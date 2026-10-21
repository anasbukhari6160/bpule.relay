/**
 * Opportunity dimensions — each one owned here, each one bounded 0-1, each
 * one explainable with the source line it came from.
 *
 *   access      — resolveAccess()            one AccessFacts authority
 *   timing      — resolveTiming()            activityRecency ≠ buyerTiming
 *   authority   — resolveAuthorityDimension()
 *   fit         — resolveCapabilityFit()      org-level, sender-independent
 *   commercial  — assessCommercialPotential() no floors, no authority double count
 *   evidence    — assessEvidenceQuality()
 *   confidence  — computeConfidence()         separate from the score
 *
 * None of these read raw text; they read SourceFacts. The model's bounded
 * answers are an input that the verified facts can confirm, cap or reject,
 * and every rejection is written into the dimension's note.
 */

import type { SourceFacts, ActivityRecency } from './source-facts-model'
import type { VerifiedBuyerIntent } from './buyer-intent'
import type { V3AccessLevel, V3BoundedDecision, V3FitLevel, V3OpportunityEpisode, V3TimingLevel, CommercialPotentialAssessment, BuildIntensity, CommercialPotentialLevel } from './types'

export interface DimensionEvidenceRef {
  text: string
  kind: 'quote' | 'signal' | 'inference'
}

// ── Access ──────────────────────────────────────────────────────────────────

export type ResolvedAccessLevel = 'DIRECT' | 'CONNECTION' | 'INDIRECT' | 'NONE'

export interface AccessResolution {
  level: ResolvedAccessLevel
  raw: number
  modelLevel: V3AccessLevel | null
  reasons: string[]
  evidence: DimensionEvidenceRef[]
  /** The model's answer was replaced by the source facts. */
  overrode: boolean
}

export const ACCESS_RAW: Record<ResolvedAccessLevel, number> = {
  DIRECT: 1.0,
  CONNECTION: 0.7,
  INDIRECT: 0.35,
  NONE: 0.1,
}

/**
 * One access authority. The source's own facts (connection degree, message
 * button, mutuals, a stated contact route) decide; the model's answer only
 * fills gaps the source leaves. "Opportunity model = NONE, signal check =
 * DIRECT" cannot happen any more because both read this.
 */
export function resolveAccess(
  facts: SourceFacts,
  modelAccess: V3AccessLevel | null | undefined,
  opts: { relationshipRole?: string; verifiedBuyerRequest?: boolean } = {},
): AccessResolution {
  const a = facts.access
  const reasons: string[] = []
  const evidence: DimensionEvidenceRef[] = []
  let level: ResolvedAccessLevel | null = null

  if (a.connectionDegree === '1st') {
    level = 'DIRECT'
    reasons.push('1st-degree connection — can message directly')
    evidence.push({ text: '1st-degree connection', kind: 'signal' })
  } else if (a.directContactAvailable && a.contactLine) {
    level = 'DIRECT'
    reasons.push('The source invites contact')
    evidence.push({ text: a.contactLine, kind: 'quote' })
  } else if (a.hasEmail) {
    level = 'DIRECT'
    reasons.push('Email address in the source')
    evidence.push({ text: 'Email address present', kind: 'signal' })
  } else if (a.canMessage) {
    level = 'CONNECTION'
    reasons.push(a.mutualConnections > 0 ? `${a.mutualConnections} mutual connection${a.mutualConnections === 1 ? '' : 's'}` : 'Message route available')
    evidence.push({ text: a.mutualConnections > 0 ? `${a.mutualConnections} mutual connections` : 'Can message', kind: 'signal' })
  } else if (a.connectionDegree === '2nd' || a.profileUrl) {
    level = 'CONNECTION'
    reasons.push(a.connectionDegree === '2nd' ? '2nd-degree — connection request is the route' : 'LinkedIn profile — connection request is the route')
    evidence.push({ text: a.connectionDegree === '2nd' ? '2nd-degree connection' : 'LinkedIn profile URL', kind: 'signal' })
  } else if (a.connectionDegree === '3rd') {
    level = 'INDIRECT'
    reasons.push('3rd-degree — cold connection request')
    evidence.push({ text: '3rd-degree connection', kind: 'signal' })
  }

  const model = modelAccess ?? null
  let overrode = false
  if (level === null) {
    // No access facts in the source: the model's answer stands, but never above CONNECTION
    // (a model cannot know about a message button the source does not show).
    if (model === 'DIRECT') { level = 'CONNECTION'; overrode = true; reasons.push('Model said DIRECT without a contact route in the source — treated as CONNECTION') }
    else if (model) level = model
    else level = 'INDIRECT'
    if (!overrode) reasons.push(model ? `No access facts in the source; model assessment ${model}` : 'No access facts in the source')
    evidence.push({ text: 'No connection degree, contact route or profile URL in the source', kind: 'inference' })
  } else if (model && model !== level) {
    overrode = true
    reasons.push(`Model said ${model}; source facts say ${level}`)
  }

  // Access measures the route to a buying decision. A recruiter sourcing for
  // clients or a candidate seeking work has no buying decision to reach, so
  // "DM me your resume" is a route to nothing we sell.
  let raw = ACCESS_RAW[level]
  const role = opts.relationshipRole
  if (!opts.verifiedBuyerRequest && (role === 'RECRUITER' || role === 'CANDIDATE')) {
    raw = Math.min(raw, 0.35)
    reasons.push(`${role === 'RECRUITER' ? 'Recruiter' : 'Candidate'} — reachable, but there is no buying decision behind the route`)
  }

  return { level, raw, modelLevel: model, reasons, evidence, overrode }
}

