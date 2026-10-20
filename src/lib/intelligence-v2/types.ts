/**
 * Canonical Prospect Intelligence — Type Definitions
 *
 * Single source of truth for the intelligence pipeline.
 * Once persisted, NO surface may independently recompute the lead score.
 */

import { QUALIFICATION_BANDS, qualifyCanonicalScore, toStoredQualification, displayScoreForCanonical } from '@/lib/scoring/qualification'


export type WorkplaceType = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN'

export type RemoteScope =
  | 'WORLDWIDE'
  | 'ANYWHERE'
  | 'COUNTRY_RESTRICTED'
  | 'REGION_RESTRICTED'
  | 'TIMEZONE_RESTRICTED'
  | 'UNKNOWN'

export type EligibilityStatus =
  | 'ELIGIBLE'
  | 'LIKELY_ELIGIBLE'
  | 'UNCLEAR'
  | 'INELIGIBLE'
  // NOT_APPLICABLE: there is no job / engagement being evaluated, so remote
  // eligibility is not a meaningful dimension. Used for non-buyer contacts
  // (recruiters, networking prospects) where employment eligibility is
  // irrelevant and geography does not determine service eligibility.
  | 'NOT_APPLICABLE'

export interface RemoteEligibility {
  workplaceType: WorkplaceType
  remoteScope: RemoteScope
  eligibility: EligibilityStatus
  /** Countries explicitly allowed/restricted, if stated */
  allowedCountries?: string[]
  restrictedCountries?: string[]
  /** Timezone requirements, if stated */
  timezoneRequirement?: string
  /** PKT overlap feasibility (0-100) for timezone-restricted roles */
  pktOverlapFeasibility?: number
  /** Human-readable explanation */
  reason: string
  /** Evidence supporting this assessment */
  evidence?: string[]
}


export type EvidenceType = 'FACT' | 'STRONG_INFERENCE' | 'WEAK_INFERENCE'

/**
 * Evidence ownership classification.
 * - PERSON_PREFERENCE: What a person wants (e.g., "Open to work in UK"). NOT a restriction on who they can hire.
 * - EMPLOYER_REQUIREMENT: Explicit employer restriction on worker location (e.g., "Must be US-based").
 * - JOB_REQUIREMENT: Job posting requirement for worker location/eligibility.
 * - COMPANY_ATTRIBUTE: Factual attribute of a company (e.g., "HQ in San Francisco").
 * - BUYER_INTENT: Signal that a company/person is looking to buy services.
 * - SELLER_INTENT: Signal that a person/company is selling services.
 * - HIRING_INTENT: Signal that a company is hiring (not necessarily for remote).
 * - CONTENT_OPINION: A person's opinion expressed in content.
 *
 * Only EMPLOYER_REQUIREMENT and JOB_REQUIREMENT can create worker-geography hard negatives.
 * PERSON_PREFERENCE (e.g., "Open to work in UK") must NEVER be treated as a hiring restriction.
 */
export type EvidenceOwnership =
  | 'PERSON_PREFERENCE'
  | 'EMPLOYER_REQUIREMENT'
  | 'JOB_REQUIREMENT'
  | 'COMPANY_ATTRIBUTE'
  | 'BUYER_INTENT'
  | 'SELLER_INTENT'
  | 'HIRING_INTENT'
  | 'CONTENT_OPINION'

export type EvidenceSubjectType = 'PERSON' | 'ORGANIZATION' | 'OPPORTUNITY' | 'ROLE' | 'UNKNOWN'

export type EvidenceRelationship =
  | 'CURRENT_EMPLOYER'
  | 'FOUNDED_COMPANY'
  | 'OPPORTUNITY_ORGANIZATION'
  | 'CLIENT'
  | 'ADVISORY'
  | 'HISTORICAL_EMPLOYER'
  | 'THIRD_PARTY'
  | 'UNKNOWN'

export type EvidenceTemporalScope = 'CURRENT' | 'RECENT' | 'FUTURE' | 'HISTORICAL' | 'UNKNOWN'

export type SignalPolarity = 'ACTIVE' | 'NEGATED' | 'CLOSED' | 'FUTURE' | 'UNKNOWN'

