/**
 * Ranking, ordinal and calibration metrics for the scoring program
 * (Phase 26). Pure functions, no I/O, usable from tests, scripts and the
 * admin QA surface.
 *
 * Labels are RANGES ([lo, hi] on the 0-100 scale), never one exact number:
 * a prediction inside the range costs nothing; outside it, the distance to
 * the nearest edge is the error. Pairs are formed only when two ranges are
 * disjoint, so "A must rank above B" is a statement both labelers and
 * outcomes can make without agreeing on exact numbers.
 */

export interface RangeLabel {
  id: string
  /** Inclusive canonical-score range the human (or golden expectation) assigned. */
  range: [number, number]
  /** Optional ordinal class (qualification band) the label belongs to. */
  band?: string | null
  /** Optional group key (e.g. a rep's queue or a day) for listwise metrics. */
  group?: string | null
}

export interface Prediction {
  id: string
  score: number
  band?: string | null
  /** Confidence in [0, 1] when the scorer reports one. */
  confidence?: number | null
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function rank(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const r = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r
    i = j + 1
  }
  return ranks
}

/** Spearman rank correlation between predicted scores and label midpoints. */
export function spearman(preds: Prediction[], labels: RangeLabel[]): number {
  const byId = new Map(labels.map((l) => [l.id, l]))
  const pairs = preds.filter((p) => byId.has(p.id)).map((p) => [p.score, mean(byId.get(p.id)!.range)] as const)
  if (pairs.length < 3) return 0
  const ra = rank(pairs.map((p) => p[0]))
  const rb = rank(pairs.map((p) => p[1]))
  const ma = mean(ra), mb = mean(rb)
  let num = 0, da = 0, db = 0
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2 }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

/**
 * Pairwise accuracy: among all label pairs with disjoint ranges, the share
 * the prediction orders the same way. Ties in prediction count as half.
 */
export function pairwiseAccuracy(preds: Prediction[], labels: RangeLabel[]): { accuracy: number; pairs: number; violations: Array<[string, string]> } {
  const score = new Map(preds.map((p) => [p.id, p.score]))
  const ls = labels.filter((l) => score.has(l.id))
  let correct = 0, total = 0
  const violations: Array<[string, string]> = []
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j]
      let hi: RangeLabel, lo: RangeLabel
      if (a.range[0] > b.range[1]) { hi = a; lo = b }
      else if (b.range[0] > a.range[1]) { hi = b; lo = a }
      else continue
      total++
      const d = score.get(hi.id)! - score.get(lo.id)!
      if (d > 0) correct++
      else if (d === 0) correct += 0.5
      else violations.push([hi.id, lo.id])
    }
  }
  return { accuracy: total ? correct / total : 0, pairs: total, violations }
}

/** NDCG@k using label midpoints as graded relevance (scaled to 0-4). */
export function ndcgAtK(preds: Prediction[], labels: RangeLabel[], k = 10): number {
  const rel = new Map(labels.map((l) => [l.id, Math.max(0, Math.min(4, mean(l.range) / 25))]))
  const ps = preds.filter((p) => rel.has(p.id))
  if (ps.length === 0) return 0
  const dcg = (order: number[]) => order.slice(0, k).reduce((s, r, i) => s + (2 ** r - 1) / Math.log2(i + 2), 0)
  const predicted = [...ps].sort((a, b) => b.score - a.score).map((p) => rel.get(p.id)!)
  const ideal = [...predicted].sort((a, b) => b - a)
  const idcg = dcg(ideal)
  return idcg === 0 ? 0 : dcg(predicted) / idcg
}

/**
 * Top-decile precision: of the top 10% by predicted score, the share whose
 * label midpoint is also in the top 10% of labels. This is the metric the
 * program's success rule is written in ("the 10 leads Relay puts at the
 * top are the 10 the company should spend time on").
 */
export function topDecilePrecision(preds: Prediction[], labels: RangeLabel[], fraction = 0.1): { precision: number; k: number } {
  const mid = new Map(labels.map((l) => [l.id, mean(l.range)]))
  const ps = preds.filter((p) => mid.has(p.id))
  const k = Math.max(1, Math.round(ps.length * fraction))
  if (ps.length === 0) return { precision: 0, k: 0 }
  const topPred = new Set([...ps].sort((a, b) => b.score - a.score).slice(0, k).map((p) => p.id))
  const topLabel = new Set([...ps].sort((a, b) => mid.get(b.id)! - mid.get(a.id)!).slice(0, k).map((p) => p.id))
  let hit = 0
  for (const id of topPred) if (topLabel.has(id)) hit++
  return { precision: hit / k, k }
}

/** Mean absolute distance from the prediction to the label range (0 inside the range). */
export function rangeMae(preds: Prediction[], labels: RangeLabel[]): { mae: number; inRange: number } {
  const byId = new Map(labels.map((l) => [l.id, l]))
  const ds: number[] = []
  let inside = 0
  for (const p of preds) {
    const l = byId.get(p.id)
    if (!l) continue
    const [lo, hi] = l.range
    const d = p.score < lo ? lo - p.score : p.score > hi ? p.score - hi : 0
    if (d === 0) inside++
    ds.push(d)
  }
  return { mae: mean(ds), inRange: ds.length ? inside / ds.length : 0 }
}

