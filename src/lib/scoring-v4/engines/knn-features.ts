/**
 * Candidate E — weighted k-nearest neighbours in OpportunityFeatures space.
 * Inference only; the reference set is built by ../train/knn.ts.
 */

import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import { featureVector, FEATURE_NAMES, type OpportunityFeatures } from '../opportunity-features'
import { KNN_FEATURES_MODEL, type KnnFeaturesModel } from '../models/knn-features.model'
import { applyGuards } from './guards'
import type { CandidateScore, OpportunityScorer } from './types'

export function weightedDistance(a: number[], b: number[], w: number[]): number {
  let d = 0
  for (let i = 0; i < a.length; i++) { const wi = w[i] ?? 1; d += wi * (a[i] - b[i]) ** 2 }
  return Math.sqrt(d)
}

export function knnEstimate(model: KnnFeaturesModel, x: number[], excludeId?: string): { score: number; neighbours: Array<{ id: string; distance: number; label: number }> } {
  const ds = model.references
    .filter((r) => r.id !== excludeId)
    .map((r) => ({ id: r.id, distance: weightedDistance(x, r.vector, model.featureWeights), label: r.label }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, model.k)
  if (ds.length === 0) return { score: 50, neighbours: [] }
  let num = 0, den = 0
  for (const n of ds) { const w = 1 / (0.05 + n.distance); num += w * n.label; den += w }
  return { score: num / den, neighbours: ds }
}

export function scoreKnnFeatures(f: OpportunityFeatures, model: KnnFeaturesModel = KNN_FEATURES_MODEL, excludeId?: string): CandidateScore {
  const trained = model.references.length > 0 && model.featureNames.length === FEATURE_NAMES.length
  const x = featureVector(f)
  const est = trained ? knnEstimate(model, x, excludeId) : { score: 50, neighbours: [] }
  const { score, guards } = applyGuards(est.score, f)
  const q = qualifyCanonicalScore(score)
  const spread = est.neighbours.length ? Math.max(...est.neighbours.map((n) => n.label)) - Math.min(...est.neighbours.map((n) => n.label)) : 100
  return {
    engine: 'knn_features',
    version: model.version,
    score,
    rawScore: Math.round(est.score),
    qualification: q.qualification,
    accountValue: Math.round(f.accountValue.v3Raw * 100),
    intentValue: f.intent.verifiedRequest ? 80 : 0,
    confidence: trained ? Math.round(Math.max(0.1, 1 - spread / 60) * 100) / 100 : 0.2,
    guards: trained ? guards : ['model untrained — neutral score'],
    reasons: trained ? est.neighbours.slice(0, 3).map((n) => `near ${n.id} (label ${Math.round(n.label)}, d=${n.distance.toFixed(2)})`) : ['kNN reference set empty.'],
  }
}

export const knnFeaturesEngine: OpportunityScorer = {
  id: 'knn_features',
  version: KNN_FEATURES_MODEL.version,
  score: (f) => scoreKnnFeatures(f),
}
