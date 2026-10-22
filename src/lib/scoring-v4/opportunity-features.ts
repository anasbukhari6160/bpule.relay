/**
 * OpportunityFeatures — the one canonical representation of an opportunity
 * (Phase 6 of the 360° scoring program).
 *
 * Built once from verified SourceFacts + the canonical buyer decision + the
 * bounded model answers. Shared by every candidate scorer, the sender
 * ranker, the action policy, the QA center and the dataset export. Nothing
 * downstream re-parses raw text once this object exists.
 *
 * Two design rules from the program:
 *   1. OPPORTUNITY is separate from INTENT. `accountValue` describes how
 *      valuable the relationship would be if a need emerged; `intent`
 *      describes whether a verified need exists today.
 *   2. Fit is semantic (capability families), not token overlap.
 *
 * Everything here is deterministic. The numeric projection
 * (`featureVector`) is the input to the trained candidate scorers.
 */

import type { SourceFactsSummary } from '@/lib/intelligence-v3/source-facts-model'
import type { VerifiedBuyerIntent, RelationshipRole, BuyerIntentLevel } from '@/lib/intelligence-v3/buyer-intent'
import type { V3BoundedDecision, V3LeadDecisionPacket, CommercialPotentialLevel, BuildIntensity } from '@/lib/intelligence-v3/types'
import { isSoftwareServicesSeller } from '@/lib/intelligence-v3/dimensions'
import {
  capabilityOverlap,
  mapToCapabilities,
  DEFAULT_ORG_CAPABILITY_FAMILIES,
  type CapabilityFamily,
  type CapabilityMatch,
} from './capability-taxonomy'

export const OPPORTUNITY_FEATURES_VERSION = 'opportunity_features_v1'

export type Platform = 'linkedin' | 'upwork'
export type CompanyMaturity = 'UNKNOWN' | 'PRE_PRODUCT' | 'EARLY' | 'GROWING' | 'ESTABLISHED' | 'ENTERPRISE'
export type TechnicalComplexity = 'NONE' | 'LOW' | 'MODERATE' | 'HIGH'
export type FitLevel6 = 'NONE' | 'WEAK' | 'ADJACENT' | 'GOOD' | 'STRONG' | 'EXCEPTIONAL'
export type AccessLevel = 'DIRECT' | 'CONNECTION' | 'INDIRECT' | 'NONE'
export type BuyerTiming = 'NONE' | 'WEAK' | 'CURRENT' | 'URGENT'
export type ActivityRecency = 'FRESH' | 'RECENT' | 'AGING' | 'STALE' | 'UNKNOWN'
export type AuthorityLevel = 'FOUNDER' | 'EXECUTIVE' | 'VP_HEAD' | 'DIRECTOR' | 'MANAGER' | 'SENIOR_IC' | 'IC' | 'RECRUITER' | 'UNKNOWN'

export interface OpportunityFeatures {
  version: typeof OPPORTUNITY_FEATURES_VERSION
  platform: Platform
  language: string

  /** Who they are in relation to us. */
  relationshipRole: RelationshipRole
  /** Verified current buying intent — the single buyer-intent authority projected. */
  intent: {
    level: BuyerIntentLevel
    verifiedRequest: boolean
    verifiedBudget: boolean
    verifiedExternalNeed: boolean
    askingForHelp: boolean
    requestAgeDays: number | null
    contradictions: number
    /** The model's unclamped buyer-request probability, kept as a weak feature. */
    modelBuyerProbability: number | null
  }
  externalNeed: boolean

  /** "How valuable would this relationship be if a legitimate need emerged?" */
  accountValue: {
    companyMaturity: CompanyMaturity
    buildIntensity: BuildIntensity
    technicalComplexity: TechnicalComplexity
    /** Verified funding or revenue signal in the current organisation. */
    fundingSignal: boolean
    /** Current employee hiring at the prospect's own organisation. */
    hiringCurrent: boolean
    hiringUrgent: boolean
    hiringCount: number
    currentProductActivity: boolean
    growthSignals: number
    companySize: 'startup' | 'small' | 'mid' | 'enterprise' | 'unknown'
    /** Would they plausibly buy outside delivery? Low for software-services sellers. */
    outsourcingPlausibility: number
    /** The v3 commercial-potential reading, for comparison. */
    v3Level: CommercialPotentialLevel
    v3Raw: number
  }

