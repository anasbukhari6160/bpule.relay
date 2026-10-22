/**
 * Decision Intelligence V3 — Public API
 *
 * Single import surface for the V3 pipeline.
 *
 * Usage:
 *   import { runV3Decision, getDecisionRegistry, initializeV3 } from '@/lib/intelligence-v3'
 *
 *   // Initialize (register providers)
 *   initializeV3()
 *
 *   // Run V3 decision (with optional V2 bridge)
 *   const result = await runV3Decision(v2Intelligence, {
 *     senderCapabilities: ['react', 'node.js', 'typescript'],
 *     productionScore: v2Score,
 *   })
 *
 *   // Access the canonical packet
 *   console.log(result.packet.score, result.packet.action)
 */


export type {
  V3Person,
  V3Organization,
  V3Affiliation,
  V3Evidence,
  V3Event,
  V3OpportunityEpisode,
  V3BoundedDecision,
  V3LeadDecisionPacket,
  V3ShadowComparison,
  V3EpisodeScore,
  V3MultiEpisodeResult,
  V3EpisodeStatus,
  V3NeedOwner,
  V3Relationship,
  V3FitLevel,
  V3TimingLevel,
  V3AccessLevel,
  V3Action,
  V3Qualification,
  V3EvidenceType,
  V3EvidenceSourceType,
  V3EventType,
  V3Explicitness,
  V3TargetAudience,
} from './types'

export {
  V3_SCORE_LABELS,
  v3ScoreLabel,
  EPISODE_STALENESS,
  MESSAGE_ELIGIBILITY,
} from './types'


export {
  V3_CONFIG_VERSION,
  V3_SCORING_WEIGHTS,
  FIT_SCORES,
  TIMING_SCORES,
  ACCESS_SCORES,
  EPISODE_STATUS_SCORES,
  RELATIONSHIP_CONTEXT,
  NEED_OWNER_BUYER_RELEVANCE,
  ACTION_THRESHOLDS,
  V3_MESSAGE_POLICY,
  V3_SHADOW_CONFIG,
  V3_DECISION_PROVIDER_CONFIG,
} from './config'


export {
  runV3Decision,
  type V3OrchestratorOptions,
  type V3OrchestratorResult,
  type V2BridgeInput,
} from './orchestrator'


export {
  createEvidenceGraph,
  upsertPerson,
  upsertOrganization,
  addAffiliation,
  addEvidence,
  addEvent,
  linkEvidenceToEvent,
  markOrganizationAsServiceProvider,
  getEvidenceForOrganization,
  getEventsForOrganization,
  getActiveEvidence,
  getActiveEvents,
  resetIdCounter,
} from './graph/evidence-graph'

export type { V3EvidenceGraph } from './graph/evidence-graph'


export { buildEpisodes } from './graph/episode-builder'


export {
  getDecisionRegistry,
  type V3DecisionProvider,
  type V3ProviderContext,
  type V3ProviderResult,
} from './decision/decision-provider'

export { OpenAIDecisionProvider } from './decision/openai-provider'
export { LongCatDecisionProvider } from './decision/longcat-provider'
// Jeff/Jev/Kev providers moved to experiments/ — not in production runtime


export { assembleDecisionPacket } from './decision/decision-assembler'


export {
  scoreEpisode,
} from './scoring/score-v3'

export type { V3ScoreInput, V3ScoreOutput, V3ScoreDimension } from './scoring/score-v3'


export { determineAction, actionFromDecisionPacket } from './action/action-policy'
export { deriveRecommendedAction } from './action/recommended-action'
export type { RecommendedAction, DeriveActionInput, DeriveActionOutput } from './action/recommended-action'

export { readSourceFacts, summarizeSourceFacts } from './source-facts-model'
export type { SourceFacts, SourceFactsSummary, RejectedSignal, AccessFacts } from './source-facts-model'

export {
  resolveAccess,
  resolveTiming,
  resolveCapabilityFit,
  resolveAuthorityDimension,
  assessCommercialPotentialFromFacts,
  assessEvidenceQuality,
  computeConfidence,
} from './dimensions'

export { currentVersions, isPacketCurrent, SCORING_VERSION, SOURCE_FACTS_VERSION, ATTRIBUTION_VERSION, ACTION_POLICY_VERSION, DISPLAY_VERSION } from './versions'
export type { ScoringVersions } from './versions'

export { extractEventsDeterministically } from './deterministic-events'


export {
  getReranker,
  setReranker,
  KeywordReranker,
  SemanticReranker,
  PROOF_MATCH_THRESHOLD,
} from './semantic/reranker'

export type { V3ProofCandidate, V3RerankResult, V3Reranker } from './semantic/reranker'


export {
  compareShadow,
  computeShadowStats,
  generateShadowReport,
} from './decision/shadow-runner'

export type { V3ShadowResult } from './decision/shadow-runner'


import { getDecisionRegistry } from './decision/decision-provider'
import { OpenAIDecisionProvider } from './decision/openai-provider'
import { LongCatDecisionProvider } from './decision/longcat-provider'
import { V3_DECISION_PROVIDER_CONFIG } from './config'


let _initialized = false

/**
 * Initialize the V3 decision provider registry.
 * Registers OpenAI (primary) and LongCat (fallback).
 * Safe to call multiple times.
 */
export function initializeV3(): void {
  if (_initialized) return

  const registry = getDecisionRegistry()

  // Register providers
  const openai = new OpenAIDecisionProvider()
  if (openai.isAvailable()) registry.register(openai)

  const longcat = new LongCatDecisionProvider()
  if (longcat.isAvailable()) registry.register(longcat)

  const primary = V3_DECISION_PROVIDER_CONFIG.primary
  if (registry.get(primary)?.isAvailable()) {
    registry.setPrimary(primary)
  }

  _initialized = true
}


export {
  V3_DECISION_SCHEMA,
  V3_DECISION_SYSTEM_PROMPT,
  buildDecisionUserPrompt,
} from './decision/bounded-questions'

export type { V3DecisionContext, V3DecisionAnswers } from './decision/bounded-questions'
