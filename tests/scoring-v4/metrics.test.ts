import { describe, expect, it } from 'vitest'
import { evaluate, expectedCalibrationError, ndcgAtK, pairwiseAccuracy, rangeMae, spearman, topDecilePrecision, type Prediction, type RangeLabel } from '@/lib/scoring-v4/metrics'
import { splitFor } from '@/lib/scoring-v4/train/split'

const labels: RangeLabel[] = [
  { id: 'a', range: [80, 95], band: 'STRONG' },
  { id: 'b', range: [55, 70], band: 'WORTH_PURSUING' },
  { id: 'c', range: [35, 50], band: 'MAYBE' },
  { id: 'd', range: [15, 30], band: 'LOW' },
  { id: 'e', range: [40, 60], band: 'MAYBE' },
]

describe('ranking and calibration metrics (Phase 26)', () => {
  it('perfect ordering scores 1 on spearman, pairwise and ndcg', () => {
    const preds: Prediction[] = [{ id: 'a', score: 90 }, { id: 'b', score: 60 }, { id: 'c', score: 45 }, { id: 'd', score: 20 }, { id: 'e', score: 50 }]
    expect(spearman(preds, labels)).toBeCloseTo(1, 5)
    expect(pairwiseAccuracy(preds, labels).accuracy).toBe(1)
    expect(ndcgAtK(preds, labels, 10)).toBeCloseTo(1, 5)
    expect(rangeMae(preds, labels)).toEqual({ mae: 0, inRange: 1 })
  })

  it('only disjoint ranges form pairs; overlapping ranges do not penalise either order', () => {
    const preds: Prediction[] = [{ id: 'c', score: 45 }, { id: 'e', score: 44 }]
    const r = pairwiseAccuracy(preds, labels.filter((l) => l.id === 'c' || l.id === 'e'))
    expect(r.pairs).toBe(0)
  })

  it('reversed ordering scores 0 pairwise and negative spearman', () => {
    const preds: Prediction[] = [{ id: 'a', score: 10 }, { id: 'b', score: 20 }, { id: 'c', score: 30 }, { id: 'd', score: 90 }, { id: 'e', score: 40 }]
    const pw = pairwiseAccuracy(preds, labels)
    expect(pw.accuracy).toBeLessThan(0.2)
    expect(pw.violations.length).toBeGreaterThan(0)
    expect(spearman(preds, labels)).toBeLessThan(0)
  })

  it('range MAE measures distance to the nearest edge only', () => {
    const preds: Prediction[] = [{ id: 'a', score: 70 }, { id: 'b', score: 60 }]
    const r = rangeMae(preds, labels)
    expect(r.mae).toBe(5)
    expect(r.inRange).toBe(0.5)
  })

  it('top-decile precision counts hits in the top fraction', () => {
    const preds: Prediction[] = [{ id: 'a', score: 10 }, { id: 'b', score: 95 }, { id: 'c', score: 45 }, { id: 'd', score: 20 }, { id: 'e', score: 50 }]
    const t = topDecilePrecision(preds, labels, 0.2)
    expect(t.k).toBe(1)
    expect(t.precision).toBe(0)
  })

  it('ECE is 0 for a perfectly calibrated set and > 0 for an overconfident one', () => {
    const good = [{ p: 0.95, y: 1 as const }, { p: 0.95, y: 1 as const }, { p: 0.05, y: 0 as const }, { p: 0.05, y: 0 as const }]
    expect(expectedCalibrationError(good).ece).toBeLessThan(0.06)
    const bad = [{ p: 0.95, y: 0 as const }, { p: 0.95, y: 0 as const }, { p: 0.95, y: 1 as const }]
    expect(expectedCalibrationError(bad).ece).toBeGreaterThan(0.5)
  })

  it('evaluate() bundles everything with band order', () => {
    const preds: Prediction[] = labels.map((l) => ({ id: l.id, score: (l.range[0] + l.range[1]) / 2, band: l.band }))
    const r = evaluate(preds, labels, ['SKIP', 'LOW', 'MAYBE', 'WORTH_PURSUING', 'STRONG'])
    expect(r.n).toBe(5)
    expect(r.ordinal.exact).toBe(1)
    expect(r.reliability.length).toBeGreaterThan(0)
  })
})

describe('locked split (Phase 25)', () => {
  it('is deterministic and roughly proportional', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `fixture-${i}`)
    const a = ids.map((id) => splitFor(id))
    const b = ids.map((id) => splitFor(id))
    expect(a).toEqual(b)
    const share = (s: string) => a.filter((x) => x === s).length / ids.length
    expect(share('locked')).toBeGreaterThan(0.2)
    expect(share('locked')).toBeLessThan(0.3)
    expect(share('validation')).toBeGreaterThan(0.15)
    expect(share('validation')).toBeLessThan(0.25)
  })
})