/**
 * Need ownership classification — WHO owns the problem/need described.
 * A statement about a market problem must not automatically become
 * "this prospect needs our services".
 *
 * - SELF_NEED: The prospect's own company has the need (e.g., "We're hiring engineers")
 * - CUSTOMER_NEED: The prospect's customers have the need (e.g., "Our clients struggle with X")
 * - MARKET_PROBLEM: An industry/market-level problem (e.g., "Currency exchange is difficult in emerging markets")
 * - SERVICE_OFFERING: The prospect offers services to solve this (e.g., "I help companies modernize")
 * - PRODUCT_PROBLEM: A problem with the prospect's own product (e.g., "Our deployment pipeline is slow")
 * - EMPLOYER_NEED: The prospect's employer (if they're an employee) has the need
 * - UNKNOWN: Need ownership cannot be determined
 *
 * Only SELF_NEED or EMPLOYER_NEED should materially increase buyer intent.
 * SERVICE_OFFERING describes what they SELL, not what they BUY.
 * CUSTOMER_NEED describes their customers' problems, not theirs.
 */
export type NeedOwnership =
  | 'SELF_NEED'
  | 'CUSTOMER_NEED'
  | 'MARKET_PROBLEM'
  | 'SERVICE_OFFERING'
  | 'PRODUCT_PROBLEM'
  | 'EMPLOYER_NEED'
  | 'UNKNOWN'

export interface EvidenceEntry {
  signal: string
  source: 'linkedin_profile' | 'linkedin_post' | 'job_posting' | 'company_website' | 'pasted_text' | 'user_provided' | 'inferred'
  sourceUrl?: string
  evidenceType: EvidenceType
  /** Who owns this evidence — determines how it affects scoring */
  ownership: EvidenceOwnership
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  safeForOutreach: boolean
  verbatimQuote?: string
  /** What entity this evidence refers to */
  subjectType?: EvidenceSubjectType
  /** Stable ID of the subject where available */
  subjectId?: string
  /** Organization this evidence is attached to (may differ from prospect's company) */
  organizationId?: string
  /** Human-readable organization name for the subject */
  organizationName?: string
  /** Relationship between the referenced entity and the prospect */
  relationshipToProspect?: EvidenceRelationship
  /** When this evidence is valid */
  temporalScope?: EvidenceTemporalScope
  /** Whether the signal is active, negated, closed, or future */
  polarity?: SignalPolarity
  /** Who owns the need/problem described by this evidence */
  needOwnership?: NeedOwnership
}


export interface PersonAffiliation {
  organizationName: string
  role?: string
  relationship: EvidenceRelationship
  temporalScope: EvidenceTemporalScope
  isCurrent: boolean
}

export interface ExtractedPerson {
  fullName: string | null
  firstName: string | null
  title: string | null
  seniority: string | null
  location: string | null
  linkedinUrl: string | null
  otherUrls: string[]
  /** All known affiliations — current employer, founded companies, advisory roles */
  affiliations?: PersonAffiliation[]
}

export interface ExtractedCompany {
  name: string | null
  domain: string | null
  linkedinUrl: string | null
  industry: string | null
  size: string | null
  sizeEvidence: string | null
  product: string | null
  stage: string | null
  stageEvidence: string | null
}

export type OpportunitySignal =
  | 'hiring'
  | 'freelance_project_need'
  | 'technical_problem'
  | 'growth_signal'
  | 'funding'
  | 'launch'
  | 'migration'
  | 'rebuild'
  | 'hiring_pressure'
  | 'explicit_ask'

export interface ExtractedOpportunity {
  signals: OpportunitySignal[]
  primarySignal: OpportunitySignal | null
  description: string | null
  urgency: 'immediate' | 'near_term' | 'future' | 'unknown'
  /** Organization where the opportunity exists — may differ from prospect's current company */
  organizationName?: string
  organizationId?: string
  /** Relationship between the opportunity organization and the prospect */
  organizationRelationship?: EvidenceRelationship
  /** Whether the opportunity is current, historical, or future */
  temporalScope?: EvidenceTemporalScope
  /** Polarity of the primary signal — active, negated, closed, or future */
  polarity?: SignalPolarity
}

export interface ExtractedJob {
  title: string | null
  employmentType: 'full_time' | 'part_time' | 'contract' | 'freelance' | 'unknown'
  workplaceType: WorkplaceType
  allowedGeography: string | null
  timezone: string | null
  compensation: string | null
  skills: string[]
  seniority: string | null
  source: string | null
  postedDate: string | null
}

export interface ExtractedContent {
  recentPosts: Array<{
    paraphrase: string
    verbatimQuote: string | null
    topics: string[]
    signals: OpportunitySignal[]
  }>
  topics: string[]
  explicitProblems: string[]
  initiatives: string[]
  launches: string[]
  technicalSignals: string[]
  hiringSignals: string[]
}


