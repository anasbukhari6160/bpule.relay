/**
 * Score Engine V3
 *
 * Scores OPPORTUNITY EPISODES, not persons.
 *
 * Principles:
 * - Score each episode independently
 * - Best active episode = lead display score
 * - No global identity penalties that zero unrelated episodes
 * - Timing and intent are SEPARATE dimensions
 * - Commercial potential is SEPARATE from buyer intent
 * - Service provider status is context, not a gate
 * - Configurable weights, one versioned config
 */

import type {
  V3OpportunityEpisode,
  V3BoundedDecision,
  V3EpisodeScore,
  V3MultiEpisodeResult,
  V3EpisodeStatus,
  CommercialPotentialAssessment,
} from '../types'
import {
  V3_SCORING_WEIGHTS,
  FIT_SCORES,
  TIMING_SCORES,
  ACCESS_SCORES,
  EPISODE_STATUS_SCORES,
  RELATIONSHIP_CONTEXT,
  NEED_OWNER_BUYER_RELEVANCE,
} from '../config'
import { extractSignals } from '@/lib/scoring/signal-extractor'
import { computeCompositeScore } from '@/lib/scoring/composite-scorer'
import type { SignalProvenance } from '@/lib/scoring/buyer-provenance'
import type { V3DimensionEvidence, V3DimensionGroup, V3ScoreCalculation, V3ScoreCalculationStep } from '../types'
import {
  detectCommercialRequest,
  extractStatedBudget,
  extractStatedTimeline,
  findContactInstruction,
  findLineMentioning,
  type StatedTimeline,
} from '../source-facts'


/** How soon a source-stated start/deadline is, as a 0-1 timing value. */
function statedTimelineTiming(timeline: StatedTimeline): number {
  if (timeline.days <= 14) return 1.0
  if (timeline.days <= 30) return 0.85
  if (timeline.days <= 90) return 0.6
  return 0.35
}

function computeTimingScore(
  episode: V3OpportunityEpisode,
  decision: V3BoundedDecision,
  timeline: StatedTimeline | null,
): number {
  const modelTiming = TIMING_SCORES[decision.timing] ?? 0.4
  // A post date is the strongest recency evidence; without one, a start
  // date stated in the source is used instead of the neutral 0.5.
  const ageTiming = episode.ageDays === null
    ? (timeline ? statedTimelineTiming(timeline) : 0.5)
    : episode.ageDays <= 7 ? 1.0
    : episode.ageDays <= 14 ? 0.8
    : episode.ageDays <= 30 ? 0.6
    : episode.ageDays <= 45 ? 0.4
    : episode.ageDays <= 90 ? 0.2
    : 0.05
  return Math.round((modelTiming * 0.6 + ageTiming * 0.4) * 100) / 100
}

function timingNote(episode: V3OpportunityEpisode, timeline: StatedTimeline | null): string {
  if (episode.ageDays === null) {
    return timeline ? `Start stated in source: ${timeline.label}` : 'Timing uncertain — no post date or start date in the source'
  }
  if (episode.ageDays <= 7) return `Current (${episode.ageDays}d ago)`
  if (episode.ageDays <= 30) return `Recent (${episode.ageDays}d ago)`
  if (episode.ageDays <= 60) return `Aging (${episode.ageDays}d ago)`
  return `Stale (${episode.ageDays}d ago)`
}

function computeCommercialPotentialScore(cp?: CommercialPotentialAssessment): number {
  if (!cp) return 0
  const BUILD_INTENSITY_SCORES: Record<string, number> = {
    NONE: 0, LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8, VERY_HIGH: 1.0,
  }
  const buildScore = BUILD_INTENSITY_SCORES[cp.buildIntensity] ?? 0
  const raw = (
    cp.decisionAuthority * 0.25 +
    buildScore * 0.25 +
    cp.technicalRelevance * 0.15 +
    cp.capacityNeedLikelihood * 0.15 +
    cp.reachability * 0.10 +
    cp.companyMaturity * 0.10
  )
  switch (cp.overallPotential) {
    case 'HIGH': return Math.max(0.5, Math.min(1.0, raw))
    case 'MEDIUM': return Math.max(0.25, Math.min(0.7, raw))
    case 'LOW': return Math.min(0.3, raw)
    default: return 0
  }
}

