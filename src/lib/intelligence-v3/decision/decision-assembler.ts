/**
 * Canonical Decision Packet Assembly — V3
 *
 * Assembles the single LeadDecisionPacket from:
 * - Extracted evidence graph
 * - Built opportunity episodes
 * - Bounded decision from provider
 * - Score from scoring engine
 * - Action from action policy
 *
 * This is the ONE commercial truth. All downstream surfaces consume this.
 * No downstream layer independently re-interprets raw source.
 */

import type {
  V3LeadDecisionPacket,
  V3OpportunityEpisode,
  V3BoundedDecision,
  V3ShadowComparison,
  CommercialPotentialAssessment,
  V3EvidenceQuote,
} from '../types'
import type { V3EvidenceGraph } from '../graph/evidence-graph'
import { V3_CONFIG_VERSION } from '../config'
import { scoreEpisode, isEmploymentHiringNotPurchase, isCandidateSeeking, type V3ScoreInput, type V3ScoreOutput } from '../scoring/score-v3'
import { detectCommercialRequest, findContactInstruction, isVerbatimInSource } from '../source-facts'
import { determineAction } from '../action/action-policy'
import type { V3ProviderResult } from './decision-provider'
import {
  assessLatentOpportunity,
  assessCommercialPotential,
  computeLatentScore,
  latentActionFromPotential,
} from '../latent-opportunity'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import { readBuyerSourceFacts, resolveVerifiedBuyerIntent, type VerifiedBuyerIntent } from '../buyer-intent'
import { resolveCurrentOrgContext } from '../current-org'
import { extractSignals } from '@/lib/scoring/signal-extractor'

// Defined before use to avoid hoisting issues with Next.js build checker.

function scopeCommercialPotentialToOrg(
  cp: CommercialPotentialAssessment,
  orgName: string,
  graph: V3EvidenceGraph,
): CommercialPotentialAssessment {
  const orgEvidences = Array.from(graph.evidence.values()).filter(
    e => e.subjectOrganizationName?.toLowerCase() === orgName.toLowerCase()
  )

  if (orgEvidences.length === 0) return cp

  const orgText = orgEvidences.map(e => e.quote).join(' ').toLowerCase()
  const hasProductBuilding = /\b(launch|product|platform|saas|mvp|beta|building|developing)\b/.test(orgText)
  const hasServiceOffering = /\b(agency|services|help companies|we build for|client work|outsourcing)\b/.test(orgText)

  if (hasProductBuilding && !hasServiceOffering) {
    return {
      ...cp,
      buildIntensity: cp.buildIntensity,
      signals: cp.signals.filter(s =>
        !s.toLowerCase().includes('service') || s.toLowerCase().includes('product')
      ),
    }
  }

  return cp
}

export interface V3AssemblerInput {
  graph: V3EvidenceGraph
  episodes: V3OpportunityEpisode[]
  providerResult: V3ProviderResult
  /** Current production score (for shadow comparison) */
  productionScore?: number
  productionAction?: string
  productionDecision?: string
  /** Sender capabilities for proof relevance */
  senderCapabilities?: string[]
  /** Proof relevance per episode */
  proofRelevanceMap?: Record<string, number>
  /** Evidence quality per episode */
  evidenceQualityMap?: Record<string, number>
  /** V2 canonical intelligence for latent opportunity assessment */
  v2Canonical?: CanonicalProspectIntelligence
  /** Raw source text for latent signal scanning */
  rawText?: string
  /**
   * The episode the provider's bounded answers were produced for. The
   * decision only describes that episode, so it is the one scored and
   * reported — re-ranking other episodes with the same answers let an
   * inferred hiring episode outscore the explicit request it came from.
   */
  decidedEpisodeId?: string | null
}

export interface V3AssemblerOutput {
  packet: V3LeadDecisionPacket
  /** Episode that was selected (best active) */
  selectedEpisode: V3OpportunityEpisode | null
  /** All episode scores */
  episodeScores: Array<{ episodeId: string; score: number }>
}

