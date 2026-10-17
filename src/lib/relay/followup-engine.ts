import { resolveConversationIntent } from '@/lib/conversation/intent'
import type { Lead, Message, OutreachStrategy } from '@/lib/domain/types'
import { calendarDaysBetween, followupDueInDays } from '@/lib/leads/followup'

/**
 * Follow-up Engine
 *
 * Context-aware follow-ups that never blindly say "just following up."
 * Uses: original message, lead developments, conversation state, sender proof,
 * previous follow-ups, elapsed time.
 */

export interface FollowupContext {
  lead: Lead
  priorMessages: Message[]
  conversationStage: string
  senderProfileId: string | null
  followupCount: number
  lastSentAt: string | null
  lastReplyAt: string | null
  now?: Date
}

export interface FollowupStrategy {
  shouldFollowUp: boolean
  reason: string
  approach: string
  tone: string
  ctaApproach: string
  valueAdd: string | null
  waitReason: string | null
  early?: boolean
}

/**
 * Determine if and how to follow up.
 */
export function determineFollowup(context: FollowupContext): FollowupStrategy {
  const { lead, priorMessages, lastSentAt, followupCount, now = new Date() } = context

  // No prior send = no follow-up
  if (!lastSentAt) {
    return {
      shouldFollowUp: false,
      reason: 'No prior message sent.',
      approach: 'none',
      tone: 'none',
      ctaApproach: 'none',
      valueAdd: null,
      waitReason: 'Send a first message before following up.',
    }
  }

  // All 3 follow-ups already used = no more (the Relay rule, raised from 1
  // to 3 per the approved product design — a lead can receive up to 3
  // follow-ups total across its life, not just one).
  if (followupCount >= 3) {
    return {
      shouldFollowUp: false,
      reason: 'All 3 follow-ups already used. Relay does not send a fourth.',
      approach: 'none',
      tone: 'none',
      ctaApproach: 'none',
      valueAdd: null,
      waitReason: 'Maximum three follow-ups per lead.',
    }
  }

  const hasConversation = priorMessages.some((m) => (m.type === 'dm' || m.type === 'followup' || m.type === 'reply') && m.sentAt)
  const hasConnection = priorMessages.some((m) => m.type === 'connection' && m.sentAt)
  if (hasConnection && !hasConversation) {
    const waiting = !lead.connectionAcceptedAt
    return {
      shouldFollowUp: false,
      reason: waiting ? 'Waiting for acceptance.' : 'Connection accepted. The first message has not been sent.',
      approach: 'none',
      tone: 'none',
      ctaApproach: 'none',
      valueAdd: null,
      waitReason: waiting
        ? 'Waiting for acceptance. A follow-up opens after they accept and the first message is due.'
        : 'Send the first message. Follow-up starts after that message, on the 3/6/6 calendar-day schedule.',
    }
  }

  // A client who declined is never followed up, however the thread ended.
  const conversation = resolveConversationIntent(
    priorMessages
      .filter((m) => m.direction === 'inbound' && m.sentText && m.sentAt)
      .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
      .map((m) => m.sentText ?? ''),
  )
  if (conversation.declined) {
    return {
      shouldFollowUp: false,
      reason: 'The client declined.',
      approach: 'none',
      tone: 'none',
      ctaApproach: 'none',
      valueAdd: null,
      waitReason: 'The client said they are not interested. Relay does not follow up after a rejection.',
    }
  }

  // Only an UNANSWERED client message blocks a follow-up. Once the rep has
  // answered, a quiet client can be followed up like any other thread.
  const lastInboundAt = [
    context.lastReplyAt ?? '',
    ...priorMessages.filter((m) => m.direction === 'inbound' && m.sentAt).map((m) => m.sentAt ?? ''),
  ].sort().at(-1) || null
  if (lastInboundAt && lastInboundAt >= lastSentAt) {
    return {
      shouldFollowUp: false,
      reason: 'They already replied.',
      approach: 'none',
      tone: 'none',
      ctaApproach: 'none',
      valueAdd: null,
      waitReason: 'They already replied. Answer that message instead of following up.',
    }
  }

  // A normal follow-up waits for the 3/6/6 calendar-day gap.
  const dueIn = followupDueInDays(followupCount)
  const daysSince = calendarDaysBetween(new Date(lastSentAt), now)
  const isEarly = daysSince < dueIn

  const lastSent = priorMessages
    .filter((m) => m.sentText && m.sentAt)
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
    .at(-1)

  const lastText = lastSent?.sentText ?? ''

  if (isEarly) {
    return {
      shouldFollowUp: false,
      reason: `Follow-up is not due yet (${daysSince}/${dueIn} calendar days).`,
      approach: 'none',
      tone: 'none',
      ctaApproach: 'none',
      valueAdd: null,
      waitReason: `Not due yet. Next follow-up is due after ${dueIn} calendar days (${daysSince} calendar day${daysSince === 1 ? '' : 's'} since the last message).`,
      early: true,
    }
  }

  const approach = chooseFollowupApproach(lastText, lead)

  return {
    shouldFollowUp: true,
    reason: `${daysSince} calendar days since last send. Follow-up ${followupCount + 1} of 3.`,
    approach: approach.approach,
    tone: approach.tone,
    ctaApproach: approach.ctaApproach,
    valueAdd: approach.valueAdd,
    waitReason: null,
    early: isEarly,
  }
}