// ── Timing ──────────────────────────────────────────────────────────────────

export type BuyerTiming = 'NONE' | 'WEAK' | 'CURRENT' | 'URGENT'

export interface TimingResolution {
  activityRecency: ActivityRecency
  buyerTiming: BuyerTiming
  modelTiming: V3TimingLevel | null
  /** 0-1 blended dimension value. */
  raw: number
  recencyRaw: number
  buyerTimingRaw: number
  note: string
  evidence: DimensionEvidenceRef[]
  /** Model urgency rejected because no buyer deadline is in the source. */
  urgencyRejected: boolean
}

const RECENCY_RAW: Record<ActivityRecency, number> = { FRESH: 1.0, RECENT: 0.75, AGING: 0.45, STALE: 0.15, UNKNOWN: 0.5 }
const BUYER_TIMING_RAW: Record<BuyerTiming, number> = { URGENT: 1.0, CURRENT: 0.8, WEAK: 0.4, NONE: 0.15 }

/**
 * Timing has two parts that must not be confused:
 *  - activityRecency: how recently the prospect posted (a dated post).
 *  - buyerTiming: how soon THEY want to buy. URGENT needs a deadline/start
 *    date tied to a verified request; CURRENT needs a verified request that
 *    is recent; otherwise WEAK/NONE. A fresh post never creates buyer timing.
 */
