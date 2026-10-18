export type ObjectionCategory =
  | 'PRICE'
  | 'TIMING'
  | 'PROOF'
  | 'TRUST'
  | 'EXPERIENCE'
  | 'LOCATION'
  | 'AVAILABILITY'
  | 'TECH_STACK'
  | 'AUTHORITY'
  | 'OTHER'

export interface ObjectionRecord {
  leadId: string
  category: ObjectionCategory
  rawText: string
  detectedAt: string
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null // proof/sender that resolved it
}

export interface ReplyIntelligence {
  intent: string
  primaryIntent: string
  secondaryDimensions: {
    urgency: 'immediate' | 'soon' | 'none'
    commercialValue: 'high' | 'medium' | 'low'
    questionDetected: boolean
    objectionType: ObjectionCategory | null
    requestedInfo: string[]
    meetingIntent: boolean
    pricingIntent: boolean
    timelineIntent: boolean
  }
  classification: string
  recommendedAction: string
  riskFlags: string[]
  evidence: string[]
}

/**
 * Deterministic reply intelligence extraction.
 * Uses obvious pattern matching first — no AI needed for clear cases.
 */
export function extractReplyIntelligence(rawText: string): ReplyIntelligence {
  const text = rawText.toLowerCase()
  const dimensions: ReplyIntelligence['secondaryDimensions'] = {
    urgency: 'none',
    commercialValue: 'low',
    questionDetected: false,
    objectionType: null,
    requestedInfo: [],
    meetingIntent: false,
    pricingIntent: false,
    timelineIntent: false,
  }

  // Urgency detection
  if (/asap|urgent|immediately|right now|today|tomorrow|this week/.test(text)) {
    dimensions.urgency = 'immediate'
  } else if (/soon|next week|this month|in the coming/.test(text)) {
    dimensions.urgency = 'soon'
  }

  // Question detection
  if (/\?/.test(text) || /can you|could you|do you|would you|what|how|when|where/.test(text)) {
    dimensions.questionDetected = true
  }

  // Meeting intent
  if (/call|meet|meeting|chat|talk|zoom|calendar|schedule|book/.test(text)) {
    dimensions.meetingIntent = true
  }

  // Pricing intent
  if (/price|rate|cost|budget|quote|pricing|how much|package|proposal/.test(text)) {
    dimensions.pricingIntent = true
    dimensions.requestedInfo.push('pricing')
  }

  // Timeline intent
  if (/timeline|deadline|when|start|launch date|launching|release/.test(text)) {
    dimensions.timelineIntent = true
  }

  // Requested information extraction
  if (/example|portfolio|case study|work|past project|reference|demo/.test(text)) {
    dimensions.requestedInfo.push('proof/work examples')
  }
  if (/process|how do you work|workflow|approach|methodology/.test(text)) {
    dimensions.requestedInfo.push('process')
  }
  if (/availability|are you free|can you take|capacity/.test(text)) {
    dimensions.requestedInfo.push('availability')
  }
  if (/team|who would work|developer|designer|engineer/.test(text)) {
    dimensions.requestedInfo.push('team')
  }

  // Objection detection
  if (/too expensive|out of budget|can't afford|not in budget|costly|overpriced/.test(text)) {
    dimensions.objectionType = 'PRICE'
    dimensions.commercialValue = 'medium'
  } else if (/not the right time|too busy|later|not now|maybe next/.test(text)) {
    dimensions.objectionType = 'TIMING'
  } else if (/prove|track record|reference|portfolio|show me|evidence/.test(text)) {
    dimensions.objectionType = 'PROOF'
  } else if (/don't know you|new company|who are you|trust|reliable/.test(text)) {
    dimensions.objectionType = 'TRUST'
  } else if (/experience|have you done|worked with|before/.test(text)) {
    dimensions.objectionType = 'EXPERIENCE'
  } else if (/location|timezone|remote|based in|local/.test(text)) {
    dimensions.objectionType = 'LOCATION'
  } else if (/available|capacity|booked|taking on/.test(text)) {
    dimensions.objectionType = 'AVAILABILITY'
  } else if (/tech stack|technology|framework|language|react|node|python/.test(text)) {
    dimensions.objectionType = 'TECH_STACK'
  } else if (/decision|boss|manager|team|approval|authority/.test(text)) {
    dimensions.objectionType = 'AUTHORITY'
  }

  // Commercial value assessment
  if (dimensions.meetingIntent || dimensions.pricingIntent) {
    dimensions.commercialValue = 'high'
  } else if (dimensions.objectionType || dimensions.requestedInfo.length > 1) {
    dimensions.commercialValue = 'medium'
  }

  // Determine primary intent and classification
  const { primaryIntent, classification, recommendedAction, riskFlags } = classifyReply(text, dimensions)

  return {
    intent: primaryIntent,
    primaryIntent,
    secondaryDimensions: dimensions,
    classification,
    recommendedAction,
    riskFlags,
    evidence: [],
  }
}

