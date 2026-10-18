
import { extractSignals, type ExtractedSignals } from './signal-extractor'
import { verifyBuyerSignal, type SignalProvenance } from './buyer-provenance'

export interface CompositeScoreInput {
  /** V3 AI decision (may be partial/uncertain) */
  aiBuyerProbability?: number
  aiFitLevel?: 'EXCELLENT' | 'STRONG' | 'MEDIUM' | 'WEAK' | 'POOR' | 'UNKNOWN'
  aiAccessLevel?: 'DIRECT' | 'CONNECTION' | 'INDIRECT' | 'NONE'
  aiIntentLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  /** Extracted deterministic signals */
  signals: ExtractedSignals
  /** Proof match score (0-1) from profile matching */
  proofScore?: number
  /** Sender capabilities for fit assessment */
  senderCapabilities?: string[]
  /** Raw source text — required for buyer-signal provenance verification */
  rawText?: string
  /** Provenance per signal type — verified before contributing to buyer intent */
  provenance?: Partial<Record<string, SignalProvenance>>
}

export interface CompositeDimension {
  key: string
  label: string
  score: number  // 0-100
  weight: number
  weighted: number
  evidence: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface CompositeScore {
  total: number  // 0-100
  label: string
  qualification: 'STRONG' | 'WORTH_PURSUING' | 'MAYBE' | 'SKIP'
  dimensions: CompositeDimension[]
  topReasons: string[]
  topRisks: string[]
  recommendedAction: 'CONTACT_NOW' | 'CONNECT_WITH_NOTE' | 'CONNECT_WITHOUT_NOTE' | 'OBSERVE' | 'SKIP'
}


const WEIGHTS = {
  buyerIntent: 0.25,
  companyQuality: 0.15,
  personAuthority: 0.12,
  capabilityFit: 0.18,
  timing: 0.10,
  access: 0.08,
  proof: 0.05,
  relationship: 0.04,
  engagement: 0.02,
  competitiveGap: 0.01,
}


export function computeCompositeScore(input: CompositeScoreInput): CompositeScore {
  const dims: CompositeDimension[] = []

  // Dimension 1: Buyer Intent (25%)
  dims.push(scoreBuyerIntent(input))

  // Dimension 2: Company Quality (15%)
  dims.push(scoreCompanyQuality(input))

  // Dimension 3: Person Authority (12%)
  dims.push(scorePersonAuthority(input))

  // Dimension 4: Capability Fit (18%)
  dims.push(scoreCapabilityFit(input))

  // Dimension 5: Timing (10%)
  dims.push(scoreTiming(input))

  // Dimension 6: Access (8%)
  dims.push(scoreAccess(input))

  // Dimension 7: Proof (5%)
  dims.push(scoreProof(input))

  // Dimension 8: Relationship (4%)
  dims.push(scoreRelationship(input))

  // Dimension 9: Engagement (2%)
  dims.push(scoreEngagement(input))

  // Dimension 10: Competitive Gap (1%)
  dims.push(scoreCompetitiveGap(input))

  const total = Math.round(
    dims.reduce((sum, d) => sum + d.weighted, 0),
  )

  const label = getCompositeLabel(total)
  const qualification = getCompositeQualification(total)
  const topReasons = dims.filter((d) => d.score >= 60).flatMap((d) => d.evidence).slice(0, 4)
  const topRisks = dims.filter((d) => d.score < 40).flatMap((d) => d.evidence).slice(0, 3)
  const recommendedAction = determineAction(total, input, dims)

  return {
    total: Math.max(0, Math.min(100, total)),
    label,
    qualification,
    dimensions: dims,
    topReasons,
    topRisks,
    recommendedAction,
  }
}


function scoreBuyerIntent(input: CompositeScoreInput): CompositeDimension {
  const { signals, aiBuyerProbability, rawText } = input
  const evidence: string[] = []
  const text = rawText ?? ''
  const prov = input.provenance ?? {}

  // Provenance-aware: each signal must pass subject + ownership + event + time
  const verifiedExplicit = prov.explicitAsk?.verifiedClaim
    ?? (text ? verifyBuyerSignal({ signalType: 'explicitAsk', text, rawDetected: signals.intent.explicitAsk }).buyerIntentValid : false)
  const verifiedHiring = prov.hiring?.verifiedClaim
    ?? (text ? verifyBuyerSignal({ signalType: 'hiring', text, rawDetected: signals.intent.hiring }).buyerIntentValid : false)
  const verifiedVendor = prov.seekingVendor?.verifiedClaim
    ?? (text ? verifyBuyerSignal({ signalType: 'seekingVendor', text, rawDetected: signals.intent.seekingVendor }).buyerIntentValid : false)
  const verifiedBudget = prov.budget?.verifiedClaim
    ?? (text ? verifyBuyerSignal({ signalType: 'budget', text, rawDetected: signals.intent.budgetMentioned }).buyerIntentValid : false)
  const verifiedAsking = prov.askingForHelp?.verifiedClaim
    ?? (text ? verifyBuyerSignal({ signalType: 'askingForHelp', text, rawDetected: signals.intent.askingForHelp }).buyerIntentValid : false)
  const verifiedLaunch = prov.launching?.verifiedClaim
    ?? (text ? verifyBuyerSignal({ signalType: 'launching', text, rawDetected: signals.intent.launching }).buyerIntentValid : false)

  let score = 0

  if (aiBuyerProbability !== undefined) {
    score = aiBuyerProbability * 100
    if (aiBuyerProbability >= 0.7) evidence.push('AI: Strong buyer signal')
    else if (aiBuyerProbability >= 0.4) evidence.push('AI: Moderate buyer signal')
  }

  if (verifiedExplicit) { score = Math.min(100, score + 25); evidence.push('Explicit buyer request (verified)') }
  if (verifiedHiring && signals.intent.hiringUrgency === 'immediate') { score = Math.min(100, score + 20); evidence.push('Urgent hiring (verified)') }
  else if (verifiedHiring) { score = Math.min(100, score + 10); evidence.push('Hiring (verified)') }
  if (verifiedVendor) { score = Math.min(100, score + 15); evidence.push('Seeking vendor (verified)') }
  if (verifiedBudget) { score = Math.min(100, score + 10); evidence.push('Budget stated (verified)') }
  if (verifiedAsking) { score = Math.min(100, score + 12); evidence.push('Asking for help (verified)') }
  if (verifiedLaunch) { score = Math.min(100, score + 8); evidence.push(`Launching (verified): ${signals.intent.launchedProduct ?? 'product'}`) }

  if (evidence.length === 0) evidence.push('No verified buyer signal')

  return {
    key: 'buyerIntent',
    label: 'Buyer Intent',
    score: Math.round(score),
    weight: WEIGHTS.buyerIntent,
    weighted: Math.round(score * WEIGHTS.buyerIntent),
    evidence,
    confidence: evidence.length >= 3 ? 'high' : evidence.length >= 1 ? 'medium' : 'low',
  }
}

function hiringIsVerified(input: CompositeScoreInput): boolean {
  const { signals } = input
  const rawDetected = signals.intent.hiring || signals.company.hiringCount > 0
  if (!rawDetected) return false
  const verified = input.provenance?.hiring?.verifiedClaim
  if (verified !== undefined) return verified
  // No source text to check against: keep the extractor's reading.
  if (!input.rawText) return signals.intent.hiring
  return verifyBuyerSignal({ signalType: 'hiring', text: input.rawText, rawDetected }).buyerIntentValid
}

function scoreCompanyQuality(input: CompositeScoreInput): CompositeDimension {
  const { signals } = input
  const evidence: string[] = []
  let score = 40

  // Size matters — mid-size companies have budget and need
  if (signals.company.sizeCategory === 'mid') {
    score += 20
    evidence.push('Mid-size company — has budget')
  } else if (signals.company.sizeCategory === 'enterprise') {
    score += 15
    evidence.push('Enterprise — large budgets')
  } else if (signals.company.sizeCategory === 'startup') {
    score += 10
    evidence.push('Startup — agile, can move fast')
  }

  // Funding signals
  if (signals.company.fundingMentioned) {
    score += 15
    evidence.push(`Funding: ${signals.company.fundingStage ?? 'mentioned'}`)
  }

  // Growth signals
  if (signals.company.growthSignals.length > 0) {
    score += signals.company.growthSignals.length * 5
    evidence.push(...signals.company.growthSignals.slice(0, 2))
  }

  // Hiring velocity
  // Quantified credit only for a count the source states; generic hiring
  // earns generic credit and never shows an invented number.
  // Hiring credit of any kind needs the prospect's own, current hiring — the
  // same provenance check buyer intent uses, so "via @founder: they are
  // hiring 3" earns nothing while "we have 6 open positions" does.
  const hiringVerified = hiringIsVerified(input)
  const statedHiring = signals.company.hiringCount > 0 && hiringVerified
  if (statedHiring && signals.company.hiringCount >= 3) {
    score += 15
    evidence.push(`Hiring ${signals.company.hiringCount} roles (stated in source)`)
  } else if (statedHiring) {
    score += 8
    evidence.push(`Hiring ${signals.company.hiringCount} role${signals.company.hiringCount === 1 ? '' : 's'} (stated in source)`)
  } else if (signals.company.isHiring && hiringVerified) {
    score += 8
    evidence.push('Hiring (no role count stated)')
  }

  // Industry fit
  if (signals.company.industry) {
    score += 5
    evidence.push(`Industry: ${signals.company.industry}`)
  }

  if (evidence.length === 0) evidence.push('Limited company data')

  return {
    key: 'companyQuality',
    label: 'Company',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.companyQuality,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.companyQuality),
    evidence,
    confidence: evidence.length >= 3 ? 'high' : evidence.length >= 1 ? 'medium' : 'low',
  }
}

