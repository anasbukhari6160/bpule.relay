/**
 * Canonical sales outcome taxonomy.
 *
 * The system used to record only `replied`, and a "reply" like
 * "stop messaging me" counted as success. Every lead/message/conversation state
 * now maps to one canonical outcome, ordered from best to worst, so a report
 * can ask "did this become real work?" instead of "did they write back?".
 *
 * Ordering (best first):
 *   WON > QUALIFIED_OPPORTUNITY > MEETING > PROPOSAL > POSITIVE_COMMERCIAL_REPLY
 *   > POSITIVE_REPLY > CONNECTION_ACCEPTED > NO_RESPONSE > NEGATIVE
 *   > LOST > DEFERRED > DO_NOT_CONTACT
 *
 * Nothing here decides an outcome from a raw paste. It maps the states the
 * rest of the system already produces, plus a bounded reply classifier.
 */

import type { ConversationStage, LeadStatus } from '@/lib/domain/types'

export type SalesOutcome =
  | 'WON'
  | 'QUALIFIED_OPPORTUNITY'
  | 'MEETING'
  | 'PROPOSAL'
  | 'POSITIVE_COMMERCIAL_REPLY'
  | 'POSITIVE_REPLY'
  | 'CONNECTION_ACCEPTED'
  | 'NO_RESPONSE'
  | 'NEGATIVE'
  | 'LOST'
  | 'DEFERRED'
  | 'DO_NOT_CONTACT'

/** Best → worst. Index = rank; lower is better. */
export const OUTCOME_HIERARCHY: readonly SalesOutcome[] = [
  'WON',
  'QUALIFIED_OPPORTUNITY',
  'MEETING',
  'PROPOSAL',
  'POSITIVE_COMMERCIAL_REPLY',
  'POSITIVE_REPLY',
  'CONNECTION_ACCEPTED',
  'NO_RESPONSE',
  'NEGATIVE',
  'LOST',
  'DEFERRED',
  'DO_NOT_CONTACT',
]

const RANK: Record<SalesOutcome, number> = Object.fromEntries(
  OUTCOME_HIERARCHY.map((o, i) => [o, i]),
) as Record<SalesOutcome, number>

/** True when `a` is a better commercial outcome than `b`. */
export function isBetterOutcome(a: SalesOutcome, b: SalesOutcome): boolean {
  return RANK[a] < RANK[b]
}

/** The best outcome in a set (WON beats MEETING beats NO_RESPONSE). */
export function bestOutcome(outcomes: readonly SalesOutcome[]): SalesOutcome | null {
  let best: SalesOutcome | null = null
  for (const o of outcomes) {
    if (!best || isBetterOutcome(o, best)) best = o
  }
  return best
}

/** The lead lifecycle status → the closest canonical outcome. */
export function outcomeFromLeadStatus(status: LeadStatus | null | undefined): SalesOutcome {
  switch (status) {
    case 'won': return 'WON'
    case 'lost': return 'LOST'
    case 'replied': return 'POSITIVE_REPLY'
    case 'no': return 'NEGATIVE'
    case 'dead': return 'DO_NOT_CONTACT'
    case 'contacted':
    case 'followed_up':
    case 'new':
    default: return 'NO_RESPONSE'
  }
}

/** The conversation stage → the closest canonical outcome. */
export function outcomeFromConversationStage(stage: ConversationStage | null | undefined): SalesOutcome {
  switch (stage) {
    case 'won': return 'WON'
    case 'negotiation':
    case 'qualifying': return 'QUALIFIED_OPPORTUNITY'
    case 'meeting': return 'MEETING'
    case 'proposal': return 'PROPOSAL'
    case 'interested': return 'POSITIVE_COMMERCIAL_REPLY'
    case 'replied': return 'POSITIVE_REPLY'
    case 'lost': return 'LOST'
    case 'contacted':
    case 'new':
    default: return 'NO_RESPONSE'
  }
}

/** The stored `outcomes.stage` value → canonical outcome. */
export function outcomeFromStoredStage(stage: string | null | undefined): SalesOutcome {
  switch (stage) {
    case 'won': return 'WON'
    case 'qualified_opportunity': return 'QUALIFIED_OPPORTUNITY'
    case 'meeting': return 'MEETING'
    case 'proposal': return 'PROPOSAL'
    case 'positive_commercial_reply': return 'POSITIVE_COMMERCIAL_REPLY'
    case 'connection_accepted': return 'CONNECTION_ACCEPTED'
    case 'negative': return 'NEGATIVE'
    case 'lost': return 'LOST'
    case 'deferred': return 'DEFERRED'
    case 'do_not_contact': return 'DO_NOT_CONTACT'
    case 'replied':
    default: return 'POSITIVE_REPLY'
  }
}

const DO_NOT_CONTACT = /\b(?:stop\s+messaging|unsubscribe|remove\s+me|don'?t\s+(?:contact|message|email)|no\s+more\s+(?:messages|emails)|not\s+interested\s+in\s+being\s+contacted)\b/i
const NEGATIVE = /\b(?:not\s+interested|no\s+thanks|thanks\s+but\s+no|not\s+a\s+fit|wrong\s+person|not\s+looking|we'?re\s+not\s+hiring|please\s+remove)\b/i
const COMMERCIAL = /\b(?:budget|pricing|price|cost|rate|proposal|scope|timeline|start\s+date|meeting|call|demo|contract|team|developers?|engineers?|engagement)\b/i

/**
 * Classify an inbound reply. A reply is never automatically success: a
 * "stop messaging me" is DO_NOT_CONTACT and a polite refusal is NEGATIVE.
 */
export function classifyInboundReply(text: string | null | undefined): SalesOutcome {
  const t = (text ?? '').trim()
  if (!t) return 'NO_RESPONSE'
  if (DO_NOT_CONTACT.test(t)) return 'DO_NOT_CONTACT'
  if (NEGATIVE.test(t)) return 'NEGATIVE'
  if (COMMERCIAL.test(t)) return 'POSITIVE_COMMERCIAL_REPLY'
  return 'POSITIVE_REPLY'
}

/** The single best outcome across every signal the system holds for a lead. */
export function currentOutcome(input: {
  leadStatus?: LeadStatus | null
  conversationStage?: ConversationStage | null
  storedStages?: Array<string | null>
  inboundReplies?: Array<string | null>
}): SalesOutcome {
  const candidates: SalesOutcome[] = []
  if (input.leadStatus) candidates.push(outcomeFromLeadStatus(input.leadStatus))
  if (input.conversationStage) candidates.push(outcomeFromConversationStage(input.conversationStage))
  for (const s of input.storedStages ?? []) if (s) candidates.push(outcomeFromStoredStage(s))
  for (const r of input.inboundReplies ?? []) if (r) candidates.push(classifyInboundReply(r))
  return bestOutcome(candidates) ?? 'NO_RESPONSE'
}

/** Outcomes that count as real commercial progress (used for success metrics). */
export const COMMERCIAL_OUTCOMES: ReadonlySet<SalesOutcome> = new Set<SalesOutcome>([
  'WON', 'QUALIFIED_OPPORTUNITY', 'MEETING', 'PROPOSAL', 'POSITIVE_COMMERCIAL_REPLY',
])