export function resolveTiming(
  facts: SourceFacts,
  intent: VerifiedBuyerIntent,
  episode: Pick<V3OpportunityEpisode, 'ageDays' | 'status'> | null,
  modelTiming: V3TimingLevel | null | undefined,
): TimingResolution {
  const episodeAge = episode?.ageDays ?? null
  const ageDays = facts.recentPostAgeDays !== null && episodeAge !== null
    ? Math.min(facts.recentPostAgeDays, episodeAge)
    : facts.recentPostAgeDays ?? episodeAge
  const activityRecency: ActivityRecency = ageDays === null ? 'UNKNOWN' : ageDays <= 7 ? 'FRESH' : ageDays <= 30 ? 'RECENT' : ageDays <= 90 ? 'AGING' : 'STALE'

  const evidence: DimensionEvidenceRef[] = []
  // A deadline stated inside an old post has passed: "start within 3 weeks"
  // written eight months ago is not urgency today.
  const requestAge = facts.buyerRequestAgeDays ?? episodeAge
  const timelineExpired = facts.timelineEvidence !== null && requestAge !== null && requestAge > 60
  const timeline = timelineExpired ? null : facts.timelineEvidence
  const verifiedRequest = intent.verifiedBuyerRequest
  const hiring = intent.verifiedHiringNeed
  let buyerTiming: BuyerTiming = 'NONE'
  let urgencyRejected = false

  if (verifiedRequest && timeline && timeline.days <= 30) {
    buyerTiming = 'URGENT'
    evidence.push({ text: timeline.line, kind: 'quote' })
  } else if (verifiedRequest && timeline && timeline.days <= 90) {
    buyerTiming = 'CURRENT'
    evidence.push({ text: timeline.line, kind: 'quote' })
  } else if (verifiedRequest && (activityRecency === 'FRESH' || activityRecency === 'RECENT')) {
    buyerTiming = 'CURRENT'
    evidence.push({ text: `Request posted ${ageDays}d ago`, kind: 'signal' })
  } else if (verifiedRequest) {
    const requestStale = activityRecency === 'STALE' || (requestAge !== null && requestAge > 90)
    buyerTiming = requestStale ? 'WEAK' : 'CURRENT'
    if (activityRecency === 'UNKNOWN') evidence.push({ text: 'Request is undated in the source', kind: 'inference' })
    if (timelineExpired) evidence.push({ text: `Stated timeline ("${facts.timelineEvidence!.label}") is ${requestAge}d old — expired`, kind: 'signal' })
  } else if (hiring && facts.hiringUrgent) {
    buyerTiming = 'WEAK'
    evidence.push({ text: facts.currentHiringActivity ?? 'Urgent hiring', kind: 'quote' })
  } else if (hiring) {
    buyerTiming = 'WEAK'
  }

  // An explicit start/deadline date in the source is buyer timing even when
  // the relative-age reader cannot place the post (QA BUG-PRO-023).
  const explicit = facts.explicitDates
  if (verifiedRequest && buyerTiming !== 'URGENT' && (explicit.buyerStartDate || explicit.deadline)) {
    buyerTiming = 'CURRENT'
    evidence.push({ text: explicit.buyerStartDate ?? explicit.deadline!, kind: 'quote' })
  }

  if ((modelTiming === 'URGENT' || modelTiming === 'CURRENT') && buyerTiming !== 'URGENT' && buyerTiming !== 'CURRENT') {
    urgencyRejected = true
  }

  const recencyRaw = RECENCY_RAW[activityRecency]
  const buyerTimingRaw = BUYER_TIMING_RAW[buyerTiming]
  const raw = Math.round((buyerTimingRaw * 0.6 + recencyRaw * 0.4) * 100) / 100

  if (evidence.length === 0) {
    evidence.push(ageDays !== null
      ? { text: `Most recent dated activity ${ageDays}d ago`, kind: 'signal' }
      : explicit.activityDate
        ? { text: `Explicit date in the source: ${explicit.activityDate}`, kind: 'signal' }
        : { text: 'No post date, start date or deadline in the source', kind: 'inference' })
  }

  const note = urgencyRejected
    ? `Model said ${modelTiming} — not verified: no buyer deadline or current request in the source. Activity ${activityRecency.toLowerCase()}, buyer timing ${buyerTiming.toLowerCase()}.`
    : `Activity ${activityRecency.toLowerCase()}${ageDays !== null ? ` (${ageDays}d)` : ''}; buyer timing ${buyerTiming.toLowerCase()}${timeline && verifiedRequest ? ` (${timeline.label})` : ''}.`

  return { activityRecency, buyerTiming, modelTiming: modelTiming ?? null, raw, recencyRaw, buyerTimingRaw, note, evidence, urgencyRejected }
}

// ── Authority ───────────────────────────────────────────────────────────────

export interface AuthorityResolution {
  raw: number
  level: SourceFacts['authorityEvidence']['level']
  technical: number
  note: string
  evidence: DimensionEvidenceRef[]
}

export function resolveAuthorityDimension(facts: SourceFacts, intent: VerifiedBuyerIntent): AuthorityResolution {
  const a = facts.authorityEvidence
  let raw = a.decisionAuthority
  let note = `${a.level.replace('_', ' ').toLowerCase()} — decision authority ${raw.toFixed(2)}`
  // A recruiter has hiring authority, not service-buying authority; a candidate
  // represents nobody's budget.
  if (intent.relationshipRole === 'RECRUITER' && !intent.verifiedBuyerRequest) { raw = Math.min(raw, 0.2); note = 'Recruiter — hiring authority, not service-buying authority' }
  if (intent.relationshipRole === 'CANDIDATE') { raw = Math.min(raw, 0.15); note = 'Candidate seeking work — no organizational buying authority' }
  return {
    raw,
    level: a.level,
    technical: a.technicalAuthority,
    note,
    evidence: a.line ? [{ text: a.line, kind: 'quote' }] : [{ text: 'No title or role line in the source', kind: 'inference' }],
  }
}