function classifyReply(
  text: string,
  dimensions: ReplyIntelligence['secondaryDimensions'],
): {
  primaryIntent: string
  classification: string
  recommendedAction: string
  riskFlags: string[]
} {
  const riskFlags: string[] = []

  // Closed/rejection
  if (/not interested|no thanks|unsubscribe|remove me|stop|passed|going with someone else|decided to/.test(text)) {
    return {
      primaryIntent: 'REJECTION',
      classification: 'CLOSED',
      recommendedAction: 'Close or archive',
      riskFlags: ['Do not follow up'],
    }
  }

  // Deferral
  if (/not now|later|maybe next|too busy right now|reach back|in a few months/.test(text)) {
    return {
      primaryIntent: 'DEFERRAL',
      classification: 'DEFERRED',
      recommendedAction: 'Stay warm — no follow-up until they re-engage',
      riskFlags: ['Do not pitch now'],
    }
  }

  // Meeting accepted
  if (/sounds good|let's do it|works for me|yes|sure|great|book it|send the invite|calendar/.test(text)) {
    return {
      primaryIntent: 'MEETING_ACCEPT',
      classification: 'INTERESTED',
      recommendedAction: 'Send calendar link immediately',
      riskFlags: [],
    }
  }

  // Buying question
  if (dimensions.pricingIntent && dimensions.questionDetected) {
    return {
      primaryIntent: 'BUYING_QUESTION',
      classification: 'BUYING_INTENT',
      recommendedAction: 'Reply now — answer pricing + propose next step',
      riskFlags: [],
    }
  }

  // Question with requested info
  if (dimensions.questionDetected && dimensions.requestedInfo.length > 0) {
    return {
      primaryIntent: 'INFORMATION_REQUEST',
      classification: dimensions.commercialValue === 'high' ? 'BUYING_INTENT' : 'QUESTION',
      recommendedAction: 'Reply now — provide requested information',
      riskFlags: [],
    }
  }

  // Objection
  if (dimensions.objectionType) {
    return {
      primaryIntent: 'OBJECTION',
      classification: 'OBJECTION',
      recommendedAction: `Address ${dimensions.objectionType.toLowerCase()} objection`,
      riskFlags: [`${dimensions.objectionType} objection detected`],
    }
  }

  // Neutral/positive engagement
  if (/thanks|thank you|got it|received|noted|ok|understood/.test(text)) {
    return {
      primaryIntent: 'ACKNOWLEDGMENT',
      classification: 'NEUTRAL',
      recommendedAction: 'Continue the conversation when ready',
      riskFlags: [],
    }
  }

  return {
    primaryIntent: 'ENGAGEMENT',
    classification: dimensions.commercialValue === 'high' ? 'BUYING_INTENT' : 'QUESTION',
    recommendedAction: dimensions.commercialValue === 'high' ? 'Reply now' : 'Review',
    riskFlags: [],
  }
}
