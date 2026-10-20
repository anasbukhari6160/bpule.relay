import type {
  ConversationState,
  Lead,
  Message,
  Profile,
  RelayEvidence,
  RelayQueue,
  RelayRecommendation,
  RelayRole,
  RelayRoleContext,
  RelayTask,
  RelayTaskKind,
  RelayTaskPriority,
  Rep,
  UpworkJob,
  UpworkMessage,
} from '@/lib/domain/types'
import type { FollowupDue, QueueData, UpworkSnapshot } from '@/lib/store/types'
import { analyzeReply } from './conversation-engine'
import { buildReplyStrategy } from './conversation-engine'
import { buildRevenueStrategy, sourceFromLead, toUiSnapshot } from './revenue-strategy'
import { priorityForCanonicalScore, qualifyCanonicalScore } from '@/lib/scoring/qualification'

/**
 * Relay Queue Engine
 *
 * Observe → Prioritize → Research → Prepare → Human Review
 *
 * Turns all existing data sources into a single prioritized queue.
 * Relay prepares work, never sends autonomously.
 */

export interface QueueInput {
  roleContext: RelayRoleContext
  queueData: QueueData
  followupsDue: FollowupDue[]
  upwork: UpworkSnapshot
  conversations: Map<string, ConversationState>
  messagesByLead: Map<string, Message[]>
  messagesByJob: Map<string, UpworkMessage[]>
  assignedProfiles: Profile[]
  allReps?: Rep[]
  allLeads?: Lead[]
}

const KIND_PRIORITY_BASE: Record<RelayTaskKind, number> = {
  reply_needed: 100,
  connection_dm_due: 80,
  followup_due: 70,
  high_fit_lead: 55,
  new_opportunity: 50,
  job_worth_apply: 45,
  proposal_ready: 60,
  lead_going_cold: 40,
  content_opportunity: 30,
  admin_review: 75,
  inbound_opportunity: 95,
}

/** Priority follows the canonical qualification band — one policy, no local cut-offs. */
function priorityFromScore(score: number): RelayTaskPriority {
  return priorityForCanonicalScore(score)
}

/**
 * The single function that resolves which score to use for any lead.
 * canonicalScore (0-100) is the persisted source of truth.
 * Legacy score (0-12) is only a fallback for old leads without canonical intelligence.
 */
function effectiveScore(lead: Lead): number | null {
  if (lead.canonicalScore != null) return lead.canonicalScore
  if (lead.score != null) return lead.score * (100 / 12) // Convert 0-12 → 0-100
  return null
}

function freshnessPenalty(createdAt: string): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays > 30) return -10
  if (ageDays > 14) return -5
  if (ageDays > 7) return -2
  return 0
}

/**
 * Build the full Relay queue from all available data.
 */