  /** Semantic fit. */
  fit: {
    /** Families the source explicitly asks for. */
    needs: CapabilityFamily[]
    /** Families present in their current stack / product context. */
    stack: CapabilityFamily[]
    orgMatched: CapabilityFamily[]
    orgMissing: CapabilityFamily[]
    /** 0-1 coverage of explicit needs by the org (0 when nothing is needed). */
    orgNeedCoverage: number
    /** 0-1 coverage of their stack by the org. */
    orgStackCoverage: number
    level: FitLevel6
    /** The model's fit answer, kept as a weak feature. */
    modelFit: V3BoundedDecision['fit'] | null
    matches: CapabilityMatch[]
  }

  currentIndustry: string | null
  authority: { level: AuthorityLevel; decisionAuthority: number; technicalAuthority: number }
  buyerTiming: BuyerTiming
  activityRecency: ActivityRecency
  recentPostAgeDays: number | null
  access: { level: AccessLevel; raw: number; connectionDegree: string; mutualConnections: number }

  /** Proof availability is filled by the sender/proof layer; null until then. */
  proofAvailability: 'NONE' | 'ORG' | 'VERIFIED' | null

  sourceCompleteness: number
  evidenceQuality: number
  contradictions: number
  supply: {
    sellerActivity: boolean
    softwareServicesSeller: boolean
    recruiterProfile: boolean
    candidateSeeking: boolean
  }
  founderOrBuilder: boolean
  episodeClosed: boolean
  fallbackUsed: boolean
}

// ── Builders ────────────────────────────────────────────────────────────────

const ACCESS_RAW: Record<AccessLevel, number> = { DIRECT: 1, CONNECTION: 0.7, INDIRECT: 0.35, NONE: 0.1 }
/** Funding events that belong to someone else's organisation. */
const THIRD_PARTY_FUNDING = /\b(?:portfolio\s+compan(?:y|ies)|our\s+(?:customers?|clients?)|one\s+of\s+(?:our|my)\s+(?:customers?|clients?)|(?:we|i)\s+(?:invested|led|backed)|congrats|congratulations|proud\s+investor|via\s+@|repost)/i

function companyMaturityFrom(facts: SourceFactsSummary): CompanyMaturity {
  const size = facts.companySizeCategory
  if (size === 'enterprise') return 'ENTERPRISE'
  if (size === 'mid') return 'ESTABLISHED'
  const growth = facts.signals.company.growthSignals.length
  if (facts.fundingEvidence || (facts.currentHiringActivity && growth > 0)) return 'GROWING'
  if (facts.currentProductActivity || facts.currentHiringActivity || size === 'small') return 'EARLY'
  if (facts.founderOrBuilder) return 'PRE_PRODUCT'
  return 'UNKNOWN'
}

function technicalComplexityFrom(facts: SourceFactsSummary, stack: CapabilityFamily[]): TechnicalComplexity {
  const tc = facts.technologyContext
  const breadth = stack.length
  if (tc.stackComplexity === 'complex' || breadth >= 4) return 'HIGH'
  if (tc.stackComplexity === 'moderate' || breadth >= 2) return 'MODERATE'
  if (breadth === 1 || tc.hasWeb || tc.hasAI || tc.hasCloud || tc.hasMobile) return 'LOW'
  return 'NONE'
}

function buildIntensityFrom(facts: SourceFactsSummary): BuildIntensity {
  let score = 0
  if (facts.currentProductActivity) score += 3
  if (facts.fundingEvidence) score += 2
  if (facts.currentHiringActivity) score += 1
  if (facts.technologyContext.stackComplexity === 'complex') score += 2
  else if (facts.technologyContext.stackComplexity === 'moderate') score += 1
  if (facts.signals.intent.launching) score += 1
  if (facts.signals.company.growthSignals.length > 0) score += 1
  if (facts.currentOrganizations.length >= 2) score += 1
  if (score >= 7) return 'VERY_HIGH'
  if (score >= 4) return 'HIGH'
  if (score >= 2) return 'MEDIUM'
  if (score >= 1) return 'LOW'
  return 'NONE'
}

