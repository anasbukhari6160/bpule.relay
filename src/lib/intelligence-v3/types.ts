/**
 * Decision Intelligence V3 — Type Definitions
 *
 * Core invariant: never score PERSON. Score ACTIVE OPPORTUNITY EPISODE.
 *
 * A person may have zero, one, or many opportunity episodes across
 * different organizations and dates. Every commercial interpretation
 * is scoped to: person + organization + event + time.
 *
 * Schema version: relay_decision_v3
 */


export interface V3Person {
  id: string
  fullName: string | null
  firstName: string | null
  linkedinUrl: string | null
  location: string | null
  /** All known affiliations across organizations */
  affiliations: V3Affiliation[]
}

export interface V3Affiliation {
  organizationId: string
  organizationName: string
  role: string | null
  relationship: 'FOUNDED' | 'EMPLOYED' | 'ADVISORY' | 'CONTRACTOR' | 'UNKNOWN'
  isCurrent: boolean
  startedAt: string | null
  endedAt: string | null
}

export interface V3Organization {
  id: string
  name: string | null
  domain: string | null
  linkedinUrl: string | null
  industry: string | null
  size: string | null
  /** Whether this org is a service provider / agency */
  appearsToBeServiceProvider: boolean
}


export type V3EvidenceType = 'FACT' | 'STRONG_INFERENCE' | 'WEAK_INFERENCE'

export type V3EvidenceSourceType =
  | 'linkedin_profile'
  | 'linkedin_post'
  | 'job_posting'
  | 'company_website'
  | 'pasted_text'
  | 'user_provided'
  | 'inferred'

export type V3NeedOwner =
  | 'SELF_NEED'       // The org itself has the need
  | 'ORGANIZATION_NEED' // A specific org (not necessarily self) has the need
  | 'HIRING_NEED'     // Explicit hiring need
  | 'CUSTOMER_NEED'   // Their customers have the need
  | 'MARKET_PROBLEM'  // Industry/market-level
  | 'SERVICE_OFFERING' // They provide this service
  | 'PRODUCT_PROBLEM' // Their own product has issues
  | 'UNKNOWN'

export interface V3Evidence {
  id: string
  sourceRef: string              // reference to raw source location
  sourceType: V3EvidenceSourceType
  sourceUrl: string | null
  /** Verbatim or paraphrased quote */
  quote: string
  /** Who said/wrote this */
  subjectPersonId: string | null
  /** Which organization this evidence belongs to */
  subjectOrganizationId: string | null
  subjectOrganizationName: string | null
  /** When the evidence was produced */
  occurredAt: string | null
  /** When we captured it */
  capturedAt: string
  confidence: number             // 0-1
  evidenceType: V3EvidenceType
  needOwner: V3NeedOwner
  /** Links to the event this evidence supports */
  eventId: string | null
  /** Whether this evidence is still active (not negated/closed/expired) */
  polarity: 'ACTIVE' | 'NEGATED' | 'CLOSED' | 'FUTURE' | 'UNKNOWN'
  /** Temporal classification */
  temporalScope: 'CURRENT' | 'RECENT' | 'HISTORICAL' | 'FUTURE' | 'UNKNOWN'
}


export type V3EventType =
  | 'HIRING'
  | 'FREELANCE_REQUEST'
  | 'AGENCY_REQUEST'
  | 'PROJECT_REQUEST'
  | 'VENDOR_EVALUATION'
  | 'PRODUCT_LAUNCH'
  | 'FUNDING'
  | 'TECHNICAL_BUILD'
  | 'SERVICE_OFFERING'
  | 'JOB_SEEKING'
  | 'PARTNERSHIP'
  | 'CUSTOMER_PROBLEM'
  | 'MARKET_COMMENTARY'
  | 'OTHER'

export type V3Explicitness = 'EXPLICIT' | 'IMPLIED' | 'INFERRED'

export type V3TargetAudience = 'PUBLIC' | 'NETWORK' | 'DIRECT' | 'UNKNOWN'

export interface V3Event {
  id: string
  eventType: V3EventType
  /** Person who authored/initiated */
  personId: string | null
  /** Organization this event belongs to */
  organizationId: string | null
  organizationName: string | null
  occurredAt: string | null
  channel: string | null
  /** What capability is being requested/offerred */
  requestedCapability: string[]
  /** Who was this said to */
  targetAudience: V3TargetAudience
  /** How explicit is the signal */
  explicitness: V3Explicitness
  /** Direct apply instructions present (email, link, DM, etc.) */
  applyInstructions: string[]
  /** Evidence supporting this event */
  evidenceRefs: string[]
  polarity: 'ACTIVE' | 'NEGATED' | 'CLOSED' | 'FUTURE' | 'UNKNOWN'
}


