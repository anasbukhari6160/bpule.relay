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


function computeTimingScore(episode: V3OpportunityEpisode, decision: V3BoundedDecision): number {
  const modelTiming = TIMING_SCORES[decision.timing] ?? 0.4
  const ageTiming = episode.ageDays === null
    ? 0.5
    : episode.ageDays <= 7 ? 1.0
    : episode.ageDays <= 14 ? 0.8
    : episode.ageDays <= 30 ? 0.6
    : episode.ageDays <= 45 ? 0.4
    : episode.ageDays <= 90 ? 0.2
    : 0.05
  return Math.round((modelTiming * 0.6 + ageTiming * 0.4) * 100) / 100
}

function timingNote(episode: V3OpportunityEpisode, score: number): string {
  if (episode.ageDays === null) return 'Timing uncertain'
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
}

export interface V3ScoreDimension {
  key: string
  label: string
  contribution: number  // weighted contribution to final score
  raw: number           // raw 0-1 value
  weight: number
  note: string
}

const RECRUITER_HEADER = /\b(?:it recruiter|technical recruiter|tech recruiter|recruiter|rekruter(?:ka)?|talent acquisition|sourcer|headhunter)\b/i
const EXTERNAL_PURCHASE = /\b(?:looking for|need|seeking|hire)\b[\s\S]{0,80}\b(?:agency|vendor|outsourc\w*|development partner|software partner|external team|staff augmentation)\b/i

function employerHiringNotPurchase(input: V3ScoreInput): boolean {
  const text = input.rawText ?? ''
  if (EXTERNAL_PURCHASE.test(text)) return false
  const header = text.split('\n').slice(0, 15).join('\n')
  if (RECRUITER_HEADER.test(header)) return true
  return input.episode.anchorEvent?.eventType === 'HIRING' && !input.episode.explicitRequest
}

