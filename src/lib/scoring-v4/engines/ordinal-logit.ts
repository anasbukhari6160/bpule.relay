/**
 * Candidate C — proportional-odds ordinal logistic regression over the
 * OpportunityFeatures vector. Inference only; training lives in
 * ../train/ordinal-logit.ts.
 */

import { qualifyCanonicalScore, QUALIFICATION_BANDS } from '@/lib/scoring/qualification'
import { featureVector, FEATURE_NAMES, type OpportunityFeatures } from '../opportunity-features'
import { ORDINAL_LOGIT_MODEL, type OrdinalLogitModel } from '../models/ordinal-logit.model'
import { applyGuards } from './guards'
import type { CandidateScore, OpportunityScorer } from './types'

export const BAND_ORDER = [...QUALIFICATION_BANDS].map((b) => b.qualification).reverse() // SKIP … STRONG

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export function latent(model: OrdinalLogitModel, x: number[]): number {
  let z = 0
  for (let i = 0; i < model.weights.length && i < x.length; i++) z += model.weights[i] * x[i]
  return z
}

/** P(class = k) for each band under the proportional-odds model. */
export function classProbabilities(model: OrdinalLogitModel, z: number): number[] {
  const K = model.cuts.length + 1
  const cum = model.cuts.map((c) => sigmoid(c - z)) // P(y <= k)
  const probs: number[] = []
  for (let k = 0; k < K; k++) {
    const lo = k === 0 ? 0 : cum[k - 1]
    const hi = k === K - 1 ? 1 : cum[k]
    probs.push(Math.max(0, hi - lo))
  }
  return probs
}

/**
 * Latent → canonical score: piecewise-linear through the fitted cuts, each
 * cut anchored to the band boundary it separates (SKIP|LOW at 14.5, LOW|MAYBE
 * at 34.5, …). Beyond the outer cuts the map continues with the fallback
 * slope. This is the ordinal model's own calibration; no target histogram.
 */
export function latentToScore(model: OrdinalLogitModel, z: number): number {
  const edges = QUALIFICATION_BANDS.slice().reverse().slice(0, -1).map((b) => b.max + 0.5) // 14.5, 34.5, 54.5, 74.5
  const cuts = model.cuts
  if (cuts.length !== edges.length) return model.scoreMap.a + model.scoreMap.b * z
  if (z <= cuts[0]) return edges[0] - (cuts[0] - z) * model.scoreMap.b
  if (z >= cuts[cuts.length - 1]) return edges[edges.length - 1] + (z - cuts[cuts.length - 1]) * model.scoreMap.b
  for (let i = 0; i < cuts.length - 1; i++) {
    if (z >= cuts[i] && z <= cuts[i + 1]) {
      const t = (z - cuts[i]) / Math.max(1e-6, cuts[i + 1] - cuts[i])
      return edges[i] + t * (edges[i + 1] - edges[i])
    }
  }
  return model.scoreMap.a + model.scoreMap.b * z
}

export function scoreOrdinalLogit(f: OpportunityFeatures, model: OrdinalLogitModel = ORDINAL_LOGIT_MODEL): CandidateScore {
  const trained = model.weights.length === FEATURE_NAMES.length && model.cuts.length === BAND_ORDER.length - 1
  const x = featureVector(f)
  const z = trained ? latent(model, x) : 0
  const probs = trained ? classProbabilities(model, z) : BAND_ORDER.map(() => 1 / BAND_ORDER.length)
  const raw = trained ? latentToScore(model, z) : 50
  const { score, guards } = applyGuards(raw, f)
  const q = qualifyCanonicalScore(score)
  const pBand = probs[BAND_ORDER.indexOf(q.qualification)] ?? 0
  return {
    engine: 'ordinal_logit',
    version: model.version,
    score,
    rawScore: Math.round(raw),
    qualification: q.qualification,
    accountValue: Math.round(f.accountValue.v3Raw * 100),
    intentValue: f.intent.verifiedRequest ? Math.round(({ HIGH: 0.95, MEDIUM: 0.7, LOW: 0.3, UNKNOWN: 0.4 } as const)[f.intent.level] * 100) : 0,
    confidence: Math.round(pBand * 100) / 100,
    guards: trained ? guards : ['model untrained — neutral score'],
    reasons: trained ? topContributions(model, x) : ['Ordinal model not trained yet.'],
  }
}

function topContributions(model: OrdinalLogitModel, x: number[]): string[] {
  const c = model.weights.map((w, i) => ({ name: FEATURE_NAMES[i], v: w * x[i] })).filter((d) => Math.abs(d.v) > 0.05)
  c.sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
  return c.slice(0, 4).map((d) => `${d.name} ${d.v >= 0 ? '+' : ''}${d.v.toFixed(2)}`)
}

export const ordinalLogitEngine: OpportunityScorer = {
  id: 'ordinal_logit',
  version: ORDINAL_LOGIT_MODEL.version,
  score: (f) => scoreOrdinalLogit(f),
}