function scorePersonAuthority(input: CompositeScoreInput): CompositeDimension {
  const { signals } = input
  const evidence: string[] = []
  let score = 40

  // Seniority
  if (signals.person.seniority === 'executive') {
    score += 30
    evidence.push('Executive — can decide')
  } else if (signals.person.seniority === 'senior') {
    score += 20
    evidence.push('Senior — influences decisions')
  } else if (signals.person.seniority === 'mid') {
    score += 10
    evidence.push('Mid-level — may influence')
  }

  // Decision maker
  if (signals.person.isDecisionMaker) {
    score += 15
    evidence.push('Decision-making role')
  }

  // Founder (highest authority)
  if (signals.person.isFounder) {
    score += 20
    evidence.push('Founder — ultimate decision maker')
  }

  // Connection count (proxy for engagement/visibility)
  if (signals.person.connectionCount !== null) {
    if (signals.person.connectionCount >= 500) {
      score += 10
      evidence.push('500+ connections — active networker')
    } else if (signals.person.connectionCount >= 100) {
      score += 5
      evidence.push(`${signals.person.connectionCount} connections`)
    }
  }

  if (evidence.length === 0) evidence.push('Unknown seniority/role')

  return {
    key: 'personAuthority',
    label: 'Authority',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.personAuthority,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.personAuthority),
    evidence,
    confidence: signals.person.name ? 'high' : 'medium',
  }
}

