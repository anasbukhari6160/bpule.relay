import type { OpportunitySignal } from './types'

export type ServiceBuyerIntent = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type ExternalEngineeringNeed = 'EXPLICIT' | 'NONE_DETECTED'
export type BuyerTiming = 'IMMEDIATE' | 'NEAR_TERM' | 'FUTURE' | 'UNKNOWN'
export type BuyerEvidenceKind =
  | 'BUYER_REQUEST'
  | 'CAPACITY_REQUEST'
  | 'PROCUREMENT_SIGNAL'
  | 'HIRING_SIGNAL'
  | 'PARTNER_REQUEST'

export interface CommercialReading {
  serviceBuyerIntent: ServiceBuyerIntent
  externalEngineeringNeed: ExternalEngineeringNeed
  immediateBuyerNeed: boolean
  buyerTiming: BuyerTiming
  productMomentum: 'HIGH' | 'MEDIUM' | 'NONE'
  customerDiscovery: 'SUPPORTED' | 'NONE'
  preLaunchActivity: 'SUPPORTED' | 'NONE'
  technicalRelevance: 'HIGH' | 'MEDIUM' | 'NONE'
  buyerEvidenceKinds: BuyerEvidenceKind[]
}

const BUYER_PATTERNS: Array<{ kind: BuyerEvidenceKind; re: RegExp }> = [
  { kind: 'HIRING_SIGNAL', re: /\b(?:we(?:'re| are) hiring|now hiring|open roles?)\b|\bhiring\b.{0,80}\b(?:developer|engineer|contractor|full[- ]?stack|backend|frontend|software)\b|\b(?:developer|engineer|contractor|full[- ]?stack)\b.{0,80}\bhiring\b/i },
  // "looking for a [adjective(s)] developer/engineer/team/partner/
  // freelancer/agency/vendor/contractor to <verb>" — a bounded gap allows
  // realistic qualifiers ("a strong React/Node.js team", "a technical
  // partner") between the noun phrase and the noun itself.
  {
    kind: 'BUYER_REQUEST',
    re: /\blooking for (?:a |an )?[\w\s/.-]{0,40}?\b(?:developer|engineer|team|freelancer|contractor|agency|vendor)\b/i,
  },
  // "development partners" or "engineering partners" = buyer signal
  // but bare "partners" or "partners, not clients" = not a buyer signal
  {
    kind: 'BUYER_REQUEST',
    re: /\blooking for\s+(?:\w+\s+){0,3}?(?:development|engineering|technical|technology)\s+partners?\b/i,
  },
  {
    kind: 'BUYER_REQUEST',
    re: /\bneed (?:a |an |someone )?[\w\s/.-]{0,40}?\b(?:developer|engineer|team|help|someone)\b.{0,40}?\b(?:to|who can|for)\b/i,
  },
  { kind: 'BUYER_REQUEST', re: /\bhelp us build\b/i },
  // Hiring post with explicit apply/contact instructions = buyer request.
  // "Hiring: Role — send resume/GitHub/portfolio/DM to apply" is functionally
  // a request for outside help, not just a hiring announcement.
  { kind: 'BUYER_REQUEST', re: /\bhiring\b.{0,150}\b(?:send|apply|contact|dm|email|resume|github|portfolio|rate|availability)\b.{0,100}\b(?:apply|contact|send|reach|instructions|instructions?)\b/i },
  { kind: 'CAPACITY_REQUEST', re: /\b(can'?t keep up|understaffed|need more (?:engineers|developers|capacity)|backlog is (?:growing|killing))\b/i },
  // Bare mentions of "procurement" are not buyer-directional on their own —
  // the word appears constantly in descriptions of procurement SYSTEMS,
  // PLATFORMS, or PAST WORK (e.g. "the e-Government Procurement portal ...
  // procurement activities by the Procuring Agencies") with no first-person
  // buyer framing at all. Require the request to be spoken in first person
  // ("we/our" + issuing/running/starting a procurement, an RFP, or a vendor
  // shortlist) so describing a procurement SYSTEM never reads as a current
  // buying signal (see Mansur/XHYRE: a former e-GP-portal project ≠ XHYRE
  // currently procuring vendors).
  {
    kind: 'PROCUREMENT_SIGNAL',
    re: /\b(?:we'?re|we\s+are|our)\s+[\w\s/.-]{0,30}?\b(?:issuing|running|starting|opening)\s+an?\s+rfp\b|\bwe'?re\s+(?:putting\s+together|building)\s+a\s+vendor\s+shortlist\b|\bour\s+budget\s+for\s+(?:development|engineering)\b/i,
  },
  {
    kind: 'PARTNER_REQUEST',
    re: /\b(?:development|engineering|technical|technology)\s+partner\b|\blooking for a partner to (?:build|help)\b/i,
  },
  // "we've tried agencies before, need someone who can embed with our
  // team" — a prior-vendor-attempt admission is strong buyer-directional
  // evidence in its own right, independent of the exact noun used.
  { kind: 'BUYER_REQUEST', re: /\b(?:we'?ve|we have)\s+tried\s+(?:agencies|contractors|freelancers|vendors)\s+before\b/i },
]

const PRODUCT_MOMENTUM = /\b(we(?:'re| are) building|building .{0,80}(?:infrastructure|platform|product)|close to launch|not public yet|early access)\b/i
const CUSTOMER_DISCOVERY = /\b(customer discovery|talking to founders|founder conversations|problem they described|engineering leaders about)\b/i
const PRE_LAUNCH = /\b(pre-launch|not public yet|close to launch|early access|we(?:'re| are) close)\b/i
const TECHNICAL = /\b(ai|infrastructure|platform|api|coding|engineer|software)\b/i
const COMPANY_GROWTH = /\b(headcount|hired \d+|team (?:grew|is growing)|revenue (?:grew|growth)|customer (?:growth|base grew)|expanding (?:into|headcount|the team)|series [abc]\b|raised\s+[\$€£\d])\b/i
const IMMEDIATE_BUYER = /\b(urgent|asap|immediately|right now)\b/i

// Signals that only mean something as BUYER-REQUEST evidence — if there is
// no buyer-directional pattern match anywhere in the text, these must not
// survive, since scoring/strategy would otherwise treat them as a current
// need/ask that was never actually stated.
const BUYER_ONLY_SIGNALS: OpportunitySignal[] = [
  'explicit_ask',
  'freelance_project_need',
  'technical_problem',
  'hiring',
  'hiring_pressure',
]

// "Relevant change" signals (launch, migration, rebuild — growth_signal is
// handled separately below) are a DIFFERENT, legitimate non-pitch outreach
// reason in their own right — decideContact's RELEVANT_CHANGE branch
// recommends a low-pressure connection note acknowledging a founder's
// scaling/launch/migration WITHOUT claiming it as buyer intent (see Daria
// Redkina/Solsonic: "scaling into a hardware startup" → CONNECT_OR_OBSERVE
// with a note, never a pitch). They are intentionally absent from
// BUYER_ONLY_SIGNALS and never filtered by the hasBuyer check below — the
// absence of buyer-request evidence says nothing about them, since they

export function deriveCommercialReading(rawText: string): CommercialReading {
  const buyerEvidenceKinds = BUYER_PATTERNS.filter((p) => p.re.test(rawText)).map((p) => p.kind)
  const hasBuyer = buyerEvidenceKinds.length > 0
  const productMomentum = PRODUCT_MOMENTUM.test(rawText) ? 'HIGH' : 'NONE'
  const customerDiscovery = CUSTOMER_DISCOVERY.test(rawText) ? 'SUPPORTED' : 'NONE'
  const preLaunchActivity = PRE_LAUNCH.test(rawText) ? 'SUPPORTED' : 'NONE'
  const technicalRelevance = TECHNICAL.test(rawText) ? 'HIGH' : 'NONE'

  let buyerTiming: BuyerTiming = 'UNKNOWN'
  let immediateBuyerNeed = false
  if (hasBuyer) {
    if (IMMEDIATE_BUYER.test(rawText)) {
      buyerTiming = 'IMMEDIATE'
      immediateBuyerNeed = true
    } else if (/\b(soon|next month|this quarter)\b/i.test(rawText)) {
      buyerTiming = 'NEAR_TERM'
    }
  }

  let serviceBuyerIntent: ServiceBuyerIntent = 'UNKNOWN'
  // HIRING_SIGNAL is NOT a strong buyer evidence — it means hiring for own team.
  // Only BUYER_REQUEST and PARTNER_REQUEST indicate real outside-help intent.
  if (hasBuyer && (buyerEvidenceKinds.includes('BUYER_REQUEST') || buyerEvidenceKinds.includes('PARTNER_REQUEST'))) {
    serviceBuyerIntent = 'HIGH'
  } else if (hasBuyer && buyerEvidenceKinds.includes('HIRING_SIGNAL')) {
    serviceBuyerIntent = 'LOW'
  } else if (hasBuyer) {
    serviceBuyerIntent = 'MEDIUM'
  }

  return recruiterHiringIsNotAPurchase(rawText, enforceBuyerIntentBoundary({
    serviceBuyerIntent,
    externalEngineeringNeed: hasBuyer ? 'EXPLICIT' : 'NONE_DETECTED',
    immediateBuyerNeed,
    buyerTiming,
    productMomentum,
    customerDiscovery,
    preLaunchActivity,
    technicalRelevance,
    buyerEvidenceKinds,
  }))
}

const RECRUITER_HEADER = /\b(?:it recruiter|technical recruiter|tech recruiter|recruiter|rekruter(?:ka)?|talent acquisition|sourcer|headhunter)\b/i
const EXTERNAL_PURCHASE = /\b(?:looking for|need|seeking|hire)\b[\s\S]{0,80}\b(?:agency|vendor|outsourc\w*|development partner|software partner|external team|staff augmentation)\b/i

/** A recruiter hiring for an employer is not a vendor purchase. */
function recruiterHiringIsNotAPurchase(rawText: string, reading: CommercialReading): CommercialReading {
  const header = rawText.split('\n').slice(0, 12).join('\n')
  if (!RECRUITER_HEADER.test(header)) return reading
  if (EXTERNAL_PURCHASE.test(rawText)) return reading
  const kinds = reading.buyerEvidenceKinds.filter((kind) => kind === 'HIRING_SIGNAL')
  return {
    ...reading,
    serviceBuyerIntent: kinds.includes('HIRING_SIGNAL') ? 'LOW' : 'UNKNOWN',
    externalEngineeringNeed: 'NONE_DETECTED',
    immediateBuyerNeed: false,
    buyerTiming: 'UNKNOWN',
    buyerEvidenceKinds: kinds,
  }
}

/** Product momentum is not buyer intent. HIGH buyer intent requires buyer-directional evidence. */
export function enforceBuyerIntentBoundary(reading: CommercialReading): CommercialReading {
  const hasBuyer = reading.buyerEvidenceKinds.length > 0
  if (hasBuyer) return reading
  return {
    ...reading,
    serviceBuyerIntent: 'UNKNOWN',
    externalEngineeringNeed: 'NONE_DETECTED',
    immediateBuyerNeed: false,
    buyerTiming: 'UNKNOWN',
  }
}

const DIAGNOSTIC_EVIDENCE = [
  /^source url\b/i,
  /\bon-site requirement\b/i,
  /\bremote eligibility\b/i,
  /\bworkplace type\b/i,
  /\bnot a vendor eligibility\b/i,
]

export function isStrategyGroundingText(text: string | null | undefined): boolean {
  const value = text?.trim() ?? ''
  if (!value) return false
  return !DIAGNOSTIC_EVIDENCE.some((re) => re.test(value))
}

/**
 * Drop buyer-opportunity signals that are not backed by buyer-directional
 * evidence. Own-product launch, customer discovery, and "this week"
 * conversation timing stay on the commercial reading and must not become
 * buying intent.
 *
 * Three independent rules, not one blanket strip:
 * 1. BUYER_ONLY_SIGNALS (explicit_ask/freelance_project_need/
 *    technical_problem/hiring/hiring_pressure) require buyer-directional
 *    evidence (a BUYER_PATTERNS match) — without it they are deleted.
 * 2. growth_signal ALWAYS requires its own typed COMPANY_GROWTH evidence
 *    (headcount/revenue/customer/funding growth), independent of buyer
 *    evidence — an ambitious company description, global-market language,
 *    or founder/technical activity is never growth evidence on its own
 *    (see Mansur/XHYRE, Andrew/Orthoboost).
 * 3. RELEVANT_CHANGE_SIGNALS (launch/migration/rebuild) are a distinct,
 *    legitimate "worth a low-pressure connect, not a pitch" reason in their
 *    own right (see decideContact's RELEVANT_CHANGE branch) and are NEVER
 *    stripped by the buyer-evidence check — they were never buyer claims to
 *    begin with, so the absence of buyer evidence says nothing about them.
 */
export function applyBuyerIntentBoundary<T extends {
  signals: OpportunitySignal[]
  primarySignal: OpportunitySignal | null
  urgency: 'immediate' | 'near_term' | 'future' | 'unknown'
}>(opportunity: T, rawText: string): { opportunity: T; reading: CommercialReading } {
  const reading = deriveCommercialReading(rawText)
  const hasBuyer = reading.buyerEvidenceKinds.length > 0
  const companyGrowth = COMPANY_GROWTH.test(rawText)
  let signals = [...opportunity.signals]

  if (!hasBuyer) {
    signals = signals.filter((s) => !BUYER_ONLY_SIGNALS.includes(s))
  }
  signals = signals.filter((s) => s !== 'growth_signal')
  if (companyGrowth) signals.push('growth_signal')

  const urgency = hasBuyer ? opportunity.urgency : 'unknown'

  const primarySignal = signals[0] ?? null
  return {
    reading,
    opportunity: { ...opportunity, signals, urgency, primarySignal },
  }
}