// ── Capability fit ──────────────────────────────────────────────────────────

export interface FitResolution {
  raw: number
  level: V3FitLevel | 'UNKNOWN'
  modelLevel: V3FitLevel | null
  overlap: string[]
  note: string
  evidence: DimensionEvidenceRef[]
}

const FIT_RAW: Record<V3FitLevel, number> = { EXCELLENT: 1.0, STRONG: 0.8, MEDIUM: 0.5, WEAK: 0.25, POOR: 0.05 }

/** What the organization (not one sender) can credibly deliver. Overridable per org. */
export const DEFAULT_ORG_CAPABILITIES = [
  'react', 'next.js', 'nextjs', 'node', 'node.js', 'typescript', 'javascript', 'python', 'django', 'fastapi', 'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'devops', 'postgresql', 'postgres', 'mongodb', 'graphql', 'rest api', 'api',
  'ai', 'ml', 'machine learning', 'llm', 'rag', 'nlp', 'automation', 'integration', 'saas', 'mvp', 'web app', 'mobile app', 'react native', 'flutter', 'backend', 'frontend', 'full-stack', 'fullstack', 'ui/ux', 'dashboard', 'analytics', 'data engineering', 'security', 'compliance', '.net', 'c#', 'php', 'laravel', 'shopify', 'wordpress',
]

/**
 * Fit = how strongly their context overlaps with what the org delivers. The
 * model's fit answer is one input; deterministic overlap between the
 * prospect's stated needs/stack and the org capability set is the other.
 * Keyword overlap alone cannot push fit above STRONG; the model alone
 * cannot push it above STRONG when the source names no overlapping need.
 */
const SOFTWARE_SERVICES = /\b(?:software|development|engineering|dev\s+shop|agency|agentur|agence|agencia|ajans|studio|web|mobile|app|react|node|full[- ]stack|saas\s+development|custom\s+software|it\s+services|consult\w*|outsourc\w*|staff\s+augmentation|fractional\s+cto|devops|cloud\s+(?:consulting|strategy))\b/i

/** A seller whose offer is software delivery, consulting or staff — what the agency sells. */
export function isSoftwareServicesSeller(facts: SourceFacts): boolean {
  if (!facts.sellerActivity) return false
  const text = [...facts.serviceOffering, facts.person.title ?? ''].join('\n')
  return SOFTWARE_SERVICES.test(text)
}