function scoreCapabilityFit(input: CompositeScoreInput): CompositeDimension {
  const { signals, aiFitLevel, senderCapabilities = [] } = input
  const evidence: string[] = []
  let score = 50

  // AI fit assessment
  const fitScores: Record<string, number> = {
    EXCELLENT: 95, STRONG: 80, MEDIUM: 55, WEAK: 30, POOR: 15, UNKNOWN: 50,
  }
  if (aiFitLevel) {
    score = fitScores[aiFitLevel] ?? 50
    if (aiFitLevel === 'EXCELLENT' || aiFitLevel === 'STRONG') {
      evidence.push(`AI: ${aiFitLevel.toLowerCase()} fit`)
    }
  }

  // Deterministic tech stack overlap
  const theirTech = [
    ...signals.technology.languages,
    ...signals.technology.frameworks,
    ...signals.technology.platforms,
  ].map((t) => t.toLowerCase())

  const myCaps = senderCapabilities.map((c) => c.toLowerCase())
  const overlap = theirTech.filter((t) => myCaps.some((c) => c.includes(t) || t.includes(c)))

  if (overlap.length >= 3) {
    score = Math.min(100, score + 20)
    evidence.push(`Strong tech overlap: ${overlap.slice(0, 3).join(', ')}`)
  } else if (overlap.length >= 1) {
    score = Math.min(100, score + 10)
    evidence.push(`Tech overlap: ${overlap.join(', ')}`)
  }

  // Domain match
  if (signals.technology.domains.length > 0) {
    score = Math.min(100, score + 5)
    evidence.push(`Domains: ${signals.technology.domains.slice(0, 3).join(', ')}`)
  }

  if (evidence.length === 0) evidence.push('No tech stack data available')

  return {
    key: 'capabilityFit',
    label: 'Fit',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.capabilityFit,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.capabilityFit),
    evidence,
    confidence: overlap.length > 0 ? 'high' : 'medium',
  }
}