/**
 * Six-level semantic fit. Explicit needs we cover dominate; a stack we work
 * in is adjacent evidence; nothing named is NONE. Supply-side roles without
 * a verified buy cannot exceed WEAK — stack overlap with a competitor is not
 * a reason they would buy from us.
 */
export function resolveFitLevel(params: {
  needs: CapabilityFamily[]
  stack: CapabilityFamily[]
  orgNeedCoverage: number
  orgStackCoverage: number
  currentProductActivity: boolean
  supplySideWithoutBuy: boolean
  modelFit: V3BoundedDecision['fit'] | null
}): FitLevel6 {
  const { needs, stack, orgNeedCoverage, orgStackCoverage, currentProductActivity, supplySideWithoutBuy, modelFit } = params
  let level: FitLevel6
  if (needs.length > 0) {
    if (orgNeedCoverage >= 0.99 && needs.length >= 2) level = 'EXCEPTIONAL'
    else if (orgNeedCoverage >= 0.99) level = 'STRONG'
    else if (orgNeedCoverage >= 0.5) level = 'GOOD'
    else if (orgNeedCoverage > 0) level = 'ADJACENT'
    else level = 'WEAK'
  } else if (stack.length > 0) {
    if (orgStackCoverage >= 0.75 && stack.length >= 3) level = 'STRONG'
    else if (orgStackCoverage >= 0.5) level = 'GOOD'
    else if (orgStackCoverage > 0) level = 'ADJACENT'
    else level = 'WEAK'
  } else if (currentProductActivity) {
    level = 'ADJACENT'
  } else {
    level = 'NONE'
  }
  // The model can lift one step only when the source names something to fit;
  // it can never lift NONE.
  if (level !== 'NONE' && (modelFit === 'EXCELLENT' || modelFit === 'STRONG') && (needs.length > 0 || stack.length > 0)) {
    const order: FitLevel6[] = ['NONE', 'WEAK', 'ADJACENT', 'GOOD', 'STRONG', 'EXCEPTIONAL']
    const i = order.indexOf(level)
    if (i < order.indexOf('STRONG')) level = order[i + 1]
  }
  if (supplySideWithoutBuy && (level === 'GOOD' || level === 'STRONG' || level === 'EXCEPTIONAL' || level === 'ADJACENT')) level = 'WEAK'
  return level
}

export interface BuildFeaturesInput {
  /** The canonical facts, read once and stored. Complete; no raw text is read here. */
  facts: SourceFactsSummary
  intent: VerifiedBuyerIntent
  decision: V3BoundedDecision | null
  platform?: Platform
  orgCapabilityFamilies?: readonly CapabilityFamily[]
  resolved?: V3LeadDecisionPacket['resolved'] | null
  episodeClosed?: boolean
  fallbackUsed?: boolean
}