function deriveAction(score: number, input: V3ScoreInput): V3EpisodeScore['action'] {
  const explicitBuyer = input.episode.explicitRequest && input.decision.buyerRequestProbability >= 0.6
  const directAccess = input.decision.access === 'DIRECT'
  if (score >= 70 && explicitBuyer && directAccess) return 'CONTACT_NOW'
  if (score >= 60 && explicitBuyer) return 'CONNECT_WITH_NOTE'
  if (score >= 50) return 'CONNECT_WITH_NOTE'
  if (score >= 35) return 'CONNECT_WITHOUT_NOTE'
  if (score >= 20) return 'OBSERVE'
  return 'SKIP'
}

function getScoreLabel(score: number): { label: string; qualification: V3ScoreOutput['qualification'] } {
  if (score >= 80) return { label: 'Strong opportunity', qualification: 'STRONG' }
  if (score >= 60) return { label: 'Worth pursuing', qualification: 'WORTH_PURSUING' }
  if (score >= 40) return { label: 'Maybe — needs more signal', qualification: 'MAYBE' }
  if (score >= 20) return { label: 'Weak fit', qualification: 'SKIP' }
  return { label: 'Not a fit', qualification: 'SKIP' }
}


export interface V3ScoreInput {
  episode: V3OpportunityEpisode
  decision: V3BoundedDecision
  /** Sender proof relevance for this episode's capabilities (0-1) */
  proofRelevance?: number
  /** Overall evidence quality (0-1) */
  evidenceQuality?: number
  /** Raw source text for deterministic signal extraction (enriches score) */
  rawText?: string
  /** Sender capabilities for fit assessment */
  senderCapabilities?: string[]
  /** Commercial potential assessment (separate from buyer intent) */
  commercialPotential?: CommercialPotentialAssessment
  /** Verbatim source quotes attached to this episode, for row evidence */
  episodeQuotes?: string[]
  /** Pre-computed provenance per signal — if omitted, scoreEpisode derives it */
  provenance?: Record<string, SignalProvenance>
}

export interface V3ScoreOutput {
  /** Final 0-100 score */
  score: number
  label: string
  qualification: 'STRONG' | 'WORTH_PURSUING' | 'MAYBE' | 'SKIP' | 'INELIGIBLE'
  reasons: string[]
  watchOut: string[]
  /** Per-dimension breakdown */
  dimensions: V3ScoreDimension[]
  /** How the rows became the final score — every multiplier, blend and floor. */
  calculation?: V3ScoreCalculation
}

export interface V3ScoreDimension {
  key: string
  label: string
  contribution: number  // weighted contribution to final score
  raw: number           // raw 0-1 value
  weight: number
  note: string
  /** model = sums to the model subtotal; signals = deterministic check blended into the total */
  group?: V3DimensionGroup
  /** Source quotes or detected signals behind this row; inference when nothing in the text supports it */
  evidence?: V3DimensionEvidence[]
}

const RECRUITER_HEADER = /\b(?:it recruiter|technical recruiter|tech recruiter|recruiter|rekruter(?:ka)?|talent acquisition|sourcer|headhunter)\b/i

/**
 * Employee recruitment is not a purchase of outside services. A buyer
 * request needs a positive request to an external provider (agency, vendor,
 * contractor, outsourced team) somewhere in the source.
 */
export function isEmploymentHiringNotPurchase(
  rawText: string | undefined,
  episode?: Pick<V3OpportunityEpisode, 'anchorEvent' | 'explicitRequest'> | null,
): boolean {
  const text = rawText ?? ''
  const facts = detectCommercialRequest(text)
  if (facts.externalServiceRequest) return false
  if (facts.employmentHiring) return true
  const header = text.split('\n').slice(0, 15).join('\n')
  if (RECRUITER_HEADER.test(header)) return true
  return episode?.anchorEvent?.eventType === 'HIRING' && !episode.explicitRequest
}

