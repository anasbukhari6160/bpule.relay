import { classifyClientMessage, type IntentClass } from '@/lib/conversation/intent'

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

export interface ReplyIntelligence {
  primaryIntent: string
  canonicalClass: IntentClass
  classification: string
  recommendedAction: string
  riskFlags: string[]
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
}

/**
 * Reply Intelligence — uses canonical intent classifier as primary source.
 * Adds secondary dimensions (urgency, objections, requested info) on top.
 * NEVER contradicts lifecycle state — canonical class is truth.
 */
export function extractReplyIntelligence(rawText: string): ReplyIntelligence {
  // 1. Use canonical classifier as ground truth
  const canonical = classifyClientMessage(rawText)

  // 2. Extract secondary dimensions deterministically
  const dimensions = extractDimensions(rawText)

  // 3. Map canonical class to action — guaranteed agreement with lifecycle
  const { classification, recommendedAction, riskFlags } = mapCanonicalToAction(
    canonical,
    dimensions,
  )

  return {
    primaryIntent: canonical.intent,
    canonicalClass: canonical.class,
    classification,
    recommendedAction,
    riskFlags,
    secondaryDimensions: dimensions,
  }
}

function extractDimensions(rawText: string): ReplyIntelligence['secondaryDimensions'] {
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

  // Urgency
  if (/asap|urgent|immediately|right now|today|tomorrow|this week/.test(text)) {
    dimensions.urgency = 'immediate'
  } else if (/soon|next week|this month|in the coming/.test(text)) {
    dimensions.urgency = 'soon'
  }

  // Question
  if (/\?/.test(text) || /can you|could you|do you|would you|what|how|when|where/.test(text)) {
    dimensions.questionDetected = true
  }

  // Meeting
  if (/call|meet|meeting|chat|talk|zoom|calendar|schedule|book/.test(text)) {
    dimensions.meetingIntent = true
  }

  // Pricing
  if (/price|rate|cost|budget|quote|pricing|how much|package|proposal/.test(text)) {
    dimensions.pricingIntent = true
    dimensions.requestedInfo.push('pricing')
  }

  // Timeline
  if (/timeline|deadline|when|start|launch date|launching|release/.test(text)) {
    dimensions.timelineIntent = true
  }

  // Requested info
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

  // Objection
  if (/too expensive|out of budget|can't afford|not in budget|costly|overpriced/.test(text)) {
    dimensions.objectionType = 'PRICE'
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

  // Commercial value
  if (dimensions.meetingIntent || dimensions.pricingIntent) {
    dimensions.commercialValue = 'high'
  } else if (dimensions.objectionType || dimensions.requestedInfo.length > 1) {
    dimensions.commercialValue = 'medium'
  }

  return dimensions
}

function mapCanonicalToAction(
  canonical: { class: IntentClass; intent: string; explicit: boolean },
  dimensions: ReplyIntelligence['secondaryDimensions'],
): { classification: string; recommendedAction: string; riskFlags: string[] } {
  const riskFlags: string[] = []

  switch (canonical.class) {
    case 'NEGATIVE':
      return {
        classification: 'CLOSED',
        recommendedAction: 'Close or archive — do not follow up',
        riskFlags: ['Do not follow up'],
      }

    case 'DEFERRED':
      return {
        classification: 'DEFERRED',
        recommendedAction: 'Stay warm — no follow-up until they re-engage',
        riskFlags: ['Do not pitch now'],
      }

    case 'CLOSED':
      return {
        classification: 'CLOSED',
        recommendedAction: 'Close or archive',
        riskFlags: ['Conversation is closed'],
      }

    case 'POSITIVE':
      if (dimensions.meetingIntent) {
        return {
          classification: 'MEETING_ACCEPT',
          recommendedAction: 'Send calendar link immediately',
          riskFlags: [],
        }
      }
      if (dimensions.objectionType) {
        return {
          classification: 'OBJECTION',
          recommendedAction: `Address ${dimensions.objectionType.toLowerCase()} objection`,
          riskFlags: [`${dimensions.objectionType} objection detected`],
        }
      }
      return {
        classification: 'INTERESTED',
        recommendedAction: dimensions.commercialValue === 'high' ? 'Reply now' : 'Continue conversation',
        riskFlags: [],
      }

    case 'QUESTION':
      if (dimensions.pricingIntent) {
        return {
          classification: 'BUYING_INTENT',
          recommendedAction: 'Reply now — answer pricing + propose next step',
          riskFlags: [],
        }
      }
      return {
        classification: 'QUESTION',
        recommendedAction: 'Reply now — provide requested information',
        riskFlags: [],
      }

    case 'NEUTRAL':
    default:
      if (dimensions.questionDetected) {
        return {
          classification: 'QUESTION',
          recommendedAction: 'Reply to question',
          riskFlags: [],
        }
      }
      return {
        classification: 'NEUTRAL',
        recommendedAction: 'Continue the conversation when ready',
        riskFlags: [],
      }
  }
}