export type BusinessModel =
  | 'PRODUCT'
  | 'RECRUITER'
  /**
   * A consulting/engineering-services business: the prospect's own company
   * SELLS technical delivery, diagnostics, or "partnership" engagements to
   * ITS clients (e.g. "we drop in the right engineering pod to unblock
   * them", "architecture diagnostics", "IT consulting"). Their
   * architecture/technical-debt/engineering language describes what they
   * offer CUSTOMERS, not a problem their own company has. Distinct from
   * RECRUITER (places candidates) and PRODUCT (builds a platform/app) —
   * this is a services/delivery business, and BPulse relevance runs through
   * a PARTNERSHIP question (could we be a delivery partner/subcontractor?),
   * never through inferring they need to buy software development.
   */
  | 'SERVICE_PROVIDER'
  | 'UNKNOWN'

/**
 * Canonical commercial relationship classification. Determined BEFORE
 * scoring so that the score knows what kind of prospect this is. A
 * recruiter's "hiring" content is about their service, not about buying
 * software — classifying first prevents the market-commentary → buyer-signal
 * inversion.
 */
export type CommercialRelationship =
  | 'POTENTIAL_BUYER'
  | 'RECRUITER'
  | 'POTENTIAL_PARTNER'
  | 'NETWORKING'
  | 'PEER'
  | 'UNKNOWN'

export interface NormalizedIntelligence {
  person: ExtractedPerson
  company: ExtractedCompany
  opportunity: ExtractedOpportunity
  job: ExtractedJob | null
  content: ExtractedContent
  remoteEligibility: RemoteEligibility
  /** Why could this person/company realistically hire us? */
  probableNeed: string | null
  opportunityTrigger: string | null
  timingSignal: string | null
  /** Risks identified */
  risks: string[]
  /** Unknowns / missing information */
  unknowns: string[]
  /** Contradictions found and resolved */
  resolvedContradictions: string[]
  /**
   * What business model the prospect operates. RECRUITER means their
   * hiring/talent content describes their service, not a buying need.
   */
  businessModel: BusinessModel
  /**
   * Canonical commercial relationship. RECRUITER/PARTNER/NETWORKING/PEER are
   * non-buyer relationships; the opportunity score must reflect that.
   */
  relationship: CommercialRelationship
  /** Buyer intent kept separate from product momentum. Strategy and score must read this, not a generic intent alias. */
  commercialReading?: import('./commercial-reading').CommercialReading
  /** Classified need ownership per evidence entry — who owns the problems/needs described */
  needOwnershipSummary?: {
    /** The dominant need ownership classification for this prospect */
    dominant: NeedOwnership
    /** Count of evidence entries per ownership type */
    counts: Record<NeedOwnership, number>
  }
}


export interface ScoreDimensionBreakdown {
  key: string
  label: string
  points: number
  max: number
  note: string
  /** Whether this is a positive or negative contributor */
  direction: 'positive' | 'negative' | 'neutral'
}

export interface CanonicalScoreBreakdown {
  dimensions: ScoreDimensionBreakdown[]
  /** Hard negatives that overrode the score */
  hardNegatives: string[]
  /** Missing information that reduced confidence */
  missingInfo: string[]
  /** Final computed score 0-100 */
  total: number
  /** Qualitative label */
  label: string
  /** 3-5 decisive reasons */
  reasons: string[]
  /** Things to watch out for */
  watchOut: string[]
}


export interface RawSourceData {
  rawInput: string
  sourceType: 'linkedin_profile' | 'linkedin_post' | 'job_posting' | 'company_website' | 'pasted_text' | 'mixed'
  sourceUrl: string | null
  profileUrl: string | null
  companyUrl: string | null
  jobUrl: string | null
  postUrls: string[]
  rawPosts: string[]
  rawJobDescription: string | null
  rawProfileText: string | null
  rawCompanyText: string | null
  capturedAt: string
}


export interface ExtractionCompleteness {
  /** Overall completeness 0-100 */
  score: number
  /** Fields that were successfully extracted */
  presentFields: string[]
  /** Fields that are missing */
  missingFields: string[]
  /** Fields with low confidence */
  weakFields: Array<{ field: string; reason: string }>
  /** Whether auto-repair was attempted */
  repairAttempted: boolean
  /** Whether repair improved the extraction */
  repairImproved: boolean
  /** URLs found in source */
  sourceUrlsFound: string[]
  /** URLs preserved after normalization */
  urlsPreserved: string[]
}