export type V3EpisodeStatus = 'CURRENT' | 'AGING' | 'STALE' | 'CLOSED' | 'UNKNOWN'

export interface V3OpportunityEpisode {
  id: string
  /** The event that anchors this episode */
  anchorEvent: V3Event
  /** Organization where the opportunity exists */
  organizationId: string | null
  organizationName: string | null
  /** Person who owns the need */
  needOwnerPersonId: string | null
  needOwnerType: V3NeedOwner
  /** Is this an explicit request vs implied? */
  explicitRequest: boolean
  /** What capabilities are needed */
  requestedCapabilities: string[]
  /** How to apply/contact */
  applicationChannels: string[]
  /** All evidence supporting this episode */
  evidenceRefs: string[]
  /** All events supporting this episode */
  eventRefs: string[]
  status: V3EpisodeStatus
  /** When the episode was first detected */
  detectedAt: string
  /** Last activity timestamp */
  lastActivityAt: string | null
  /** Days since last activity */
  ageDays: number | null
}


export type V3Relationship =
  | 'BUYER'
  | 'SERVICE_PROVIDER'
  | 'COMPETITOR'
  | 'PARTNER'
  | 'CANDIDATE'
  | 'MIXED'
  | 'UNKNOWN'

export type V3FitLevel = 'POOR' | 'WEAK' | 'MEDIUM' | 'STRONG' | 'EXCELLENT'
export type V3TimingLevel = 'STALE' | 'WEAK' | 'CURRENT' | 'URGENT' | 'UNKNOWN'
export type V3AccessLevel = 'NONE' | 'INDIRECT' | 'CONNECTION' | 'DIRECT'

export interface V3BoundedDecision {
  relationship: V3Relationship
  /** Probability this is a buyer request (0-1) */
  buyerRequestProbability: number
  /** Probability this describes an external/commercial need (0-1) */
  externalNeedProbability: number
  /** Who owns the need */
  needOwnerType: V3NeedOwner
  /** Quality of fit for our capabilities */
  fit: V3FitLevel
  /** Timing urgency */
  timing: V3TimingLevel
  /** Access to the decision maker */
  access: V3AccessLevel
  /** Probability that a message is appropriate (0-1) */
  messageEligible: number
  /** Provider confidence in this decision (0-1) */
  providerConfidence: number
}


export type V3Action =
  | 'CONTACT_NOW'
  | 'CONNECT_WITH_NOTE'
  | 'CONNECT_WITHOUT_NOTE'
  | 'OBSERVE'
  | 'WAIT'
  | 'SKIP'
  | 'HUMAN_REVIEW'

export type V3Qualification =
  | 'STRONG'
  | 'WORTH_PURSUING'
  | 'MAYBE'
  | 'LOW'
  | 'SKIP'
  | 'INELIGIBLE'

/** 'model' rows sum to the model subtotal; 'signals' rows are the deterministic signal check blended into the total. */
export type V3DimensionGroup = 'model' | 'signals'

export interface V3DimensionEvidence {
  text: string
  /** quote = verbatim source line; signal = deterministic detection; inference = no source text behind it */
  kind: 'quote' | 'signal' | 'inference'
}

export interface V3ScoreCalculationStep {
  label: string
  value: string
  detail: string
}

export interface V3ScoreCalculation {
  modelSubtotal: number
  statusMultiplier: number
  relationshipMultiplier: number
  modelScore: number
  signalCheckTotal: number | null
  modelWeight: number
  floorApplied: number | null
  finalScore: number
  steps: V3ScoreCalculationStep[]
}

export interface V3EvidenceQuote {
  quote: string
  verbatim: boolean
  sourceType: string
  needOwner: string
}

