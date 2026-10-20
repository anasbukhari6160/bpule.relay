/**
 * Parameter search for candidate B (calibrated_v4).
 *
 * Coordinate descent over the mix weights and the account-value weights,
 * maximising a ranking objective on TRAIN (pairwise accuracy + Spearman,
 * minus a small range-distance penalty so the scale stays meaningful),
 * with the rescale (a, b) refitted by least squares after every sweep.
 * VALIDATION is used only to pick the sweep to keep; LOCKED is never read.
 */

import { scoreCalibratedV4 } from '../engines/calibrated-v4'
import type { CalibratedV4Params } from '../models/calibrated-v4.params'
import { pairwiseAccuracy, rangeMae, spearman } from '../metrics'
import { midpoint, toRangeLabels, type LabelledRow } from './dataset'

function objective(p: CalibratedV4Params, rows: LabelledRow[]): number {
  const preds = rows.map((r) => ({ id: r.id, score: scoreCalibratedV4(r.features, p).score }))
  const labels = toRangeLabels(rows)
  return pairwiseAccuracy(preds, labels).accuracy + 0.5 * spearman(preds, labels) - 0.004 * rangeMae(preds, labels).mae
}

function normalise<T extends Record<string, number>>(o: T): T {
  const sum = Object.values(o).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sum === 0 ? 0 : v / sum])) as T
}

function refitRescale(p: CalibratedV4Params, rows: LabelledRow[]): CalibratedV4Params {
  const unit = { ...p, rescale: { a: 0, b: 100 } }
  // The engine applies guards after rescale; for the fit we use the raw mix.
  const xs = rows.map((r) => scoreCalibratedV4(r.features, unit).rawScore / 100)
  const ys = rows.map((r) => midpoint(r.range))
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0, den = 0
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  const b = den === 0 ? 100 : Math.max(40, Math.min(160, num / den))
  const a = my - b * mx
  return { ...p, rescale: { a: Math.round(a * 10) / 10, b: Math.round(b * 10) / 10 } }
}

export function searchCalibratedV4(seed: CalibratedV4Params, train: LabelledRow[], validation: LabelledRow[], opts: { sweeps?: number; step?: number; version?: string } = {}): { params: CalibratedV4Params; trainObjective: number; validationObjective: number; sweepsRun: number } {
  const sweeps = opts.sweeps ?? 6
  const step = opts.step ?? 0.04
  let current = refitRescale(seed, train)
  let best = { params: current, val: objective(current, validation), train: objective(current, train) }
  let sweepsRun = 0

  for (let s = 0; s < sweeps; s++) {
    sweepsRun++
    let improved = false
    for (const group of ['weights', 'account'] as const) {
      for (const key of Object.keys(current[group])) {
        for (const delta of [step, -step]) {
          const trial = { ...current, [group]: normalise({ ...current[group], [key]: Math.max(0, (current[group] as Record<string, number>)[key] + delta) }) } as CalibratedV4Params
          const fitted = refitRescale(trial, train)
          if (objective(fitted, train) > objective(current, train) + 1e-6) { current = fitted; improved = true }
        }
      }
    }
    const val = objective(current, validation)
    if (val > best.val) best = { params: current, val, train: objective(current, train) }
    if (!improved) break
  }
  const version = opts.version ?? `calibrated_v4.1.${Date.now().toString(36)}`
  const params = { ...best.params, version, trainedOn: `${train.length} train rows, ${validation.length} validation rows` }
  Object.assign(params.weights, Object.fromEntries(Object.entries(params.weights).map(([k, v]) => [k, Math.round(v * 1000) / 1000])))
  Object.assign(params.account, Object.fromEntries(Object.entries(params.account).map(([k, v]) => [k, Math.round(v * 1000) / 1000])))
  return { params, trainObjective: Math.round(best.train * 1000) / 1000, validationObjective: Math.round(best.val * 1000) / 1000, sweepsRun }
}
