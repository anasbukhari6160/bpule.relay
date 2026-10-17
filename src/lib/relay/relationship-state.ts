import type { LeadDetail } from '@/lib/store/types'
import type { Message } from '@/lib/domain/types'
import { deriveNextLeadAction } from './lead-state-machine'

/**
 * Relationship presentation state.
 *
 * This is a PURE PRESENTATION LAYER. It reads canonical business state
 * (LeadDetail: messages, outcomes, status, connectionAcceptedAt, etc.)
 * and maps it to presentation states the UI renders. It does NOT invent
 * lifecycle truth — every field traces back to canonical domain state.
 *
 * The five presentation kinds:
 *   your_move        — the rep needs to act now
 *   their_move       — we are legitimately waiting on the other party
 *   needs_information — external state is unknown, ask the rep
 *   won              — terminal success
 *   lost             — terminal closed
 */

export type RelationshipKind =
  | 'your_move'
  | 'their_move'
  | 'needs_information'
  | 'won'
  | 'lost'

export type RelationshipPhase =
  | 'prospect'
  | 'connection_due'
  | 'connection_sent'
  | 'connection_accepted'
  | 'dm_due'
  | 'dm_sent'
  | 'waiting_for_reply'
  | 'replied'
  | 'follow_up_due'
  | 'conversation'
  | 'meeting'
  | 'proposal'
  | 'won'
  | 'lost'

export interface RelationshipState {
  kind: RelationshipKind
  phase: RelationshipPhase
  title: string
  detail: string
  waitingOn: 'client' | 'connection' | null
  waitingSince: string | null
  followUpDueLabel: string | null
  lastClientMessage: Message | null
  lastOutboundMessage: Message | null
  primaryCta: string
  secondaryCta: string | null
  lastActionLabel: string | null
  lastActionAt: string | null
}

export function computeRelationshipState(lead: LeadDetail, now: number = Date.now()): RelationshipState {
  // Derive presentation state from the canonical state machine
  const canonical = deriveNextLeadAction(lead, now)

  const lastClient = lead.messages
    .filter((m) => m.direction === 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null

  const lastOutbound = lead.messages
    .filter((m) => m.direction !== 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null

  return mapCanonicalToPresentation(canonical, lead, lastClient, lastOutbound)
}

function mapCanonicalToPresentation(
  canonical: ReturnType<typeof deriveNextLeadAction>,
  lead: LeadDetail,
  lastClient: Message | null,
  lastOutbound: Message | null,
): RelationshipState {
  const connMsg = lead.messages
    // Presence = type + sent time; the note is optional.
    .filter((m) => m.type === 'connection' && m.direction !== 'inbound' && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null

  switch (canonical.action) {
    case 'CLOSED':
      return {
        kind: lead.status === 'won' ? 'won' : 'lost',
        phase: lead.status === 'won' ? 'won' : 'lost',
        title: canonical.primaryLabel,
        detail: canonical.reason,
        waitingOn: null,
        waitingSince: null,
        followUpDueLabel: null,
        lastClientMessage: lastClient,
        lastOutboundMessage: lastOutbound,
        primaryCta: '',
        secondaryCta: null,
        lastActionLabel: lastOutbound ? 'Last action' : null,
        lastActionAt: lastOutbound?.sentAt ?? null,
      }

    case 'SEND_CONNECTION':
      return {
        kind: 'your_move',
        phase: 'connection_due',
        title: canonical.primaryLabel,
        detail: canonical.reason,
        waitingOn: null,
        waitingSince: null,
        followUpDueLabel: null,
        lastClientMessage: null,
        lastOutboundMessage: null,
        primaryCta: 'Prepare Connection',
        secondaryCta: null,
        lastActionLabel: null,
        lastActionAt: null,
      }

    case 'WAIT_CONNECTION':
      return {
        kind: 'their_move',
        phase: 'connection_sent',
        title: 'Waiting for connection',
        detail: canonical.reason,
        waitingOn: 'connection',
        waitingSince: connMsg?.sentAt ?? null,
        followUpDueLabel: null,
        lastClientMessage: null,
        lastOutboundMessage: connMsg,
        primaryCta: 'Mark Accepted',
        secondaryCta: 'Log Update',
        lastActionLabel: 'Connection sent',
        lastActionAt: connMsg?.sentAt ?? null,
      }

    case 'SEND_DM':
      return {
        kind: 'your_move',
        phase: 'connection_accepted',
        title: canonical.primaryLabel,
        detail: canonical.reason,
        waitingOn: null,
        waitingSince: null,
        followUpDueLabel: null,
        lastClientMessage: null,
        lastOutboundMessage: connMsg,
        primaryCta: 'Prepare DM',
        secondaryCta: null,
        lastActionLabel: 'Connection accepted',
        lastActionAt: lead.connectionAcceptedAt ?? null,
      }

    case 'WAIT_REPLY':
      return {
        kind: 'their_move',
        phase: canonical.inConversation ? 'conversation' : 'dm_sent',
        title: 'Waiting for reply',
        detail: canonical.reason,
        waitingOn: 'client',
        waitingSince: lastOutbound?.sentAt ?? null,
        followUpDueLabel: null,
        lastClientMessage: null,
        lastOutboundMessage: lastOutbound,
        primaryCta: 'Paste Client Reply',
        secondaryCta: 'Log Update',
        lastActionLabel: 'Message sent',
        lastActionAt: lastOutbound?.sentAt ?? null,
      }

    case 'SEND_REPLY':
      return {
        kind: 'your_move',
        phase: 'replied',
        title: 'They replied',
        detail: canonical.reason,
        waitingOn: null,
        waitingSince: null,
        followUpDueLabel: null,
        lastClientMessage: lastClient,
        lastOutboundMessage: lastOutbound,
        primaryCta: 'Prepare Reply',
        secondaryCta: null,
        lastActionLabel: 'They replied',
        lastActionAt: lastClient?.sentAt ?? null,
      }

    case 'SEND_FOLLOWUP':
      return {
        kind: 'your_move',
        phase: 'follow_up_due',
        title: 'Follow up',
        detail: canonical.reason,
        waitingOn: null,
        waitingSince: null,
        followUpDueLabel: null,
        lastClientMessage: lastClient,
        lastOutboundMessage: lastOutbound,
        primaryCta: 'Prepare Follow-Up',
        secondaryCta: null,
        lastActionLabel: 'Last message sent',
        lastActionAt: lastOutbound?.sentAt ?? null,
      }

    case 'REVIEW':
    default:
      return {
        kind: 'your_move',
        phase: 'connection_due',
        title: canonical.primaryLabel,
        detail: canonical.reason,
        waitingOn: null,
        waitingSince: null,
        followUpDueLabel: null,
        lastClientMessage: null,
        lastOutboundMessage: null,
        primaryCta: 'Review',
        secondaryCta: null,
        lastActionLabel: null,
        lastActionAt: null,
      }
  }
}
