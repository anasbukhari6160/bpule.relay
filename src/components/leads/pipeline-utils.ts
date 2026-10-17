import type { Lead } from '@/lib/domain/types'
import { getComparableLeadScore } from '@/lib/score/rubric'
import { isLeadLocked } from '@/lib/leads/lock'
import { computeLifecycleState, type LifecycleState, type LifecycleResult } from '@/lib/leads/lifecycle-policy'
import { isFollowupDue } from '@/lib/leads/followup'
import { formatRelativeTime } from '@/lib/ui/time'
export { formatRelativeTime }

export type LeadRow = Lead & {
  ownerName?: string
  lastActivityAt?: string | null
  senderProfileName?: string | null
  lastOutboundText?: string | null
  lastOutboundAt?: string | null
  lastInboundText?: string | null
  lastInboundAt?: string | null
  followupCount?: number
  lifecycle?: LifecycleResult
  hasDmSent?: boolean
}

export type PipelineStage =
  | 'to_contact'
  | 'waiting'
  | 'follow_up_due'
  | 'needs_reply'
  | 'done'
  | 'cold'

export interface PipelineColumnDef {
  id: PipelineStage
  label: string
  description: string
  dotColor: string
  iconColor: string
  borderColor: string
  headerBg: string
}

export const PIPELINE_COLUMNS: PipelineColumnDef[] = [
  { id: 'to_contact', label: 'To Contact', description: 'Not yet reached out', dotColor: 'bg-stone', iconColor: 'text-stone', borderColor: 'border-t-stone', headerBg: 'bg-bone-raised' },
  { id: 'waiting', label: 'Waiting', description: 'Sent, awaiting reply', dotColor: 'bg-cobalt', iconColor: 'text-cobalt', borderColor: 'border-t-cobalt', headerBg: 'bg-cobalt/[0.03]' },
  { id: 'follow_up_due', label: 'Follow-Up Due', description: 'Time to follow up', dotColor: 'bg-orange', iconColor: 'text-orange', borderColor: 'border-t-orange', headerBg: 'bg-orange/[0.03]' },
  { id: 'needs_reply', label: 'Needs Reply', description: 'They wrote back', dotColor: 'bg-orange', iconColor: 'text-orange', borderColor: 'border-t-orange', headerBg: 'bg-orange/[0.03]' },
]

export const TERMINAL_COLUMNS: PipelineColumnDef[] = [
  { id: 'done', label: 'Done', description: 'Won or closed', dotColor: 'bg-status-success', iconColor: 'text-status-success', borderColor: 'border-t-status-success', headerBg: 'bg-status-success/[0.03]' },
  { id: 'cold', label: 'Cold', description: 'Unresponsive — reactivate or archive', dotColor: 'bg-status-warning', iconColor: 'text-status-warning', borderColor: 'border-t-status-warning', headerBg: 'bg-status-warning/[0.03]' },
]

export function derivePipelineStage(lead: LeadRow): PipelineStage {
  if (lead.status === 'won' || lead.status === 'lost' || lead.status === 'dead' || lead.status === 'no') return 'done'
  if (lead.status === 'replied') return 'needs_reply'

  // Cold/frozen leads go to the cold section regardless of their status
  if (lead.lifecycle && (lead.lifecycle.state === 'cold' || lead.lifecycle.state === 'frozen')) {
    return 'cold'
  }

  const hasOutbound = !!lead.lastOutboundAt
  const hasInbound = !!lead.lastInboundAt
  const hasRepliedSinceOutbound = hasInbound && hasOutbound && new Date(lead.lastInboundAt!).getTime() > new Date(lead.lastOutboundAt!).getTime()

  // Follow-up due: contacted but no reply, and enough time has passed
  if (hasOutbound && !hasRepliedSinceOutbound && lead.lastOutboundAt) {
    const hasReplied = hasRepliedSinceOutbound
    if (isFollowupDue(lead.lastOutboundAt, hasReplied, new Date(), lead.followupCount ?? 0)) {
      return 'follow_up_due'
    }
  }

  if (lead.status === 'followed_up') {
    if (hasRepliedSinceOutbound) return 'needs_reply'
    return 'waiting'
  }

  if (lead.status === 'contacted') {
    // Pipeline/detail parity: when connection is accepted but no DM has been
    // sent, the rep's next action is "Send first message" — the lead belongs
    // in to_contact (action required), not waiting.
    if (lead.connectionAcceptedAt && !lead.hasDmSent) return 'to_contact'
    if (hasOutbound && !hasInbound) return 'waiting'
    if (hasRepliedSinceOutbound) return 'needs_reply'
    return 'waiting'
  }

  return 'to_contact'
}