/** Exact band agreement and "within one band" agreement for ordinal classes. */
export function ordinalAccuracy(preds: Prediction[], labels: RangeLabel[], order: string[]): { exact: number; withinOne: number; n: number } {
  const byId = new Map(labels.map((l) => [l.id, l]))
  let exact = 0, within = 0, n = 0
  for (const p of preds) {
    const l = byId.get(p.id)
    if (!l || !l.band || !p.band) continue
    n++
    const a = order.indexOf(p.band), b = order.indexOf(l.band)
    if (a === b) { exact++; within++ } else if (Math.abs(a - b) === 1) within++
  }
  return { exact: n ? exact / n : 0, withinOne: n ? within / n : 0, n }
}

/**
 * Expected calibration error for a probability-like output against a binary
 * truth (e.g. "confidence that the band is right" vs. "band was right").
 */
export function expectedCalibrationError(rows: Array<{ p: number; y: 0 | 1 }>, bins = 10): { ece: number; reliability: Array<{ bin: string; n: number; meanP: number; rate: number }> } {
  const buckets: Array<Array<{ p: number; y: 0 | 1 }>> = Array.from({ length: bins }, () => [])
  for (const r of rows) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(r.p * bins)))
    buckets[i].push(r)
  }
  let ece = 0
  const reliability = buckets.map((b, i) => {
    const n = b.length
    const meanP = n ? mean(b.map((r) => r.p)) : 0
    const rate = n ? mean(b.map((r) => r.y)) : 0
    if (n) ece += (n / rows.length) * Math.abs(meanP - rate)
    return { bin: `${(i / bins).toFixed(1)}-${((i + 1) / bins).toFixed(1)}`, n, meanP: Math.round(meanP * 100) / 100, rate: Math.round(rate * 100) / 100 }
  })
  return { ece: rows.length ? Math.round(ece * 1000) / 1000 : 0, reliability }
}

/**
 * Score-range reliability: for each predicted-score bucket, the mean label
 * midpoint. A calibrated scorer's 70s are labelled higher than its 50s.
 */
export function scoreReliability(preds: Prediction[], labels: RangeLabel[], step = 10): Array<{ bucket: string; n: number; meanLabel: number; inRange: number }> {
  const byId = new Map(labels.map((l) => [l.id, l]))
  const buckets = new Map<number, Prediction[]>()
  for (const p of preds) {
    if (!byId.has(p.id)) continue
    const b = Math.min(90, Math.floor(p.score / step) * step)
    buckets.set(b, [...(buckets.get(b) ?? []), p])
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([b, ps]) => {
    const labelsHere = ps.map((p) => byId.get(p.id)!)
    const inside = ps.filter((p) => { const [lo, hi] = byId.get(p.id)!.range; return p.score >= lo && p.score <= hi }).length
    return { bucket: `${b}-${b + step - 1}`, n: ps.length, meanLabel: Math.round(mean(labelsHere.map((l) => mean(l.range)))), inRange: Math.round((inside / ps.length) * 100) / 100 }
  })
}

/** Precision / recall / F1 for one positive class. */
export function precisionRecallF1(rows: Array<{ predicted: boolean; actual: boolean }>): { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number } {
  let tp = 0, fp = 0, fn = 0
  for (const r of rows) { if (r.predicted && r.actual) tp++; else if (r.predicted) fp++; else if (r.actual) fn++ }
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  return { precision: Math.round(precision * 1000) / 1000, recall: Math.round(recall * 1000) / 1000, f1: Math.round(f1 * 1000) / 1000, tp, fp, fn }
}

/** Macro-averaged F1 over classes present in the truth set. */
export function macroF1(rows: Array<{ predicted: string; actual: string }>): { macroF1: number; perClass: Record<string, number>; accuracy: number } {
  const classes = [...new Set(rows.map((r) => r.actual))]
  const perClass: Record<string, number> = {}
  for (const c of classes) perClass[c] = precisionRecallF1(rows.map((r) => ({ predicted: r.predicted === c, actual: r.actual === c }))).f1
  const acc = rows.length ? rows.filter((r) => r.predicted === r.actual).length / rows.length : 0
  return { macroF1: Math.round((classes.reduce((s, c) => s + perClass[c], 0) / Math.max(1, classes.length)) * 1000) / 1000, perClass, accuracy: Math.round(acc * 1000) / 1000 }
}

export interface MetricReport {
  n: number
  spearman: number
  pairwise: { accuracy: number; pairs: number }
  ndcg10: number
  topDecile: { precision: number; k: number }
  rangeMae: { mae: number; inRange: number }
  ordinal: { exact: number; withinOne: number; n: number }
  reliability: ReturnType<typeof scoreReliability>
}

export function evaluate(preds: Prediction[], labels: RangeLabel[], bandOrder: string[]): MetricReport {
  const pw = pairwiseAccuracy(preds, labels)
  return {
    n: preds.filter((p) => labels.some((l) => l.id === p.id)).length,
    spearman: Math.round(spearman(preds, labels) * 1000) / 1000,
    pairwise: { accuracy: Math.round(pw.accuracy * 1000) / 1000, pairs: pw.pairs },
    ndcg10: Math.round(ndcgAtK(preds, labels, 10) * 1000) / 1000,
    topDecile: topDecilePrecision(preds, labels),
    rangeMae: { mae: Math.round(rangeMae(preds, labels).mae * 10) / 10, inRange: Math.round(rangeMae(preds, labels).inRange * 1000) / 1000 },
    ordinal: ordinalAccuracy(preds, labels, bandOrder),
    reliability: scoreReliability(preds, labels),
  }
}
