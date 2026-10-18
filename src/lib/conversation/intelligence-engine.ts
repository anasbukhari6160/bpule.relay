/**
 * Generic Live Conversation Intelligence + State Transition Engine
 *
 * Converts ANY inbound client message into:
 * 1. Conversation intent
 * 2. Commercial strength
 * 3. Requested action
 * 4. Lifecycle transition
 * 5. Recommended next action
 * 6. Reply strategy
 *
 * Design:
 * - Deterministic first, AI only for ambiguity
 * - Live state overrides cold prospect state
 * - No hardcoded lead-specific rules
 * - All transitions are event-driven
 * - Every action has an idempotency key
 */

import { classifyClientMessage, type IntentClass } from './intent'

// ── Canonical Message Intent ────────────────────────────────────────────────

export type MessageIntent =
  | 'BUYING_INTEREST'
  | 'QUESTION'
  | 'REQUEST_FOR_INFO'
  | 'REQUEST_FOR_PROOF'
  | 'PRICING'
  | 'TIMELINE'
  | 'MEETING'
  | 'NEGOTIATION'
  | 'PROCUREMENT'
  | 'CONTRACTING'
  | 'ONBOARDING'
  | 'WON_CONFIRMATION'
  | 'DEFERRED'
  | 'OBJECTION'
  | 'NEGATIVE'
  | 'CLOSED'
  | 'REFERRAL'
  | 'NEUTRAL'
  | 'UNKNOWN'

export type CommercialStrength =
  | 'NONE'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'COMMITMENT'

export type LifecycleStage =
  | 'NEW'
  | 'CONNECTION_SENT'
  | 'CONNECTED'
  | 'FIRST_DM_SENT'
  | 'WAITING'
  | 'ENGAGED'
  | 'QUALIFIED'
  | 'INTERESTED'
  | 'MEETING'
  | 'NEGOTIATION'
  | 'CONTRACTING'
  | 'ONBOARDING'
  | 'WON'
  | 'DEFERRED'
  | 'LOST'
  | 'CLOSED'

export type RecommendedAction =
  | 'REPLY_NOW'
  | 'REPLY_CLARIFY'
  | 'SEND_PRICING'
  | 'SEND_PROOF'
  | 'SCHEDULE_MEETING'
  | 'SEND_CONTRACT'
  | 'ACKNOWLEDGE'
  | 'CLOSE_GRACEFULLY'
  | 'DEFER_FOLLOWUP'
  | 'START_OUTREACH'
  | 'WAIT'
  | 'RESEARCH'

export interface RequestedItem {
  type: 'pricing' | 'proof' | 'case_study' | 'portfolio' | 'availability' | 'contract' | 'nda' | 'proposal' | 'timeline' | 'info' | 'meeting' | 'vendor_form' | 'invoice' | 'sow' | 'other'
  raw: string
  deadline?: string
}

export interface StakeholderMention {
  role: string
  name?: string
  action: string
}

// ── Input / Output ──────────────────────────────────────────────────────────

export interface InboundMessage {
  text: string
  leadId: string
  messageId: string
  timestamp: string
  senderName?: string
  senderTitle?: string
}

export interface ConversationContext {
  currentStage: LifecycleStage
  clientMessages: string[]
  lastOutboundAt?: string
  lastInboundAt?: string
  followupCount: number
  knownObjections: string[]
  knownTimeline?: string
  knownBudget?: string
  stakeholders: StakeholderMention[]
}

export interface ConversationIntelligence {
  // 1. Intent
  primaryIntent: MessageIntent
  secondaryIntents: MessageIntent[]
  intentClass: IntentClass
  confidence: 'high' | 'medium' | 'low'
  intentReason: string

  // 2. Commercial strength
  commercialStrength: CommercialStrength

  // 3. Request extraction
  requestedItems: RequestedItem[]
  requestedAction: string | null
  stakeholders: StakeholderMention[]

  // 4. Lifecycle
  previousStage: LifecycleStage
  newStage: LifecycleStage
  stageTransition: string

  // 5. Recommended next action
  recommendedAction: RecommendedAction
  priority: number

  // 6. Reply strategy
  replyStrategy: ReplyStrategy

  // 7. Idempotency
  idempotencyKey: string

  // 8. Trace
  decisionTrace: DecisionStep[]
}

export interface ReplyStrategy {
  goal: string
  mustAddress: string[]
  mustNotAddress: string[]
  tone: 'warm' | 'direct' | 'clarifying' | 'closing' | 'enthusiastic'
  suggestedOpening?: string
  keyPoints: string[]
  questions: string[]
}