export function resolveCapabilityFit(
  facts: SourceFacts,
  modelFit: V3FitLevel | null | undefined,
  orgCapabilities: string[] = DEFAULT_ORG_CAPABILITIES,
  opts: { relationshipRole?: string; verifiedBuyerRequest?: boolean } = {},
): FitResolution {
  const caps = new Set(orgCapabilities.map((c) => c.toLowerCase()))
  const theirTerms = [...new Set([
    ...facts.capabilityNeeds,
    ...facts.technologyContext.languages,
    ...facts.technologyContext.frameworks,
    ...facts.technologyContext.platforms,
    ...facts.technologyContext.domains,
    ...facts.proofCandidates,
  ].map((t) => t.toLowerCase()))]
  const overlap = theirTerms.filter((t) => caps.has(t) || [...caps].some((c) => c.length > 3 && (c.includes(t) || t.includes(c))))
  const needOverlap = facts.capabilityNeeds.filter((t) => overlap.includes(t.toLowerCase()))

  // Deterministic component: requested capabilities we cover count most; general stack next.
  let deterministic = 0.3
  if (facts.capabilityNeeds.length > 0) {
    deterministic = 0.3 + 0.7 * (needOverlap.length / facts.capabilityNeeds.length)
  } else if (overlap.length >= 3) deterministic = 0.75
  else if (overlap.length >= 1) deterministic = 0.55
  else if (facts.technologyContext.hasWeb || facts.technologyContext.hasAI || facts.technologyContext.hasCloud || facts.currentProductActivity) deterministic = 0.45

  const model = modelFit ?? null
  const modelRaw = model ? FIT_RAW[model] : null
  let raw = modelRaw === null ? deterministic : Math.round((modelRaw * 0.6 + deterministic * 0.4) * 100) / 100
  // Guard: the model alone cannot claim EXCELLENT when nothing in the source overlaps.
  if (modelRaw !== null && modelRaw >= 0.8 && overlap.length === 0 && !facts.currentProductActivity) raw = Math.min(raw, 0.6)
  // Guard: with no named need, no stack, no product and no overlap at all,
  // fit is unverifiable — the model's default "medium" cannot lift it past WEAK
  // (a psychiatric clinic is not a software buyer because a model said so).
  const tc = facts.technologyContext
  const nothingToFit = overlap.length === 0 && facts.capabilityNeeds.length === 0 && !facts.currentProductActivity
    && !tc.hasWeb && !tc.hasAI && !tc.hasCloud && !tc.hasMobile && !tc.hasDevOps
  if (nothingToFit) raw = Math.min(raw, 0.3)
  // Fit is "would they buy what we deliver". A software-services seller
  // delivers it themselves, a recruiter places people, a candidate wants a
  // job: stack overlap with them is not a reason they would buy from us.
  const role = opts.relationshipRole ?? 'UNKNOWN'
  if (!opts.verifiedBuyerRequest) {
    if (role === 'CANDIDATE') raw = Math.min(raw, 0.2)
    else if (role === 'RECRUITER') raw = Math.min(raw, 0.3)
    else if (role === 'SELLER' && isSoftwareServicesSeller(facts)) raw = Math.min(raw, 0.3)
  }

  const level: FitResolution['level'] = raw >= 0.9 ? 'EXCELLENT' : raw >= 0.7 ? 'STRONG' : raw >= 0.45 ? 'MEDIUM' : raw >= 0.25 ? 'WEAK' : modelRaw === null && overlap.length === 0 ? 'UNKNOWN' : 'POOR'
  const note = overlap.length > 0
    ? `Overlap: ${overlap.slice(0, 4).join(', ')}${model ? ` · model ${model.toLowerCase()}` : ''}`
    : model ? `Model ${model.toLowerCase()}; no overlapping capability named in the source` : 'No capability or stack named in the source'
  const evidence: DimensionEvidenceRef[] = facts.buyerRequest && needOverlap.length > 0
    ? [{ text: facts.buyerRequest, kind: 'quote' }]
    : overlap.length > 0
      ? [{ text: `Stack mentioned: ${overlap.slice(0, 5).join(', ')}`, kind: 'signal' }]
      : [{ text: 'No overlapping capability in the source', kind: 'inference' }]

  return { raw: Math.round(raw * 100) / 100, level, modelLevel: model, overlap, note, evidence }
}

// ── Commercial potential ────────────────────────────────────────────────────

const BUILD_RAW: Record<BuildIntensity, number> = { NONE: 0, LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8, VERY_HIGH: 1.0 }

export interface CommercialPotentialResolution extends CommercialPotentialAssessment {
  /** 0-1 dimension value with no floors. */
  raw: number
  note: string
  evidence: DimensionEvidenceRef[]
}

function buildIntensityFromFacts(facts: SourceFacts): BuildIntensity {
  let score = 0
  if (facts.currentProductActivity) score += 3
  if (facts.fundingEvidence) score += 2
  if (facts.currentHiringActivity) score += 1
  if (facts.technologyContext.stackComplexity === 'complex') score += 2
  else if (facts.technologyContext.stackComplexity === 'moderate') score += 1
  if (facts.signals.intent.launching) score += 1
  if (facts.signals.company.growthSignals.length > 0) score += 1
  if (facts.currentOrganizations.length >= 2) score += 1
  // History is credibility, not current build: historicalProductActivity adds nothing.
  if (score >= 7) return 'VERY_HIGH'
  if (score >= 4) return 'HIGH'
  if (score >= 2) return 'MEDIUM'
  if (score >= 1) return 'LOW'
  return 'NONE'
}

/**
 * "Could this organization plausibly become a valuable customer even without
 * explicit buyer intent?" Authority is NOT in here (it is its own dimension),
 * and nothing in here is floored by a budget — a verified budget is buyer
 * evidence and is credited there.
 */