export function buildOpportunityFeatures(input: BuildFeaturesInput): OpportunityFeatures {
  const platform = input.platform ?? 'linkedin'
  const summary = input.facts
  const intent = input.intent
  const decision = input.decision
  const orgFamilies = input.orgCapabilityFamilies ?? DEFAULT_ORG_CAPABILITY_FAMILIES

  // ── Capability families ──────────────────────────────────────────────
  const needTerms = summary.capabilityNeeds ?? []
  const requestContext = [summary.buyerRequest ?? '', summary.helpRequest ?? ''].join('\n')
  const needMatches = mapToCapabilities(needTerms, requestContext)
  const stackTerms = [...summary.technologyContext.languages, ...summary.technologyContext.frameworks, ...summary.technologyContext.platforms, ...summary.technologyContext.domains, ...summary.proofCandidates]
  const stackMatches = mapToCapabilities(stackTerms, [summary.currentIndustryLine ?? '', summary.person.title ?? ''].join('\n'))
  const needs = needMatches.map((m) => m.family)
  const stack = stackMatches.map((m) => m.family).filter((f) => !needs.includes(f))
  const needOverlap = capabilityOverlap(needs, orgFamilies)
  const stackOverlap = capabilityOverlap(stack, orgFamilies)

  const softwareServicesSeller = isSoftwareServicesSeller(summary)
  const supplySide = intent.relationshipRole === 'SELLER' || intent.relationshipRole === 'RECRUITER' || intent.relationshipRole === 'CANDIDATE'
  const supplySideWithoutBuy = supplySide && !intent.verifiedBuyerRequest
    && (intent.relationshipRole !== 'SELLER' || softwareServicesSeller)
  const fitLevel = resolveFitLevel({
    needs, stack,
    orgNeedCoverage: needOverlap.coverage, orgStackCoverage: stackOverlap.coverage,
    currentProductActivity: summary.currentProductActivity,
    supplySideWithoutBuy,
    modelFit: decision?.fit ?? null,
  })

  // ── Account value ────────────────────────────────────────────────────
  const buildIntensity = buildIntensityFrom(summary)
  const companyMaturity = companyMaturityFrom(summary)
  const technicalComplexity = technicalComplexityFrom(summary, [...needs, ...stack])
  let outsourcing = 0.3
  {
    const size = summary.companySizeCategory
    outsourcing = size === 'startup' ? 0.7 : size === 'small' ? 0.6 : size === 'mid' ? 0.5 : size === 'enterprise' ? 0.4 : 0.35
    if (summary.currentHiringActivity) outsourcing = Math.min(1, outsourcing + 0.15)
    if (summary.currentProductActivity && !summary.sellerActivity) outsourcing = Math.min(1, outsourcing + 0.15)
    if (summary.founderOrBuilder && summary.currentProductActivity && !summary.sellerActivity) outsourcing = Math.min(1, outsourcing + 0.1)
    if (softwareServicesSeller && !intent.verifiedBuyerRequest) outsourcing = Math.min(outsourcing, 0.15)
    if (intent.relationshipRole === 'CANDIDATE') outsourcing = 0.05
    if (intent.relationshipRole === 'RECRUITER' && !intent.verifiedBuyerRequest) outsourcing = Math.min(outsourcing, 0.15)
  }

  // ── Access ───────────────────────────────────────────────────────────
  const a = summary.access
  let accessLevel: AccessLevel
  if (input.resolved?.access) accessLevel = input.resolved.access
  else if (a.connectionDegree === '1st' || (a.directContactAvailable && a.contactLine) || a.hasEmail) accessLevel = 'DIRECT'
  else if (a.canMessage || a.connectionDegree === '2nd' || a.profileUrl) accessLevel = 'CONNECTION'
  else if (a.connectionDegree === '3rd') accessLevel = 'INDIRECT'
  else accessLevel = decision?.access === 'DIRECT' ? 'CONNECTION' : (decision?.access as AccessLevel | undefined) ?? 'INDIRECT'
  let accessRaw = ACCESS_RAW[accessLevel]
  if (!intent.verifiedBuyerRequest && (intent.relationshipRole === 'RECRUITER' || intent.relationshipRole === 'CANDIDATE')) accessRaw = Math.min(accessRaw, 0.35)

  // ── Timing ───────────────────────────────────────────────────────────
  const activityRecency: ActivityRecency = input.resolved?.activityRecency ?? summary.activityRecency
  let buyerTiming: BuyerTiming = input.resolved?.buyerTiming ?? 'NONE'
  if (!input.resolved) {
    const requestAge = summary.buyerRequestAgeDays
    const timeline = summary.timelineEvidence
    const expired = timeline !== null && requestAge !== null && requestAge > 60
    if (intent.verifiedBuyerRequest && timeline && !expired && timeline.days <= 30) buyerTiming = 'URGENT'
    else if (intent.verifiedBuyerRequest && timeline && !expired && timeline.days <= 90) buyerTiming = 'CURRENT'
    else if (intent.verifiedBuyerRequest && (activityRecency === 'FRESH' || activityRecency === 'RECENT')) buyerTiming = 'CURRENT'
    else if (intent.verifiedBuyerRequest) buyerTiming = activityRecency === 'STALE' || (requestAge !== null && requestAge > 90) ? 'WEAK' : 'CURRENT'
    else if (intent.verifiedHiringNeed) buyerTiming = 'WEAK'
  }

  // ── Evidence quality ─────────────────────────────────────────────────
  const completeness = summary.sourceCompleteness.score / 100
  const positiveFacts = [summary.buyerRequest, summary.currentHiringActivity, summary.budgetEvidence?.line, summary.timelineEvidence?.line, summary.fundingEvidence, summary.currentIndustryLine].filter(Boolean).length
  const corroboration = Math.min(1, positiveFacts / 3)
  const freshness = activityRecency === 'FRESH' ? 1 : activityRecency === 'RECENT' ? 0.8 : activityRecency === 'AGING' ? 0.5 : activityRecency === 'STALE' ? 0.25 : 0.4
  const consistency = intent.contradictions.length === 0 ? 1 : Math.max(0.2, 1 - 0.3 * intent.contradictions.length)
  const evidenceQuality = input.resolved?.evidenceQuality ?? Math.round((completeness * 0.35 + corroboration * 0.3 + freshness * 0.2 + consistency * 0.15) * 100) / 100

  const v3Level = input.resolved?.commercialPotential ?? 'LOW'
  const v3Raw = input.resolved?.commercialPotentialRaw ?? 0

  // Funding must belong to the prospect's own organisation. A raise by a
  // portfolio company, a customer or a client is someone else's event.
  const fundingLine = summary.fundingEvidence ?? null
  const fundingSignal = Boolean(fundingLine) && !THIRD_PARTY_FUNDING.test(fundingLine ?? '')

  return {
    version: OPPORTUNITY_FEATURES_VERSION,
    platform,
    language: summary.sourceLanguage,
    relationshipRole: intent.relationshipRole,
    intent: {
      level: intent.buyerIntentLevel,
      verifiedRequest: intent.verifiedBuyerRequest,
      verifiedBudget: intent.verifiedBudget,
      verifiedExternalNeed: intent.verifiedExternalNeed,
      askingForHelp: intent.askingForHelp,
      requestAgeDays: summary.buyerRequestAgeDays,
      contradictions: intent.contradictions.length,
      modelBuyerProbability: intent.claims.modelBuyerProbability ?? null,
    },
    externalNeed: intent.verifiedExternalNeed || Boolean(summary.externalNeed),
    accountValue: {
      companyMaturity,
      buildIntensity,
      technicalComplexity,
      fundingSignal,
      hiringCurrent: Boolean(summary.currentHiringActivity),
      hiringUrgent: Boolean(summary.hiringUrgent),
      hiringCount: summary.hiringCount,
      currentProductActivity: summary.currentProductActivity,
      growthSignals: summary.signals.company.growthSignals.length,
      companySize: summary.companySizeCategory,
      outsourcingPlausibility: Math.round(outsourcing * 100) / 100,
      v3Level,
      v3Raw,
    },
    fit: {
      needs,
      stack,
      orgMatched: [...needOverlap.matched, ...stackOverlap.matched],
      orgMissing: [...needOverlap.missing, ...stackOverlap.missing],
      orgNeedCoverage: Math.round(needOverlap.coverage * 100) / 100,
      orgStackCoverage: Math.round(stackOverlap.coverage * 100) / 100,
      level: fitLevel,
      modelFit: decision?.fit ?? null,
      matches: [...needMatches, ...stackMatches],
    },
    currentIndustry: summary.currentIndustry,
    authority: {
      level: summary.authorityEvidence.level,
      decisionAuthority: summary.authorityEvidence.decisionAuthority,
      technicalAuthority: summary.authorityEvidence.technicalAuthority,
    },
    buyerTiming,
    activityRecency,
    recentPostAgeDays: summary.recentPostAgeDays,
    access: { level: accessLevel, raw: accessRaw, connectionDegree: a.connectionDegree, mutualConnections: a.mutualConnections },
    proofAvailability: null,
    sourceCompleteness: summary.sourceCompleteness.score,
    evidenceQuality,
    contradictions: intent.contradictions.length,
    supply: {
      sellerActivity: summary.sellerActivity,
      softwareServicesSeller,
      recruiterProfile: summary.recruiterProfile,
      candidateSeeking: summary.candidateSeeking,
    },
    founderOrBuilder: Boolean(summary.founderOrBuilder),
    episodeClosed: input.episodeClosed ?? false,
    fallbackUsed: input.fallbackUsed ?? false,
  }
}

