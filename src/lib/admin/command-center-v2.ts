// Command Center V2 — unified admin operating view.
// Answers: What happened? Who worked? What needs attention? Where are the opportunities?

// Command Center V2 data layer


export type ExceptionSeverity = 'attention' | 'urgent' | 'critical'
export type TeamMemberStatus = 'active' | 'waiting' | 'needs_attention' | 'inactive'

export interface DailyBrief {
  date: string
  activeReps: number
  totalActions: number
  connectionsSent: number
  dmsSent: number
  followupsSent: number
  repliesReceived: number
  leadsExtracted: number
  opportunities: number
  wins: number
  referrals: number
}

export interface TeamRow {
  repId: string
  repName: string
  status: TeamMemberStatus
  lastActivityMinutes: number | null
  actionsToday: number
  connectionsSent: number
  dmsSent: number
  followupsSent: number
  repliesReceived: number
  leadsExtracted: number
  opportunities: number
  assignedLeads: number
  pendingReplies: number
}

export interface ExceptionItem {
  id: string
  type: 'reply_waiting' | 'followup_overdue' | 'stale_lead' | 'weak_profile' | 'referral_waiting' | 'high_value_ignored' | 'inactive_rep'
  severity: ExceptionSeverity
  title: string
  detail: string
  repId: string | null
  repName: string | null
  leadId: string | null
  leadCompany: string | null
  minutesWaiting: number | null
}

export interface OpportunityFeedItem {
  leadId: string
  company: string
  contactName: string | null
  score: number
  repId: string
  repName: string
  currentProfileId: string | null
  currentProfileName: string | null
  currentProfileScore: number | null
  recommendedProfileId: string | null
  recommendedProfileName: string | null
  recommendedProfileScore: number | null
  currentStage: string
  lastActionAt: string | null
  daysSinceAction: number | null
}

export interface SinceYesterday {
  newLeads: number
  newReplies: number
  opportunitiesAdvanced: number
  leadsWentStale: number
  referralsUntouched: number
  repsWentInactive: number
  wins: number
}

export interface RepQueueSnapshot {
  repId: string
  repName: string
  topActions: {
    action: string
    company: string
    reason: string
    urgency: string
    leadId: string | null
  }[]
  pendingReplies: number
  overdueFollowups: number
  untouchedReferrals: number
  staleLeads: number
}

export interface CommandCenterData {
  brief: DailyBrief
  sinceYesterday: SinceYesterday | null
  team: TeamRow[]
  exceptions: ExceptionItem[]
  opportunities: OpportunityFeedItem[]
  repQueueSnapshots?: RepQueueSnapshot[]
}


function getClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createServiceSupabase } = require('@/lib/supabase/service')
  return createServiceSupabase()
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

/**
 * Compute UTC timestamps for a local-date boundary.
 * "2026-10-08" in Asia/Karachi → UTC range covering Pakistan's full day.
 */
