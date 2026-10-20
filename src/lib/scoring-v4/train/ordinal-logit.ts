/**
 * Trainer for candidate C — proportional-odds ordinal logistic regression.
 *
 * Minimises the negative log-likelihood of the labelled BAND under the
 * cumulative-logit model with L2 regularisation, by full-batch gradient
 * descent on standardised features. Standardisation is folded back into
 * the stored weights and cuts, so inference is a plain dot product.
 *
 * The latent is mapped to the canonical 0-100 scale by piecewise-linear
 * interpolation through the fitted cuts (cut_k ↔ the band boundary it
 * separates), which is the natural calibration for an ordinal model.
 */

import { FEATURE_NAMES } from '../opportunity-features'
import type { OrdinalLogitModel } from '../models/ordinal-logit.model'
import { BAND_ORDER_ASC, bandIndex, type LabelledRow } from './dataset'

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export interface OrdinalTrainOptions {
  epochs?: number
  learningRate?: number
  l2?: number
  version?: string
  trainedOn?: string
}

export function trainOrdinalLogit(rows: LabelledRow[], opts: OrdinalTrainOptions = {}): OrdinalLogitModel {
  const epochs = opts.epochs ?? 1500
  const lr = opts.learningRate ?? 0.05
  const l2 = opts.l2 ?? 0.02
  const K = BAND_ORDER_ASC.length
  const d = FEATURE_NAMES.length
  const n = rows.length
  if (n === 0) throw new Error('trainOrdinalLogit: no rows')

  // Standardise.
  const mu = new Array(d).fill(0), sd = new Array(d).fill(0)
  for (const r of rows) for (let i = 0; i < d; i++) mu[i] += r.vector[i] / n
  for (const r of rows) for (let i = 0; i < d; i++) sd[i] += (r.vector[i] - mu[i]) ** 2 / n
  for (let i = 0; i < d; i++) sd[i] = Math.sqrt(sd[i]) || 1
  const X = rows.map((r) => r.vector.map((v, i) => (v - mu[i]) / sd[i]))
  const y = rows.map((r) => bandIndex(r.band))

  const w = new Array(d).fill(0)
  // Cuts initialised from class frequencies (monotone by construction).
  const counts = new Array(K).fill(0)
  for (const k of y) counts[k]++
  const cuts: number[] = []
  let cum = 0
  for (let k = 0; k < K - 1; k++) { cum += counts[k]; const p = Math.min(0.98, Math.max(0.02, cum / n)); cuts.push(Math.log(p / (1 - p))) }

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array(d).fill(0)
    const gc = new Array(K - 1).fill(0)
    for (let r = 0; r < n; r++) {
      let z = 0
      for (let i = 0; i < d; i++) z += w[i] * X[r][i]
      const k = y[r]
      // P(y = k) = F(c_k - z) - F(c_{k-1} - z)
      const hi = k === K - 1 ? 1 : sigmoid(cuts[k] - z)
      const lo = k === 0 ? 0 : sigmoid(cuts[k - 1] - z)
      const p = Math.max(1e-9, hi - lo)
      const dHi = k === K - 1 ? 0 : hi * (1 - hi)
      const dLo = k === 0 ? 0 : lo * (1 - lo)
      // d(-log p)/dz = (dHi - dLo) / p  (since dF(c - z)/dz = -F')
      const dz = (dHi - dLo) / p
      for (let i = 0; i < d; i++) gw[i] += dz * X[r][i]
      // d(-log p)/dc_k = -dHi / p ; d/dc_{k-1} = +dLo / p
      if (k < K - 1) gc[k] += -dHi / p
      if (k > 0) gc[k - 1] += dLo / p
    }
    for (let i = 0; i < d; i++) w[i] -= lr * (gw[i] / n + l2 * w[i])
    for (let k = 0; k < K - 1; k++) cuts[k] -= lr * (gc[k] / n)
    // Keep cuts ordered.
    for (let k = 1; k < K - 1; k++) if (cuts[k] <= cuts[k - 1] + 1e-3) cuts[k] = cuts[k - 1] + 1e-3
  }

  // Fold standardisation: z = Σ w_i (x_i - mu_i)/sd_i = Σ (w_i/sd_i) x_i - Σ w_i mu_i/sd_i
  const weights = w.map((wi, i) => wi / sd[i])
  const shift = w.reduce((s, wi, i) => s + (wi * mu[i]) / sd[i], 0)
  const foldedCuts = cuts.map((c) => c + shift)
  // Fallback affine map for the engine (used beyond the outer cuts).
  const slope = foldedCuts.length >= 2 ? 20 / Math.max(0.2, (foldedCuts[foldedCuts.length - 1] - foldedCuts[0]) / (foldedCuts.length - 1)) : 10
  return {
    version: opts.version ?? `ordinal_logit_v1.${Date.now().toString(36)}`,
    trainedOn: opts.trainedOn ?? `${n} rows`,
    featureNames: [...FEATURE_NAMES],
    weights: weights.map((x) => Math.round(x * 1e5) / 1e5),
    cuts: foldedCuts.map((x) => Math.round(x * 1e5) / 1e5),
    scoreMap: { a: 0, b: Math.round(slope * 1000) / 1000 },
  }
}