export interface V3LeadDecisionPacket {
  /** Schema version */
  version: 'relay_decision_v3'
  /** Unique decision run ID */
  decisionRunId: string
  /** Which episode was selected for scoring */
  selectedEpisodeId: string | null
  /** All episodes found */
  episodes: V3OpportunityEpisode[]
  /** The bounded decision from the model */
  decision: V3BoundedDecision
  /** Calibrated opportunity score 0-100 */
  score: number
  /** Score version */
  scoreVersion: string
  /** Qualitative label */
  label: string
  /** Qualification */
  qualification: V3Qualification
  /** Recommended action */
  action: V3Action
  /** Whether a message should be sent */
  messageEligible: boolean
  /** Human-readable reasons */
  reasons: string[]
  /** Cautions */
  watchOut: string[]
  /** Per-dimension scoring breakdown */
  dimensions: Array<{ key: string; label: string; contribution: number; raw: number; weight: number; note: string; group?: V3DimensionGroup; evidence?: V3DimensionEvidence[] }>
  /** How the dimension contributions became the final score (PRO-006). */
  scoreCalculation?: V3ScoreCalculation | null
  /** Deterministic guards applied to the model's bounded answers, with the reason. */
  decisionAdjustments?: string[]
  /** Evidence behind the selected episode, marked verbatim when it appears in the source. */
  evidenceQuotes?: V3EvidenceQuote[]
  /** Evidence used */
  evidenceRefs: string[]
  /** Semantic proof strength 0-1 */
  proofStrength: number
  /** Overall confidence 0-1 */
  confidence: number
  /** Decision provider used */
  decisionProvider: string
  /** Model version */
  decisionModel: string
  /** Shadow comparison data (if running in shadow mode) */
  shadowComparison: V3ShadowComparison | null
  /** Latent commercial potential (when no active buyer episode) */
  latentPotential: 'LOW' | 'MEDIUM' | 'HIGH' | null
  /** Signals detected in latent assessment */
  latentSignals: string[]
}

export interface V3ShadowComparison {
  productionScore: number
  productionAction: string
  v3Score: number
  v3Action: V3Action
  scoreDelta: number
  actionChanged: boolean
  productionDecision: string | null
}


export interface V3ScoringWeights {
  buyerRequestProbability: number
  commercialPotential: number
  externalNeedProbability: number
  fit: number
  timing: number
  access: number
  proofRelevance: number
  evidenceQuality: number
}


export interface V3EpisodeScore {
  episodeId: string
  score: number
  label: string
  qualification: V3Qualification
  action: V3Action
  messageEligible: boolean
  reasons: string[]
}

export interface V3MultiEpisodeResult {
  episodes: V3EpisodeScore[]
  /** Best active episode score (lead display score) */
  bestActiveScore: number
  bestActiveEpisodeId: string | null
}



export type BuildIntensity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'


export type CommercialPotentialLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface CommercialPotentialAssessment {
  decisionAuthority: number        // 0-1: founder/CEO/CTO vs IC
  buildIntensity: BuildIntensity   // active product/company building
  technicalRelevance: number       // 0-1: stack overlap with our services
  capacityNeedLikelihood: number   // 0-1: likely to need external help
  reachability: number             // 0-1: how reachable
  companyMaturity: number          // 0-1: funding, growth, team
  commercialActivity: number       // 0-1: active commercial signals count
  overallPotential: CommercialPotentialLevel
  confidence: number               // 0-1
  signals: string[]                // human-readable signals
}

export const V3_SCORE_LABELS: Array<{
  min: number
  max: number
  label: string
  qualification: V3Qualification
}> = [
  { min: 75, max: 100, label: 'Strong opportunity', qualification: 'STRONG' },
  { min: 55, max: 74, label: 'Worth pursuing', qualification: 'WORTH_PURSUING' },
  { min: 35, max: 54, label: 'Maybe — needs more signal', qualification: 'MAYBE' },
  { min: 15, max: 34, label: 'Weak fit', qualification: 'LOW' },
  { min: 0, max: 14, label: 'Not a fit', qualification: 'SKIP' },
]

export function v3ScoreLabel(score: number): { label: string; qualification: V3Qualification } {
  for (const entry of V3_SCORE_LABELS) {
    if (score >= entry.min && score <= entry.max) {
      return { label: entry.label, qualification: entry.qualification }
    }
  }
  return { label: 'Not a fit', qualification: 'SKIP' }
}


export const EPISODE_STALENESS = {
  /** Days before an episode is considered aging */
  AGING_DAYS: 14,
  /** Days before an episode is considered stale */
  STALE_DAYS: 45,
  /** Days before an episode is considered closed (unless refreshed) */
  CLOSED_DAYS: 90,
} as const


export const MESSAGE_ELIGIBILITY = {
  /** Minimum score to send a message */
  MIN_SCORE: 40,
  /** Minimum buyer request probability */
  MIN_BUYER_PROBABILITY: 0.3,
  /** Minimum message_eligible from model */
  MIN_MODEL_ELIGIBLE: 0.4,
} as const