const BUYER_CAP = 0.2

function quote(line: string | null | undefined): V3DimensionEvidence[] {
  return line ? [{ text: line, kind: 'quote' }] : []
}

function inference(text: string): V3DimensionEvidence[] {
  return [{ text, kind: 'inference' }]
}

function fmt(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits)
}

export function scoreEpisode(input: V3ScoreInput): V3ScoreOutput {
  const { episode, decision } = input
  const rawText = input.rawText ?? ''
  const proofRelevance = input.proofRelevance ?? 0.5
  const evidenceQuality = input.evidenceQuality ?? 0.5
  const reasons: string[] = []
  const watchOut: string[] = []
  const dimensions: V3ScoreDimension[] = []
  const steps: V3ScoreCalculationStep[] = []

  const facts = detectCommercialRequest(rawText)
  const budget = extractStatedBudget(rawText)
  const timeline = extractStatedTimeline(rawText)
  const contact = findContactInstruction(rawText)
  const episodeQuotes = (input.episodeQuotes ?? []).filter(Boolean)

  // Employer hiring, including a recruiter's own role, is not a vendor purchase.
  const capBuyer = isEmploymentHiringNotPurchase(rawText, episode)
  const buyerRaw = capBuyer
    ? Math.min(decision.buyerRequestProbability, BUYER_CAP)
    : decision.buyerRequestProbability
  dimensions.push({
    key: 'buyerRequest',
    label: 'Buyer Request',
    contribution: buyerRaw * V3_SCORING_WEIGHTS.buyerRequestProbability * 100,
    raw: buyerRaw,
    weight: V3_SCORING_WEIGHTS.buyerRequestProbability,
    group: 'model',
    note: capBuyer
      ? 'Recruitment activity detected; external-service buying need not verified.'
      : buyerRaw >= 0.7
        ? 'Explicit request to an external provider'
        : buyerRaw >= 0.4
          ? 'Moderate buyer signal'
          : 'Weak or no buyer request',
    evidence: facts.externalServiceRequest
      ? quote(facts.externalServiceRequest.line)
      : capBuyer && facts.employmentHiring
        ? quote(facts.employmentHiring.line)
        : episodeQuotes.length > 0
          ? episodeQuotes.slice(0, 1).map((text) => ({ text, kind: 'quote' as const }))
          : inference('Model judgement — no request line found in the source'),
  })
  if (!capBuyer && buyerRaw >= 0.7) reasons.push('Explicit buyer request detected')
  if (capBuyer) reasons.push('Recruitment activity detected; external-service buying need not verified')
  if (buyerRaw < 0.3) watchOut.push(capBuyer
    ? 'Buying intent is unproven. Employee hiring is not a request to buy services. Research before treating this as a buyer.'
    : 'No clear buyer request signal')

  // Separated from buyer intent. A founder building a product can have
  // buyerIntent=UNKNOWN but commercialPotential=HIGH. A budget stated in the
  // source is direct evidence of commercial value and sets a floor.
  const assessedCp = computeCommercialPotentialScore(input.commercialPotential)
  const budgetFloor = budget ? (budget.approved ? 0.6 : 0.5) : 0
  const cpRaw = Math.max(assessedCp, budgetFloor)
  dimensions.push({
    key: 'commercialPotential',
    label: 'Commercial Potential',
    contribution: cpRaw * V3_SCORING_WEIGHTS.commercialPotential * 100,
    raw: cpRaw,
    weight: V3_SCORING_WEIGHTS.commercialPotential,
    group: 'model',
    note: [
      budget ? `Budget stated: ${budget.amount}${budget.approved ? ' (approved)' : ''}.` : null,
      cpRaw >= 0.6
        ? 'Strong commercial potential.'
        : cpRaw >= 0.3
          ? 'Moderate commercial potential.'
          : 'Limited commercial potential.',
      budget && budgetFloor > assessedCp ? `Floor ${fmt(budgetFloor)} applied for the stated budget (profile assessment ${fmt(assessedCp)}).` : null,
    ].filter(Boolean).join(' '),
    evidence: budget
      ? quote(budget.line)
      : (input.commercialPotential?.signals?.length ?? 0) > 0
        ? input.commercialPotential!.signals.slice(0, 3).map((text): V3DimensionEvidence => ({ text, kind: 'signal' }))
        : inference('Assessed from role and company context; no budget in the source'),
  })
  if (budget) reasons.push(`Budget stated: ${budget.amount}${budget.approved ? ' (approved)' : ''}`)
  if (cpRaw >= 0.5 && decision.buyerRequestProbability < 0.4) {
    reasons.push('High commercial potential despite no explicit buyer request')
  }

  const needOwnerRelevance = NEED_OWNER_BUYER_RELEVANCE[episode.needOwnerType] ?? 0.4
  const externalProb = capBuyer ? Math.min(decision.externalNeedProbability, BUYER_CAP) : decision.externalNeedProbability
  const externalRaw = externalProb * needOwnerRelevance
  dimensions.push({
    key: 'externalNeed',
    label: 'External Need',
    contribution: externalRaw * V3_SCORING_WEIGHTS.externalNeedProbability * 100,
    raw: externalRaw,
    weight: V3_SCORING_WEIGHTS.externalNeedProbability,
    group: 'model',
    note: externalRaw >= 0.6 ? 'Clear external need' : capBuyer ? 'Need is internal hiring, not outside help' : 'Need signal weak or internal-only',
    evidence: facts.externalServiceRequest
      ? quote(facts.externalServiceRequest.line)
      : inference('No request for outside help in the source'),
  })

  const fitRaw = FIT_SCORES[decision.fit] ?? 0.5
  const capabilityLine = findLineMentioning(rawText, episode.requestedCapabilities)
  dimensions.push({
    key: 'fit',
    label: 'Capability Fit',
    contribution: fitRaw * V3_SCORING_WEIGHTS.fit * 100,
    raw: fitRaw,
    weight: V3_SCORING_WEIGHTS.fit,
    group: 'model',
    note: `Fit: ${decision.fit}${episode.requestedCapabilities.length > 0 ? ` for ${episode.requestedCapabilities.slice(0, 4).join(', ')}` : ''}`,
    evidence: capabilityLine
      ? quote(capabilityLine.line)
      : inference('Model fit assessment; no requested capability named in the source'),
  })
  if (fitRaw >= 0.8) reasons.push('Strong capability fit')

  const timingRaw = computeTimingScore(episode, decision, timeline)
  dimensions.push({
    key: 'timing',
    label: 'Timing',
    contribution: timingRaw * V3_SCORING_WEIGHTS.timing * 100,
    raw: timingRaw,
    weight: V3_SCORING_WEIGHTS.timing,
    group: 'model',
    note: timingNote(episode, timeline),
    evidence: timeline
      ? quote(timeline.line)
      : episode.ageDays !== null
        ? [{ text: `Post dated ${episode.ageDays}d ago`, kind: 'signal' }]
        : inference('No post date or start date in the source'),
  })
  if (timeline && timeline.days <= 30) reasons.push(`Start stated: ${timeline.label}`)
  else if (timingRaw >= 0.8) reasons.push('Current/recent opportunity')
  if (timingRaw <= 0.3) watchOut.push('Event may be stale or expired')

  const accessRaw = ACCESS_SCORES[decision.access] ?? 0.3
  dimensions.push({
    key: 'access',
    label: 'Access',
    contribution: accessRaw * V3_SCORING_WEIGHTS.access * 100,
    raw: accessRaw,
    weight: V3_SCORING_WEIGHTS.access,
    group: 'model',
    note: `Access: ${decision.access}`,
    evidence: contact ? quote(contact.line) : inference('No contact or apply instruction in the source'),
  })
  if (accessRaw >= 0.7) reasons.push('Direct access available')

  dimensions.push({
    key: 'proofRelevance',
    label: 'Proof Relevance',
    contribution: proofRelevance * V3_SCORING_WEIGHTS.proofRelevance * 100,
    raw: proofRelevance,
    weight: V3_SCORING_WEIGHTS.proofRelevance,
    group: 'model',
    note: proofRelevance >= 0.6 ? 'Relevant proof available' : 'Weak proof match',
    evidence: inference('Matched against your proof library, not the prospect text'),
  })

  dimensions.push({
    key: 'evidenceQuality',
    label: 'Evidence Quality',
    contribution: evidenceQuality * V3_SCORING_WEIGHTS.evidenceQuality * 100,
    raw: evidenceQuality,
    weight: V3_SCORING_WEIGHTS.evidenceQuality,
    group: 'model',
    note: evidenceQuality >= 0.6 ? 'Good evidence quality' : 'Limited evidence',
    evidence: [{ text: `${episode.evidenceRefs.length} evidence item(s) attached to this opportunity`, kind: 'signal' }],
  })

  const modelSubtotal = dimensions.reduce((sum, d) => sum + d.contribution, 0)
  steps.push({
    label: 'Opportunity model subtotal',
    value: `${fmt(modelSubtotal)}/100`,
    detail: 'Sum of the eight weighted model rows.',
  })

  // An undated episode is uncertain, unless the source itself states a
  // near-term start — that is direct evidence the opportunity is live.
  const timelineMakesCurrent = episode.status === 'UNKNOWN' && timeline !== null && timeline.days <= 45
  const effectiveStatus = timelineMakesCurrent ? 'CURRENT' : episode.status
  const statusMultiplier = EPISODE_STATUS_SCORES[effectiveStatus] ?? 0.5
  if (statusMultiplier < 1.0) {
    watchOut.push(episode.status === 'UNKNOWN'
      ? 'Episode status: UNKNOWN — no post date or start date in the source'
      : `Episode status: ${episode.status}`)
  }
  steps.push({
    label: 'Episode status',
    value: `×${fmt(statusMultiplier)}`,
    detail: timelineMakesCurrent
      ? `Treated as CURRENT: the source states "${timeline!.label}".`
      : statusMultiplier < 1
        ? `${episode.status} episode${episode.status === 'UNKNOWN' ? ' (no post date or start date in the source)' : ''}.`
        : 'Current episode, no reduction.',
  })

  const relContext = RELATIONSHIP_CONTEXT[decision.relationship] ?? RELATIONSHIP_CONTEXT.UNKNOWN
  // Relationship multiplier is dampened when commercial potential is high:
  // a service provider building a real product has commercial worth of its own.
  const relationshipMultiplier = (buyerRaw >= 0.5)
    ? 1.0
    : relContext.multiplier + (1.0 - relContext.multiplier) * cpRaw * 0.7
  if (relationshipMultiplier < 1.0 && buyerRaw < 0.5) {
    watchOut.push(`Primary role: ${decision.relationship} (context, not gate)`)
  }
  steps.push({
    label: 'Relationship context',
    value: `×${fmt(relationshipMultiplier)}`,
    detail: relationshipMultiplier < 1
      ? `${decision.relationship} relationship without a strong buyer request.`
      : 'No reduction.',
  })

  const modelScore = Math.round(Math.max(0, Math.min(100, modelSubtotal * statusMultiplier * relationshipMultiplier)))
  steps.push({
    label: 'Model score',
    value: `${modelScore}/100`,
    detail: `${fmt(modelSubtotal)} × ${fmt(statusMultiplier)} × ${fmt(relationshipMultiplier)}, rounded.`,
  })
  let score = modelScore
  let signalCheckTotal: number | null = null
  let modelWeight = 1

  // Blend in deterministic signals from the composite scorer. This catches
  // signals the model missed (tech overlap, company growth, hiring velocity).
  if (rawText.length > 50) {
    try {
      const signals = extractSignals(rawText)
      const composite = computeCompositeScore({
        aiBuyerProbability: buyerRaw,
        aiFitLevel: decision.fit,
        aiAccessLevel: decision.access,
        aiIntentLevel: buyerRaw >= 0.6 ? 'HIGH' : buyerRaw >= 0.3 ? 'MEDIUM' : 'LOW',
        signals,
        proofScore: input.proofRelevance,
        senderCapabilities: input.senderCapabilities,
        rawText,
        provenance: input.provenance,
      })

      modelWeight = score >= 70 || score <= 20 ? 0.7 : 0.5
      signalCheckTotal = composite.total
      score = Math.round(score * modelWeight + composite.total * (1 - modelWeight))
      steps.push({
        label: 'Signal check blend',
        value: `${score}/100`,
        detail: `${Math.round(modelWeight * 100)}% model score ${modelScore} + ${Math.round((1 - modelWeight) * 100)}% signal check ${composite.total}, rounded.`,
      })

      const topCompositeEvidence = composite.dimensions
        .filter((d) => d.score >= 60)
        .flatMap((d) => d.evidence)
        .filter((e) => !reasons.includes(e) && !(capBuyer && /buyer signal|asking for help|seeking vendor/i.test(e)))
        .slice(0, 3)
      reasons.push(...topCompositeEvidence)

      for (const dim of composite.dimensions) {
        dimensions.push({
          key: `signal_${dim.key}`,
          label: dim.label,
          contribution: dim.weighted,
          raw: dim.score / 100,
          weight: dim.weight,
          group: 'signals',
          note: dim.evidence[0] || '',
          evidence: dim.evidence.map((text) => ({ text, kind: 'signal' as const })),
        })
      }
    } catch {
      // Composite scoring is best-effort; the model score stands alone.
    }
  }

  if (capBuyer) {
    for (let i = reasons.length - 1; i >= 0; i--) {
      if (/explicit buyer request|strong buyer signal|AI: (?:strong|moderate) buyer/i.test(reasons[i])) reasons.splice(i, 1)
    }
  }

  let { label, qualification } = getScoreLabel(score)
  let finalReasons = reasons
  let floorApplied: number | null = null

  // Builder floor removed: corrected dimensions (commercialPotential,
  // decisionAuthority, buildIntensity) now naturally produce scores in the
  // 40-60 range for high-potential founders, mapping to MAYBE/CONNECT actions.
  if (episode.status === 'CLOSED' && qualification !== 'SKIP') {
    qualification = 'SKIP'
    finalReasons = ['Episode closed — not resurrected']
  }

  return {
    score,
    label,
    qualification,
    reasons: [...new Set(finalReasons)],
    watchOut,
    dimensions,
    calculation: {
      modelSubtotal: Math.round(modelSubtotal * 100) / 100,
      statusMultiplier,
      relationshipMultiplier: Math.round(relationshipMultiplier * 100) / 100,
      modelScore,
      signalCheckTotal,
      modelWeight,
      floorApplied,
      finalScore: score,
      steps,
    },
  }
}


export function scoreAllEpisodes(
  inputs: V3ScoreInput[],
): V3MultiEpisodeResult {
  const episodeScores: V3EpisodeScore[] = []

  for (const input of inputs) {
    const result = scoreEpisode(input)
    const isClosed = input.episode.status === 'CLOSED'
    // Builder floor removed: dimensions produce natural scores for builders.
    const qualification = result.qualification
    episodeScores.push({
      episodeId: input.episode.id,
      score: result.score,
      label: result.label,
      qualification,
      action: deriveAction(result.score, input),
      messageEligible: result.score >= 40 && qualification !== 'SKIP' && !isClosed,
      reasons: result.reasons,
    })
  }

  // Best active episode score = lead display score
  const activeEpisodes = episodeScores.filter((es) => {
    const input = inputs.find((i) => i.episode.id === es.episodeId)
    return input && input.episode.status !== 'CLOSED'
  })

  const bestActive = activeEpisodes.length > 0
    ? activeEpisodes.reduce((best, current) => current.score > best.score ? current : best)
    : episodeScores[0] ?? null

  return {
    episodes: episodeScores,
    bestActiveScore: bestActive?.score ?? 0,
    bestActiveEpisodeId: bestActive?.episodeId ?? null,
  }
}