export function buildRelayQueue(input: QueueInput): RelayQueue {
  const tasks: RelayTask[] = []

  // 1. Inbound opportunities (highest priority — client contacted us first)
  if (input.allLeads) {
    for (const lead of input.allLeads) {
      if (lead.direction === 'inbound' && lead.status === 'new') {
        tasks.push(buildInboundTask(lead, input))
      }
    }
  }

  // 2. Reply needed
  for (const lead of input.queueData.replies) {
    tasks.push(buildReplyTask(lead, input))
  }

  // 2b. Connection message due — a good-profile lead whose 6h connection-pacing
  // lock has just expired. The DM is now the next priority, but the existing
  // gate still applies: it is only appropriate once the connection is accepted.
  // CRITICAL: Only create DM task if connection has been accepted. Otherwise
  // the lead should appear as "waiting for connection", not "DM due".
  for (const lead of input.queueData.queue) {
    if (
      lead.status === 'contacted' &&
      lead.lockedReason === 'connection_note_sent' &&
      lead.lockedUntil &&
      new Date(lead.lockedUntil).getTime() <= Date.now()
    ) {
      const already = tasks.some((t) => t.entityId === lead.id)
      if (!already && lead.connectionAcceptedAt) {
        tasks.push(buildConnectionDmTask(lead, input))
      }
    }
  }

  // 3. Follow-up due
  for (const f of input.followupsDue) {
    tasks.push(buildFollowupTask(f.lead, f.daysSinceContact, input))
  }

  // 4. High-fit leads (scored 'send' but not yet contacted)
  for (const lead of input.queueData.queue) {
    if (lead.verdict === 'send' && lead.status === 'new') {
      tasks.push(buildHighFitTask(lead, input))
    }
  }

  // 4. New qualified opportunities (recently added, scored)
  for (const lead of input.queueData.queue) {
    const leadScore = effectiveScore(lead)
    const band = leadScore === null ? null : qualifyCanonicalScore(leadScore).qualification
    if (lead.status === 'new' && (band === 'STRONG' || band === 'WORTH_PURSUING')) {
      const alreadyHighFit = tasks.some(
        (t) => t.entityId === lead.id && t.kind === 'high_fit_lead',
      )
      if (!alreadyHighFit) {
        tasks.push(buildNewOpportunityTask(lead, input))
      }
    }
  }

  // 5. Jobs worth applying to
  for (const job of input.upwork.queue) {
    if (job.verdict === 'apply' && job.status === 'new') {
      tasks.push(buildJobApplyTask(job, input))
    }
  }

  // 6. Proposals ready for review
  for (const job of input.upwork.queue) {
    if (job.status === 'drafted') {
      tasks.push(buildProposalReadyTask(job, input))
    }
  }

  // 7. Leads going cold (contacted but no reply after 10+ days)
  for (const lead of input.queueData.queue) {
    if (lead.status === 'contacted') {
      const age = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      if (age > 10) {
        tasks.push(buildColdLeadTask(lead, age, input))
      }
    }
  }

  // 8. Admin review (admin role only)
  if (input.roleContext.role === 'admin' && input.allReps && input.allLeads) {
    tasks.push(...buildAdminTasks(input))
  }

  tasks.sort((a, b) => b.priorityScore - a.priorityScore)

  const byKind = {} as Record<RelayTaskKind, number>
  for (const t of tasks) {
    byKind[t.kind] = (byKind[t.kind] ?? 0) + 1
  }

  return {
    tasks,
    roleContext: input.roleContext,
    generatedAt: new Date().toISOString(),
    stale: false,
    summary: {
      total: tasks.length,
      urgent: tasks.filter((t) => t.priority === 'urgent').length,
      byKind,
    },
  }
}

function buildReplyTask(lead: Lead, input: QueueInput): RelayTask {
  const messages = input.messagesByLead.get(lead.id) ?? []
  const convo = input.conversations.get(lead.id)
  const lastReply = messages.filter((m) => m.type === 'reply' && m.sentText).at(-1)

  const analysis = lastReply
    ? analyzeReply(lastReply.draftText ?? '', {
        leadId: lead.id,
        leadCompany: lead.company,
        contactName: lead.contactName,
        replyText: lastReply.draftText ?? '',
        priorMessages: messages.filter((m) => m.sentText),
        conversationStage: convo?.stage ?? 'new',
        senderProfileId: convo?.senderProfileId ?? null,
      })
    : null

  const strategy = analysis
    ? buildReplyStrategy(analysis, {
        leadId: lead.id,
        leadCompany: lead.company,
        contactName: lead.contactName,
        replyText: lastReply?.draftText ?? '',
        priorMessages: messages.filter((m) => m.sentText),
        conversationStage: convo?.stage ?? 'new',
        senderProfileId: convo?.senderProfileId ?? null,
      }, null)
    : null

  const evidence: RelayEvidence[] = [
    {
      source: 'message',
      detail: lastReply?.draftText
        ? `Their message: "${lastReply.draftText.slice(0, 120)}..."`
        : 'They replied to your outreach',
      timestamp: lastReply?.createdAt ?? null,
      verified: true,
    },
  ]

  if (analysis) {
    evidence.push({
      source: 'analysis',
      detail: `Intent: ${analysis.intent}, Sentiment: ${analysis.sentiment}${analysis.buyingSignal ? ' (buying signal)' : ''}`,
      timestamp: null,
      verified: false,
    })
  }

  const rec: RelayRecommendation = {
    action: strategy?.goal ?? 'Reply to their message',
    preparedOutput: null,
    evidence,
    confidence: analysis?.buyingSignal ? 0.8 : 0.5,
    forbidsImpersonation: true,
  }

  return {
    id: `reply-${lead.id}`,
    kind: 'reply_needed',
    priority: 'urgent',
    priorityScore: KIND_PRIORITY_BASE.reply_needed,
    title: lead.company,
    subtitle: lead.contactName ?? 'Reply needed',
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: analysis
      ? `They replied — detected "${analysis.intent}" intent`
      : 'They replied to your outreach',
    whyItMatters: analysis?.buyingSignal
      ? 'Buying signal detected. Fast reply wins.'
      : 'A reply is a live conversation. Respond while warm.',
    recommendation: rec,
    humanAction: 'Review their message, craft your reply, send manually',
    stale: false,
    stalenessNote: null,
    createdAt: lead.createdAt,
  }
}

