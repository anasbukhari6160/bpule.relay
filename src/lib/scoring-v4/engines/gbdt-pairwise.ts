/**
 * Candidate D — gradient-boosted shallow trees with a pairwise objective.
 * Inference only; training in ../train/gbdt-pairwise.ts.
 */

import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import { featureVector, FEATURE_NAMES, type OpportunityFeatures } from '../opportunity-features'
import { GBDT_PAIRWISE_MODEL, type GbdtNode, type GbdtPairwiseModel } from '../models/gbdt-pairwise.model'
import { applyGuards } from './guards'
import type { CandidateScore, OpportunityScorer } from './types'

export function evalNode(node: GbdtNode, x: number[]): number {
  if ('leaf' in node) return node.leaf
  return x[node.feature] <= node.threshold ? evalNode(node.left, x) : evalNode(node.right, x)
}

export function gbdtLatent(model: GbdtPairwiseModel, x: number[]): number {
  let z = 0
  for (const t of model.trees) z += model.learningRate * evalNode(t, x)
  return z
}

export function scoreGbdtPairwise(f: OpportunityFeatures, model: GbdtPairwiseModel = GBDT_PAIRWISE_MODEL): CandidateScore {
  const trained = model.trees.length > 0 && model.featureNames.length === FEATURE_NAMES.length
  const x = featureVector(f)
  const z = trained ? gbdtLatent(model, x) : 0
  const raw = trained ? model.scoreMap.a + model.scoreMap.b * z : 50
  const { score, guards } = applyGuards(raw, f)
  const q = qualifyCanonicalScore(score)
  const edge = Math.min(score - q.min, q.max - score)
  return {
    engine: 'gbdt_pairwise',
    version: model.version,
    score,
    rawScore: Math.round(raw),
    qualification: q.qualification,
    accountValue: Math.round(f.accountValue.v3Raw * 100),
    intentValue: f.intent.verifiedRequest ? 80 : 0,
    confidence: trained ? Math.round(Math.min(1, 0.4 + edge / 20) * 100) / 100 : 0.2,
    guards: trained ? guards : ['model untrained — neutral score'],
    reasons: trained ? usedFeatures(model, x) : ['GBDT model not trained yet.'],
  }
}

function usedFeatures(model: GbdtPairwiseModel, x: number[]): string[] {
  const counts = new Map<number, number>()
  const walk = (n: GbdtNode) => { if ('leaf' in n) return; counts.set(n.feature, (counts.get(n.feature) ?? 0) + 1); walk(n.left); walk(n.right) }
  for (const t of model.trees) walk(t)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([i, c]) => `${FEATURE_NAMES[i]}=${x[i].toFixed(2)} (${c} splits)`)
}

export const gbdtPairwiseEngine: OpportunityScorer = {
  id: 'gbdt_pairwise',
  version: GBDT_PAIRWISE_MODEL.version,
  score: (f) => scoreGbdtPairwise(f),
}