export function scoreEpisode(input: V3ScoreInput): V3ScoreOutput {
  const { episode, decision } = input
  const proofRelevance = input.proofRelevance ?? 0.5
  const evidenceQuality = input.evidenceQuality ?? 0.5
  const reasons: string[] = []
  const watchOut: string[] = []
  const dimensions: V3ScoreDimension[] = []

  // Employer hiring, including a recruiter's own role, is not a vendor purchase.
  // A high buyer request needs positive external-buying evidence.
  const capBuyer = employerHiringNotPurchase(input)
  const buyerRaw = capBuyer
    ? Math.min(decision.buyerRequestProbability, 0.2)
    : decision.buyerRequestProbability
  const buyerContribution = buyerRaw * V3_SCORING_WEIGHTS.buyerRequestProbability * 100
  dimensions.push({
    key: 'buyerRequest',
    label: 'Buyer Request',
    contribution: buyerContribution,
    raw: buyerRaw,
    weight: V3_SCORING_WEIGHTS.buyerRequestProbability,
    note: capBuyer
      ? 'Employer hiring. Buying intent is unproven until there is a request to buy services.'
      : buyerRaw >= 0.7
        ? 'Strong buyer request signal'
        : buyerRaw >= 0.4
          ? 'Moderate buyer signal'
          : 'Weak or no buyer request',
  })
  if (!capBuyer && buyerRaw >= 0.7) reasons.push('Explicit buyer request detected')
  if (buyerRaw < 0.3) watchOut.push(capBuyer
    ? 'Buying intent is unproven. Employer hiring is not a request to buy services. Research before treating this as a buyer.'
    : 'No clear buyer request signal')

  // Separated from buyer intent. A founder building a product can have
  // buyerIntent=UNKNOWN but commercialPotential=HIGH.
  const cpRaw = computeCommercialPotentialScore(input.commercialPotential)
  const cpContribution = cpRaw * V3_SCORING_WEIGHTS.commercialPotential * 100
  dimensions.push({
    key: 'commercialPotential',
    label: 'Commercial Potential',
    contribution: cpContribution,
    raw: cpRaw,
    weight: V3_SCORING_WEIGHTS.commercialPotential,
    note: cpRaw >= 0.6
      ? 'Strong commercial potential — worth pursuing'
      : cpRaw >= 0.3
        ? 'Moderate commercial potential'
        : 'Limited commercial potential',
  })
  if (cpRaw >= 0.5 && decision.buyerRequestProbability < 0.4) {
    reasons.push('High commercial potential despite no explicit buyer request')
  }

  const needOwnerRelevance = NEED_OWNER_BUYER_RELEVANCE[episode.needOwnerType] ?? 0.4
  const externalRaw = decision.externalNeedProbability * needOwnerRelevance
  const externalContribution = externalRaw * V3_SCORING_WEIGHTS.externalNeedProbability * 100
  dimensions.push({
    key: 'externalNeed',
    label: 'External Need',
    contribution: externalContribution,
    raw: externalRaw,
    weight: V3_SCORING_WEIGHTS.externalNeedProbability,
    note: externalRaw >= 0.6 ? 'Clear external need' : 'Need signal weak or internal-only',
  })

  const fitRaw = FIT_SCORES[decision.fit] ?? 0.5
  const fitContribution = fitRaw * V3_SCORING_WEIGHTS.fit * 100
  dimensions.push({
    key: 'fit',
    label: 'Capability Fit',
    contribution: fitContribution,
    raw: fitRaw,
    weight: V3_SCORING_WEIGHTS.fit,
    note: `Fit: ${decision.fit}`,
  })
  if (fitRaw >= 0.8) reasons.push('Strong capability fit')

  const timingRaw = computeTimingScore(episode, decision)
  const timingContribution = timingRaw * V3_SCORING_WEIGHTS.timing * 100
  dimensions.push({
    key: 'timing',
    label: 'Timing',
    contribution: timingContribution,
    raw: timingRaw,
    weight: V3_SCORING_WEIGHTS.timing,
    note: timingNote(episode, timingRaw),
  })
  if (timingRaw >= 0.8) reasons.push('Current/recent opportunity')
  if (timingRaw <= 0.3) watchOut.push('Event may be stale or expired')

  const accessRaw = ACCESS_SCORES[decision.access] ?? 0.3
  const accessContribution = accessRaw * V3_SCORING_WEIGHTS.access * 100
  dimensions.push({
    key: 'access',
    label: 'Access',
    contribution: accessContribution,
    raw: accessRaw,
    weight: V3_SCORING_WEIGHTS.access,
    note: `Access: ${decision.access}`,
  })
  if (accessRaw >= 0.7) reasons.push('Direct access available')

  const proofContribution = proofRelevance * V3_SCORING_WEIGHTS.proofRelevance * 100
  dimensions.push({
    key: 'proofRelevance',
    label: 'Proof Relevance',
    contribution: proofContribution,
    raw: proofRelevance,
    weight: V3_SCORING_WEIGHTS.proofRelevance,
    note: proofRelevance >= 0.6 ? 'Relevant proof available' : 'Weak proof match',
  })

  const evidenceContribution = evidenceQuality * V3_SCORING_WEIGHTS.evidenceQuality * 100
  dimensions.push({
    key: 'evidenceQuality',
    label: 'Evidence Quality',
    contribution: evidenceContribution,
    raw: evidenceQuality,
    weight: V3_SCORING_WEIGHTS.evidenceQuality,
    note: evidenceQuality >= 0.6 ? 'Good evidence quality' : 'Limited evidence',
  })

  const statusMultiplier = EPISODE_STATUS_SCORES[episode.status] ?? 0.5
  if (statusMultiplier < 1.0) {
    watchOut.push(`Episode status: ${episode.status}`)
  }

  const relContext = RELATIONSHIP_CONTEXT[decision.relationship] ?? RELATIONSHIP_CONTEXT.UNKNOWN
  // Relationship multiplier is dampened when commercial potential is high.
  // A service provider building a real product has commercial worth independent
  // relationship penalty and 1.0 based on commercial potential strength.
  const cpStrength = cpRaw // 0-1
  const relationshipMultiplier = (buyerRaw >= 0.5)
    ? 1.0
    : relContext.multiplier + (1.0 - relContext.multiplier) * cpStrength * 0.7

  if (relationshipMultiplier < 1.0 && buyerRaw < 0.5) {
    watchOut.push(`Primary role: ${decision.relationship} (context, not gate)`)
  }

  const rawTotal = dimensions.reduce((sum, d) => sum + d.contribution, 0)
  const adjustedTotal = rawTotal * statusMultiplier * relationshipMultiplier
  let score = Math.round(Math.max(0, Math.min(100, adjustedTotal)))

  // signals from the composite scorer. This catches signals the AI missed
  // (tech stack overlap, company growth, hiring velocity, etc.)
  if (input.rawText && input.rawText.length > 50) {
    try {
      const signals = extractSignals(input.rawText)
      const composite = computeCompositeScore({
        aiBuyerProbability: buyerRaw,
        aiFitLevel: decision.fit,
        aiAccessLevel: decision.access,
        aiIntentLevel: buyerRaw >= 0.6 ? 'HIGH' : buyerRaw >= 0.3 ? 'MEDIUM' : 'LOW',
        signals,
        proofScore: input.proofRelevance,
        senderCapabilities: input.senderCapabilities,
      })

      // Blend: 60% V3 (AI context) + 40% composite (deterministic signals)
      const v3Weight = score >= 70 || score <= 20 ? 0.7 : 0.5
      const compositeWeight = 1 - v3Weight
      score = Math.round(score * v3Weight + composite.total * compositeWeight)

      const topCompositeEvidence = composite.dimensions
        .filter((d) => d.score >= 60)
        .flatMap((d) => d.evidence)
        .filter((e) => !reasons.includes(e))
        .slice(0, 3)
      reasons.push(...topCompositeEvidence)

      for (const dim of composite.dimensions) {
        if (!dimensions.find((d) => d.key === dim.key)) {
          dimensions.push({
            key: dim.key,
            label: dim.label,
            contribution: dim.weighted,
            raw: dim.score / 100,
            weight: dim.weight,
            note: dim.evidence[0] || '',
          })
        }
      }
    } catch {
      // Composite scoring is best-effort; V3 score stands alone
    }
  }

  if (capBuyer) {
    for (let i = reasons.length - 1; i >= 0; i--) {
      if (/explicit buyer request|strong buyer signal/i.test(reasons[i])) reasons.splice(i, 1)
    }
  }

  let { label, qualification } = getScoreLabel(score)
  let finalReasons = reasons

  // Founders/CEOs with active building get upgraded qualification and score
  // so they're eligible for connection notes (relationship-building, not pitch)
  if (isHighPotentialBuilderEpisode(input) && qualification === 'SKIP') {
    score = Math.max(42, score)
    label = 'Worth connecting'
    qualification = 'MAYBE'
    finalReasons = ['High commercial potential — worth connecting']
  }

  return {
    score,
    label,
    qualification,
    reasons: finalReasons,
    watchOut,
    dimensions,
  }
}


