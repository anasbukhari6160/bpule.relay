/**
 * Canonical Decision Packet Assembly — V3.2
 *
 * Assembles the single LeadDecisionPacket from:
 * - SourceFacts (read once)
 * - the evidence graph + opportunity episodes
 * - the bounded decision from the provider (guarded, then projected onto the
 *   canonical buyer decision)
 * - the canonical score (seven dimensions, no multipliers)
 * - confidence (separate from the score)
 * - the recommended action (one policy)
 *
 * This is the ONE commercial truth. No downstream layer re-interprets raw
 * source; the packet carries the facts, the rejected signals and every
 * version that produced it.
 */

import type {
  V3LeadDecisionPacket,
  V3OpportunityEpisode,
  V3BoundedDecision,
  V3ShadowComparison,
  V3EvidenceQuote,
  V3Event,
} from '../types'
import type { V3EvidenceGraph } from '../graph/evidence-graph'
import { scoreEpisode, type V3ScoreInput, type V3ScoreOutput } from '../scoring/score-v3'
import { isVerbatimInSource } from '../source-facts'
import { NORMALIZED_ANSWER_CONFIDENCE_CAP, type V3ProviderResult } from './decision-provider'
import { resolveVerifiedBuyerIntent, type VerifiedBuyerIntent } from '../buyer-intent'
import { summarizeSourceFacts, type SourceFacts } from '../source-facts-model'
import { computeConfidence } from '../dimensions'
import { deriveRecommendedAction } from '../action/recommended-action'
import { currentVersions, SCORING_VERSION } from '../versions'
import { ROUTING_VERSION } from '@/lib/relay/sender-routing-engine'

export interface V3AssemblerInput {
  graph: V3EvidenceGraph
  episodes: V3OpportunityEpisode[]
  providerResult: V3ProviderResult
  /** Current production score (for shadow comparison) */
  productionScore?: number
  productionAction?: string
  productionDecision?: string
  /** @deprecated sender data never enters the opportunity decision. */
  senderCapabilities?: string[]
  /** @deprecated */
  proofRelevanceMap?: Record<string, number>
  /** @deprecated */
  evidenceQualityMap?: Record<string, number>
  /** Raw source text, for verbatim quote verification only. */
  rawText?: string
  /** The canonical facts, read once by the caller with readSourceFacts. Required. */
  sourceFacts: SourceFacts
  /** Organization capability set for fit. */
  orgCapabilities?: string[]
  /** The episode the provider's bounded answers were produced for. */
  decidedEpisodeId?: string | null
  /** Where events came from, for the trace. */
  eventSource?: 'model' | 'deterministic' | 'none'
}

export interface V3AssemblerOutput {
  packet: V3LeadDecisionPacket
  selectedEpisode: V3OpportunityEpisode | null
  episodeScores: Array<{ episodeId: string; score: number }>
}

