import type { LeadDetail } from '@/lib/store/types'
import type { ConversationTurn, TurnKind } from './types'

/**
 * The single ordered thread for a lead, oldest first, every turn labeled by
 * who wrote it. Every writer and the chat view read this — never the raw
 * message rows — so labeling and ordering cannot drift between surfaces.
 */
export function buildThread(lead: Pick<LeadDetail, 'messages' | 'direction' | 'inboundMessage' | 'createdAt' | 'id'>): ConversationTurn[] {
  const turns: ConversationTurn[] = []

  // Inbound-first leads: the client's opening message lives on the lead.
  if (lead.direction === 'inbound' && lead.inboundMessage?.trim()) {
    turns.push({
      id: `inbound_first:${lead.id}`,
      role: 'client',
      kind: 'inbound_first',
      text: lead.inboundMessage.trim(),
      at: lead.createdAt ?? null,
    })
  }

  for (const m of lead.messages) {
    if (!m.sentAt) continue // unsent drafts are not part of the conversation
    const text = (m.sentText ?? '').trim()
    if (!text && m.type !== 'connection') continue
    turns.push({
      id: m.id,
      role: m.direction === 'inbound' ? 'client' : 'me',
      kind: m.type as TurnKind,
      // A connection request without a note still happened.
      text: text || 'Connection request sent (no note).',
      at: m.sentAt,
    })
  }

  return turns.sort((a, b) => {
    if (a.kind === 'inbound_first') return -1
    if (b.kind === 'inbound_first') return 1
    return (a.at ?? '').localeCompare(b.at ?? '')
  })
}

export function lastTurn(thread: ConversationTurn[], role?: ConversationTurn['role']): ConversationTurn | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (!role || thread[i].role === role) return thread[i]
  }
  return null
}

/** The client wrote after our last message and is waiting on us. */
export function awaitingOurReply(thread: ConversationTurn[]): boolean {
  const last = thread.filter((t) => !(t.kind === 'connection' && t.role === 'me')).at(-1)
  return last?.role === 'client'
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Turns rendered for a prompt: "Me:" / "Client:" lines, oldest first. */
export function renderTurns(turns: ConversationTurn[], maxCharsPerTurn = 700): string {
  return turns
    .map((t) => `${t.role === 'me' ? 'Me' : 'Client'}${t.kind === 'followup' ? ' (follow-up)' : t.kind === 'connection' ? ' (connection note)' : ''}: ${clip(t.text, maxCharsPerTurn)}`)
    .join('\n')
}