export function assessCommercialPotentialFromFacts(
  facts: SourceFacts,
  intent: VerifiedBuyerIntent,
  opts: { technicalRelevance?: number } = {},
): CommercialPotentialResolution {
  const buildIntensity = buildIntensityFromFacts(facts)
  const buildRaw = BUILD_RAW[buildIntensity]

  const tech = facts.technologyContext
  const techCount = tech.languages.length + tech.frameworks.length + tech.platforms.length
  const technicalRelevance = opts.technicalRelevance ?? Math.min(1, (techCount + (tech.hasAI ? 1 : 0) + (tech.hasWeb ? 1 : 0)) / 5)

  // Would they plausibly need outside delivery capacity?
  let capacity = 0.2
  if (facts.companySizeCategory === 'startup' || facts.companySizeEvidence === 'startup') capacity = 0.65
  else if (facts.companySizeCategory === 'small' || facts.companySizeEvidence === 'small') capacity = 0.55
  else if (facts.companySizeCategory === 'mid' || facts.companySizeEvidence === 'mid') capacity = 0.45
  else if (facts.companySizeCategory === 'enterprise' || facts.companySizeEvidence === 'enterprise') capacity = 0.35
  if (facts.currentHiringActivity) capacity = Math.min(1, capacity + 0.2)
  if (facts.currentProductActivity && !facts.sellerActivity) capacity = Math.min(1, capacity + 0.15)
  // An owner-operator of an early product is the archetype that buys delivery capacity.
  if (facts.founderOrBuilder && facts.currentProductActivity && !facts.sellerActivity) capacity = Math.min(1, capacity + 0.1)
  // A software services seller already has delivery capacity; a non-software seller does not.
  if (isSoftwareServicesSeller(facts) && !intent.verifiedBuyerRequest) capacity = Math.min(capacity, 0.15)
  if (intent.relationshipRole === 'CANDIDATE') capacity = 0.05
  if (intent.relationshipRole === 'RECRUITER' && !intent.verifiedBuyerRequest) capacity = Math.min(capacity, 0.15)

  let maturity = 0.1
  if (facts.fundingEvidence) maturity += 0.4
  if (facts.companySizeCategory === 'mid') maturity += 0.25
  else if (facts.companySizeCategory === 'enterprise') maturity += 0.35
  else if (facts.companySizeCategory === 'small') maturity += 0.15
  if (facts.signals.company.growthSignals.length > 0) maturity += 0.15
  if (facts.currentHiringActivity) maturity += 0.1 + Math.min(0.15, facts.hiringCount * 0.03)
  maturity = Math.min(1, maturity)

  let commercialActivity = 0
  if (facts.currentProductActivity) commercialActivity += 0.4
  if (facts.signals.intent.launching) commercialActivity += 0.2
  if (facts.fundingEvidence) commercialActivity += 0.2
  if (facts.currentHiringActivity) commercialActivity += 0.2
  commercialActivity = Math.min(1, commercialActivity)

  const reachability = facts.access.connectionDegree === '1st' || facts.access.directContactAvailable ? 1 : facts.access.profileUrl || facts.access.canMessage ? 0.7 : 0.4

  // Weighted, no floors. Authority excluded (own dimension).
  let raw = buildRaw * 0.35 + technicalRelevance * 0.10 + capacity * 0.20 + maturity * 0.15 + commercialActivity * 0.20
  if (intent.relationshipRole === 'CANDIDATE') raw = Math.min(raw, 0.25)
  if (intent.relationshipRole === 'RECRUITER' && !intent.verifiedBuyerRequest) raw = Math.min(raw, 0.25)
  raw = Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100

  const overallPotential: CommercialPotentialLevel = raw >= 0.75 ? 'VERY_HIGH' : raw >= 0.5 ? 'HIGH' : raw >= 0.3 ? 'MEDIUM' : raw >= 0.15 ? 'LOW' : 'VERY_LOW'

  const signals: string[] = []
  if (buildIntensity !== 'NONE' && buildIntensity !== 'LOW') signals.push(`Active building (${buildIntensity.toLowerCase().replace('_', ' ')})`)
  if (facts.currentProductActivity) signals.push('Current product activity')
  if (facts.fundingEvidence) signals.push('Funding event in the source')
  if (facts.currentHiringActivity) signals.push('Hiring for own team')
  if (technicalRelevance >= 0.4) signals.push('Technical stack overlap')
  if (capacity >= 0.5) signals.push('Likely needs outside capacity')
  if (maturity >= 0.4) signals.push('Company maturity signals')

  const evidence: DimensionEvidenceRef[] = []
  if (facts.currentIndustryLine && facts.currentProductActivity) evidence.push({ text: facts.currentIndustryLine, kind: 'quote' })
  if (facts.fundingEvidence) evidence.push({ text: facts.fundingEvidence, kind: 'quote' })
  if (facts.currentHiringActivity) evidence.push({ text: facts.currentHiringActivity, kind: 'quote' })
  if (evidence.length === 0) evidence.push(signals.length > 0 ? { text: signals.slice(0, 3).join('; '), kind: 'signal' } : { text: 'No product, funding or growth activity in the source', kind: 'inference' })

  return {
    decisionAuthority: facts.authorityEvidence.decisionAuthority,
    buildIntensity,
    technicalRelevance: Math.round(technicalRelevance * 100) / 100,
    capacityNeedLikelihood: Math.round(capacity * 100) / 100,
    reachability,
    companyMaturity: Math.round(maturity * 100) / 100,
    commercialActivity: Math.round(commercialActivity * 100) / 100,
    overallPotential,
    confidence: Math.min(1, signals.length / 4),
    signals,
    raw,
    note: `${overallPotential.toLowerCase()} potential — build ${buildIntensity.toLowerCase().replace('_', ' ')}, capacity need ${capacity.toFixed(2)}, maturity ${maturity.toFixed(2)}`,
    evidence,
  }
}

