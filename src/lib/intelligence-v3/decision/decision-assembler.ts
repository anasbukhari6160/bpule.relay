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
} from '../types'
import type { V3EvidenceGraph } from '../graph/evidence-graph'
import { V3_CONFIG_VERSION } from '../config'
import { scoreEpisode, type V3ScoreInput } from '../scoring/score-v3'
import { determineAction } from '../action/action-policy'
import type { V3ProviderResult } from './decision-provider'
import {
  assessLatentOpportunity,
  assessCommercialPotential,
  computeLatentScore,
  latentActionFromPotential,
} from '../latent-opportunity'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'

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

  const decision = buildBoundedDecision(providerResult)

  // Assess commercial potential once (deterministic, no AI call)
  let commercialPotential = null
  if (input.v2Canonical) {
    commercialPotential = await assessCommercialPotential(input.v2Canonical, rawText)
  }

  // Score each episode
  const episodeScores: Array<{ episodeId: string; score: number }> = []
  let bestEpisode: V3OpportunityEpisode | null = null
  let bestScore = -1

  for (const episode of episodes) {
    const scoreInput: V3ScoreInput = {
      episode,
      decision,
      proofRelevance: proofRelevanceMap[episode.id] ?? estimateProofRelevance(episode, senderCapabilities),
      evidenceQuality: evidenceQualityMap[episode.id] ?? estimateEvidenceQuality(episode, graph),
      rawText,
      commercialPotential: episode.organizationName && commercialPotential
        ? scopeCommercialPotentialToOrg(commercialPotential, episode.organizationName, graph)
        : commercialPotential ?? undefined,
    }

    const scoreOutput = scoreEpisode(scoreInput)
    episodeScores.push({ episodeId: episode.id, score: scoreOutput.score })

    // Best active episode wins
    if (episode.status !== 'CLOSED' && scoreOutput.score > bestScore) {
      bestScore = scoreOutput.score
      bestEpisode = episode
    }
  }

  if (!bestEpisode && episodes.length > 0) {
    bestEpisode = episodes[0]
    bestScore = episodeScores[0]?.score ?? 0
  }

  // Score the selected episode with full context
  const selectedScoreInput: V3ScoreInput | null = bestEpisode
    ? {
        episode: bestEpisode,
        decision,
        proofRelevance: proofRelevanceMap[bestEpisode.id] ?? estimateProofRelevance(bestEpisode, senderCapabilities),
        evidenceQuality: evidenceQualityMap[bestEpisode.id] ?? estimateEvidenceQuality(bestEpisode, graph),
        rawText,
        senderCapabilities,
        commercialPotential: bestEpisode.organizationName && commercialPotential
          ? scopeCommercialPotentialToOrg(commercialPotential, bestEpisode.organizationName, graph)
          : commercialPotential ?? undefined,
      }
    : null

  let selectedScore = selectedScoreInput
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
        explicitRequest: bestEpisode.explicitRequest,
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

  let latentAssessment = null
  if (!hasMeaningfulEpisode && commercialPotential) {
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
  const confidence = computeOverallConfidence(decision, bestEpisode, providerResult)

  // Collect evidence refs
  const evidenceRefs = bestEpisode?.evidenceRefs ?? []

  const packet: V3LeadDecisionPacket = {
    version: 'relay_decision_v3',
    decisionRunId: generateDecisionRunId(),
    selectedEpisodeId: bestEpisode?.id ?? null,
    episodes,
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
    evidenceRefs,
    proofStrength: proofRelevanceMap[bestEpisode?.id ?? ''] ?? 0.5,
    confidence: latentAssessment ? latentAssessment.confidence : confidence,
    decisionProvider: providerResult.providerId,
    decisionModel: providerResult.modelVersion,
    shadowComparison,
    latentPotential: latentAssessment?.overallPotential ?? null,
    latentSignals: latentAssessment?.signals ?? [],
  }

  return {
    packet,
    selectedEpisode: bestEpisode,
    episodeScores,
  }
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