export interface DecisionStep {
  step: string
  reason: string
  evidence?: string
}

// ── Intent Classification ────────────────────────────────────────────────────

const PROCUREMENT_PATTERNS = [
  /\b(nda|non[- ]disclosure|vendor form|supplier form|security review|compliance|procurement|purchase order|po\b|msa|master service|statement of work|sow\b|invoice|billing|payment|onboarding doc|tax form|w9|w-9)\b/i,
]

const CONTRACTING_PATTERNS = [
  /\b(contract|agreement|sign|signed|signing|terms|conditions|legal review|reviewing (?:the |your )?(?:contract|agreement|terms)|countersign|executed)\b/i,
]

const ONBOARDING_PATTERNS = [
  /\b(onboard|access|credentials|kickoff|kick[- ]off|start date|first day|welcome|getting started|setup|account|login|portal)\b/i,
]

const TIMELINE_PATTERNS = [
  /\b(when can (?:you|we)|how soon|start date|timeline|deadline|by (?:next|this) (?:week|month)|before (?:the |end of)|urgent|asap|rush)\b/i,
]

const MEETING_PATTERNS = [
  /\b(book|schedule|call|meeting|zoom|teams|google meet|calendly|availability|available|talk (?:this|next)|meet up|let'?s meet|let'?s talk|let'?s chat)\b/i,
]

const PRICING_PATTERNS = [
  /\b(how much|pricing|price|cost|rates?|fee|fees|budget|quote|estimate|costs?|package|plan|tiers?)\b/i,
]

const REQUEST_FOR_INFO_PATTERNS = [
  /\b(how does|how do|what is|what are|what stack|what tools|can you|could you|tell me|explain|details|more info|information|deck|jd|job description|brief|scope|requirements)\b/i,
]

const REQUEST_FOR_PROOF_PATTERNS = [
  /\b(case stud|portfolio|example|examples|reference|references|testimonial|proof|work samples|previous work|past clients|who have you|built|delivered|shipped)\b/i,
]

const NEGOTIATION_PATTERNS = [
  /\b(can you do|discount|less|lower|reduce|cheaper|budget|offer|deal|terms|scope down|scope up|adjust|flexible|compromise|meet me|counter)\b/i,
]

const OBJECTION_PATTERNS = [
  /\b(too expensive|too much|too high|not sure|concern|worried|risk|timeline|timing|need (?:to |more )?(?:think|discuss|review|consider)|internal approval|stakeholder|boss|team needs to|not convinced|hesitant)\b/i,
]

const WON_PATTERNS = [
  /\b(you'?re hired|we'?re ready|let'?s (?:do it|go|start|begin|proceed|move forward|kick off)|signed|contract signed|ready to start|approved|greenlight|go ahead)\b/i,
]

const REFERRAL_PATTERNS = [
  /\b(talk to|reach out to|speak to|contact|loop in|cc|my (?:cto|ceo|co[- ]?founder|partner|manager|boss|team|colleague)|forward to|send this to|share with)\b/i,
]

const DEFERRED_PATTERNS = [
  /\b(not now|not (?:right )?now|later|next (?:quarter|month|year|week)|maybe (?:later|next)|reach out (?:again )?(?:later|next|in)|circle back|check back|busy|no budget|bad timing|not the right time|after (?:q[1-4]|the holidays|the new year))\b/i,
]

/**
 * Map IntentClass + detected patterns to canonical MessageIntent.
 * Deterministic first — no AI calls.
 */
function determineMessageIntent(text: string, intentClass: IntentClass): {
  primary: MessageIntent
  secondary: MessageIntent[]
  confidence: 'high' | 'medium' | 'low'
  reason: string
} {
  const normalized = text.toLowerCase().trim()
  const secondary: MessageIntent[] = []

  // Hard stops first (from intent.ts classification)
  if (intentClass === 'NEGATIVE') {
    return { primary: 'NEGATIVE', secondary: [], confidence: 'high', reason: 'explicit rejection phrase detected' }
  }
  if (intentClass === 'CLOSED') {
    return { primary: 'CLOSED', secondary: [], confidence: 'high', reason: 'conversation ended (goodbye/signoff)' }
  }
  if (intentClass === 'DEFERRED') {
    return { primary: 'DEFERRED', secondary, confidence: 'high', reason: 'asked to talk later' }
  }

  // Check procurement/contracting first (highest commercial value)
  const hasProcurement = matchesAny(normalized, PROCUREMENT_PATTERNS)
  const hasContracting = matchesAny(normalized, CONTRACTING_PATTERNS)

  if (hasProcurement || hasContracting) {
    return { primary: 'CONTRACTING', secondary: hasProcurement && !hasContracting ? ['PROCUREMENT'] : [], confidence: 'high', reason: 'procurement/contracting language detected' }
  }

  if (matchesAny(normalized, ONBOARDING_PATTERNS)) {
    return { primary: 'ONBOARDING', secondary, confidence: 'medium', reason: 'onboarding language detected' }
  }

  // Won confirmation
  if (matchesAny(normalized, WON_PATTERNS)) {
    return { primary: 'WON_CONFIRMATION', secondary: ['BUYING_INTEREST'], confidence: 'high', reason: 'commitment/won language detected' }
  }

  // Commitment-level buying
  const hasCommit = /send (?:me |us |over |across )*(?:a |an |the |your )?(?:proposal|contract|agreement|sow|statement of work|invoice|estimate|nda)|ready to (?:sign|start|begin|proceed)|where do (?:i|we) sign|you(?:'|re| are) hired|next steps/i.test(normalized)
  if (hasCommit) {
    return { primary: 'WON_CONFIRMATION', secondary: ['BUYING_INTEREST'], confidence: 'high', reason: 'explicit commitment language' }
  }

  // Meeting
  if (matchesAny(normalized, MEETING_PATTERNS)) {
    secondary.push('MEETING')
  }

  // Pricing
  if (matchesAny(normalized, PRICING_PATTERNS)) {
    secondary.unshift('PRICING')
  }

  // Timeline
  if (matchesAny(normalized, TIMELINE_PATTERNS)) {
    secondary.push('TIMELINE')
  }

  // Negotiation
  if (matchesAny(normalized, NEGOTIATION_PATTERNS)) {
    return { primary: 'NEGOTIATION', secondary, confidence: 'medium', reason: 'negotiation/counter-offer detected' }
  }

  // Objection
  if (matchesAny(normalized, OBJECTION_PATTERNS)) {
    return { primary: 'OBJECTION', secondary, confidence: 'medium', reason: 'objection/concern detected' }
  }

  // Referral / multi-stakeholder
  if (matchesAny(normalized, REFERRAL_PATTERNS)) {
    return { primary: 'REFERRAL', secondary, confidence: 'high', reason: 'stakeholder referral detected' }
  }

  // Buying interest (from intent.ts POSITIVE) — check before generic info
  if (intentClass === 'POSITIVE') {
    if (secondary.length > 0) {
      return { primary: 'BUYING_INTEREST', secondary, confidence: 'medium', reason: 'interest + ' + secondary.join(', ') }
    }
    return { primary: 'BUYING_INTEREST', secondary, confidence: 'medium', reason: 'expressed interest' }
  }

  // Request for info / proof
  if (matchesAny(normalized, REQUEST_FOR_PROOF_PATTERNS)) {
    if (secondary.includes('PRICING')) {
      return { primary: 'REQUEST_FOR_PROOF', secondary: ['PRICING', ...secondary.filter(s => s !== 'PRICING')], confidence: 'medium', reason: 'proof + pricing request' }
    }
    return { primary: 'REQUEST_FOR_PROOF', secondary, confidence: 'medium', reason: 'proof/case study request' }
  }

  if (matchesAny(normalized, REQUEST_FOR_INFO_PATTERNS)) {
    return { primary: 'REQUEST_FOR_INFO', secondary, confidence: 'medium', reason: 'information request' }
  }

  // Questions
  if (intentClass === 'QUESTION') {
    if (secondary.length > 0) {
      return { primary: secondary[0], secondary: secondary.slice(1), confidence: 'medium', reason: 'question + ' + secondary.join(', ') }
    }
    return { primary: 'QUESTION', secondary: [], confidence: 'medium', reason: 'asked a question' }
  }

  // Deferral
  if (matchesAny(normalized, DEFERRED_PATTERNS)) {
    return { primary: 'DEFERRED', secondary: [], confidence: 'high', reason: 'asked to defer/talk later' }
  }

  // Neutral / unknown
  if (intentClass === 'NEUTRAL') {
    if (secondary.length > 0) {
      return { primary: secondary[0], secondary: secondary.slice(1), confidence: 'low', reason: 'neutral message with hints of: ' + secondary.join(', ') }
    }
    return { primary: 'NEUTRAL', secondary: [], confidence: 'medium', reason: 'no clear commercial intent' }
  }

  return { primary: 'UNKNOWN', secondary: [], confidence: 'low', reason: 'could not classify' }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => {
    p.lastIndex = 0
    return p.test(text)
  })
}

// ── Commercial Strength ──────────────────────────────────────────────────────

function computeCommercialStrength(
  intent: MessageIntent,
  secondaryIntents: MessageIntent[],
  text: string,
): CommercialStrength {
  const normalized = text.toLowerCase()

  // Commitment signals
  if (intent === 'WON_CONFIRMATION' || intent === 'CONTRACTING') return 'COMMITMENT'
  if (intent === 'ONBOARDING') return 'COMMITMENT'

  // High — explicit buying signals
  if (intent === 'PRICING' && (normalized.includes('send') || normalized.includes('share'))) return 'HIGH'
  if (intent === 'MEETING' && (normalized.includes('book') || normalized.includes('schedule'))) return 'HIGH'
  if (intent === 'NEGOTIATION') return 'HIGH'
  if (intent === 'BUYING_INTEREST' && secondaryIntents.length >= 2) return 'HIGH'

  // Medium — questions with commercial direction
  if (intent === 'REQUEST_FOR_INFO' || intent === 'REQUEST_FOR_PROOF') return 'MEDIUM'
  if (intent === 'TIMELINE') return 'MEDIUM'
  if (intent === 'QUESTION') return 'MEDIUM'
  if (intent === 'BUYING_INTEREST') return 'MEDIUM'
  if (intent === 'MEETING') return 'MEDIUM'

  // Low — weak or no signal
  if (intent === 'REFERRAL') return 'LOW'
  if (intent === 'NEUTRAL') return 'LOW'
  if (intent === 'DEFERRED') return 'LOW'

  // None
  if (intent === 'NEGATIVE' || intent === 'CLOSED') return 'NONE'

  return 'LOW'
}

// ── Request Extraction ───────────────────────────────────────────────────────

function extractRequestedItems(text: string): RequestedItem[] {
  const items: RequestedItem[] = []
  const normalized = text.toLowerCase()

  // Pricing
  if (/\b(how much|pricing|price|cost|rates?|fee|fees|budget|quote|estimate|costs?|package|plan)\b/i.test(normalized)) {
    items.push({ type: 'pricing', raw: extractPhrase(text, /(?:pricing|price|cost|rates?|fee|fees|budget|quote|estimate|costs?|package|plan)/i) })
  }

  // Proof / case studies
  if (/\b(case stud(?:y|ies)?|portfolio|example|examples?|reference|references?|testimonial|proof|work samples?|previous work|built|delivered|shipped)\b/i.test(normalized)) {
    items.push({ type: 'case_study', raw: extractPhrase(text, /(?:case stud(?:y|ies)?|portfolio|examples?|references?|testimonial|proof|work samples?|previous work)/i) })
  }

  // Availability / meeting
  if (/\b(available|availability|when can|schedule|book|call|meeting|zoom|talk)\b/i.test(normalized)) {
    items.push({ type: 'availability', raw: extractPhrase(text, /(?:available|availability|when can|schedule|book|call|meeting|zoom|talk)/i) })
  }

  // Contract / NDA
  if (/\b(contract|agreement|nda|non[- ]disclosure|sow|statement of work|proposal)\b/i.test(normalized)) {
    const type = /\bnda\b/i.test(normalized) ? 'nda' : /\b(contract|agreement)\b/i.test(normalized) ? 'contract' : 'proposal'
    items.push({ type, raw: extractPhrase(text, /(?:contract|agreement|nda|sow|statement of work|proposal)/i) })
  }

  // Info / JD
  if (/\b(details|info|information|jd|job description|brief|scope|requirements|deck)\b/i.test(normalized)) {
    items.push({ type: 'info', raw: extractPhrase(text, /(?:details|info|information|jd|job description|brief|scope|requirements|deck)/i) })
  }

  // Vendor forms / procurement
  if (/\b(vendor form|supplier form|compliance|security review|w9|w-9|tax form|invoice|billing|payment)\b/i.test(normalized)) {
    items.push({ type: 'vendor_form', raw: extractPhrase(text, /(?:vendor form|supplier form|compliance|security review|w9|w-9|tax form|invoice|billing|payment)/i) })
  }

  // Timeline
  if (/\b(when can|how soon|start date|timeline|deadline|by (?:next|this)|before|urgent|asap)\b/i.test(normalized)) {
    items.push({ type: 'timeline', raw: extractPhrase(text, /(?:when can|how soon|start date|timeline|deadline|by (?:next|this)|before|urgent|asap)/i) })
  }

  return items
}

function extractPhrase(text: string, pattern: RegExp): string {
  const match = text.match(pattern)
  return match ? match[0] : ''
}

function extractStakeholders(text: string): StakeholderMention[] {
  const stakeholders: StakeholderMention[] = []
  const normalized = text.toLowerCase()

  const patterns = [
    { role: 'CTO', pattern: /\b(my |our |the )?cto\b/i },
    { role: 'CEO', pattern: /\b(my |our |the )?ceo\b/i },
    { role: 'Co-founder', pattern: /\b(my |our |the )?(?:co[- ]?founder|cofounder)\b/i },
    { role: 'Manager', pattern: /\b(my |our |the )?(?:manager|boss|director|lead|head of)\b/i },
    { role: 'Partner', pattern: /\b(my |our |the )?partner\b/i },
    { role: 'Procurement', pattern: /\b(my |our |the )?(?:procurement|purchasing|finance|legal)\b/i },
    { role: 'Team', pattern: /\b(my |our |the )?team\b/i },
  ]

  for (const { role, pattern } of patterns) {
    if (pattern.test(normalized)) {
      const actionMatch = text.match(/(?:talk to|reach out to|contact|speak to|ask|loop in|cc|forward to|send this to|share with)\b/i)
      stakeholders.push({
        role,
        action: actionMatch ? actionMatch[0] : 'mentioned',
      })
    }
  }

  return stakeholders
}

// ── Lifecycle State Machine ──────────────────────────────────────────────────

interface TransitionResult {
  newStage: LifecycleStage
  reason: string
}

function computeLifecycleTransition(
  currentStage: LifecycleStage,
  intent: MessageIntent,
  commercialStrength: CommercialStrength,
  previousIntents: MessageIntent[],
): TransitionResult {
  // Terminal states — strong buying signal can reopen
  if (currentStage === 'WON') {
    return { newStage: 'WON', reason: 'already won' }
  }
  if (currentStage === 'LOST' || currentStage === 'CLOSED') {
    if (intent === 'WON_CONFIRMATION') {
      return { newStage: 'WON', reason: 'reopened and won after closure' }
    }
    if (intent === 'BUYING_INTEREST' || intent === 'PRICING' || intent === 'MEETING' || intent === 'REQUEST_FOR_INFO') {
      return { newStage: 'ENGAGED', reason: 'reopened after closure with commercial signal' }
    }
    return { newStage: currentStage, reason: 'terminal state preserved' }
  }
  if (currentStage === 'DEFERRED') {
    if (intent === 'WON_CONFIRMATION' || intent === 'BUYING_INTEREST' || intent === 'PRICING' || intent === 'MEETING') {
      return { newStage: 'ENGAGED', reason: 'deferral ended with commercial signal' }
    }
    return { newStage: 'DEFERRED', reason: 'still deferred' }
  }

  // Event-driven transitions (forward only, no skipping without evidence)
  switch (intent) {
    case 'WON_CONFIRMATION':
      return { newStage: 'WON', reason: 'client committed' }
    case 'CONTRACTING':
      return { newStage: 'CONTRACTING', reason: 'contracting started' }
    case 'ONBOARDING':
      return { newStage: 'ONBOARDING', reason: 'onboarding phase' }
    case 'NEGOTIATION':
      // Must be at INTERESTED or beyond to negotiate
      if (stageRank(currentStage) >= stageRank('INTERESTED')) {
        return { newStage: 'NEGOTIATION', reason: 'in negotiation' }
      }
      return { newStage: 'INTERESTED', reason: 'negotiation signals → qualified interest' }
    case 'MEETING':
      if (commercialStrength === 'HIGH' || commercialStrength === 'COMMITMENT') {
        return { newStage: 'MEETING', reason: 'meeting requested with commitment' }
      }
      if (stageRank(currentStage) >= stageRank('ENGAGED')) {
        return { newStage: 'MEETING', reason: 'meeting requested' }
      }
      return { newStage: 'ENGAGED', reason: 'meeting request during engagement' }
    case 'PRICING':
    case 'REQUEST_FOR_PROOF':
    case 'REQUEST_FOR_INFO':
      if (commercialStrength === 'HIGH' || commercialStrength === 'COMMITMENT') {
        return { newStage: 'QUALIFIED', reason: 'high-intent request' }
      }
      if (stageRank(currentStage) >= stageRank('ENGAGED')) {
        return { newStage: 'QUALIFIED', reason: 'request during engagement' }
      }
      return { newStage: 'ENGAGED', reason: 'commercial inquiry → engaged' }
    case 'OBJECTION':
      if (stageRank(currentStage) >= stageRank('INTERESTED')) {
        return { newStage: currentStage, reason: 'objection within active deal — stay' }
      }
      return { newStage: 'ENGAGED', reason: 'objection during early engagement' }
    case 'DEFERRED':
      return { newStage: 'DEFERRED', reason: 'client deferred' }
    case 'NEGATIVE':
    case 'CLOSED':
      return { newStage: 'LOST', reason: 'rejection/closure' }
    case 'REFERRAL':
      return { newStage: currentStage === 'NEW' || currentStage === 'CONNECTION_SENT' || currentStage === 'CONNECTED' || currentStage === 'FIRST_DM_SENT' || currentStage === 'WAITING' ? 'ENGAGED' : currentStage, reason: 'stakeholder referral' }
    case 'BUYING_INTEREST':
      if (commercialStrength === 'HIGH' || commercialStrength === 'COMMITMENT') {
        return { newStage: 'INTERESTED', reason: 'strong buying signal' }
      }
      return { newStage: 'ENGAGED', reason: 'buying interest expressed' }
    case 'QUESTION':
    case 'TIMELINE':
      if (stageRank(currentStage) >= stageRank('ENGAGED')) {
        return { newStage: currentStage, reason: 'question within active conversation' }
      }
      return { newStage: 'ENGAGED', reason: 'first engagement' }
    case 'PROCUREMENT':
      return { newStage: 'CONTRACTING', reason: 'procurement behavior detected' }
    case 'NEUTRAL':
      return { newStage: currentStage, reason: 'neutral — no transition' }
    default:
      return { newStage: currentStage, reason: 'unknown intent — no transition' }
  }
}

function stageRank(stage: LifecycleStage): number {
  const order: LifecycleStage[] = [
    'NEW', 'CONNECTION_SENT', 'CONNECTED', 'FIRST_DM_SENT', 'WAITING',
    'ENGAGED', 'QUALIFIED', 'INTERESTED', 'MEETING', 'NEGOTIATION',
    'CONTRACTING', 'ONBOARDING', 'WON',
  ]
  return order.indexOf(stage)
}

// ── Recommended Action ───────────────────────────────────────────────────────

function computeRecommendedAction(
  intent: MessageIntent,
  commercialStrength: CommercialStrength,
  currentStage: LifecycleStage,
  hasObjection: boolean,
): { action: RecommendedAction; priority: number } {
  switch (intent) {
    case 'WON_CONFIRMATION':
      return { action: 'ACKNOWLEDGE', priority: 100 }
    case 'CONTRACTING':
    case 'PROCUREMENT':
      return { action: 'SEND_CONTRACT', priority: 95 }
    case 'MEETING':
      return { action: 'SCHEDULE_MEETING', priority: 90 }
    case 'PRICING':
      return { action: 'SEND_PRICING', priority: 85 }
    case 'REQUEST_FOR_PROOF':
      return { action: 'SEND_PROOF', priority: 80 }
    case 'NEGOTIATION':
      return { action: 'REPLY_NOW', priority: 85 }
    case 'OBJECTION':
      return { action: 'REPLY_NOW', priority: 75 }
    case 'REQUEST_FOR_INFO':
      return { action: 'REPLY_NOW', priority: 70 }
    case 'QUESTION':
      return { action: 'REPLY_NOW', priority: 65 }
    case 'TIMELINE':
      return { action: 'REPLY_NOW', priority: 60 }
    case 'BUYING_INTEREST':
      if (commercialStrength === 'HIGH' || commercialStrength === 'COMMITMENT') {
        return { action: 'REPLY_NOW', priority: 80 }
      }
      return { action: 'REPLY_NOW', priority: 55 }
    case 'REFERRAL':
      return { action: 'REPLY_NOW', priority: 50 }
    case 'DEFERRED':
      return { action: 'DEFER_FOLLOWUP', priority: 20 }
    case 'NEGATIVE':
    case 'CLOSED':
      return { action: 'CLOSE_GRACEFULLY', priority: 30 }
    case 'ONBOARDING':
      return { action: 'ACKNOWLEDGE', priority: 90 }
    default:
      return { action: 'WAIT', priority: 10 }
  }
}

// ── Reply Strategy ───────────────────────────────────────────────────────────

function generateReplyStrategy(
  intent: MessageIntent,
  requestedItems: RequestedItem[],
  stakeholders: StakeholderMention[],
  commercialStrength: CommercialStrength,
  objectionContext?: string,
): ReplyStrategy {
  const mustAddress: string[] = []
  const mustNotAddress: string[] = []
  const keyPoints: string[] = []
  const questions: string[] = []

  // Must address all requested items
  for (const item of requestedItems) {
    mustAddress.push(`Answer request for ${item.type}${item.raw ? ` ("${item.raw}")` : ''}`)
  }

  switch (intent) {
    case 'PRICING':
      return {
        goal: 'Provide pricing or minimum info to price',
        mustAddress: ['Give pricing range or ask clarifying scope question', ...mustAddress],
        mustNotAddress: ['Send generic portfolio', 'Pitch services not asked for'],
        tone: 'direct',
        keyPoints: ['Answer what was asked', 'If scope unclear, ask minimum needed to price', 'No unnecessary details'],
        questions: requestedItems.length === 0 ? ['What scope are you looking at?'] : [],
      }
    case 'MEETING':
      return {
        goal: 'Coordinate schedule',
        mustAddress: ['Propose time or ask for availability', ...mustAddress],
        mustNotAddress: ['Pitch before meeting', 'Send long intro'],
        tone: 'warm',
        keyPoints: ['Make scheduling easy', 'Offer 2-3 time slots or calendar link', 'Confirm timezone'],
        questions: ['What time works for you?'],
      }
    case 'REQUEST_FOR_PROOF':
      return {
        goal: 'Provide relevant proof',
        mustAddress: ['Share case study/portfolio/examples requested', ...mustAddress],
        mustNotAddress: ['Send generic examples', 'Claim unverifiable results'],
        tone: 'warm',
        keyPoints: ['Match proof to client context', 'Use verified case studies only', 'Highlight relevant outcomes'],
        questions: [],
      }
    case 'CONTRACTING':
    case 'PROCUREMENT':
      return {
        goal: 'Move procurement forward',
        mustAddress: ['Acknowledge request', 'Confirm next step', ...mustAddress],
        mustNotAddress: ['Negotiate terms in first reply', 'Introduce new scope'],
        tone: 'direct',
        keyPoints: ['Confirm receipt of request', 'State timeline for delivery', 'Ask if anything else needed'],
        questions: [],
      }
    case 'OBJECTION':
      return {
        goal: 'Address concern and re-engage',
        mustAddress: ['Acknowledge objection', 'Provide counter-evidence or alternative', ...mustAddress],
        mustNotAddress: ['Dismiss objection', 'Push harder without addressing concern'],
        tone: 'warm',
        keyPoints: ['Validate the concern', 'Provide evidence or alternative', 'Keep door open'],
        questions: ['What would work better?'],
      }
    case 'NEGOTIATION':
      return {
        goal: 'Find mutually acceptable terms',
        mustAddress: ['Respond to specific terms', ...mustAddress],
        mustNotAddress: ['Blindly accept or reject', 'Introduce unrelated points'],
        tone: 'direct',
        keyPoints: ['Acknowledge the counter', 'State your position clearly', 'Propose next step'],
        questions: [],
      }
    case 'NEGATIVE':
    case 'CLOSED':
      return {
        goal: 'Close gracefully, leave door open',
        mustAddress: ['Acknowledge decision', ...mustAddress],
        mustNotAddress: ['Argue', 'Push back', 'Ask why'],
        tone: 'warm',
        keyPoints: ['Polite closing', 'Leave door open for future', 'No follow-up pressure'],
        questions: [],
      }
    case 'DEFERRED':
      return {
        goal: 'Acknowledge deferral, no pressure',
        mustAddress: ['Confirm you will follow up later', ...mustAddress],
        mustNotAddress: ['Push for immediate decision', 'Send follow-up content now'],
        tone: 'warm',
        keyPoints: ['Acknowledge timing', 'Confirm you will reach out at the right time', 'Brief positive close'],
        questions: [],
      }
    case 'REFERRAL':
      return {
        goal: 'Acknowledge referral and confirm handoff',
        mustAddress: ['Confirm you will contact the referred person', ...mustAddress],
        mustNotAddress: ['Continue selling to wrong person'],
        tone: 'warm',
        keyPoints: ['Acknowledge the referral', 'Confirm you will reach out to the right person', 'Thank them'],
        questions: [],
      }
    default:
      return {
        goal: 'Respond helpfully',
        mustAddress,
        mustNotAddress: ['Make unsupported claims', 'Invent facts', 'Send generic content'],
        tone: 'direct',
        keyPoints: ['Answer what was asked', 'Keep it brief', 'Move conversation forward'],
        questions: [],
      }
  }
}

// ── Idempotency Key ──────────────────────────────────────────────────────────

function generateIdempotencyKey(message: InboundMessage, action: RecommendedAction): string {
  return `conv:${message.leadId}:${message.messageId}:${action}`
}

// ── Decision Trace ───────────────────────────────────────────────────────────

function buildTrace(steps: DecisionStep[]): DecisionStep[] {
  return steps
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

export interface ProcessInboundParams {
  message: InboundMessage
  context: ConversationContext
  previousIntents?: MessageIntent[]
}

export function processInboundMessage(params: ProcessInboundParams): ConversationIntelligence {
  const { message, context, previousIntents = [] } = params
  const trace: DecisionStep[] = []

  // Step 1: Classify intent (deterministic)
  const classification = classifyClientMessage(message.text)
  trace.push({ step: 'Intent classification', reason: classification.intent, evidence: classification.reason })

  // Step 2: Determine canonical message intent
  const { primary, secondary, confidence, reason } = determineMessageIntent(message.text, classification.class)
  trace.push({ step: 'Canonical intent', reason, evidence: `primary: ${primary}, secondary: ${secondary.join(',')}` })

  // Step 3: Compute commercial strength
  const strength = computeCommercialStrength(primary, secondary, message.text)
  trace.push({ step: 'Commercial strength', reason: strength })

  // Step 4: Extract requested items
  const requestedItems = extractRequestedItems(message.text)
  trace.push({ step: 'Request extraction', reason: `${requestedItems.length} items: ${requestedItems.map(i => i.type).join(', ')}` })

  // Step 5: Extract stakeholders
  const stakeholders = extractStakeholders(message.text)
  if (stakeholders.length > 0) {
    trace.push({ step: 'Stakeholder detection', reason: stakeholders.map(s => s.role).join(', ') })
  }

  // Step 6: Lifecycle transition
  const transition = computeLifecycleTransition(context.currentStage, primary, strength, previousIntents)
  trace.push({ step: 'Lifecycle transition', reason: transition.reason, evidence: `${context.currentStage} → ${transition.newStage}` })

  // Step 7: Recommended action
  const { action: recommendedAction, priority } = computeRecommendedAction(primary, strength, context.currentStage, context.knownObjections.length > 0)
  trace.push({ step: 'Recommended action', reason: recommendedAction, evidence: `priority: ${priority}` })

  // Step 8: Reply strategy
  const replyStrategy = generateReplyStrategy(primary, requestedItems, stakeholders, strength, context.knownObjections[0])
  trace.push({ step: 'Reply strategy', reason: replyStrategy.goal })

  // Step 9: Idempotency key
  const idempotencyKey = generateIdempotencyKey(message, recommendedAction)

  return {
    primaryIntent: primary,
    secondaryIntents: secondary,
    intentClass: classification.class,
    confidence,
    intentReason: reason,
    commercialStrength: strength,
    requestedItems,
    requestedAction: requestedItems.length > 0 ? requestedItems[0].type : null,
    stakeholders,
    previousStage: context.currentStage,
    newStage: transition.newStage,
    stageTransition: transition.reason,
    recommendedAction,
    priority,
    replyStrategy,
    idempotencyKey,
    decisionTrace: buildTrace(trace),
  }
}

// ── Multi-turn Understanding ─────────────────────────────────────────────────

/**
 * Process a conversation history to get the current state.
 * Latest explicit meaning wins (rejection overrides earlier interest,
 * real buying signal reopens after rejection).
 */
export function resolveConversationState(messages: InboundMessage[], initialStage: LifecycleStage = 'NEW'): {
  currentStage: LifecycleStage
  intents: MessageIntent[]
  latestIntelligence: ConversationIntelligence | null
} {
  let stage = initialStage
  const intents: MessageIntent[] = []
  let latest: ConversationIntelligence | null = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const context: ConversationContext = {
      currentStage: stage,
      clientMessages: messages.slice(0, i).map(m => m.text),
      followupCount: 0,
      knownObjections: [],
      stakeholders: [],
    }

    const intelligence = processInboundMessage({ message: msg, context, previousIntents: intents })
    intents.push(intelligence.primaryIntent)
    stage = intelligence.newStage
    latest = intelligence
  }

  return { currentStage: stage, intents, latestIntelligence: latest }
}