// ── Evidence quality ────────────────────────────────────────────────────────

export interface EvidenceQualityResolution {
  raw: number
  note: string
  evidence: DimensionEvidenceRef[]
  components: { verbatim: number; completeness: number; corroboration: number; freshness: number; ownership: number; consistency: number }
}

export function assessEvidenceQuality(
  facts: SourceFacts,
  intent: VerifiedBuyerIntent,
  episode: { evidenceCount: number; verbatimCount: number } | null,
): EvidenceQualityResolution {
  const verbatimCount = episode?.verbatimCount ?? 0
  const evidenceCount = episode?.evidenceCount ?? 0
  const verbatim = verbatimCount > 0 ? Math.min(1, 0.6 + verbatimCount * 0.2) : evidenceCount > 0 ? 0.3 : 0.2
  const completeness = facts.sourceCompleteness.score / 100
  const positiveFacts = [facts.buyerRequest, facts.currentHiringActivity, facts.budgetEvidence?.line, facts.timelineEvidence?.line, facts.fundingEvidence, facts.currentIndustryLine].filter(Boolean).length
  const corroboration = Math.min(1, positiveFacts / 3)
  const freshness = facts.activityRecency === 'FRESH' ? 1 : facts.activityRecency === 'RECENT' ? 0.8 : facts.activityRecency === 'AGING' ? 0.5 : facts.activityRecency === 'STALE' ? 0.25 : 0.4
  const ownership = intent.relationshipRole === 'UNKNOWN' ? 0.5 : facts.rejectedSignals.some((r) => r.actor === 'third_party') ? 0.6 : 0.85
  const consistency = intent.contradictions.length === 0 ? 1 : Math.max(0.2, 1 - 0.3 * intent.contradictions.length)
  const raw = Math.round((verbatim * 0.25 + completeness * 0.2 + corroboration * 0.2 + freshness * 0.15 + ownership * 0.1 + consistency * 0.1) * 100) / 100
  return {
    raw,
    note: `${verbatimCount} verbatim quote${verbatimCount === 1 ? '' : 's'}, source ${facts.sourceCompleteness.score}% complete, ${positiveFacts} corroborating fact${positiveFacts === 1 ? '' : 's'}${intent.contradictions.length > 0 ? `, ${intent.contradictions.length} contradiction${intent.contradictions.length === 1 ? '' : 's'}` : ''}`,
    evidence: [{ text: `${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'} attached; ${facts.sourceCompleteness.missingFields.length > 0 ? `missing ${facts.sourceCompleteness.missingFields.join(', ')}` : 'all identity fields present'}`, kind: 'signal' }],
    components: { verbatim, completeness, corroboration, freshness, ownership, consistency },
  }
}