export function scoreAllEpisodes(
  inputs: V3ScoreInput[],
): V3MultiEpisodeResult {
  const episodeScores: V3EpisodeScore[] = []

  for (const input of inputs) {
    const result = scoreEpisode(input)
    const isBuilder = isHighPotentialBuilderEpisode(input)
    // Builders with high commercial potential get upgraded qualification
    // so the display score reflects their value (not just buyer intent)
    const qualification = isBuilder && result.qualification === 'SKIP' ? 'MAYBE' : result.qualification
    episodeScores.push({
      episodeId: input.episode.id,
      score: isBuilder ? Math.max(42, result.score) : result.score,
      label: isBuilder ? 'Worth connecting' : result.label,
      qualification,
      action: isBuilder ? 'CONNECT_WITH_NOTE' : deriveAction(result.score, input),
      messageEligible: (result.score >= 40 && result.qualification !== 'SKIP') || isBuilder,
      reasons: isBuilder ? ['High commercial potential — worth connecting'] : result.reasons,
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

// A founder/CEO/CTO with high commercial potential is eligible for a
// connection note even with low buyer-intent score. Connection notes earn
// access — they don't pitch. This aligns V3 eligibility with the revenue
// strategy's builder-connection path.

function isHighPotentialBuilderEpisode(input: V3ScoreInput): boolean {
  const cp = input.commercialPotential
  if (!cp) return false

  // Use the computed commercial potential score (matches the dimension score)
  const cpScore = computeCommercialPotentialScore(cp)
  const isHighCommercialPotential = cpScore >= 0.5

  // Founder/CEO/CTO title in raw text as additional signal
  const rawText = input.rawText ?? ''
  const hasFounderTitle = /(ceo|cto|cfo|founder|co[- ]?founder|owner|president|managing director)/i.test(rawText)

  return isHighCommercialPotential || (hasFounderTitle && cpScore >= 0.35)
}


// Maps V3 0-100 score to a 0-10 display value using qualification bands
// rather than blind division. V3 42 ("Maybe" / CONTACT_NOW) → 5/10 (medium),
// not 4/10 (which reads as "very weak" and contradicts the action).
export function v3ToDisplay(score: number, messageEligible?: boolean): number {
  // show at least medium score so reps don't skip based on low buyer-intent score
  if (score >= 80) return 9
  if (score >= 60) return 7
  if (score >= 40) return 5
  if (score >= 20) return messageEligible ? 4 : 3
  return messageEligible ? 3 : 1
}
