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

  // Timing check: allow follow-up even early, just flag it
  const dueIn = followupDueInDays(followupCount)
  const daysSince = calendarDaysBetween(new Date(lastSentAt), now)
  const isEarly = daysSince < dueIn

  const lastSent = priorMessages
    .filter((m) => m.sentText && m.sentAt)
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
    .at(-1)

  const lastText = lastSent?.sentText ?? ''

  const approach = chooseFollowupApproach(lastText, lead)

  return {
    shouldFollowUp: true,
    reason: isEarly
      ? `Early follow-up (${daysSince}/${dueIn} days). Follow-up ${followupCount + 1} of 3.`
      : `${daysSince} days since last send. Follow-up ${followupCount + 1} of 3.`,
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
    ctaApproach: '"Not now" is a perfect reply',
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