function dateRange(date: string, timezone: string = 'UTC'): { start: string; end: string } {
  try {
    const startLocal = new Date(`${date}T00:00:00`)
    const endLocal = new Date(`${date}T23:59:59.999`)

    if (timezone === 'UTC') {
      return {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`,
      }
    }

    // Use the timezone offset to convert local date boundaries to UTC
    const startStr = startLocal.toLocaleString('en-US', { timeZone: timezone })
    const endStr = endLocal.toLocaleString('en-US', { timeZone: timezone })

    const startUtc = new Date(startStr).toISOString()
    const endUtc = new Date(endStr).toISOString()

    const startDate = startUtc.split('T')[0]
    const endDate = endUtc.split('T')[0]

    if (startDate !== date) {
      // Positive offset (ahead of UTC): subtract hours to get correct UTC start
      const diff = new Date(endDate).getTime() - new Date(date).getTime()
      const adjustedStart = new Date(startLocal.getTime() - diff)
      const adjustedEnd = new Date(endLocal.getTime() - diff)
      return {
        start: adjustedStart.toISOString(),
        end: adjustedEnd.toISOString(),
      }
    }

    return { start: startUtc, end: endUtc }
  } catch {
    return {
      start: `${date}T00:00:00.000Z`,
      end: `${date}T23:59:59.999Z`,
    }
  }
}

function computeRepStatus(
  actions: number,
  lastMin: number | null,
  pendingReplies: number,
  assignedLeads: number,
  actionableLeads: number,
  isToday: boolean,
): TeamMemberStatus {
  if (!isToday) return 'waiting'
  if (actions > 0) {
    if (pendingReplies > 0) return 'needs_attention'
    return 'active'
  }
  if (assignedLeads === 0) return 'waiting'
  if (actionableLeads === 0) return 'waiting'
  if (lastMin !== null && lastMin > 240) return 'inactive'
  return 'waiting'
}

/**
 * Determine if a lead is actionable (YOUR_MOVE) vs waiting (THEIR_MOVE).
 * A lead is actionable if the rep has something to do:
 * - New lead (needs connection)
 * - Connection accepted (needs DM)
 * - Reply received (needs response)
 * - Follow-up due
 * Not actionable if:
 * - Waiting for connection acceptance
 * - Waiting for reply after outbound
 * - Follow-up not yet due
 */
function isLeadActionable(lead: {
  status: string
  conversation_states?: Array<{
    stage: string
    last_reply_at: string | null
    last_sent_at: string | null
    next_followup_at: string | null
  }>
}): boolean {
  const cs = lead.conversation_states?.[0]
  const stage = cs?.stage || lead.status

  // Won/lost/dead — not actionable
  if (['won', 'lost', 'dead'].includes(stage)) return false

  if (cs?.next_followup_at && new Date(cs.next_followup_at).getTime() <= Date.now()) return true

  if (cs?.last_reply_at && cs?.last_sent_at && cs.last_reply_at > cs.last_sent_at) return true

  if (['new', 'contacted'].includes(stage)) return true

  // Waiting for reply after outbound — their_move
  if (['followed_up', 'replied'].includes(stage)) return false

  return false
}


export async function loadCommandCenterData(
  orgId: string,
  date: string,
  timezone: string = 'UTC',
): Promise<CommandCenterData> {
  const client = getClient()
  const { start, end } = dateRange(date, timezone)
  const now = Date.now()

  // Compute "today" in the org's timezone
  const todayInTz = new Date().toLocaleString('en-US', { timeZone: timezone })
  const todayStr = new Date(todayInTz).toISOString().split('T')[0]
  const isToday = date === todayStr

  const { data: events } = await client
    .from('action_events')
    .select('id, action_type, actor_id, actor_type, lead_id, occurred_at, sender_profile_id')
    .eq('organization_id', orgId)
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .order('occurred_at', { ascending: false })
    .limit(1000)

  const { data: reps } = await client
    .from('reps')
    .select('id, name')
    .eq('organization_id', orgId)
    .order('name')

  const { data: leads } = await client
    .from('leads')
    .select(`
      id,
      company,
      contact_name,
      status,
      canonical_score,
      owner_rep_id,
      sender_profile_id,
      created_at,
      conversation_states (stage, last_reply_at, last_sent_at, next_followup_at)
    `)
    .eq('organization_id', orgId)
    .eq('archived', false)
    .limit(500)

  const senderProfileIds = new Set<string>()
  for (const lead of leads || []) {
    if (lead.sender_profile_id) senderProfileIds.add(lead.sender_profile_id as string)
  }
  const { data: senderProfiles } = senderProfileIds.size > 0
    ? await client.from('profiles').select('id, identity_name').in('id', [...senderProfileIds])
    : { data: [] }
  const profileNameMap = new Map<string, string>((senderProfiles || []).map((p: { id: string; identity_name: string }) => [p.id, p.identity_name] as [string, string]))

  const { data: profileMatches } = await client
    .from('profile_opportunity_matches')
    .select('lead_id, profile_id, match_score')
    .eq('organization_id', orgId)
    .order('match_score', { ascending: false })
    .limit(500)

  // repNames available for future use
  void reps

  const repEventMap = new Map<string, {
    actions: number
    connectionsSent: number
    dmsSent: number
    followupsSent: number
    repliesReceived: number
    leadsExtracted: number
    opportunities: number
    wins: number
    lastActivityAt: string | null
  }>()

  for (const event of events || []) {
    if (event.actor_type !== 'rep' || !event.actor_id) continue
    const repId = event.actor_id as string
    if (!repEventMap.has(repId)) {
      repEventMap.set(repId, {
        actions: 0, connectionsSent: 0, dmsSent: 0, followupsSent: 0,
        repliesReceived: 0, leadsExtracted: 0, opportunities: 0, wins: 0,
        lastActivityAt: null,
      })
    }
    const r = repEventMap.get(repId)!
    r.actions++
    r.lastActivityAt = event.occurred_at as string
    switch (event.action_type) {
      case 'CONNECTION_SENT': r.connectionsSent++; break
      case 'DM_SENT': r.dmsSent++; break
      case 'FOLLOWUP_SENT': r.followupsSent++; break
      case 'REPLY_RECEIVED': r.repliesReceived++; break
      case 'LEAD_EXTRACTED': case 'UPWORK_JOB_EXTRACTED': r.leadsExtracted++; break
      case 'OPPORTUNITY_CREATED': case 'CLIENT_WON': r.opportunities++; break
    }
  }

  const leadsByRep = new Map<string, typeof leads>()
  for (const lead of leads || []) {
    const repId = lead.owner_rep_id as string
    if (!repId) continue
    const arr = leadsByRep.get(repId) || []
    arr.push(lead)
    leadsByRep.set(repId, arr)
  }

  const bestProfileByLead = new Map<string, { id: string; score: number }>()
  for (const match of profileMatches || []) {
    const leadId = match.lead_id as string
    if (!leadId) continue
    if (!bestProfileByLead.has(leadId)) {
      bestProfileByLead.set(leadId, {
        id: match.profile_id as string,
        score: match.match_score as number,
      })
    }
  }
  const bestProfileIds = new Set([...bestProfileByLead.values()].map(v => v.id))
  const { data: bestProfileData } = bestProfileIds.size > 0
    ? await client.from('profiles').select('id, identity_name').in('id', [...bestProfileIds])
    : { data: [] }
  const bestProfileNameMap = new Map<string, string>((bestProfileData || []).map((p: { id: string; identity_name: string }) => [p.id, p.identity_name] as [string, string]))

  const team: TeamRow[] = (reps || []).map((rep: { id: string; name: string }) => {
    const ev = repEventMap.get(rep.id)
    const repLeads = leadsByRep.get(rep.id) || []
    const assignedLeads = repLeads.length

    // Count pending replies: leads where client replied outbound but no reply sent today
    let pendingReplies = 0
    for (const lead of repLeads) {
      const cs = (lead.conversation_states as unknown as { last_reply_at: string | null; last_sent_at: string | null }[] | null)?.[0]
      if (cs?.last_reply_at && cs?.last_sent_at && cs.last_reply_at > cs.last_sent_at) {
        const replyDay = (cs.last_reply_at as string).split('T')[0]
        if (replyDay >= date) {
          const hasReplyAfter = (events || []).some(
            (e: { actor_id: string; lead_id: string; action_type: string; occurred_at: string }) =>
              e.actor_id === rep.id && e.lead_id === lead.id &&
              e.action_type === 'REPLY_SENT' && e.occurred_at > (cs.last_reply_at as string)
          )
          if (!hasReplyAfter) pendingReplies++
        }
      }
    }

    const lastMin = minutesSince(ev?.lastActivityAt ?? null)
    const actionableLeads = repLeads.filter((l: Record<string, unknown>) => isLeadActionable({
      status: l.status as string,
      conversation_states: l.conversation_states as unknown as { stage: string; last_reply_at: string | null; last_sent_at: string | null; next_followup_at: string | null }[],
    })).length
    const status = computeRepStatus(ev?.actions ?? 0, lastMin, pendingReplies, assignedLeads, actionableLeads, isToday)

    return {
      repId: rep.id,
      repName: rep.name,
      status,
      lastActivityMinutes: lastMin,
      actionsToday: ev?.actions ?? 0,
      connectionsSent: ev?.connectionsSent ?? 0,
      dmsSent: ev?.dmsSent ?? 0,
      followupsSent: ev?.followupsSent ?? 0,
      repliesReceived: ev?.repliesReceived ?? 0,
      leadsExtracted: ev?.leadsExtracted ?? 0,
      opportunities: ev?.opportunities ?? 0,
      assignedLeads,
      pendingReplies,
    }
  })

  const exceptions: ExceptionItem[] = []

  for (const rep of reps || []) {
    const row = team.find(t => t.repId === rep.id)
    const repLeads = leadsByRep.get(rep.id) || []

    for (const lead of repLeads) {
      const cs = (lead.conversation_states as unknown as {
        last_reply_at: string | null
        last_sent_at: string | null
        next_followup_at: string | null
      }[] | null)?.[0]

      // Reply waiting
      if (cs?.last_reply_at && cs?.last_sent_at && cs.last_reply_at > cs.last_sent_at) {
        const minutes = minutesSince(cs.last_reply_at)
        if (minutes !== null && minutes > 60) {
          exceptions.push({
            id: `reply-${lead.id}`,
            type: 'reply_waiting',
            severity: minutes > 480 ? 'urgent' : 'attention',
            title: `${rep.name} — reply waiting`,
            detail: `${lead.company || lead.contact_name || 'Lead'} replied ${formatMinutes(minutes)} ago`,
            repId: rep.id,
            repName: rep.name,
            leadId: lead.id,
            leadCompany: lead.company as string,
            minutesWaiting: minutes,
          })
        }
      }

      // Follow-up overdue
      if (cs?.next_followup_at) {
        const overdueMin = Math.floor((now - new Date(cs.next_followup_at).getTime()) / 60000)
        if (overdueMin > 60) {
          exceptions.push({
            id: `followup-${lead.id}`,
            type: 'followup_overdue',
            severity: overdueMin > 2880 ? 'urgent' : 'attention',
            title: `${rep.name} — follow-up overdue`,
            detail: `${lead.company || lead.contact_name || 'Lead'} was due ${formatMinutes(overdueMin)} ago`,
            repId: rep.id,
            repName: rep.name,
            leadId: lead.id,
            leadCompany: lead.company as string,
            minutesWaiting: overdueMin,
          })
        }
      }

      // Stale lead
      const days = daysSince(lead.created_at as string)
      if (days !== null && days >= 14 && ['new', 'contacted', 'followed_up'].includes(lead.status as string)) {
        exceptions.push({
          id: `stale-${lead.id}`,
          type: 'stale_lead',
          severity: days >= 30 ? 'urgent' : 'attention',
          title: `${rep.name} — stale lead (${days}d)`,
          detail: `${lead.company || lead.contact_name || 'Lead'} unchanged for ${days} days`,
          repId: rep.id,
          repName: rep.name,
          leadId: lead.id,
          leadCompany: lead.company as string,
          minutesWaiting: days * 1440,
        })
      }
    }

    // Inactive rep (today only)
    if (isToday && row && row.actionsToday === 0 && row.assignedLeads > 0) {
      exceptions.push({
        id: `inactive-${rep.id}`,
        type: 'inactive_rep',
        severity: 'attention',
        title: `${rep.name} has not acted today`,
        detail: `${row.assignedLeads} leads assigned, 0 actions so far`,
        repId: rep.id,
        repName: rep.name,
        leadId: null,
        leadCompany: null,
        minutesWaiting: row.lastActivityMinutes,
      })
    }
  }

  const opportunities: OpportunityFeedItem[] = []
  for (const rep of reps || []) {
    const repLeads = leadsByRep.get(rep.id) || []
    for (const lead of repLeads) {
      const score = (lead.canonical_score as number) || 0
      if (score < 60) continue

      const currentProfileName = lead.sender_profile_id ? profileNameMap.get(lead.sender_profile_id as string) : null
      const best = bestProfileByLead.get(lead.id as string)
      const cs = (lead.conversation_states as unknown as { stage: string; last_sent_at: string | null }[] | null)?.[0]

      opportunities.push({
        leadId: lead.id as string,
        company: (lead.company as string) || 'Unknown',
        contactName: (lead.contact_name as string) || null,
        score,
        repId: rep.id,
        repName: rep.name,
        currentProfileId: (lead.sender_profile_id as string) || null,
        currentProfileName: currentProfileName ?? null,
        currentProfileScore: null,
        recommendedProfileId: best?.id || null,
        recommendedProfileName: best ? (bestProfileNameMap.get(best.id) ?? null) : null,
        recommendedProfileScore: best?.score || null,
        currentStage: cs?.stage || (lead.status as string),
        lastActionAt: cs?.last_sent_at || null,
        daysSinceAction: daysSince(cs?.last_sent_at || null),
      })
    }
  }

  opportunities.sort((a, b) => b.score - a.score)

  const severityOrder: Record<ExceptionSeverity, number> = { critical: 0, urgent: 1, attention: 2 }
  exceptions.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity]
    if (sev !== 0) return sev
    return (b.minutesWaiting || 0) - (a.minutesWaiting || 0)
  })

  const statusOrder: Record<TeamMemberStatus, number> = { active: 0, waiting: 1, needs_attention: 2, inactive: 3 }
  team.sort((a, b) => {
    const sa = statusOrder[a.status] - statusOrder[b.status]
    if (sa !== 0) return sa
    return b.actionsToday - a.actionsToday
  })

  const activeReps = team.filter(t => t.status === 'active' || t.status === 'waiting').length
  const brief: DailyBrief = {
    date,
    activeReps,
    totalActions: team.reduce((s, t) => s + t.actionsToday, 0),
    connectionsSent: team.reduce((s, t) => s + t.connectionsSent, 0),
    dmsSent: team.reduce((s, t) => s + t.dmsSent, 0),
    followupsSent: team.reduce((s, t) => s + t.followupsSent, 0),
    repliesReceived: team.reduce((s, t) => s + t.repliesReceived, 0),
    leadsExtracted: team.reduce((s, t) => s + t.leadsExtracted, 0),
    opportunities: team.reduce((s, t) => s + t.opportunities, 0),
    wins: 0,
    referrals: 0,
  }

  let sinceYesterday: SinceYesterday | null = null
  if (isToday) {
    const prevDate = getPreviousDate(date)
    const prevRange = dateRange(prevDate, timezone)

    const prevSummary = await client
      .from('action_events')
      .select('action_type, actor_id')
      .eq('organization_id', orgId)
      .gte('occurred_at', prevRange.start)
      .lt('occurred_at', prevRange.end)
      .limit(1000)

    const prevEvents = (prevSummary.data || []) as Array<{ action_type: string; actor_id: string | null; occurred_at: string }>
    const prevLeadExtractions = prevEvents.filter((e) => e.action_type === 'LEAD_EXTRACTED').length
    const prevRepliesReceived = prevEvents.filter((e) => e.action_type === 'REPLY_RECEIVED').length
    const prevOpportunities = prevEvents.filter((e) => e.action_type === 'OPPORTUNITY_CREATED' || e.action_type === 'CLIENT_WON').length

    // Count referrals that happened yesterday but receiving rep hasn't acted today
    const prevReferrals = prevEvents.filter((e) => e.action_type === 'LEAD_REFERRED')
    let referralsUntouched = 0
    for (const ref of prevReferrals) {
      const hasAction = (events as Array<{ actor_id: string | null; occurred_at: string }> || []).some((e) =>
        e.actor_id === ref.actor_id && e.occurred_at > ref.occurred_at
      )
      if (!hasAction) referralsUntouched++
    }

    sinceYesterday = {
      newLeads: brief.leadsExtracted - prevLeadExtractions,
      newReplies: brief.repliesReceived - prevRepliesReceived,
      opportunitiesAdvanced: brief.opportunities - prevOpportunities,
      leadsWentStale: exceptions.filter(e => e.type === 'stale_lead').length,
      referralsUntouched,
      repsWentInactive: team.filter(t => t.status === 'inactive').length,
      wins: 0,
    }
  }

  return { brief, sinceYesterday, team, exceptions: exceptions.slice(0, 20), opportunities: opportunities.slice(0, 15) }
}

function getPreviousDate(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`
  return `${Math.floor(min / 1440)}d`
}

/**
 * Load a per-rep ranked work queue snapshot for admin visibility.
 * Extends Command Center — does NOT create a new dashboard.
 * Returns top 5 actions per rep, plus exception counts.
 */
export async function loadRepQueueSnapshot(
  orgId: string,
  repId: string,
  repName: string,
  date: string,
): Promise<RepQueueSnapshot> {
  const client = getClient()
  const now = Date.now()

  const { data: leads } = await client
    .from('leads')
    .select(`
      id, company, contact_name, status, canonical_score,
      sender_profile_id, created_at,
      conversation_states (stage, last_reply_at, last_sent_at, next_followup_at)
    `)
    .eq('organization_id', orgId)
    .eq('owner_rep_id', repId)
    .eq('archived', false)
    .limit(100)

  const actions: RepQueueSnapshot['topActions'] = []
  let pendingReplies = 0
  let overdueFollowups = 0
  let untouchedReferrals = 0
  let staleLeads = 0

  for (const lead of leads || []) {
    const cs = (lead.conversation_states as unknown as {
      stage: string
      last_reply_at: string | null
      last_sent_at: string | null
      next_followup_at: string | null
    }[] | null)?.[0]

    // Reply waiting
    if (cs?.last_reply_at && cs?.last_sent_at && cs.last_reply_at > cs.last_sent_at) {
      pendingReplies++
      const mins = Math.floor((now - new Date(cs.last_reply_at).getTime()) / 60000)
      actions.push({
        action: 'Reply',
        company: (lead.company as string) || 'Unknown',
        reason: `Client replied ${formatMinutes(mins)} ago`,
        urgency: mins > 480 ? 'urgent' : 'high',
        leadId: lead.id as string,
      })
    }

    // Follow-up overdue
    if (cs?.next_followup_at && new Date(cs.next_followup_at).getTime() <= now) {
      const overdueMin = Math.floor((now - new Date(cs.next_followup_at).getTime()) / 60000)
      if (overdueMin > 60) {
        overdueFollowups++
        actions.push({
          action: 'Follow up',
          company: (lead.company as string) || 'Unknown',
          reason: `Due ${formatMinutes(overdueMin)} ago`,
          urgency: overdueMin > 2880 ? 'urgent' : 'medium',
          leadId: lead.id as string,
        })
      }
    }

    // Stale lead
    const days = Math.floor((now - new Date(lead.created_at as string).getTime()) / 86400000)
    if (days >= 14 && ['new', 'contacted'].includes(lead.status as string)) {
      staleLeads++
      actions.push({
        action: 'Decide',
        company: (lead.company as string) || 'Unknown',
        reason: `Untouched for ${days} days`,
        urgency: days >= 30 ? 'urgent' : 'low',
        leadId: lead.id as string,
      })
    }

    // High-value untouched
    const score = (lead.canonical_score as number) || 0
    if (lead.status === 'new' && score >= 70) {
      actions.push({
        action: 'Contact',
        company: (lead.company as string) || 'Unknown',
        reason: `Score ${score}/100 — strong match`,
        urgency: 'medium',
        leadId: lead.id as string,
      })
    }
  }

  // Sort: urgent first, then high, then by urgency order
  const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  actions.sort((a, b) => (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4))

  return {
    repId,
    repName,
    topActions: actions.slice(0, 5),
    pendingReplies,
    overdueFollowups,
    untouchedReferrals,
    staleLeads,
  }
}