/** Build features from a stored decision packet. The packet carries the complete facts. */
export function featuresFromPacket(packet: V3LeadDecisionPacket, opts: { platform?: Platform; orgCapabilityFamilies?: readonly CapabilityFamily[] } = {}): OpportunityFeatures | null {
  if (!packet.sourceFacts || !packet.buyerIntent) return null
  // Stored packets predate the SourceFactsSummary shape: their sourceFacts has
  // no technologyContext/signals/person/authorityEvidence. Those rows still
  // render in the QA surfaces — they simply get no candidate comparison.
  const sf = packet.sourceFacts
  if (!sf.technologyContext || !sf.signals || !sf.person || !sf.authorityEvidence || !sf.currentOrganizations) return null
  const selected = packet.episodes.find((e) => e.id === packet.selectedEpisodeId) ?? null
  return buildOpportunityFeatures({
    facts: packet.sourceFacts,
    intent: packet.buyerIntent,
    decision: packet.decision,
    platform: opts.platform,
    orgCapabilityFamilies: opts.orgCapabilityFamilies,
    resolved: packet.resolved ?? null,
    episodeClosed: selected?.status === 'CLOSED',
    fallbackUsed: Boolean(packet.fallbackUsed),
  })
}

// ── Numeric projection ──────────────────────────────────────────────────────