function chooseFollowupApproach(
  lastSentText: string,
  _lead: Lead,
): {
  approach: string
  tone: string
  ctaApproach: string
  valueAdd: string | null
} {
  const lower = lastSentText.toLowerCase()

  if (lower.includes('free read') || lower.includes('quick read')) {
    return {
      approach: 'Light nudge with a different angle. Do not repeat the Read offer.',
      tone: 'brief, no pressure',
      ctaApproach: 'Easy yes/no or "not now"',
      valueAdd: null,
    }
  }

  if (lastSentText.includes('?')) {
    return {
      approach: 'Reference the original question. Make it easy to answer.',
      tone: 'curious, patient',
      ctaApproach: 'Re-ask the core question in a simpler way',
      valueAdd: null,
    }
  }

  if (lower.includes('noticed') || lower.includes('saw') || lower.includes('building')) {
    return {
      approach: 'Add a small new observation or thought. Show you are paying attention.',
      tone: 'observational, light',
      ctaApproach: 'Permission to share something useful or close the loop',
      valueAdd: 'One specific observation or thought related to their work',
    }
  }

  // Default: short, graceful nudge
  return {
    approach: 'Short nudge. Acknowledge they are busy. Give an easy out.',
    tone: 'respectful, brief',
    ctaApproach: 'One plain question about their work, with an easy way to pass',
    valueAdd: null,
  }
}

/**
 * Build the follow-up prompt context. Includes ALL prior outbound messages
 * (connection note, first DM, previous follow-ups) so the writer can
 * differentiate this follow-up from everything sent before — never repeat
 * the same offer, angle, or opening.
 */
export function buildFollowupPrompt(
  context: FollowupContext,
  strategy: FollowupStrategy,
): string {
  const parts: string[] = []

  parts.push(`## Follow-up Message`)
  parts.push(`This follow-up is allowed under the 3-per-lead cap (${strategy.reason})`)
  parts.push(``)
  parts.push(`### Approach: ${strategy.approach}`)
  parts.push(`### Tone: ${strategy.tone}`)
  parts.push(`### CTA: ${strategy.ctaApproach}`)
  parts.push(`Do not write "Not now is a perfect reply" or any canned opt-out slogan. If the thread has no specific fact, do not invent advice about recruitment or their industry. Say that more research is needed, or ask one question that uses only a fact already in the thread.`)

  if (strategy.valueAdd) {
    parts.push(`### Value to add: ${strategy.valueAdd}`)
  }

  parts.push(``)
  parts.push(`### ALL previous outbound messages (connection note → DM → follow-ups) — DO NOT repeat any of these:`)
  const outbound = context.priorMessages
    .filter((m) => m.sentText && m.sentAt && m.direction !== 'inbound')
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))

  if (outbound.length === 0) {
    parts.push(`(none recorded)`)
  } else {
    for (const m of outbound) {
      const label = m.type ?? 'message'
      parts.push(`[${label}] ${m.sentText}`)
    }
  }

  parts.push(``)
  parts.push(`### Inbound from prospect (if any):`)
  const inbound = context.priorMessages
    .filter((m) => m.sentText && m.sentAt && m.direction === 'inbound')
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
  if (inbound.length === 0) {
    parts.push(`(no reply yet — this is a follow-up to an unanswered message)`)
  } else {
    for (const m of inbound) {
      parts.push(`"${m.sentText}"`)
    }
  }

  parts.push(``)
  parts.push(`### Rules:`)
  parts.push(`- Do NOT say "just following up" or "checking in" or "bumping this"`)
  parts.push(`- 15–45 words. Add ONE new reason to reply, or close the loop.`)
  parts.push(`- Give them an easy way to say "not now"`)
  parts.push(`- Do NOT repeat the same offer, angle, opening, or CTA from any previous outbound message above`)
  parts.push(`- If the previous message asked a question, do NOT re-ask it — add a new observation or insight instead`)
  parts.push(`- Do not dump biography, proof, or BPulse positioning`)

  return parts.join('\n')
}