function scoreTiming(input: CompositeScoreInput): CompositeDimension {
  const { signals } = input
  const evidence: string[] = []
  let score = 40

  // Recency
  if (signals.timing.recency === 'fresh') {
    score += 30
    evidence.push('Very recent activity (< 24h)')
  } else if (signals.timing.recency === 'recent') {
    score += 20
    evidence.push('Recent activity (< 7 days)')
  } else if (signals.timing.recency === 'stale') {
    score -= 15
    evidence.push('Stale — may no longer be relevant')
  }

  // Urgency
  if (signals.timing.hasUrgencyWords) {
    score += 15
    evidence.push(`Urgent timing detected`)
  }

  // Budget cycle
  if (signals.timing.budgetCycleMentioned) {
    score += 10
    evidence.push('Budget cycle mentioned')
  }

  // Timeline
  if (signals.timing.timelineMentioned) {
    score += 8
    evidence.push(`Timeline: ${signals.timing.timelineMentioned}`)
  }

  if (evidence.length === 0) evidence.push('No timing signals')

  return {
    key: 'timing',
    label: 'Timing',
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: WEIGHTS.timing,
    weighted: Math.round(Math.max(0, Math.min(100, score)) * WEIGHTS.timing),
    evidence,
    confidence: signals.timing.recency !== 'unknown' ? 'high' : 'low',
  }
}

function scoreAccess(input: CompositeScoreInput): CompositeDimension {
  const { signals, aiAccessLevel } = input
  const evidence: string[] = []
  let score = 30

  // AI access assessment
  const accessScores: Record<string, number> = { DIRECT: 95, CONNECTION: 70, INDIRECT: 40, NONE: 10 }
  if (aiAccessLevel) {
    score = accessScores[aiAccessLevel] ?? 30
  }

  // Deterministic access signals
  if (signals.access.isFirstDegree) {
    score = Math.min(100, score + 10)
    evidence.push('1st degree connection')
  }
  if (signals.access.canMessage) {
    score = Math.min(100, score + 10)
    evidence.push('Can message directly')
  }
  if (signals.access.hasEmail) {
    score = Math.min(100, score + 10)
    evidence.push('Email available')
  }
  if (signals.access.profileComplete) {
    score = Math.min(100, score + 5)
    evidence.push('Complete profile')
  }

  if (evidence.length === 0) evidence.push('Access level unknown')

  return {
    key: 'access',
    label: 'Access',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.access,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.access),
    evidence,
    confidence: signals.access.isFirstDegree ? 'high' : 'medium',
  }
}