function buildConnectionDmTask(lead: Lead, input: QueueInput): RelayTask {
  const unlocked = lead.lockedUntil
    ? Math.round((Date.now() - new Date(lead.lockedUntil).getTime()) / (1000 * 60))
    : 0
  const accepted = Boolean(lead.connectionAcceptedAt)
  const evidence: RelayEvidence[] = [
    {
      source: 'message',
      detail: accepted
        ? `Connection accepted. The 6h pacing window has passed — a direct message is now appropriate.`
        : `The 6h connection window has passed. The prospect may have accepted your connection — a direct message is now appropriate.`,
      timestamp: lead.lockedUntil ?? null,
      verified: true,
    },
  ]
  return {
    id: `connection-dm-${lead.id}`,
    kind: 'connection_dm_due',
    priority: 'high',
    priorityScore: KIND_PRIORITY_BASE.connection_dm_due,
    title: lead.company,
    subtitle: lead.contactName ?? 'Send connection message',
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: accepted
      ? `Connection accepted — pacing window over (${unlocked}m ago).`
      : `Connection note sent — pacing window over (${unlocked}m ago).`,
    whyItMatters: accepted
      ? 'The prospect accepted your connection. Now a DM lands in their inbox, not into the void.'
      : 'The pacing window is closed. Send your DM now — if they have not accepted yet, check LinkedIn first.',
    recommendation: {
      action: 'Send a direct message',
      preparedOutput: null,
      evidence,
      confidence: accepted ? 0.8 : 0.6,
      forbidsImpersonation: true,
    },
    humanAction: accepted
      ? 'Review the lead, craft your connection message, send manually'
      : 'Check LinkedIn for connection acceptance, then craft and send your DM manually',
    createdAt: lead.createdAt,
    stale: false,
    stalenessNote: null,
  }
}

function buildInboundTask(lead: Lead, input: QueueInput): RelayTask {
  const convo = input.conversations.get(lead.id)
  const age = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60)

  const evidence: RelayEvidence[] = [
    {
      source: lead.source ?? 'inbound',
      detail: lead.inboundMessage
        ? `Client message: "${lead.inboundMessage.slice(0, 150)}"`
        : 'Inbound request received',
      timestamp: lead.createdAt,
      verified: true,
    },
  ]

  if (convo?.senderProfileId) {
    const profile = input.assignedProfiles.find((p) => p.id === convo.senderProfileId)
    if (profile) {
      evidence.push({
        source: 'identity',
        detail: `Assigned identity: ${profile.label ?? profile.platform}`,
        timestamp: null,
        verified: true,
      })
    }
  }

  const rec: RelayRecommendation = {
    action: 'Review inbound request and generate a reply',
    preparedOutput: null,
    evidence,
    confidence: 0.9,
    forbidsImpersonation: true,
  }

  let title = `New inbound — ${lead.company}`
  if (lead.contactName) title = `New inbound — ${lead.contactName} (${lead.company})`

  const subtitle = age < 1
    ? 'Reply needed'
    : age < 4
      ? `Waiting ${Math.round(age)}h — needs attention`
      : `Waiting ${Math.round(age)}h — high priority`

  return {
    id: `inbound-${lead.id}`,
    kind: 'inbound_opportunity',
    priority: age < 4 ? 'urgent' : 'high',
    priorityScore: KIND_PRIORITY_BASE.inbound_opportunity - Math.round(age),
    title,
    subtitle,
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: lead.inboundMessage
      ? `Client contacted you: "${lead.inboundMessage.slice(0, 80)}..."`
      : 'Client contacted you first',
    whyItMatters: 'Inbound leads convert at higher rates. Respond quickly.',
    recommendation: rec,
    humanAction: 'Review, generate reply, send manually',
    stale: age > 24,
    stalenessNote: age > 24 ? `Inbound waiting ${Math.round(age)}h — risk of losing them` : null,
    createdAt: lead.createdAt,
  }
}