export async function assembleDecisionPacket(input: V3AssemblerInput): Promise<V3AssemblerOutput> {
  const { graph, providerResult, productionScore, productionAction, productionDecision } = input
  const rawText = input.rawText ?? ''
  if (!input.sourceFacts) throw new Error('assembleDecisionPacket: sourceFacts are required — read them once with readSourceFacts.')
  const facts = input.sourceFacts

  // Every profile has at least one opportunity context to score, even when
  // no event was found: the organization itself. Without this, "no events"
  // became score 0, which is not what "unknown" means.
  const episodes = input.episodes.length > 0 ? input.episodes : [profileEpisode(graph, facts)]

  const rawDecidedEpisode = input.decidedEpisodeId
    ? episodes.find((e) => e.id === input.decidedEpisodeId) ?? null
    : null
  const { decision: guarded, adjustments: decisionAdjustments } = guardBoundedDecision(
    buildBoundedDecision(providerResult),
    facts,
    rawDecidedEpisode,
  )

  // ONE buyer decision for the whole packet. The deterministic fallback is
  // not a second opinion — when no model ran, the resolver sees no model.
  const modelRan = providerResult.providerId !== 'deterministic_fallback'
  const buyerIntent = resolveVerifiedBuyerIntent(facts.buyer, {
    modelBuyerProbability: modelRan ? guarded.buyerRequestProbability : null,
    modelExternalNeedProbability: modelRan ? guarded.externalNeedProbability : null,
    modelRelationship: modelRan ? guarded.relationship : null,
    signalCheck: {
      explicitAsk: facts.signals.intent.explicitAsk,
      seekingVendor: facts.signals.intent.seekingVendor,
      hiring: facts.signals.intent.hiring,
      budgetMentioned: facts.signals.intent.budgetMentioned,
    },
  })
  const decision = projectBuyerIntent(guarded, buyerIntent, decisionAdjustments)

  // An episode is only an explicit request when the canonical decision verified one.
  const projectedEpisodes = episodes.map((e) =>
    e.explicitRequest && !buyerIntent.verifiedBuyerRequest ? { ...e, explicitRequest: false } : e,
  )
  const decidedEpisode = rawDecidedEpisode
    ? projectedEpisodes.find((e) => e.id === rawDecidedEpisode.id) ?? null
    : null
  const quotesFor = (episode: V3OpportunityEpisode) => verbatimEpisodeQuotes(episode, graph, rawText)

  // Score every episode with the shared facts and buyer decision.
  const episodeScores: Array<{ episodeId: string; score: number }> = []
  const outputs = new Map<string, V3ScoreOutput>()
  for (const episode of projectedEpisodes) {
    const out = scoreEpisode({
      episode,
      decision,
      sourceFacts: facts,
      buyerIntent,
      episodeQuotes: quotesFor(episode),
      orgCapabilities: input.orgCapabilities,
    })
    outputs.set(episode.id, out)
    episodeScores.push({ episodeId: episode.id, score: out.score })
  }

  // Selection: the decided episode when it is open; else the best open episode;
  // else the first episode (closed episodes still produce a packet, marked SKIP).
  let bestEpisode: V3OpportunityEpisode | null = null
  if (decidedEpisode && decidedEpisode.status !== 'CLOSED') bestEpisode = decidedEpisode
  if (!bestEpisode) {
    const open = projectedEpisodes.filter((e) => e.status !== 'CLOSED')
    const pool = open.length > 0 ? open : projectedEpisodes
    bestEpisode = pool.reduce<V3OpportunityEpisode | null>((best, e) => {
      if (!best) return e
      return (outputs.get(e.id)?.score ?? 0) > (outputs.get(best.id)?.score ?? 0) ? e : best
    }, null)
  }
  const selectedScore = (bestEpisode ? outputs.get(bestEpisode.id) : null) ?? emptyScore()
  const resolved = selectedScore.resolved!

  // Confidence — separate from the score.
  const fallbackUsed = providerResult.providerId === 'deterministic_fallback'
  const confidence = computeConfidence({
    facts,
    intent: buyerIntent,
    evidenceQuality: resolved.evidenceQuality.raw,
    timing: resolved.timing,
    access: resolved.access,
    decision,
    providerConfidence: providerResult.confidence,
    fallbackUsed,
  })
  if (providerResult.normalizedFields && providerResult.normalizedFields.length > 0) {
    decisionAdjustments.push(`Model answers normalized (${providerResult.normalizedFields.join(', ')}): invalid values replaced by safe defaults; confidence capped.`)
  }
  if (resolved.access.overrode) decisionAdjustments.push(`Access ${resolved.access.modelLevel ?? 'unspecified'} → ${resolved.access.level}: ${resolved.access.reasons[0] ?? 'source facts decide access'}.`)
  if (resolved.timing.urgencyRejected) decisionAdjustments.push(`Timing ${resolved.timing.modelTiming} → ${resolved.timing.buyerTiming}: no buyer deadline or current verified request in the source.`)
  if (resolved.fit.modelLevel && resolved.fit.level !== resolved.fit.modelLevel) decisionAdjustments.push(`Fit ${resolved.fit.modelLevel} → ${resolved.fit.level}: ${resolved.fit.note}.`)

  // The one action policy (cold context here; live/sender overlays are applied by the surfaces that have them).
  const cpLevel = resolved.commercialPotential.overallPotential
  const recommended = deriveRecommendedAction({
    opportunity: {
      score: selectedScore.score,
      qualification: selectedScore.qualification,
      buyerIntentLevel: buyerIntent.buyerIntentLevel,
      verifiedBuyerRequest: buyerIntent.verifiedBuyerRequest,
      relationshipRole: buyerIntent.relationshipRole,
      access: resolved.access.level,
      buyerTiming: resolved.timing.buyerTiming,
      activityRecency: resolved.timing.activityRecency,
      commercialPotential: cpLevel,
      episodeClosed: bestEpisode?.status === 'CLOSED' || buyerIntent.terminalState !== null,
    },
    confidence: { label: confidence.label, researchMore: confidence.researchMore },
    channel: 'linkedin',
  })

  const shadowComparison: V3ShadowComparison | null = productionScore !== undefined
    ? {
        productionScore,
        productionAction: productionAction ?? 'UNKNOWN',
        v3Score: selectedScore.score,
        v3Action: recommended.legacyAction,
        scoreDelta: selectedScore.score - productionScore,
        actionChanged: recommended.legacyAction !== productionAction,
        productionDecision: productionDecision ?? null,
      }
    : null

  const latentPotential = buyerIntent.verifiedBuyerRequest ? null : toLatentLevel(cpLevel)

  // Hard guard at the packet boundary: a score that is not a finite number
  // never leaves here. It fails closed (0, SKIP, no message, zero
  // confidence) and says so in the adjustments, instead of surfacing NaN.
  const scoreIsFinite = Number.isFinite(selectedScore.score)
  if (!scoreIsFinite) decisionAdjustments.push('Score guard: the computed score was not a finite number; failed closed to 0 / SKIP.')
  const guardedScore = scoreIsFinite ? Math.max(0, Math.min(100, selectedScore.score)) : 0
  const answersNormalized = Boolean(providerResult.normalizedFields && providerResult.normalizedFields.length > 0)
  const guardedConfidence = Number.isFinite(confidence.value)
    ? Math.max(0, Math.min(answersNormalized ? NORMALIZED_ANSWER_CONFIDENCE_CAP : 1, confidence.value))
    : 0

  const packet: V3LeadDecisionPacket = {
    version: 'relay_decision_v3',
    decisionRunId: generateDecisionRunId(),
    selectedEpisodeId: bestEpisode?.id ?? null,
    episodes: projectedEpisodes,
    decision,
    score: guardedScore,
    scoreVersion: SCORING_VERSION,
    label: scoreIsFinite ? selectedScore.label : 'Score unavailable',
    qualification: scoreIsFinite ? selectedScore.qualification : 'SKIP',
    action: scoreIsFinite ? recommended.legacyAction : 'SKIP',
    messageEligible: scoreIsFinite ? recommended.messageEligible : false,
    reasons: selectedScore.reasons,
    watchOut: selectedScore.watchOut,
    dimensions: selectedScore.dimensions,
    scoreCalculation: selectedScore.calculation ?? null,
    decisionAdjustments,
    evidenceQuotes: bestEpisode ? episodeEvidenceQuotes(bestEpisode, graph, rawText) : [],
    evidenceRefs: bestEpisode?.evidenceRefs ?? [],
    proofStrength: 0,
    confidence: guardedConfidence,
    decisionProvider: providerResult.providerId,
    decisionModel: providerResult.modelVersion,
    shadowComparison,
    latentPotential,
    latentSignals: resolved.commercialPotential.signals,
    buyerIntent,
    orgContext: {
      currentIndustry: facts.currentIndustry,
      currentIndustryLine: facts.currentIndustryLine,
      currentProductActivity: facts.currentProductActivity,
    },
    versions: currentVersions({ routingVersion: ROUTING_VERSION, modelVersion: providerResult.modelVersion }),
    sourceFacts: summarizeSourceFacts(facts),
    resolved: {
      access: resolved.access.level,
      activityRecency: resolved.timing.activityRecency,
      buyerTiming: resolved.timing.buyerTiming,
      fit: resolved.fit.level,
      authority: resolved.authority.level,
      commercialPotential: cpLevel,
      commercialPotentialRaw: resolved.commercialPotential.raw,
      evidenceQuality: resolved.evidenceQuality.raw,
    },
    confidenceDetail: { label: confidence.label, reasons: confidence.reasons, researchMore: confidence.researchMore },
    recommendedAction: recommended,
    fallbackUsed,
    eventSource: input.eventSource ?? (input.episodes.length > 0 ? 'model' : 'none'),
  }

  return { packet, selectedEpisode: bestEpisode, episodeScores }
}

