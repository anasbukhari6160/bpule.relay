/**
 * Builder for candidate E — the kNN reference set with per-feature weights.
 * Feature weights are the absolute Pearson correlation of each feature with
 * the label midpoint on train (floored), so irrelevant features do not
 * dominate the distance; k is chosen on validation.
 */

import { FEATURE_NAMES } from '../opportunity-features'
import type { KnnFeaturesModel } from '../models/knn-features.model'
import { knnEstimate } from '../engines/knn-features'
import { midpoint, type LabelledRow } from './dataset'

export function buildKnnModel(rows: LabelledRow[], opts: { validation?: LabelledRow[]; version?: string; trainedOn?: string } = {}): KnnFeaturesModel {
  const d = FEATURE_NAMES.length
  const n = rows.length
  const y = rows.map((r) => midpoint(r.range))
  const my = y.reduce((a, b) => a + b, 0) / n
  const weights: number[] = []
  for (let i = 0; i < d; i++) {
    const xs = rows.map((r) => r.vector[i])
    const mx = xs.reduce((a, b) => a + b, 0) / n
    let num = 0, dx = 0, dy = 0
    for (let r = 0; r < n; r++) { num += (xs[r] - mx) * (y[r] - my); dx += (xs[r] - mx) ** 2; dy += (y[r] - my) ** 2 }
    const corr = dx === 0 || dy === 0 ? 0 : Math.abs(num / Math.sqrt(dx * dy))
    weights.push(Math.round(Math.max(0.1, corr) * 1000) / 1000)
  }
  const base: KnnFeaturesModel = {
    version: opts.version ?? `knn_features_v1.${Date.now().toString(36)}`,
    trainedOn: opts.trainedOn ?? `${n} references`,
    featureNames: [...FEATURE_NAMES],
    featureWeights: weights,
    k: 5,
    references: rows.map((r) => ({ id: r.id, vector: r.vector.map((v) => Math.round(v * 1000) / 1000), label: midpoint(r.range), band: r.band })),
  }
  const val = opts.validation ?? []
  if (val.length >= 5) {
    let best = { k: 5, mae: Infinity }
    for (const k of [3, 5, 7, 9]) {
      const m = { ...base, k }
      const errs = val.map((r) => {
        const est = knnEstimate(m, r.vector).score
        const [lo, hi] = r.range
        return est < lo ? lo - est : est > hi ? est - hi : 0
      })
      const mae = errs.reduce((a, b) => a + b, 0) / errs.length
      if (mae < best.mae) best = { k, mae }
    }
    base.k = best.k
  }
  return base
}