function buildFollowupTask(lead: Lead, daysSince: number, input: QueueInput): RelayTask {
  const messages = input.messagesByLead.get(lead.id) ?? []
  const convo = input.conversations.get(lead.id)
  const lastSent = messages.filter((m) => m.sentText && m.sentAt).sort((a, b) =>
    (a.sentAt ?? '').localeCompare(b.sentAt ?? '')
  ).at(-1)

  const senderProfileId = convo?.senderProfileId ?? lead.senderProfileId ?? null
  const senderProfile = senderProfileId
    ? input.assignedProfiles.find((p) => p.id === senderProfileId) ?? null
    : null

  const evidence: RelayEvidence[] = [
    {
      source: 'message',
      detail: lastSent?.sentText
        ? `Last sent: "${lastSent.sentText.slice(0, 100)}..."`
        : 'You sent a message',
      timestamp: lastSent?.sentAt ?? null,
      verified: true,
    },
    {
      source: 'time',
      detail: `${daysSince} business days without a reply`,
      timestamp: null,
      verified: true,
    },
    ...(senderProfile ? [{
      source: 'profile' as const,
      detail: `Sender profile: ${senderProfile.displayName ?? senderProfile.fullName ?? 'Unknown'}`,
      timestamp: null,
      verified: true,
    }] : []),
  ]

  const rec: RelayRecommendation = {
    action: 'Send your next follow-up',
    preparedOutput: null,
    evidence,
    confidence: 0.6,
    forbidsImpersonation: true,
  }

  return {
    id: `followup-${lead.id}`,
    kind: 'followup_due',
    priority: daysSince >= 7 ? 'urgent' : 'high',
    priorityScore: KIND_PRIORITY_BASE.followup_due + (daysSince >= 7 ? 10 : 0),
    title: lead.company,
    subtitle: lead.contactName ?? 'Follow-up due',
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: `${daysSince} business days since your last send, no reply`,
    whyItMatters: 'Relay allows up to 3 follow-ups per lead. Use each one when it adds value.',
    recommendation: rec,
    humanAction: 'Review and send your next follow-up, or let it go',
    stale: false,
    stalenessNote: null,
    createdAt: lead.createdAt,
  }
}

function buildHighFitTask(lead: Lead, _input: QueueInput): RelayTask {
  const score = effectiveScore(lead)
  const evidence: RelayEvidence[] = [
    {
      source: 'score',
      detail: `Score: ${score ?? '?'}/100, Verdict: ${lead.verdict}`,
      timestamp: null,
      verified: true,
    },
    {
      source: 'signal',
      detail: lead.signalEvidence
        ? `Signal: ${lead.signalEvidence.slice(0, 120)}`
        : `Signal type: ${lead.signalType}`,
      timestamp: null,
      verified: lead.signalType === 1 || lead.signalType === 7,
    },
  ]

  if (lead.verbatimQuote) {
    evidence.push({
      source: 'verbatim',
      detail: `Their words: "${lead.verbatimQuote.slice(0, 100)}"`,
      timestamp: null,
      verified: true,
    })
  }

  const rec: RelayRecommendation = {
    action: 'Reach out — this lead scored high',
    preparedOutput: null,
    evidence,
    confidence: score ? score / 100 : 0.5,
    forbidsImpersonation: true,
  }

  return {
    id: `highfit-${lead.id}`,
    kind: 'high_fit_lead',
    priority: priorityFromScore(score ?? 0),
    priorityScore: KIND_PRIORITY_BASE.high_fit_lead + (score ?? 0) / 10 + freshnessPenalty(lead.createdAt),
    title: lead.company,
    subtitle: lead.contactTitle
      ? `${lead.contactName ?? 'Contact'} · ${lead.contactTitle}`
      : (lead.contactName ?? 'High-fit lead'),
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: `Scored ${score ?? '?'}/100 — ready for outreach`,
    whyItMatters: whyLeadMatters(lead),
    recommendation: rec,
    humanAction: 'Review, draft outreach, send manually',
    stale: freshnessPenalty(lead.createdAt) < -5,
    stalenessNote: freshnessPenalty(lead.createdAt) < -5
      ? 'Lead is aging — signal may no longer be relevant'
      : null,
    createdAt: lead.createdAt,
  }
}