function toLatentLevel(level: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (level === 'HIGH' || level === 'VERY_HIGH') return 'HIGH'
  if (level === 'MEDIUM') return 'MEDIUM'
  return 'LOW'
}

/** Synthetic episode for a profile with no detected events: the current organization itself. */
export function profileEpisode(graph: V3EvidenceGraph, facts: SourceFacts): V3OpportunityEpisode {
  const org = Array.from(graph.organizations.values())[0] ?? null
  const now = new Date().toISOString()
  const ageDays = facts.recentPostAgeDays
  const status: V3OpportunityEpisode['status'] = ageDays === null ? 'UNKNOWN' : ageDays < 14 ? 'CURRENT' : ageDays < 45 ? 'AGING' : ageDays < 90 ? 'STALE' : 'CLOSED'
  const anchorEvent: V3Event = {
    id: 'evt_profile',
    eventType: facts.currentProductActivity ? 'TECHNICAL_BUILD' : 'OTHER',
    personId: Array.from(graph.persons.keys())[0] ?? null,
    organizationId: org?.id ?? null,
    organizationName: org?.name ?? facts.currentCompany ?? null,
    occurredAt: null,
    channel: null,
    requestedCapability: [],
    targetAudience: 'PUBLIC',
    explicitness: 'INFERRED',
    applyInstructions: [],
    evidenceRefs: [],
    polarity: 'ACTIVE',
  }
  return {
    id: 'ep_profile',
    anchorEvent,
    organizationId: org?.id ?? null,
    organizationName: org?.name ?? facts.currentCompany ?? null,
    needOwnerPersonId: anchorEvent.personId,
    needOwnerType: 'UNKNOWN',
    explicitRequest: false,
    requestedCapabilities: [],
    applicationChannels: [],
    evidenceRefs: [],
    eventRefs: [anchorEvent.id],
    // A profile with no dated activity is UNKNOWN, never CLOSED — unknown is not negative.
    status: status === 'CLOSED' ? 'STALE' : status,
    detectedAt: now,
    lastActivityAt: null,
    ageDays,
  }
}

