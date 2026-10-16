
import type { LeadDetail } from '@/lib/store/types'
import type { Message } from '@/lib/domain/types'
import { followupDueInDays } from '@/lib/leads/followup'

export type LeadAction =
  | 'SEND_CONNECTION'
  | 'WAIT_CONNECTION'
  | 'SEND_DM'
  | 'WAIT_REPLY'
  | 'SEND_REPLY'
  | 'SEND_FOLLOWUP'
  | 'CLOSED'
  | 'REVIEW'

export interface LeadActionResult {
  action: LeadAction
  /** Human-readable label for the primary CTA */
  primaryLabel: string
  /** Short explanation of why this is next */
  reason: string
  /** Whether this requires rep action (true) or waiting (false) */
  requiresAction: boolean
  /** Whether follow-up is currently due */
  followupDue: boolean
  /** Number of follow-ups remaining (0-3) */
  followupsRemaining: number
  /** True once the client has written at least once — a live two-way thread. */
  inConversation?: boolean
}

const MAX_FOLLOWUPS = 3
const DAY_MS = 1000 * 60 * 60 * 24

function bySentAtDesc(a: Message, b: Message): number {
  return (b.sentAt ?? '').localeCompare(a.sentAt ?? '')
}

function latestMessage(messages: Message[], type: string): Message | null {
  return messages
    .filter((m) => m.type === type && m.direction !== 'inbound' && m.sentText && m.sentAt)
    .sort(bySentAtDesc)[0] ?? null
}