function scoreProof(input: CompositeScoreInput): CompositeDimension {
  const { proofScore = 0.5 } = input
  const evidence: string[] = []
  const score = proofScore * 100

  if (proofScore >= 0.7) evidence.push('Strong proof match')
  else if (proofScore >= 0.4) evidence.push('Some proof match')
  else evidence.push('No relevant proof matched')

  return {
    key: 'proof',
    label: 'Proof',
    score: Math.round(score),
    weight: WEIGHTS.proof,
    weighted: Math.round(score * WEIGHTS.proof),
    evidence,
    confidence: proofScore > 0 ? 'medium' : 'low',
  }
}

function scoreRelationship(input: CompositeScoreInput): CompositeDimension {
  const { signals } = input
  const evidence: string[] = []
  let score = 30

  if (signals.access.mutualConnections !== null && signals.access.mutualConnections > 5) {
    score += 30
    evidence.push(`${signals.access.mutualConnections} mutual connections`)
  } else if (signals.access.mutualConnections !== null) {
    score += 15
    evidence.push(`${signals.access.mutualConnections} mutual connections`)
  }

  return {
    key: 'relationship',
    label: 'Relationship',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.relationship,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.relationship),
    evidence: evidence.length > 0 ? evidence : ['No mutual connections'],
    confidence: 'medium',
  }
}

function scoreEngagement(input: CompositeScoreInput): CompositeDimension {
  const { signals } = input
  const evidence: string[] = []
  let score = 30

  if (signals.access.profileComplete) {
    score += 20
    evidence.push('Complete profile — active on platform')
  }
  if (signals.person.connectionCount !== null && signals.person.connectionCount >= 100) {
    score += 15
    evidence.push('Active networker')
  }

  return {
    key: 'engagement',
    label: 'Engagement',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.engagement,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.engagement),
    evidence: evidence.length > 0 ? evidence : ['Unknown engagement'],
    confidence: 'low',
  }
}

function scoreCompetitiveGap(input: CompositeScoreInput): CompositeDimension {
  const { signals } = input
  const evidence: string[] = []
  let score = 30

  // Only award competitive-gap points when the vendor signal is verified
  const verifiedVendor = input.provenance?.seekingVendor?.verifiedClaim ?? false
  if (verifiedVendor || signals.intent.seekingVendor) {
    score += 30
    evidence.push(verifiedVendor ? 'Actively seeking vendor (verified)' : 'Possible vendor search (unverified)')
  }
  if (signals.technology.stackComplexity === 'complex') {
    score += 15
    evidence.push('Complex stack — likely underserved')
  }

  return {
    key: 'competitiveGap',
    label: 'Opportunity',
    score: Math.round(Math.min(100, score)),
    weight: WEIGHTS.competitiveGap,
    weighted: Math.round(Math.min(100, score) * WEIGHTS.competitiveGap),
    evidence: evidence.length > 0 ? evidence : ['No clear competitive gap'],
    confidence: 'low',
  }
}


function getCompositeLabel(score: number): string {
  if (score >= 80) return 'Strong opportunity'
  if (score >= 65) return 'Worth pursuing'
  if (score >= 50) return 'Maybe — needs research'
  if (score >= 35) return 'Weak fit'
  return 'Not a fit'
}

function getCompositeQualification(score: number): CompositeScore['qualification'] {
  if (score >= 70) return 'STRONG'
  if (score >= 55) return 'WORTH_PURSUING'
  if (score >= 40) return 'MAYBE'
  return 'SKIP'
}

function determineAction(
  total: number,
  input: CompositeScoreInput,
  dims: CompositeDimension[],
): CompositeScore['recommendedAction'] {
  const buyerScore = dims.find((d) => d.key === 'buyerIntent')?.score ?? 0
  const accessScore = dims.find((d) => d.key === 'access')?.score ?? 0

  if (total >= 65 && buyerScore >= 60) return 'CONTACT_NOW'
  if (total >= 50 && accessScore >= 50) return 'CONNECT_WITH_NOTE'
  if (total >= 40) return 'CONNECT_WITHOUT_NOTE'
  if (total >= 30) return 'OBSERVE'
  return 'SKIP'
}
