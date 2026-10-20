import { displayContactName } from '@/lib/prospect/paste-normalize'
import type { ScoutStore, LeadDetail } from '@/lib/store/types'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import { buildThread, clip } from './thread'
import { DEAL_STAGE_LABEL } from './stage'
import type { DealStage } from './types'

/** How a stored thread should be filed. Closed wins over an open action. */
export type ArchiveLane = 'reply' | 'followup' | 'waiting' | 'open' | 'closed'

export interface ArchiveThread {
  leadId: string
  contactName: string | null
  company: string
  status: string
  direction: 'inbound' | 'outbound'
  source: string | null
  lane: ArchiveLane
  lastText: string
  lastFrom: 'me' | 'client'
  lastAt: string | null
  turnCount: number
  stageLabel: string | null
  reason: string
}

const CLOSED = new Set(['won', 'lost', 'dead', 'no'])

export function archiveLane(status: string, action: string, lastFrom: 'me' | 'client'): ArchiveLane {
  if (CLOSED.has(status) || action === 'CLOSED') return 'closed'
  if (action === 'SEND_REPLY') return 'reply'
  if (action === 'SEND_FOLLOWUP') return 'followup'
  if (lastFrom === 'me') return 'waiting'
  return 'open'
}

/**
 * Every thread the rep owns, including closed and archived leads.
 * Chats only shows work that is due. This is the record of the conversations.
 */
export async function loadConversationArchive(store: ScoutStore): Promise<ArchiveThread[]> {
  const leads = await store.listOwnedLeads(true)
  const snapshots = await store.listConversationSnapshots(leads.map((lead) => lead.id))
  const threads: ArchiveThread[] = []

  for (const lead of leads) {
    const snap = snapshots.get(lead.id)
    const detail = {
      ...lead,
      messages: snap?.messages ?? [],
      outcomes: [],
      followupCount: snap?.followupCount ?? 0,
    } as LeadDetail
    const thread = buildThread(detail)
    const last = thread.at(-1)
    if (!last) continue
    const action = deriveNextLeadAction(detail)
    threads.push({
      leadId: lead.id,
      contactName: displayContactName(lead.contactName),
      company: lead.company,
      status: lead.status,
      direction: lead.direction === 'inbound' ? 'inbound' : 'outbound',
      source: lead.source ?? null,
      lane: archiveLane(lead.status, action.action, last.role),
      lastText: clip(last.text, 180),
      lastFrom: last.role,
      lastAt: last.at,
      turnCount: thread.length,
      stageLabel: snap?.memoryStage ? DEAL_STAGE_LABEL[snap.memoryStage as DealStage] ?? null : null,
      reason: action.reason,
    })
  }

  return threads.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}

export interface InboundQueueItem {
  leadId: string
  contactName: string | null
  company: string
  source: string | null
  status: string
  preview: string
  message: string
  lastAt: string | null
  needsReply: boolean
}

/** Inbound leads the rep owns, replies first, then newest. */
export async function loadInboundQueue(store: ScoutStore): Promise<InboundQueueItem[]> {
  const leads = (await store.listOwnedLeads(true)).filter((lead) => lead.direction === 'inbound')
  const snapshots = await store.listConversationSnapshots(leads.map((lead) => lead.id))
  const items: InboundQueueItem[] = []

  for (const lead of leads) {
    const snap = snapshots.get(lead.id)
    const detail = {
      ...lead,
      messages: snap?.messages ?? [],
      outcomes: [],
      followupCount: snap?.followupCount ?? 0,
    } as LeadDetail
    const thread = buildThread(detail)
    const last = thread.at(-1)
    const preview = (last?.text ?? lead.inboundMessage ?? '').trim()
    if (!preview) continue
    const action = deriveNextLeadAction(detail)
    const closed = CLOSED.has(lead.status) || action.action === 'CLOSED'
    items.push({
      leadId: lead.id,
      contactName: displayContactName(lead.contactName),
      company: lead.company,
      source: lead.source ?? null,
      status: lead.status,
      preview: clip(preview, 140),
      message: clip(preview, 1200),
      lastAt: last?.at ?? lead.createdAt,
      needsReply: !closed && (action.action === 'SEND_REPLY' || last?.role === 'client'),
    })
  }

  return items.sort((a, b) => Number(b.needsReply) - Number(a.needsReply) || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}