function isAutoReply(text: string): boolean {
  return /out of office|ooo|auto.?(reply|response)|i am currently away|i('m| am) on vacation|on leave|delayed response|limited email access/i.test(text)
}

/**
 * Next action for a lead. The rule is turn-taking: whoever wrote the last
 * real message decides whose move it is. A client message that came after
 * our last message always means "reply", however many rounds in — the old
 * "any outbound reply ever" check made every second client reply read as
 * "waiting for client".
 */
export function deriveNextLeadAction(lead: LeadDetail, now: number = Date.now()): LeadActionResult {
  const messages = lead.messages

  if (lead.status === 'won') {
    return {
      action: 'CLOSED',
      primaryLabel: 'Opportunity won',
      reason: 'This lead converted successfully.',
      requiresAction: false,
      followupDue: false,
      followupsRemaining: 0,
    }
  }

  if (lead.status === 'lost' || lead.status === 'dead' || lead.status === 'no') {
    return {
      action: 'CLOSED',
      primaryLabel: lead.status === 'no' ? 'Closed' : 'Opportunity lost',
      reason: 'This lead is no longer active.',
      requiresAction: false,
      followupDue: false,
      followupsRemaining: 0,
    }
  }

  // A connection is "sent" even without a note — the presence of a
  // connection-type message (even with empty sentText) means the request
  // was made. Sending without a note must still advance the lifecycle.
  const connectionMsg = messages
    .filter((m) => m.type === 'connection' && m.direction !== 'inbound' && m.sentAt)
    .sort(bySentAtDesc)[0] ?? null
  const connectionSent = Boolean(connectionMsg)
  const connectionAccepted = lead.connectionAcceptedAt != null

  const dmSent = Boolean(latestMessage(messages, 'dm'))

  const lastInbound = messages
    .filter((m) => m.direction === 'inbound' && m.sentText && m.sentAt && !isAutoReply(m.sentText))
    .sort(bySentAtDesc)[0] ?? null
  // Inbound-first leads: the client's opening message lives on the lead.
  const inboundFirst = lead.direction === 'inbound' && Boolean(lead.inboundMessage?.trim())
  const clientWrote = Boolean(lastInbound) || inboundFirst

  const lastOutbound = messages
    .filter((m) => m.direction !== 'inbound' && m.sentText && m.sentAt)
    .sort(bySentAtDesc)[0] ?? null

  const followupCount = lead.followupCount ?? 0
  const followupsRemaining = Math.max(0, MAX_FOLLOWUPS - followupCount)

  // 1. Client wrote after our last message → reply. Takes priority over
  // everything, including a connection that was never logged.
  const unanswered = lastInbound
    // Inclusive: a client message logged at the same instant as ours is still unanswered.
    ? !lastOutbound || (lastOutbound.sentAt ?? '') <= (lastInbound.sentAt ?? '')
    : inboundFirst && !lastOutbound
  if (unanswered) {
    const at = lastInbound?.sentAt ?? null
    return {
      action: 'SEND_REPLY',
      primaryLabel: `Reply to ${lead.contactName ?? 'them'}`,
      reason: at ? `Client replied ${timeAgo(at, now)}.` : 'Client wrote first and is waiting for an answer.',
      requiresAction: true,
      followupDue: false,
      followupsRemaining,
      inConversation: true,
    }
  }

  const engaged = dmSent || clientWrote || Boolean(lastOutbound && lastOutbound.type !== 'connection')

  if (!engaged) {
    // 2. Connection not sent yet
    if (!connectionSent) {
      return {
        action: 'SEND_CONNECTION',
        primaryLabel: 'Send connection request',
        reason: 'Reach out to connect.',
        requiresAction: true,
        followupDue: false,
        followupsRemaining,
      }
    }

    // 3. Connection sent but not accepted
    if (!connectionAccepted) {
      if (connectionMsg?.sentAt) {
        const daysPending = (now - new Date(connectionMsg.sentAt).getTime()) / DAY_MS
        if (daysPending > 14) {
          return {
            action: 'CLOSED',
            primaryLabel: 'Connection expired',
            reason: 'Connection request was not accepted within 14 days.',
            requiresAction: false,
            followupDue: false,
            followupsRemaining: 0,
          }
        }
      }
      return {
        action: 'WAIT_CONNECTION',
        primaryLabel: 'Waiting for connection',
        reason: `Connection sent ${connectionMsg?.sentAt ? timeAgo(connectionMsg.sentAt, now) : ''}. Waiting for acceptance.`,
        requiresAction: false,
        followupDue: false,
        followupsRemaining,
      }
    }

    // 4. Connection accepted, DM not sent
    return {
      action: 'SEND_DM',
      primaryLabel: 'Send first message',
      reason: 'Connection accepted. Start the conversation.',
      requiresAction: true,
      followupDue: false,
      followupsRemaining,
    }
  }

  // 5. Our move was last. Follow up once the spacing has passed — this
  // applies mid-conversation too, when the client goes quiet after a reply.
  if (lastOutbound?.sentAt) {
    const daysSince = (now - new Date(lastOutbound.sentAt).getTime()) / DAY_MS
    const dueIn = followupDueInDays(followupCount)
    if (followupsRemaining > 0 && daysSince >= dueIn) {
      return {
        action: 'SEND_FOLLOWUP',
        primaryLabel: 'Send follow-up',
        reason: `No reply after ${Math.floor(daysSince)} days (due at ${dueIn}). ${followupsRemaining} follow-ups remaining.`,
        requiresAction: true,
        followupDue: true,
        followupsRemaining,
        inConversation: clientWrote,
      }
    }
    return {
      action: 'WAIT_REPLY',
      primaryLabel: clientWrote ? 'Waiting for client' : 'Waiting for reply',
      reason: clientWrote
        ? `You replied ${timeAgo(lastOutbound.sentAt, now)}.`
        : `Last message sent ${timeAgo(lastOutbound.sentAt, now)}.`,
      requiresAction: false,
      followupDue: false,
      followupsRemaining,
      inConversation: clientWrote,
    }
  }

  // 6. Fallback
  return {
    action: 'REVIEW',
    primaryLabel: 'Review lead',
    reason: 'Lead state needs review.',
    requiresAction: true,
    followupDue: false,
    followupsRemaining,
  }
}

function timeAgo(iso: string | null, now: number): string {
  if (!iso) return ''
  const diff = now - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
