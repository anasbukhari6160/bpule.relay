/**
 * Trainer for candidate D — gradient-boosted depth-2 regression trees with
 * a RankNet-style pairwise objective.
 *
 * For each labelled pair (hi, lo) the loss is -log σ(s_hi - s_lo). The
 * pseudo-residual of a row is the sum of pair gradients it takes part in;
 * each round fits one small tree to those residuals. Pure TypeScript — no
 * LightGBM dependency — because the labelled set is a few hundred rows and
 * the point is to measure whether a tree ensemble beats the deterministic
 * engine at this size, not to ship a heavyweight runtime.
 */

import { FEATURE_NAMES } from '../opportunity-features'
import type { GbdtNode, GbdtPairwiseModel, GbdtTree } from '../models/gbdt-pairwise.model'
import { evalNode } from '../engines/gbdt-pairwise'
import { disjointPairs, midpoint, type LabelledRow } from './dataset'

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export interface GbdtTrainOptions {
  rounds?: number
  learningRate?: number
  minLeaf?: number
  /** Validation rows for early stopping on pairwise accuracy. */
  validation?: LabelledRow[]
  version?: string
  trainedOn?: string
}

function bestSplit(X: number[][], g: number[], idx: number[], minLeaf: number): { feature: number; threshold: number; gain: number; left: number[]; right: number[] } | null {
  const d = X[0].length
  const total = idx.reduce((s, i) => s + g[i], 0)
  const base = (total * total) / idx.length
  let best: ReturnType<typeof bestSplit> = null
  for (let f = 0; f < d; f++) {
    const sorted = [...idx].sort((a, b) => X[a][f] - X[b][f])
    let leftSum = 0
    for (let p = 0; p < sorted.length - 1; p++) {
      leftSum += g[sorted[p]]
      if (X[sorted[p]][f] === X[sorted[p + 1]][f]) continue
      const nl = p + 1, nr = sorted.length - nl
      if (nl < minLeaf || nr < minLeaf) continue
      const rightSum = total - leftSum
      const gain = (leftSum * leftSum) / nl + (rightSum * rightSum) / nr - base
      if (!best || gain > best.gain) {
        best = { feature: f, threshold: (X[sorted[p]][f] + X[sorted[p + 1]][f]) / 2, gain, left: sorted.slice(0, nl), right: sorted.slice(nl) }
      }
    }
  }
  return best
}

function leaf(g: number[], idx: number[]): GbdtNode {
  return { leaf: idx.length ? idx.reduce((s, i) => s + g[i], 0) / idx.length : 0 }
}

function fitTree(X: number[][], g: number[], idx: number[], minLeaf: number, depth: number): GbdtNode {
  if (depth === 0 || idx.length < 2 * minLeaf) return leaf(g, idx)
  const s = bestSplit(X, g, idx, minLeaf)
  if (!s || s.gain <= 1e-9) return leaf(g, idx)
  const tree: GbdtTree = {
    feature: s.feature,
    threshold: Math.round(s.threshold * 1e4) / 1e4,
    left: fitTree(X, g, s.left, minLeaf, depth - 1),
    right: fitTree(X, g, s.right, minLeaf, depth - 1),
  }
  return tree
}

function pairwiseAcc(scores: number[], pairs: Array<[number, number]>): number {
  if (pairs.length === 0) return 0
  let c = 0
  for (const [hi, lo] of pairs) { const d = scores[hi] - scores[lo]; if (d > 0) c++; else if (d === 0) c += 0.5 }
  return c / pairs.length
}

export function trainGbdtPairwise(rows: LabelledRow[], opts: GbdtTrainOptions = {}): GbdtPairwiseModel {
  const rounds = opts.rounds ?? 150
  const lr = opts.learningRate ?? 0.1
  const minLeaf = opts.minLeaf ?? 4
  const X = rows.map((r) => r.vector)
  const pairs = disjointPairs(rows)
  if (pairs.length === 0) throw new Error('trainGbdtPairwise: no disjoint pairs')
  const scores = new Array(rows.length).fill(0)
  const trees: GbdtTree[] = []

  const val = opts.validation ?? []
  const valX = val.map((r) => r.vector)
  const valPairs = disjointPairs(val)
  let bestVal = -1, bestRound = 0

  for (let round = 0; round < rounds; round++) {
    const g = new Array(rows.length).fill(0)
    for (const [hi, lo] of pairs) {
      const p = sigmoid(scores[hi] - scores[lo])
      g[hi] += 1 - p
      g[lo] -= 1 - p
    }
    const tree = fitTree(X, g, rows.map((_, i) => i), minLeaf, 2)
    if ('leaf' in tree) break
    trees.push(tree)
    for (let i = 0; i < rows.length; i++) scores[i] += lr * evalNode(tree, X[i])
    if (val.length > 0 && valPairs.length > 0) {
      const vs = valX.map((x) => trees.reduce((s, t) => s + lr * evalNode(t, x), 0))
      const acc = pairwiseAcc(vs, valPairs)
      if (acc > bestVal + 1e-9) { bestVal = acc; bestRound = trees.length }
    } else {
      bestRound = trees.length
    }
  }
  const kept = trees.slice(0, Math.max(1, bestRound))

  // Latent → score affine map, least squares on train midpoints.
  const z = X.map((x) => kept.reduce((s, t) => s + lr * evalNode(t, x), 0))
  const yv = rows.map((r) => midpoint(r.range))
  const mz = z.reduce((a, b) => a + b, 0) / z.length
  const my = yv.reduce((a, b) => a + b, 0) / yv.length
  let num = 0, den = 0
  for (let i = 0; i < z.length; i++) { num += (z[i] - mz) * (yv[i] - my); den += (z[i] - mz) ** 2 }
  const b = den === 0 ? 10 : num / den
  const a = my - b * mz

  return {
    version: opts.version ?? `gbdt_pairwise_v1.${Date.now().toString(36)}`,
    trainedOn: opts.trainedOn ?? `${rows.length} rows, ${pairs.length} pairs, ${kept.length} trees`,
    featureNames: [...FEATURE_NAMES],
    learningRate: lr,
    trees: kept,
    scoreMap: { a: Math.round(a * 100) / 100, b: Math.round(b * 1000) / 1000 },
  }
}