function emptyScore(): V3ScoreOutput & { resolved: NonNullable<V3ScoreOutput['resolved']> } {
  throw new Error('assembleDecisionPacket: no episode was scored')
}

const BUYER_CAP = 0.2

/**
 * Write the canonical buyer decision into the bounded decision, so every
 * reader of `packet.decision` sees one buyer truth. Each change and each
 * scorer contradiction is recorded for the debug trace.
 */
export function projectBuyerIntent(
  decision: V3BoundedDecision,
  intent: VerifiedBuyerIntent,
  adjustments: string[],
): V3BoundedDecision {
  const next = { ...decision }
  if (Math.abs(next.buyerRequestProbability - intent.effectiveBuyerProbability) > 0.005) {
    adjustments.push(`Buyer request ${next.buyerRequestProbability.toFixed(2)} → ${intent.effectiveBuyerProbability.toFixed(2)}: canonical buyer decision (${intent.buyerIntentLevel}${intent.verifiedBuyerRequest ? ', verified request' : ', no verified request'}).`)
    next.buyerRequestProbability = intent.effectiveBuyerProbability
  }
  if (Math.abs(next.externalNeedProbability - intent.effectiveExternalNeedProbability) > 0.005) {
    adjustments.push(`External need ${next.externalNeedProbability.toFixed(2)} → ${intent.effectiveExternalNeedProbability.toFixed(2)}: ${intent.verifiedExternalNeed ? 'verified request for outside help' : 'no verified request for outside help'}.`)
    next.externalNeedProbability = intent.effectiveExternalNeedProbability
  }
  if (next.relationship === 'BUYER' && !intent.verifiedBuyerRequest) {
    const role = intent.relationshipRole === 'SELLER' ? 'SERVICE_PROVIDER' : intent.relationshipRole === 'CANDIDATE' ? 'CANDIDATE' : 'UNKNOWN'
    adjustments.push(`Relationship BUYER → ${role}: no verified request to buy${intent.relationshipRole === 'SELLER' ? '; the source is seller-side promotion' : ''}.`)
    next.relationship = role
  }
  for (const c of intent.contradictions) adjustments.push(`Contradiction (audit): ${c}`)
  return next
}

/**
 * Deterministic guards on the model's bounded answers. The model is a
 * classifier over one episode; these rules hold regardless of its output and
 * every change is recorded so the response explains it.
 *
 * Consumes the canonical `SourceFacts` only. The safety rules it enforces
 * (employee hiring is not a purchase, candidate-seeking is not a buyer, a
 * contact invitation opens access) are read from the one reader, never
 * re-derived from raw text here.
 */