const ROLE_ORDER: RelationshipRole[] = ['CANDIDATE', 'RECRUITER', 'SELLER', 'UNKNOWN', 'BUILDER', 'BUYER_AND_SELLER', 'BUYER']
const INTENT_RAW: Record<BuyerIntentLevel, number> = { HIGH: 1, MEDIUM: 0.65, LOW: 0.3, UNKNOWN: 0 }
const MATURITY_RAW: Record<CompanyMaturity, number> = { UNKNOWN: 0, PRE_PRODUCT: 0.2, EARLY: 0.45, GROWING: 0.7, ESTABLISHED: 0.85, ENTERPRISE: 1 }
const BUILD_RAW: Record<BuildIntensity, number> = { NONE: 0, LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8, VERY_HIGH: 1 }
const COMPLEXITY_RAW: Record<TechnicalComplexity, number> = { NONE: 0, LOW: 0.33, MODERATE: 0.66, HIGH: 1 }
const FIT_RAW: Record<FitLevel6, number> = { NONE: 0, WEAK: 0.2, ADJACENT: 0.45, GOOD: 0.65, STRONG: 0.85, EXCEPTIONAL: 1 }
const TIMING_RAW: Record<BuyerTiming, number> = { NONE: 0, WEAK: 0.35, CURRENT: 0.8, URGENT: 1 }
const RECENCY_RAW: Record<ActivityRecency, number> = { FRESH: 1, RECENT: 0.75, AGING: 0.45, STALE: 0.15, UNKNOWN: 0.4 }
const CP_RAW: Record<CommercialPotentialLevel, number> = { VERY_LOW: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 0.75, VERY_HIGH: 1 }

export const FEATURE_NAMES = [
  'intent_level', 'intent_verified_request', 'intent_verified_budget', 'intent_external_need', 'intent_asking_help', 'intent_request_age_factor', 'intent_contradictions', 'intent_model_probability',
  'role_rank', 'role_buyer', 'role_builder', 'role_seller', 'role_recruiter', 'role_candidate', 'role_unknown',
  'av_company_maturity', 'av_build_intensity', 'av_technical_complexity', 'av_funding', 'av_hiring_current', 'av_hiring_urgent', 'av_hiring_count', 'av_product_activity', 'av_growth_signals', 'av_outsourcing', 'av_v3_cp',
  'fit_level', 'fit_need_count', 'fit_stack_count', 'fit_org_need_coverage', 'fit_org_stack_coverage', 'fit_model',
  'authority_decision', 'authority_technical', 'authority_founder',
  'timing_buyer', 'timing_recency', 'access_raw', 'access_direct',
  'evidence_quality', 'source_completeness', 'contradictions',
  'supply_seller', 'supply_software_seller', 'supply_recruiter', 'supply_candidate', 'founder_or_builder',
  'episode_closed', 'fallback_used', 'platform_upwork', 'language_non_en',
] as const

export type FeatureName = typeof FEATURE_NAMES[number]

export function requestAgeFactor(ageDays: number | null): number {
  if (ageDays === null) return 1
  if (ageDays <= 90) return 1
  if (ageDays <= 180) return 0.8
  if (ageDays <= 365) return 0.6
  return 0.35
}