function buildNewOpportunityTask(lead: Lead, _input: QueueInput): RelayTask {
  const score = effectiveScore(lead)
  const evidence: RelayEvidence[] = [
    {
      source: 'score',
      detail: `Score: ${score ?? '?'}/100, Verdict: ${lead.verdict ?? 'unscored'}`,
      timestamp: null,
      verified: true,
    },
  ]

  const rec: RelayRecommendation = {
    action: 'Review and decide if worth pursuing',
    preparedOutput: null,
    evidence,
    confidence: 0.5,
    forbidsImpersonation: true,
  }

  return {
    id: `opportunity-${lead.id}`,
    kind: 'new_opportunity',
    priority: 'medium',
    priorityScore: KIND_PRIORITY_BASE.new_opportunity + freshnessPenalty(lead.createdAt),
    title: lead.company,
    subtitle: lead.contactName ?? 'New opportunity',
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: 'New lead added and scored',
    whyItMatters: 'Fresh opportunity — research while context is current.',
    recommendation: rec,
    humanAction: 'Review lead quality, decide to contact or skip',
    stale: false,
    stalenessNote: null,
    createdAt: lead.createdAt,
  }
}

function buildJobApplyTask(job: UpworkJob, _input: QueueInput): RelayTask {
  const evidence: RelayEvidence[] = [
    {
      source: 'job',
      detail: job.description.slice(0, 150),
      timestamp: job.postedAt ?? null,
      verified: true,
    },
  ]

  if (job.budgetMax) {
    evidence.push({
      source: 'budget',
      detail: job.hourlyRateMax
        ? `Hourly: $${job.hourlyRateMin}-${job.hourlyRateMax}/hr`
        : `Budget: $${job.budgetMin}-${job.budgetMax}`,
      timestamp: null,
      verified: true,
    })
  }

  const rec: RelayRecommendation = {
    action: 'Review and apply — job scored as strong match',
    preparedOutput: null,
    evidence,
    confidence: job.score ? job.score / 100 : 0.5,
    forbidsImpersonation: true,
  }

  return {
    id: `apply-${job.id}`,
    kind: 'job_worth_apply',
    priority: 'high',
    priorityScore: KIND_PRIORITY_BASE.job_worth_apply + (job.score ?? 0) / 10,
    title: job.title,
    subtitle: `Upwork · ${Array.isArray(job.requiredSkills) ? job.requiredSkills.slice(0, 3).join(', ') : ''}`,
    entityType: 'job',
    entityId: job.id,
    whatHappened: `Scored ${job.score ?? '?'}/100 — strong match`,
    whyItMatters: job.urgencySignal
      ? `Urgency: ${job.urgencySignal}`
      : 'High-fit job worth applying to.',
    recommendation: rec,
    humanAction: 'Review draft proposal, edit, submit manually',
    stale: false,
    stalenessNote: null,
    createdAt: job.createdAt,
  }
}

function buildProposalReadyTask(job: UpworkJob, input: QueueInput): RelayTask {
  const messages = input.messagesByJob.get(job.id) ?? []
  const draft = messages.find((m) => m.draftText && !m.sentText)

  const evidence: RelayEvidence[] = [
    {
      source: 'draft',
      detail: draft?.draftText
        ? `Draft ready: "${draft.draftText.slice(0, 100)}..."`
        : 'Proposal drafted',
      timestamp: draft?.createdAt ?? null,
      verified: true,
    },
  ]

  const rec: RelayRecommendation = {
    action: 'Review your proposal draft',
    preparedOutput: draft?.draftText ?? null,
    evidence,
    confidence: 0.7,
    forbidsImpersonation: true,
  }

  return {
    id: `proposal-${job.id}`,
    kind: 'proposal_ready',
    priority: 'high',
    priorityScore: KIND_PRIORITY_BASE.proposal_ready,
    title: job.title,
    subtitle: 'Upwork · Proposal ready for review',
    entityType: 'job',
    entityId: job.id,
    whatHappened: 'Proposal drafted and ready for your review',
    whyItMatters: 'Review before submitting ensures quality.',
    recommendation: rec,
    humanAction: 'Edit and submit your proposal',
    stale: false,
    stalenessNote: null,
    createdAt: job.createdAt,
  }
}