export interface RescoreEvent {
  fromScore: number
  toScore: number
  reason: string
  version: string
  timestamp: string
  trigger: 'source_changed' | 'user_requested' | 'model_version_changed' | 'new_signal'
}


export interface CanonicalProspectIntelligence {
  /** Schema version */
  version: 'relay_qualification_v2'
  /** Unique ID for this intelligence run — links score/strategy/message to the same source */
  intelligenceRunId: string
  /**
   * Deterministic hash of the normalized source text + pipeline/score
   * versions (see src/lib/intelligence-v2/input-hash.ts). Same hash + same
   * versions => this result may be reused instead of re-running extraction.
   */
  intelligenceInputHash: string
  /** Bundled extraction/normalization/prompt version this run used */
  intelligenceVersion: string
  /** When this intelligence was produced */
  computedAt: string
  /** The canonical score 0-100 */
  canonicalScore: number
  /** Score version/model used */
  scoreVersion: string
  /** When the score was last computed */
  scoredAt: string
  /** Transparent score breakdown */
  scoreBreakdown: CanonicalScoreBreakdown
  /** Extraction confidence 0-100 */
  confidence: number
  /** Qualification verdict */
  qualification: 'strong' | 'worth_pursuing' | 'maybe' | 'low' | 'skip'
  /** Normalized intelligence */
  intelligence: NormalizedIntelligence
  /** Raw source data — never destroyed */
  rawSource: RawSourceData
  /** Source/evidence ledger */
  evidenceLedger: EvidenceEntry[]
  /** Remote eligibility assessment */
  remoteEligibility: RemoteEligibility
  /** Extraction completeness assessment */
  extractionCompleteness: ExtractionCompleteness
  /** Re-score history */
  rescoreEvents: RescoreEvent[]
  /** Best Revenue Identity to approach (if known) */
  recommendedIdentityId: string | null
  /** Best proof to use (if known) */
  recommendedProofIds: string[]
  /** Best personalization angle */
  personalizationAngle: string | null
  /** Outreach context for message generation */
  outreachContext: {
    whyNow: string | null
    probableNeed: string | null
    bestProof: string | null
    personalizationAnchor: string | null
    messageGoal: string | null
    cta: string | null
    thingsNotToClaim: string[]
  } | null
  /** Provider/model/task/latency/fallback log */
  extractionCallLog: Array<{
    provider: string
    model: string
    task: string
    latencyMs: number
    fallback: boolean
  }>
  /** Timing trace for latency debugging */
  extractionTrace?: Array<{ stage: string; ms: number; provider?: string }>
}


/** Qualification bands live in one place: @/lib/scoring/qualification. */
export const SCORE_LABELS: Array<{ min: number; max: number; label: string; qualification: CanonicalProspectIntelligence['qualification'] }> =
  QUALIFICATION_BANDS.map((b) => ({ min: b.min, max: b.max, label: b.label, qualification: toStoredQualification(b.qualification) }))

/**
 * WriterInput — the ONLY data the message writer may receive.
 * Built exclusively from canonical Strategy. Raw scraped text is NOT included.
 */
export type Channel = 'dm' | 'connection' | 'upwork' | 'email' | 'followup' | 'reply'
export type RelationshipState = 'no_relationship' | 'first_touch' | 'followup' | 'reply' | 'warming'

export interface WriterEvidence {
  text: string
  source: string
  ownership: EvidenceOwnership
  temporalScope?: EvidenceTemporalScope
  organizationName?: string
}

export interface WriterProof {
  summary: string
  reviewQuote?: string
  clientName?: string
}

export interface WriterInput {
  channel: Channel
  messageJob: string
  relationshipState: RelationshipState
  allowedEvidence: WriterEvidence[]
  relevantProof: WriterProof[]
  primaryUncertainty?: string
  thingsNotToClaim: string[]
  knowledgeRelease: {
    safeNow: string[]
    hold: string[]
    neverClaim: string[]
  }
  prospectName?: string
  prospectCompany?: string
  opportunityOrganization?: string
  wordBudget: { min: number; max: number; label: string }
  successCondition: string
  tone: string
  ctaStrategy: string
  intelligenceRunId?: string
}

export function scoreLabel(score: number): { label: string; qualification: CanonicalProspectIntelligence['qualification'] } {
  const band = qualifyCanonicalScore(score)
  return { label: band.label, qualification: toStoredQualification(band.qualification) }
}

/** Convert canonical 0-100 score to display /10 — the one display policy. */
export function canonicalToDisplay(score: number): number {
  return displayScoreForCanonical(score)
}