export async function assembleDecisionPacket(input: V3AssemblerInput): Promise<V3AssemblerOutput> {
  const {
    graph,
    episodes,
    providerResult,
    productionScore,
    productionAction,
    productionDecision,
    senderCapabilities = [],
    proofRelevanceMap = {},
    evidenceQualityMap = {},
    rawText,
  } = input

  const rawDecidedEpisode = input.decidedEpisodeId
    ? episodes.find((e) => e.id === input.decidedEpisodeId) ?? null
    : null
  const { decision: guarded, adjustments: decisionAdjustments } = guardBoundedDecision(
    buildBoundedDecision(providerResult),
    rawText,
    rawDecidedEpisode,
  )

  // ONE buyer decision for the whole packet. The model's and the signal
  // check's claims go in as an audit; what comes out is the only buyer
  // intent any scorer, action rule or surface may read.
  const signals = rawText && rawText.length > 50 ? extractSignals(rawText) : null
  const buyerIntent = resolveVerifiedBuyerIntent(readBuyerSourceFacts(rawText ?? ''), {
    modelBuyerProbability: guarded.buyerRequestProbability,
    modelExternalNeedProbability: guarded.externalNeedProbability,
    modelRelationship: guarded.relationship,
    signalCheck: signals ? {
      explicitAsk: signals.intent.explicitAsk,
      seekingVendor: signals.intent.seekingVendor,
      hiring: signals.intent.hiring,
      budgetMentioned: signals.intent.budgetMentioned,
    } : null,
  })
  const decision = projectBuyerIntent(guarded, buyerIntent, decisionAdjustments)
  const orgContext = resolveCurrentOrgContext(rawText ?? '')
  // An episode is only an explicit request when the canonical decision verified one.
  const projectedEpisodes = episodes.map((e) =>
    e.explicitRequest && !buyerIntent.verifiedBuyerRequest ? { ...e, explicitRequest: false } : e,
  )
  const decidedEpisode = rawDecidedEpisode
    ? projectedEpisodes.find((e) => e.id === rawDecidedEpisode.id) ?? null
    : null
  const quotesFor = (episode: V3OpportunityEpisode) => verbatimEpisodeQuotes(episode, graph, rawText)

  // Assess commercial potential once (deterministic, no AI call)
  let commercialPotential = null
  if (input.v2Canonical) {
    commercialPotential = await assessCommercialPotential(input.v2Canonical, rawText)
  }

  // Score each episode
  const episodeScores: Array<{ episodeId: string; score: number }> = []
  let bestEpisode: V3OpportunityEpisode | null = null
  let bestScore = -1

  for (const episode of projectedEpisodes) {
    const scoreInput: V3ScoreInput = {
      episode,
      decision,
      proofRelevance: proofRelevanceMap[episode.id] ?? estimateProofRelevance(episode, senderCapabilities),
      evidenceQuality: evidenceQualityMap[episode.id] ?? estimateEvidenceQuality(episode, graph),
      rawText,
      buyerIntent,
      episodeQuotes: quotesFor(episode),
      commercialPotential: episode.organizationName && commercialPotential
        ? scopeCommercialPotentialToOrg(commercialPotential, episode.organizationName, graph)
        : commercialPotential ?? undefined,
    }

    const scoreOutput = scoreEpisode(scoreInput)
    episodeScores.push({ episodeId: episode.id, score: scoreOutput.score })

    // Without a decided episode, the best active episode wins.
    if (!decidedEpisode && episode.status !== 'CLOSED' && scoreOutput.score > bestScore) {
      bestScore = scoreOutput.score
      bestEpisode = episode
    }
  }

  if (decidedEpisode && decidedEpisode.status !== 'CLOSED') {
    bestEpisode = decidedEpisode
    bestScore = episodeScores.find((e) => e.episodeId === decidedEpisode.id)?.score ?? 0
  }

  if (!bestEpisode && projectedEpisodes.length > 0) {
    const open = projectedEpisodes.filter((e) => e.status !== 'CLOSED')
    const fallback = open.length > 0 ? open[0] : projectedEpisodes[0]
    bestEpisode = fallback
    bestScore = episodeScores.find((e) => e.episodeId === fallback.id)?.score ?? 0
  }

  // Score the selected episode with full context
  const selectedScoreInput: V3ScoreInput | null = bestEpisode
    ? {
        episode: bestEpisode,
        decision,
        proofRelevance: proofRelevanceMap[bestEpisode.id] ?? estimateProofRelevance(bestEpisode, senderCapabilities),
        evidenceQuality: evidenceQualityMap[bestEpisode.id] ?? estimateEvidenceQuality(bestEpisode, graph),
        rawText,
        buyerIntent,
        senderCapabilities,
        episodeQuotes: quotesFor(bestEpisode),
        commercialPotential: bestEpisode.organizationName && commercialPotential
          ? scopeCommercialPotentialToOrg(commercialPotential, bestEpisode.organizationName, graph)
          : commercialPotential ?? undefined,
      }
    : null

  let selectedScore: V3ScoreOutput = selectedScoreInput
    ? scoreEpisode(selectedScoreInput)
    : { score: 0, label: 'Not a fit', qualification: 'SKIP' as const, reasons: ['No episodes found'], watchOut: [], dimensions: [] }

  // LinkedIn profiles always have at least CONNECTION access (you can message them)
  const effectiveAccess = (bestEpisode && bestEpisode.applicationChannels.length > 0)
    ? (decision.access === 'NONE' ? 'CONNECTION' : decision.access)
    : decision.access

  let actionOutput = bestEpisode
    ? determineAction({
        score: selectedScore.score,
        buyerRequestProbability: decision.buyerRequestProbability,
        externalNeedProbability: decision.externalNeedProbability,
        access: effectiveAccess,
        timing: decision.timing,
        relationship: decision.relationship,
        fit: decision.fit,
        messageEligible: decision.messageEligible,
        explicitRequest: buyerIntent.buyerIntentLevel === 'HIGH',
        status: bestEpisode.status,
        confidence: providerResult.confidence,
        evidenceQuality: proofRelevanceMap[bestEpisode.id] ?? estimateProofRelevance(bestEpisode, senderCapabilities),
        commercialPotential: commercialPotential?.overallPotential ?? null,
      })
    : { action: 'SKIP' as const, messageEligible: false, reason: 'No active episodes', needsReview: false }

  // Commercial potential is already factored into the score via the
  // commercialPotential dimension in scoreEpisode. This section handles
  // the case where no meaningful episode was found at all.
  const hasMeaningfulEpisode = bestEpisode && (
    bestEpisode.explicitRequest ||
    (bestEpisode.organizationName && bestEpisode.organizationName !== 'UNKNOWN' && bestEpisode.organizationName !== 'Unknown') ||
    !['OTHER', 'SERVICE_OFFERING', 'MARKET_COMMENTARY'].includes(bestEpisode.anchorEvent.eventType)
  )

  const allClosed = projectedEpisodes.length > 0 && projectedEpisodes.every((e) => e.status === 'CLOSED')
  let latentAssessment = null
  if (!hasMeaningfulEpisode && commercialPotential && !allClosed) {
    latentAssessment = await assessLatentOpportunity(input.v2Canonical!, input.rawText)
    const latentScore = computeLatentScore(latentAssessment)
    const latentAction = latentActionFromPotential(latentAssessment.overallPotential, latentAssessment.confidence)

    if (latentAssessment.overallPotential !== 'LOW') {
      selectedScore = {
        score: latentScore,
        label: `Commercial potential (${latentAssessment.overallPotential.toLowerCase()})`,
        qualification: latentAssessment.overallPotential === 'HIGH' ? 'MAYBE' : 'SKIP',
        reasons: latentAssessment.signals.length > 0
          ? latentAssessment.signals
          : ['No explicit buyer signal detected'],
        watchOut: [`Current buyer intent: UNKNOWN. ${latentAssessment.signals.join(', ')}`],
        dimensions: [],
        calculation: latentCalculation(latentScore, `No concrete opportunity episode; scored on ${latentAssessment.overallPotential.toLowerCase()} latent commercial potential.`),
      }
      actionOutput = {
        action: latentAction.action as import('../types').V3Action,
        messageEligible: latentAction.messageEligible,
        reason: `Commercial ${latentAssessment.overallPotential.toLowerCase()} potential: ${latentAssessment.signals.join(', ')}`,
        needsReview: false,
      }
    }
  }

  if (!hasMeaningfulEpisode && (latentAssessment?.overallPotential === 'LOW' || !latentAssessment) && selectedScore.score < 10) {
    selectedScore = {
      score: 0,
      label: 'Not a fit',
      qualification: 'SKIP',
      reasons: ['No explicit buyer signal detected'],
      watchOut: ['No meaningful commercial opportunity identified'],
      dimensions: [],
      calculation: latentCalculation(0, 'No concrete opportunity episode and low commercial potential.'),
    }
    actionOutput = { action: 'SKIP', messageEligible: false, reason: 'No buyer intent and low commercial potential', needsReview: false }
  }

  // Shadow comparison
  const shadowComparison: V3ShadowComparison | null = productionScore !== undefined
    ? {
        productionScore,
        productionAction: productionAction ?? 'UNKNOWN',
        v3Score: selectedScore.score,
        v3Action: actionOutput.action,
        scoreDelta: selectedScore.score - productionScore,
        actionChanged: actionOutput.action !== productionAction,
        productionDecision: productionDecision ?? null,
      }
    : null

  // Confidence
  const confidence = Math.round(computeOverallConfidence(decision, bestEpisode, providerResult) * (buyerIntent.contradictions.length > 0 ? 0.7 : 1) * 100) / 100

  // Collect evidence refs
  const evidenceRefs = bestEpisode?.evidenceRefs ?? []

  const packet: V3LeadDecisionPacket = {
    version: 'relay_decision_v3',
    decisionRunId: generateDecisionRunId(),
    selectedEpisodeId: bestEpisode?.id ?? null,
    episodes: projectedEpisodes,
    decision,
    score: selectedScore.score,
    scoreVersion: V3_CONFIG_VERSION,
    label: selectedScore.label,
    qualification: selectedScore.qualification,
    action: actionOutput.action,
    messageEligible: actionOutput.messageEligible,
    reasons: selectedScore.reasons,
    watchOut: selectedScore.watchOut,
    dimensions: selectedScore.dimensions,
    scoreCalculation: selectedScore.calculation ?? null,
    decisionAdjustments,
    evidenceQuotes: bestEpisode ? episodeEvidenceQuotes(bestEpisode, graph, rawText) : [],
    evidenceRefs,
    proofStrength: proofRelevanceMap[bestEpisode?.id ?? ''] ?? 0.5,
    confidence: latentAssessment ? latentAssessment.confidence : confidence,
    decisionProvider: providerResult.providerId,
    decisionModel: providerResult.modelVersion,
    shadowComparison,
    latentPotential: latentAssessment?.overallPotential ?? null,
    latentSignals: latentAssessment?.signals ?? [],
    buyerIntent,
    orgContext: {
      currentIndustry: orgContext.currentIndustry,
      currentIndustryLine: orgContext.currentIndustryLine,
      currentProductActivity: orgContext.currentProductActivity,
    },
  }

  return {
    packet,
    selectedEpisode: bestEpisode,
    episodeScores,
  }
}


