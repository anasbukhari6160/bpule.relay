/**
 * Candidate opportunity scorers sit behind ONE interface (Phase 14 / 33).
 *
 * Every engine consumes the canonical OpportunityFeatures and returns a
 * canonical 0-100 score plus a trace. None of them talk to a model, read
 * raw text, or know about senders. The production engine is selected by
 * `SCORING_ENGINE` (see ./registry.ts); any other engine can run in shadow.
 */

import type { OpportunityFeatures } from '../opportunity-features'
import type { CanonicalQualification } from '@/lib/scoring/qualification'

export type EngineId = 'v3' | 'calibrated_v4' | 'ordinal_logit' | 'gbdt_pairwise' | 'knn_features'

export interface CandidateScore {
  engine: EngineId
  version: string
  /** Canonical 0-100 after every safety guard. */
  score: number
  /** The engine's raw output before guards (same scale), for the trace. */
  rawScore: number
  qualification: CanonicalQualification
  /** Account value independent of intent, 0-100 (Phase 9/10). */
  accountValue: number
  /** Verified intent strength, 0-100. */
  intentValue: number
  /** 0-1: how sure the engine is of its own band. */
  confidence: number
  guards: string[]
  reasons: string[]
}

export interface OpportunityScorer {
  id: EngineId
  version: string
  score(features: OpportunityFeatures, ctx?: { v3Score?: number | null }): CandidateScore
}
