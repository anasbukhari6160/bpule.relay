/**
 * Engine registry and feature flag (Phase 33).
 *
 *   SCORING_ENGINE=v3                 production score = relay_decision_v3 (default)
 *   SCORING_ENGINE=calibrated_v4      production score = candidate B
 *   SCORING_SHADOW_ENGINES=calibrated_v4,ordinal_logit
 *                                     engines computed and stored beside the
 *                                     production score, never shown to reps
 *
 * Production engine selection is read once per process. Rollback is the
 * env var; no data migration is needed because every stored packet keeps
 * its V3 score and the candidate results live in a separate table.
 */

import type { EngineId, OpportunityScorer } from './types'
import { v3CurrentEngine } from './v3-current'
import { calibratedV4Engine } from './calibrated-v4'
import { ordinalLogitEngine } from './ordinal-logit'
import { gbdtPairwiseEngine } from './gbdt-pairwise'
import { knnFeaturesEngine } from './knn-features'

export const ENGINES: Record<EngineId, OpportunityScorer> = {
  v3: v3CurrentEngine,
  calibrated_v4: calibratedV4Engine,
  ordinal_logit: ordinalLogitEngine,
  gbdt_pairwise: gbdtPairwiseEngine,
  knn_features: knnFeaturesEngine,
}

export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[]

export function isEngineId(x: string): x is EngineId {
  return (ENGINE_IDS as string[]).includes(x)
}

/** The engine whose score reps see. Defaults to v3; unknown values fall back to v3. */
export function productionEngineId(env: NodeJS.ProcessEnv = process.env): EngineId {
  const v = (env.SCORING_ENGINE ?? 'v3').trim()
  return isEngineId(v) ? v : 'v3'
}

/** Engines to run in shadow beside production (never the production engine itself). */
export function shadowEngineIds(env: NodeJS.ProcessEnv = process.env): EngineId[] {
  const prod = productionEngineId(env)
  const raw = (env.SCORING_SHADOW_ENGINES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const ids = raw.filter(isEngineId).filter((id) => id !== prod)
  return [...new Set(ids)]
}
