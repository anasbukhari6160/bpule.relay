import type { RelayQueue, RelayTask } from '@/lib/domain/types'
import type { Lead } from '@/lib/domain/types'
import { deriveNextLeadAction } from './lead-state-machine'
import type { LeadDetail } from '@/lib/store/types'

export type NextBestActionType =
  | 'REPLY_NOW'
  | 'SEND_CONNECTION'
  | 'SEND_FIRST_DM'
  | 'SEND_FOLLOWUP'
  | 'REVIEW_REFERRAL'
  | 'APPLY_UPWORK'
  | 'RESUME_DRAFT'
  | 'RESEARCH'
  | 'WAIT'

export type NextBestActionChannel =
  | 'LINKEDIN'
  | 'UPWORK'
  | 'INBOUND'
  | 'EMAIL_FUTURE'

export interface NextBestAction {
  leadId: string | null
  jobId: string | null
  channel: NextBestActionChannel
  action: NextBestActionType
  priority: number
  reason: string
  dueAt: string | null
  senderProfile: string | null
  confidence: number
  title: string
  subtitle: string
}

export interface NextBestActionInput {
  queue: RelayQueue
  leads: LeadDetail[]
  messagesByLead: Map<string, import('@/lib/domain/types').Message[]>
  now?: number
}

/**
 * Canonical ranking layer over existing queue-engine and lead-state-machine.
 *
 * Input: the already-computed RelayQueue (from buildRelayQueue) plus raw lead data.
 * Output: a flat, priority-sorted list of NextBestAction items.
 *
 * No AI calls. No new state models. Pure ranking over stored intelligence.
 */
export function rankNextActions(input: NextBestActionInput): NextBestAction[] {
  const now = input.now ?? Date.now()
  const actions: NextBestAction[] = []
  const seenLeads = new Set<string>()

  // 1. Tasks already ranked by buildRelayQueue — trust their priority order
  for (const task of input.queue.tasks) {
    if (task.entityType === 'lead' && task.entityId) {
      if (seenLeads.has(task.entityId)) continue
      seenLeads.add(task.entityId)

      const action = taskToAction(task, input, now)
      if (action) actions.push(action)
    } else if (task.entityType === 'job' && task.entityId) {
      actions.push(jobTaskToAction(task, now))
    }
  }

  // 2. Catch any leads not in the queue but needing action
  for (const lead of input.leads) {
    if (seenLeads.has(lead.id)) continue
    if (isTerminal(lead)) continue

    const leadAction = deriveNextLeadAction(lead, now)
    if (!leadAction.requiresAction) continue

    const channel: NextBestActionChannel = lead.direction === 'inbound' ? 'INBOUND' : 'LINKEDIN'
    const nbaAction = leadActionToNba(leadAction, lead, channel, now)
    if (nbaAction) actions.push(nbaAction)
  }

  // 3. Sort: reply first, then by priority desc, then by urgency
  actions.sort((a, b) => {
    // Incoming replies always win
    if (a.action === 'REPLY_NOW' && b.action !== 'REPLY_NOW') return -1
    if (b.action === 'REPLY_NOW' && a.action !== 'REPLY_NOW') return 1
    // Then by priority score
    if (b.priority !== a.priority) return b.priority - a.priority
    // Then by due date (sooner first)
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    if (a.dueAt) return -1
    if (b.dueAt) return 1
    return 0
  })

  return actions
}

function taskToAction(task: RelayTask, input: NextBestActionInput, now: number): NextBestAction | null {
  const lead = input.leads.find((l) => l.id === task.entityId)
  const channel: NextBestActionChannel =
    task.kind === 'inbound_opportunity' ? 'INBOUND'
      : task.kind === 'job_worth_apply' ? 'UPWORK'
      : 'LINKEDIN'

  let action: NextBestActionType
  switch (task.kind) {
    case 'reply_needed':
    case 'inbound_opportunity':
      action = 'REPLY_NOW'
      break
    case 'followup_due':
      action = 'SEND_FOLLOWUP'
      break
    case 'connection_dm_due':
      action = 'SEND_FIRST_DM'
      break
    case 'high_fit_lead':
      action = 'RESEARCH'
      break
    case 'new_opportunity':
      action = 'RESEARCH'
      break
    case 'admin_review':
      action = 'WAIT'
      break
    case 'lead_going_cold':
      action = 'RESEARCH'
      break
    default:
      action = 'WAIT'
  }

  return {
    leadId: task.entityId,
    jobId: null,
    channel,
    action,
    priority: task.priorityScore,
    reason: task.whyItMatters,
    dueAt: task.createdAt ?? null,
    senderProfile: lead?.senderProfileId ?? null,
    confidence: task.recommendation.confidence,
    title: task.title,
    subtitle: task.subtitle,
  }
}

function jobTaskToAction(task: RelayTask, now: number): NextBestAction {
  const action: NextBestActionType =
    task.kind === 'proposal_ready' ? 'RESUME_DRAFT'
      : task.kind === 'job_worth_apply' ? 'APPLY_UPWORK'
      : 'WAIT'

  return {
    leadId: null,
    jobId: task.entityId,
    channel: 'UPWORK',
    action,
    priority: task.priorityScore,
    reason: task.whyItMatters,
    dueAt: task.createdAt ?? null,
    senderProfile: null,
    confidence: 0.5,
    title: task.title,
    subtitle: task.subtitle,
  }
}

function leadActionToNba(
  leadAction: ReturnType<typeof deriveNextLeadAction>,
  lead: LeadDetail,
  channel: NextBestActionChannel,
  now: number,
): NextBestAction | null {
  let action: NextBestActionType
  let priority: number

  switch (leadAction.action) {
    case 'SEND_REPLY':
      action = 'REPLY_NOW'
      priority = 100
      break
    case 'SEND_CONNECTION':
      action = 'SEND_CONNECTION'
      priority = 80
      break
    case 'SEND_DM':
      action = 'SEND_FIRST_DM'
      priority = 75
      break
    case 'SEND_FOLLOWUP':
      action = 'SEND_FOLLOWUP'
      priority = 70
      break
    case 'REVIEW':
      action = 'RESEARCH'
      priority = 50
      break
    default:
      return null
  }

  return {
    leadId: lead.id,
    jobId: null,
    channel,
    action,
    priority,
    reason: leadAction.reason,
    dueAt: leadAction.followupDue ? new Date(now).toISOString() : null,
    senderProfile: lead.senderProfileId ?? null,
    confidence: 0.5,
    title: lead.company,
    subtitle: lead.contactName ?? leadAction.primaryLabel,
  }
}

function isTerminal(lead: LeadDetail): boolean {
  return lead.status === 'won' || lead.status === 'lost' || lead.status === 'dead' || lead.status === 'no'
}

/**
 * Get the single highest-priority action for a rep.
 * Returns null if nothing needs attention.
 */
export function getNextBestAction(input: NextBestActionInput): NextBestAction | null {
  const ranked = rankNextActions(input)
  return ranked[0] ?? null
}

/**
 * Get top N actions for the rep home view.
 */
export function getTopActions(input: NextBestActionInput, n = 8): NextBestAction[] {
  return rankNextActions(input).slice(0, n)
}