/** Fixed-order numeric projection of the features, every value in [0, 1] except counts (clipped). */
export function featureVector(f: OpportunityFeatures): number[] {
  const b = (x: boolean) => (x ? 1 : 0)
  const modelFit = f.fit.modelFit ? ({ POOR: 0, WEAK: 0.25, MEDIUM: 0.5, STRONG: 0.8, EXCELLENT: 1 } as const)[f.fit.modelFit] : 0.5
  const values: Record<FeatureName, number> = {
    intent_level: INTENT_RAW[f.intent.level],
    intent_verified_request: b(f.intent.verifiedRequest),
    intent_verified_budget: b(f.intent.verifiedBudget),
    intent_external_need: b(f.intent.verifiedExternalNeed),
    intent_asking_help: b(f.intent.askingForHelp),
    intent_request_age_factor: f.intent.verifiedRequest ? requestAgeFactor(f.intent.requestAgeDays) : 0,
    intent_contradictions: Math.min(1, f.intent.contradictions / 2),
    intent_model_probability: f.intent.modelBuyerProbability ?? 0.2,
    role_rank: ROLE_ORDER.indexOf(f.relationshipRole) / (ROLE_ORDER.length - 1),
    role_buyer: b(f.relationshipRole === 'BUYER' || f.relationshipRole === 'BUYER_AND_SELLER'),
    role_builder: b(f.relationshipRole === 'BUILDER'),
    role_seller: b(f.relationshipRole === 'SELLER'),
    role_recruiter: b(f.relationshipRole === 'RECRUITER'),
    role_candidate: b(f.relationshipRole === 'CANDIDATE'),
    role_unknown: b(f.relationshipRole === 'UNKNOWN'),
    av_company_maturity: MATURITY_RAW[f.accountValue.companyMaturity],
    av_build_intensity: BUILD_RAW[f.accountValue.buildIntensity],
    av_technical_complexity: COMPLEXITY_RAW[f.accountValue.technicalComplexity],
    av_funding: b(f.accountValue.fundingSignal),
    av_hiring_current: b(f.accountValue.hiringCurrent),
    av_hiring_urgent: b(f.accountValue.hiringUrgent),
    av_hiring_count: Math.min(1, f.accountValue.hiringCount / 5),
    av_product_activity: b(f.accountValue.currentProductActivity),
    av_growth_signals: Math.min(1, f.accountValue.growthSignals / 3),
    av_outsourcing: f.accountValue.outsourcingPlausibility,
    av_v3_cp: CP_RAW[f.accountValue.v3Level],
    fit_level: FIT_RAW[f.fit.level],
    fit_need_count: Math.min(1, f.fit.needs.length / 3),
    fit_stack_count: Math.min(1, f.fit.stack.length / 4),
    fit_org_need_coverage: f.fit.orgNeedCoverage,
    fit_org_stack_coverage: f.fit.orgStackCoverage,
    fit_model: modelFit,
    authority_decision: f.authority.decisionAuthority,
    authority_technical: f.authority.technicalAuthority,
    authority_founder: b(f.authority.level === 'FOUNDER'),
    timing_buyer: TIMING_RAW[f.buyerTiming],
    timing_recency: RECENCY_RAW[f.activityRecency],
    access_raw: f.access.raw,
    access_direct: b(f.access.level === 'DIRECT'),
    evidence_quality: f.evidenceQuality,
    source_completeness: f.sourceCompleteness / 100,
    contradictions: Math.min(1, f.contradictions / 2),
    supply_seller: b(f.supply.sellerActivity),
    supply_software_seller: b(f.supply.softwareServicesSeller),
    supply_recruiter: b(f.supply.recruiterProfile),
    supply_candidate: b(f.supply.candidateSeeking),
    founder_or_builder: b(f.founderOrBuilder),
    episode_closed: b(f.episodeClosed),
    fallback_used: b(f.fallbackUsed),
    platform_upwork: b(f.platform === 'upwork'),
    language_non_en: b(f.language !== 'en'),
  }
  return FEATURE_NAMES.map((n) => values[n])
}

export function featureRecord(f: OpportunityFeatures): Record<FeatureName, number> {
  const v = featureVector(f)
  return Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, v[i]])) as Record<FeatureName, number>
}
