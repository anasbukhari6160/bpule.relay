/**
 * Conversation Override Engine
 *
 * Cold score answers: "Should we initiate?"
 * Conversation state answers: "What do we do now?"
 *
 * Once a client replies, the latest conversation intent overrides the cold score.
 * The cold score is preserved in the trace for historical reference.
 *
 * Examples:
 *   Cold 2/10 + inbound "send proposal" → REPLY_NOW
 *   Cold 9/10 + inbound "not interested" → CLOSED
 *   Cold 5/10 + inbound "tell me more" → ENGAGE
 */

export type ConversationIntent =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'NEEDS_MORE_INFO'
  | 'SEND_PROPOSAL'
  | 'SCHEDULE_CALL'
  | 'PRICING_INQUIRY'
  | 'OBJECTION'
  | 'REFERRAL'
  | 'UNRELATED'
  | 'UNKNOWN'

export interface ConversationState {
  latestInboundIntent: ConversationIntent
  lastInboundAt: string | null
  stage: 'cold' | 'contacted' | 'replied' | 'meeting_booked' | 'closed' | 'lost'
  messageCount: number
  lastInboundQuote: string | null
}

export interface OverrideResult {
  effectiveAction: string
  coldScore: number | null
  conversationOverride: boolean
  reason: string
  confidence: 'high' | 'medium' | 'low'
  preserveColdScore: true  // always preserved in trace
}

/**
 * Determine the effective action when conversation evidence exists.
 * Conversation intent ALWAYS overrides cold score once client has replied.
 */
export function resolveEffectiveAction(
  coldScore: number | null,
  coldAction: string | null,
  conversation: ConversationState | null,
): OverrideResult {
  if (!conversation || conversation.stage === 'cold' || !conversation.latestInboundIntent) {
    return {
      effectiveAction: coldAction ?? 'OBSERVE',
      coldScore,
      conversationOverride: false,
      reason: 'No conversation evidence — using cold score',
      confidence: coldScore !== null ? 'medium' : 'low',
      preserveColdScore: true,
    }
  }

  const intent = conversation.latestInboundIntent

  // Explicit negative → closed/lost regardless of cold score
  if (intent === 'NOT_INTERESTED') {
    return {
      effectiveAction: 'CLOSED',
      coldScore,
      conversationOverride: true,
      reason: 'Client expressed disinterest — overrides cold score',
      confidence: 'high',
      preserveColdScore: true,
    }
  }

  // Explicit strong interest → act now regardless of cold score
  if (intent === 'SEND_PROPOSAL' || intent === 'SCHEDULE_CALL') {
    return {
      effectiveAction: 'REPLY_NOW',
      coldScore,
      conversationOverride: true,
      reason: `Client requested ${intent === 'SEND_PROPOSAL' ? 'a proposal' : 'a call'} — act immediately`,
      confidence: 'high',
      preserveColdScore: true,
    }
  }

  // Pricing inquiry → strong buying signal
  if (intent === 'PRICING_INQUIRY') {
    return {
      effectiveAction: 'ENGAGE',
      coldScore,
      conversationOverride: true,
      reason: 'Client asked about pricing — active buying signal',
      confidence: 'high',
      preserveColdScore: true,
    }
  }

  // Needs more info → engage if fit is reasonable
  if (intent === 'NEEDS_MORE_INFO') {
    return {
      effectiveAction: coldScore !== null && coldScore >= 30 ? 'ENGAGE' : 'REPLY',
      coldScore,
      conversationOverride: true,
      reason: 'Client wants more information — respond with relevant proof',
      confidence: 'medium',
      preserveColdScore: true,
    }
  }

  // General interest
  if (intent === 'INTERESTED') {
    return {
      effectiveAction: 'ENGAGE',
      coldScore,
      conversationOverride: true,
      reason: 'Client expressed interest — prioritize engagement',
      confidence: 'high',
      preserveColdScore: true,
    }
  }

  // Objection — needs research
  if (intent === 'OBJECTION') {
    return {
      effectiveAction: 'RESEARCH_THEN_REPLY',
      coldScore,
      conversationOverride: true,
      reason: 'Client raised objection — research before responding',
      confidence: 'medium',
      preserveColdScore: true,
    }
  }

  // Referral — follow the referral
  if (intent === 'REFERRAL') {
    return {
      effectiveAction: 'FOLLOW_REFERRAL',
      coldScore,
      conversationOverride: true,
      reason: 'Client referred elsewhere — route to recommended sender',
      confidence: 'medium',
      preserveColdScore: true,
    }
  }

  // Unknown or unrelated — defer to cold score
  return {
    effectiveAction: coldAction ?? 'OBSERVE',
    coldScore,
    conversationOverride: false,
    reason: 'Conversation intent unclear — using cold score',
    confidence: 'low',
    preserveColdScore: true,
  }
}

/**
 * Parse a raw inbound message to extract conversation intent.
 * Deterministic keyword-based — no AI needed for initial classification.
 */
export function classifyConversationIntent(text: string): ConversationIntent {
  const lower = text.toLowerCase().trim()

  if (/not interested|not a fit|not looking|pass on|no thanks|no thank you|unsubscribe/i.test(lower))
    return 'NOT_INTERESTED'

  if (/send (?:us |me )?(?:a |your )?(?:proposal|quote|pricing|estimate)/i.test(lower) || /proposal/i.test(lower))
    return 'SEND_PROPOSAL'

  if (/schedule|book (?:a )?(?:call|meeting|demo)|calendar/i.test(lower))
    return 'SCHEDULE_CALL'

  if (/too expensive|not sure|concern|worried|hesitant|not convinced/i.test(lower))
    return 'OBJECTION'

  if (/how much|pricing|cost|rate|fee|what('s| is) your (?:price|fee|rate)/i.test(lower))
    return 'PRICING_INQUIRY'

  if (/tell me more|more info|details|elaborate|explain/i.test(lower))
    return 'NEEDS_MORE_INFO'

  if (/interested|sounds good|let('|')s talk|keen|intrigued/i.test(lower))
    return 'INTERESTED'

  if (/(?:talk to|reach out to|contact|refer you to|connect you with) ([A-Z][a-z]+)/i.test(lower))
    return 'REFERRAL'

  return 'UNKNOWN'
}