export type SortMode = 'score' | 'recent' | 'activity'

export function sortLeads(leads: LeadRow[], mode: SortMode): LeadRow[] {
  const sorted = [...leads]
  switch (mode) {
    case 'score':
      sorted.sort((a, b) => getComparableLeadScore(b) - getComparableLeadScore(a))
      break
    case 'recent':
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      break
    case 'activity':
      sorted.sort((a, b) => {
        const aT = a.lastActivityAt ?? a.createdAt
        const bT = b.lastActivityAt ?? b.createdAt
        return new Date(bT).getTime() - new Date(aT).getTime()
      })
      break
  }
  return sorted
}

export function filterLeads(leads: LeadRow[], search: string): LeadRow[] {
  if (!search.trim()) return leads
  const q = search.toLowerCase()
  return leads.filter((lead) => {
    const hay = [
      lead.company,
      lead.contactName ?? '',
      lead.signalEvidence ?? '',
      lead.companyKey,
      lead.senderProfileName ?? '',
      lead.ownerName ?? '',
    ].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export function truncate(text: string | null | undefined, max: number = 80): string | null {
  if (!text) return null
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  to_contact: 'To Contact',
  needs_reply: 'Needs Reply',
  follow_up_due: 'Follow-Up',
  waiting: 'Waiting',
  done: 'Done',
  cold: 'Cold',
}

/** Empty-state copy per pipeline stage (no search involved). */
export const STAGE_EMPTY_MESSAGES: Record<PipelineStage, { title: string; hint: string }> = {
  to_contact: { title: 'No leads to contact.', hint: 'New leads appear here.' },
  waiting: { title: 'No leads are waiting here.', hint: 'Leads you have messaged show here until they answer.' },
  follow_up_due: { title: 'No follow-ups due.', hint: 'Leads come back here when a follow-up is due.' },
  needs_reply: { title: 'No replies waiting for you.', hint: 'Client replies land here.' },
  done: { title: 'No closed leads yet.', hint: 'Won and lost leads show here.' },
  cold: { title: 'No cold leads.', hint: 'Unresponsive leads appear here.' },
}

export interface PipelineEmptyState {
  kind: 'search' | 'stage' | 'all'
  title: string
  hint: string | null
}

/**
 * The one place that decides what an empty pipeline view says. A search
 * with no results is about the search; an empty stage is about the stage;
 * the two must never borrow each other's copy.
 */
export function resolvePipelineEmptyState(input: { stage: PipelineStage | 'all'; query: string }): PipelineEmptyState {
  const query = input.query.trim()
  if (query) {
    const where = input.stage === 'all' ? '' : ` in ${PIPELINE_STAGE_LABELS[input.stage]}`
    return { kind: 'search', title: `No leads match "${query}"${where}.`, hint: 'Try a different name, company or title.' }
  }
  if (input.stage === 'all') return { kind: 'all', title: 'No leads yet.', hint: 'Create or import a lead to start your pipeline.' }
  const copy = STAGE_EMPTY_MESSAGES[input.stage]
  return { kind: 'stage', title: copy.title, hint: copy.hint }
}