export function guardBoundedDecision(
  decision: V3BoundedDecision,
  facts: SourceFacts,
  episode: V3OpportunityEpisode | null,
): { decision: V3BoundedDecision; adjustments: string[] } {
  const adjustments: string[] = []
  const next = { ...decision }

  const externalRequest = facts.buyer.externalServiceRequest !== null
  const candidateSeeking = facts.buyer.candidateSeeking
  const employmentHiringNotPurchase =
    !externalRequest
    && (facts.buyer.employmentHiring !== null
      || candidateSeeking
      || (episode?.anchorEvent?.eventType === 'HIRING' && !episode.explicitRequest))

  if (employmentHiringNotPurchase) {
    if (candidateSeeking) {
      if (next.relationship === 'BUYER' || next.relationship === 'UNKNOWN') {
        adjustments.push('Relationship → CANDIDATE: prospect is seeking opportunities, not buying services.')
        next.relationship = 'CANDIDATE'
      }
      if (next.buyerRequestProbability > 0.1) {
        adjustments.push('Buyer request capped at 0.1: candidate-seeking language detected.')
        next.buyerRequestProbability = 0.1
      }
      if (next.needOwnerType === 'ORGANIZATION_NEED' || next.needOwnerType === 'UNKNOWN') {
        next.needOwnerType = 'UNKNOWN'
      }
    } else {
      if (next.buyerRequestProbability > BUYER_CAP) {
        adjustments.push(`Buyer request capped at ${BUYER_CAP.toFixed(2)} (model: ${decision.buyerRequestProbability.toFixed(2)}): employee hiring with no request to an external provider.`)
        next.buyerRequestProbability = BUYER_CAP
      }
      if (next.externalNeedProbability > BUYER_CAP) {
        adjustments.push(`External need capped at ${BUYER_CAP.toFixed(2)} (model: ${decision.externalNeedProbability.toFixed(2)}): the need is filled by hiring, not outside help.`)
        next.externalNeedProbability = BUYER_CAP
      }
      if (next.relationship === 'BUYER') {
        adjustments.push('Relationship BUYER → UNKNOWN: recruiting an employee is not buying services.')
        next.relationship = 'UNKNOWN'
      }
      if (next.needOwnerType !== 'HIRING_NEED' && (next.needOwnerType === 'ORGANIZATION_NEED' || next.needOwnerType === 'UNKNOWN')) {
        adjustments.push(`Need owner ${next.needOwnerType} → HIRING_NEED: the source describes employee recruitment.`)
        next.needOwnerType = 'HIRING_NEED'
      }
    }
  } else if (externalRequest && next.needOwnerType === 'HIRING_NEED') {
    adjustments.push('Need owner HIRING_NEED → ORGANIZATION_NEED: the source asks for an external provider, not employees.')
    next.needOwnerType = 'ORGANIZATION_NEED'
  }

  const contact = employmentHiringNotPurchase ? null : facts.access.contactLine
  if (contact && (next.access === 'NONE' || next.access === 'INDIRECT')) {
    adjustments.push(`Access ${next.access} → CONNECTION: the source invites contact ("${contact.slice(0, 100)}").`)
    next.access = 'CONNECTION'
  }

  return { decision: next, adjustments }
}

function verbatimEpisodeQuotes(episode: V3OpportunityEpisode, graph: V3EvidenceGraph, rawText: string | undefined): string[] {
  return episodeEvidenceQuotes(episode, graph, rawText).filter((q) => q.verbatim).map((q) => q.quote)
}

function episodeEvidenceQuotes(episode: V3OpportunityEpisode, graph: V3EvidenceGraph, rawText: string | undefined): V3EvidenceQuote[] {
  const seen = new Set<string>()
  const out: V3EvidenceQuote[] = []
  for (const id of episode.evidenceRefs) {
    const ev = graph.evidence.get(id)
    const q = ev?.quote?.trim()
    if (!ev || !q || seen.has(q.toLowerCase())) continue
    seen.add(q.toLowerCase())
    out.push({
      quote: q,
      verbatim: isVerbatimInSource(q, rawText ?? ''),
      sourceType: ev.sourceType,
      needOwner: ev.needOwner,
    })
  }
  return out
}

function buildBoundedDecision(result: V3ProviderResult): V3BoundedDecision {
  return {
    relationship: result.answers.relationship,
    buyerRequestProbability: result.answers.buyerRequestProbability,
    externalNeedProbability: result.answers.externalNeedProbability,
    needOwnerType: result.answers.needOwner,
    fit: result.answers.fit,
    timing: result.answers.timing,
    access: result.answers.access,
    messageEligible: result.answers.messageEligible,
    providerConfidence: result.confidence,
  }
}

function generateDecisionRunId(): string {
  return `v3run_${Date.now().toString(36)}`
}