function buildColdLeadTask(lead: Lead, ageDays: number, _input: QueueInput): RelayTask {
  const evidence: RelayEvidence[] = [
    {
      source: 'time',
      detail: `${Math.round(ageDays)} days since added, still contacted with no reply`,
      timestamp: lead.createdAt,
      verified: true,
    },
  ]

  const rec: RelayRecommendation = {
    action: 'Decide: follow up (up to 3 allowed) or archive',
    preparedOutput: null,
    evidence,
    confidence: 0.3,
    forbidsImpersonation: true,
  }

  return {
    id: `cold-${lead.id}`,
    kind: 'lead_going_cold',
    priority: 'low',
    priorityScore: KIND_PRIORITY_BASE.lead_going_cold + freshnessPenalty(lead.createdAt),
    title: lead.company,
    subtitle: lead.contactName ?? 'No reply yet',
    entityType: 'lead',
    entityId: lead.id,
    whatHappened: `Contacted ${Math.round(ageDays)} days ago, no reply`,
    whyItMatters: 'Leads going cold lose momentum. Up to 3 follow-ups remain.',
    recommendation: rec,
    humanAction: 'Send your next follow-up or mark as no-reply',
    stale: false,
    stalenessNote: ageDays > 21 ? 'Very cold — unlikely to get a reply' : null,
    createdAt: lead.createdAt,
  }
}

function buildAdminTasks(input: QueueInput): RelayTask[] {
  const tasks: RelayTask[] = []
  const { allReps, allLeads } = input
  if (!allReps || !allLeads) return tasks

  const now = Date.now()
  const leadsByRep = new Map<string, Lead[]>()
  for (const lead of allLeads) {
    if (lead.ownerRepId) {
      const arr = leadsByRep.get(lead.ownerRepId) ?? []
      arr.push(lead)
      leadsByRep.set(lead.ownerRepId, arr)
    }
  }

  for (const rep of allReps) {
    if (rep.role === 'sourcer') continue
    const repAgeDays = (now - new Date(rep.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    if (repAgeDays < 14) continue
    const repLeads = leadsByRep.get(rep.id) ?? []
    const recentSent = repLeads.filter((l) => {
      const age = (now - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      return l.status !== 'new' && age < 14
    })
    if (repLeads.length > 0 && recentSent.length === 0) {
      tasks.push({
        id: `admin-inactive-${rep.id}`,
        kind: 'admin_review',
        priority: 'medium',
        priorityScore: KIND_PRIORITY_BASE.admin_review,
        title: `${rep.name} may need support`,
        subtitle: `No outreach in 14+ days · ${repLeads.length} leads`,
        entityType: 'admin',
        entityId: rep.id,
        whatHappened: 'Rep has leads but no recent outreach activity',
        whyItMatters: 'Team member may need coaching or has stalled.',
        recommendation: {
          action: 'Check in with this rep',
          preparedOutput: null,
          evidence: [{
            source: 'activity',
            detail: `${repLeads.length} assigned leads, none contacted recently`,
            timestamp: null,
            verified: true,
          }],
          confidence: 0.6,
          forbidsImpersonation: false,
        },
        humanAction: 'Review rep activity and offer support',
        stale: false,
        stalenessNote: null,
        createdAt: new Date().toISOString(),
      })
    }
  }

  return tasks
}

/**
 * Filter queue tasks based on role.
 * Admins see everything including admin_review tasks.
 * BD sees only their own pipeline tasks.
 */
function whyLeadMatters(lead: Lead): string {
  const snapshot = toUiSnapshot(buildRevenueStrategy(sourceFromLead(lead, null, { channel: 'dm' })))
  return snapshot.why
}

export function filterQueueByRole(queue: RelayQueue, role: RelayRole): RelayTask[] {
  if (role === 'admin') return queue.tasks
  return queue.tasks.filter((t) => t.kind !== 'admin_review')
}