function latentCalculation(score: number, detail: string): NonNullable<V3ScoreOutput['calculation']> {
  return {
    modelSubtotal: score,
    statusMultiplier: 1,
    relationshipMultiplier: 1,
    modelScore: score,
    signalCheckTotal: null,
    modelWeight: 1,
    floorApplied: null,
    finalScore: score,
    steps: [{ label: 'Latent potential score', value: `${score}/100`, detail }],
  }
}

const BUYER_CAP = 0.2

/**
 * Write the canonical buyer decision into the bounded decision, so every
 * reader of `packet.decision` (action policy, routing, decision context,
 * signal watch, inbound) sees one buyer truth. Each change and each scorer
 * contradiction is recorded for the debug trace.
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
  for (const c of intent.contradictions) adjustments.push(`Contradiction: ${c} Buyer intent → UNKNOWN.`)
  return next
}

/**
 * Deterministic guards on the model's bounded answers. The model is a
 * classifier over one episode; these rules hold regardless of its output and
 * every change is recorded so the response explains it.
 */
export function guardBoundedDecision(
  decision: V3BoundedDecision,
  rawText: string | undefined,
  episode: V3OpportunityEpisode | null,
): { decision: V3BoundedDecision; adjustments: string[] } {
  const adjustments: string[] = []
  const next = { ...decision }
  const text = rawText ?? ''

  if (isEmploymentHiringNotPurchase(text, episode)) {
    // Candidate seeking: prospect is looking for opportunities, not buying
    // This must run BEFORE the employment hiring guards that set relationship to UNKNOWN
    if (isCandidateSeeking(text)) {
      if (next.relationship === 'BUYER' || next.relationship === 'UNKNOWN') {
        adjustments.push('Relationship → CANDIDATE: prospect is seeking opportunities, not buying services.')
        next.relationship = 'CANDIDATE'
      }
      if (next.buyerRequestProbability > 0.1) {
        adjustments.push(`Buyer request capped at 0.1: candidate-seeking language detected.`)
        next.buyerRequestProbability = 0.1
      }
      if (next.needOwnerType === 'ORGANIZATION_NEED' || next.needOwnerType === 'UNKNOWN') {
        next.needOwnerType = 'UNKNOWN'
      }
    } else {
      // Standard employment hiring (not candidate seeking)
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
  } else if (detectCommercialRequest(text).externalServiceRequest && next.needOwnerType === 'HIRING_NEED') {
    adjustments.push('Need owner HIRING_NEED → ORGANIZATION_NEED: the source asks for an external provider, not employees.')
    next.needOwnerType = 'ORGANIZATION_NEED'
  }

  // An explicit invitation to get in touch is a contact route; the model
  // answering NONE/INDIRECT produced a 0/10 Access row quoting that line.
  // Candidate apply instructions ("submit your CV") are not a contact route
  // for a vendor, so employee-only hiring is left as the model judged it.
  const contact = isEmploymentHiringNotPurchase(text, episode) ? null : findContactInstruction(text)
  if (contact && (next.access === 'NONE' || next.access === 'INDIRECT')) {
    adjustments.push(`Access ${next.access} → CONNECTION: the source invites contact ("${contact.line.slice(0, 100)}").`)
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

function computeOverallConfidence(
  decision: V3BoundedDecision,
  episode: V3OpportunityEpisode | null,
  providerResult: V3ProviderResult,
): number {
  // Base confidence: how decisive is the model's prediction?
  // Prob near 0 or 1 = decisive (high confidence). Prob near 0.5 = uncertain.
  const buyerConfidence = 2 * Math.abs(decision.buyerRequestProbability - 0.5)
  let confidence = buyerConfidence

  // Boost for explicit requests (clearer signal)
  if (episode?.explicitRequest) {
    confidence = Math.min(1, confidence + 0.15)
  }

  if (episode && episode.evidenceRefs.length < 2) {
    confidence *= 0.8
  }

  if (episode && episode.ageDays !== null && episode.ageDays > 60) {
    confidence *= 0.9
  }

  if (episode && episode.ageDays === null) {
    confidence *= 0.85
  }

  return Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100
}

function estimateProofRelevance(
  episode: V3OpportunityEpisode,
  senderCapabilities: string[],
): number {
  if (senderCapabilities.length === 0) return 0.5
  if (episode.requestedCapabilities.length === 0) return 0.5

  // Simple keyword overlap — replaced by semantic reranking when available
  const requested = episode.requestedCapabilities.map((c) => c.toLowerCase())
  const capabilities = senderCapabilities.map((c) => c.toLowerCase())
  let matches = 0
  for (const req of requested) {
    if (capabilities.some((cap) => cap.includes(req) || req.includes(cap))) {
      matches++
    }
  }

  return requested.length > 0 ? Math.min(1, matches / requested.length + 0.2) : 0.5
}

function estimateEvidenceQuality(
  episode: V3OpportunityEpisode,
  graph: V3EvidenceGraph,
): number {
  let totalConfidence = 0
  let count = 0

  for (const evId of episode.evidenceRefs) {
    const ev = graph.evidence.get(evId)
    if (ev) {
      totalConfidence += ev.confidence
      count++
    }
  }

  if (count === 0) return 0.3
  return Math.round((totalConfidence / count) * 100) / 100
}

function generateDecisionRunId(): string {
  return `v3run_${Date.now().toString(36)}`
}

