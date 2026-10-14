
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
}

const MAX_FOLLOWUPS = 3

function latestMessage(messages: Message[], type: string): Message | null {
  return messages
    .filter((m) => m.type === type && m.sentText && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null
}

function latestInbound(messages: Message[]): Message | null {
  return messages
    .filter((m) => m.direction === 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null
}

function isAutoReply(text: string): boolean {
  return /out of office|ooo|auto.?(reply|response)|i am currently away|i('m| am) on vacation|on leave|delayed response|limited email access/i.test(text)
}

export function deriveNextLeadAction(lead: LeadDetail): LeadActionResult {
  const now = Date.now()
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
    .filter((m) => m.type === 'connection' && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null
  const connectionSent = Boolean(connectionMsg)
  const connectionAccepted = lead.connectionAcceptedAt != null

  const dmMsg = latestMessage(messages, 'dm')
  const dmSent = Boolean(dmMsg)

  const lastInbound = latestInbound(messages)
  const clientReplied = Boolean(lastInbound) && !isAutoReply(lastInbound!.sentText ?? '')

  const outboundReply = messages
    .filter((m) => m.type === 'reply' && m.direction !== 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null
  const replySent = Boolean(outboundReply)

  const followupCount = lead.followupCount ?? 0
  const followupsRemaining = Math.max(0, MAX_FOLLOWUPS - followupCount)

  const lastOutbound = messages
    .filter((m) => m.direction !== 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null


  // 1. Connection not sent yet
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

  // 2. Connection sent but not accepted
  if (connectionSent && !connectionAccepted) {
    // Connection expired after 14 days
    if (connectionMsg?.sentAt) {
      const daysPending = (now - new Date(connectionMsg.sentAt).getTime()) / (1000 * 60 * 60 * 24)
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

  // 3. Client replied, rep hasn't answered — takes priority over everything.
  // A reply is the next action whether or not a DM was sent first.
  if (clientReplied && !replySent) {
    return {
      action: 'SEND_REPLY',
      primaryLabel: `Reply to ${lead.contactName ?? 'them'}`,
      reason: `Client replied ${lastInbound?.sentAt ? timeAgo(lastInbound.sentAt, now) : ''}.`,
      requiresAction: true,
      followupDue: false,
      followupsRemaining,
    }
  }

  // 4. Connection accepted, DM not sent
  if (connectionAccepted && !dmSent) {
    return {
      action: 'SEND_DM',
      primaryLabel: 'Send first message',
      reason: 'Connection accepted. Start the conversation.',
      requiresAction: true,
      followupDue: false,
      followupsRemaining,
    }
  }

  // 5. DM sent, waiting for reply, follow-up due
  if (dmSent && !clientReplied && followupsRemaining > 0 && lastOutbound?.sentAt) {
    const daysSince = (now - new Date(lastOutbound.sentAt).getTime()) / (1000 * 60 * 60 * 24)
    const dueIn = followupDueInDays(followupCount)
    if (daysSince >= dueIn) {
      return {
        action: 'SEND_FOLLOWUP',
        primaryLabel: 'Send follow-up',
        reason: `No reply after ${Math.floor(daysSince)} days (due at ${dueIn}). ${followupsRemaining} follow-ups remaining.`,
        requiresAction: true,
        followupDue: true,
        followupsRemaining,
      }
    }
  }

  // 6. DM sent, waiting for reply, follow-up not yet due
  if (dmSent && !clientReplied) {
    return {
      action: 'WAIT_REPLY',
      primaryLabel: 'Waiting for reply',
      reason: `Last message sent ${lastOutbound?.sentAt ? timeAgo(lastOutbound.sentAt, now) : ''}.`,
      requiresAction: false,
      followupDue: false,
      followupsRemaining,
    }
  }

  // 7. Reply sent, waiting for client
  if (replySent) {
    return {
      action: 'WAIT_REPLY',
      primaryLabel: 'Waiting for client',
      reason: `You replied ${outboundReply?.sentAt ? timeAgo(outboundReply.sentAt, now) : ''}.`,
      requiresAction: false,
      followupDue: false,
      followupsRemaining,
    }
  }

  // 8. Fallback
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
