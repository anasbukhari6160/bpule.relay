import { displayContactName } from '@/lib/prospect/paste-normalize'
import type { ScoutStore, LeadDetail } from '@/lib/store/types'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import { buildThread, clip } from './thread'
import { DEAL_STAGE_LABEL } from './stage'
import type { DealStage } from './types'

export type InboxBucket = 'reply' | 'followup' | 'active'

export interface InboxItem {
  leadId: string
  contactName: string | null
  company: string
  bucket: InboxBucket
  lastText: string
  lastFrom: 'me' | 'client'
  lastAt: string | null
  stageLabel: string | null
  reason: string
}

const BUCKET_ORDER: Record<InboxBucket, number> = { reply: 0, followup: 1, active: 2 }

/**
 * Every thread that needs the rep, newest first within each bucket:
 * client waiting on us, follow-up due, then live conversations where the
 * client has written at least once.
 */
export async function loadInbox(store: ScoutStore): Promise<InboxItem[]> {
  const leads = (await store.listOwnedLeads(false)).filter((l) => !['won', 'lost', 'dead', 'no'].includes(l.status))
  const snapshots = await store.listConversationSnapshots(leads.map((l) => l.id))
  const items: InboxItem[] = []

  for (const lead of leads) {
    const snap = snapshots.get(lead.id)
    if (!snap) continue
    if (snap.messages.length === 0 && !(lead.direction === 'inbound' && lead.inboundMessage)) continue
    const detail = { ...lead, messages: snap.messages, outcomes: [], followupCount: snap.followupCount } as LeadDetail
    const action = deriveNextLeadAction(detail)
    const thread = buildThread(detail)
    const last = thread.at(-1)
    if (!last) continue

    let bucket: InboxBucket | null = null
    if (action.action === 'SEND_REPLY') bucket = 'reply'
    else if (action.action === 'SEND_FOLLOWUP') bucket = 'followup'
    else if (action.inConversation && action.action !== 'CLOSED') bucket = 'active'
    if (!bucket) continue

    items.push({
      leadId: lead.id,
      contactName: displayContactName(lead.contactName),
      company: lead.company,
      bucket,
      lastText: clip(last.text, 160),
      lastFrom: last.role,
      lastAt: last.at,
      stageLabel: snap.memoryStage ? DEAL_STAGE_LABEL[snap.memoryStage as DealStage] ?? null : null,
      reason: action.reason,
    })
  }

  return items.sort((a, b) =>
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''),
  )
}