// ── Confidence ──────────────────────────────────────────────────────────────

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ConfidenceResolution {
  value: number
  label: ConfidenceLabel
  reasons: string[]
  components: { completeness: number; evidenceQuality: number; agreement: number; freshness: number; ambiguity: number; language: number }
  /** True when the right next step is to research rather than act. */
  researchMore: boolean
}

export function confidenceLabel(value: number): ConfidenceLabel {
  return value >= 0.7 ? 'HIGH' : value >= 0.45 ? 'MEDIUM' : 'LOW'
}

/**
 * Confidence is NOT the score. A 6/10 with LOW confidence means "research
 * more"; a 6/10 with HIGH confidence means "act on a soft touch".
 */
export function computeConfidence(params: {
  facts: SourceFacts
  intent: VerifiedBuyerIntent
  evidenceQuality: number
  timing: TimingResolution
  access: AccessResolution
  decision: V3BoundedDecision | null
  providerConfidence: number | null
  fallbackUsed: boolean
}): ConfidenceResolution {
  const { facts, intent, timing, access, decision } = params
  const reasons: string[] = []

  const completeness = facts.sourceCompleteness.score / 100
  if (completeness < 0.5) reasons.push(`Source is thin (${facts.sourceCompleteness.score}% complete)`)

  const evidenceQuality = params.evidenceQuality

  // Agreement between the model and the deterministic readers.
  let agreement = 1
  if (intent.contradictions.length > 0) { agreement -= 0.35 * Math.min(2, intent.contradictions.length); reasons.push('Scorers disagree on buyer intent') }
  if (timing.urgencyRejected) { agreement -= 0.15; reasons.push('Model timing not supported by the source') }
  if (access.overrode) { agreement -= 0.1 }
  if (decision && decision.buyerRequestProbability >= 0.3 && decision.buyerRequestProbability < 0.7 && !intent.verifiedBuyerRequest) { agreement -= 0.15; reasons.push('Model buyer probability is in the uncertain zone') }
  if (params.fallbackUsed) { agreement -= 0.25; reasons.push('Decision model unavailable — deterministic fallback used') }
  agreement = Math.max(0, agreement)

  const freshness = timing.activityRecency === 'FRESH' ? 1 : timing.activityRecency === 'RECENT' ? 0.85 : timing.activityRecency === 'AGING' ? 0.6 : timing.activityRecency === 'STALE' ? 0.4 : 0.5
  if (timing.activityRecency === 'UNKNOWN') reasons.push('No dated activity in the source')

  let ambiguity = 1
  if (intent.relationshipRole === 'UNKNOWN') { ambiguity -= 0.3; reasons.push('Relationship role unclear') }
  if (intent.sellerSideContent && intent.verifiedBuyerRequest) { ambiguity -= 0.2; reasons.push('Prospect both sells and asks — mixed role') }
  if (decision?.relationship === 'MIXED') ambiguity -= 0.15
  ambiguity = Math.max(0, ambiguity)

  const language = facts.sourceLanguage === 'en' ? 1 : facts.sourceLanguage === 'mixed' ? 0.8 : facts.sourceLanguage === 'other' ? 0.5 : 0.75
  if (language < 1) reasons.push(`Source language ${facts.sourceLanguage} — deterministic readers have partial coverage`)

  let value = Math.round((completeness * 0.2 + evidenceQuality * 0.25 + agreement * 0.25 + freshness * 0.1 + ambiguity * 0.1 + language * 0.1) * 100) / 100
  // Hard caps: a contradiction between scorers is never HIGH confidence; two
  // contradictions or a thin, undated source are LOW.
  if (intent.contradictions.length >= 1) value = Math.min(value, 0.65)
  if (intent.contradictions.length >= 2) value = Math.min(value, 0.44)
  if (facts.sourceCompleteness.score <= 50 && timing.activityRecency === 'UNKNOWN') value = Math.min(value, 0.44)
  if (params.fallbackUsed) value = Math.min(value, 0.6)
  const label = confidenceLabel(value)
  return {
    value,
    label,
    reasons,
    components: { completeness, evidenceQuality, agreement, freshness, ambiguity, language },
    researchMore: label === 'LOW',
  }
}
