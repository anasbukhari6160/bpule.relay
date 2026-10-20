/**
 * Labelled rows for training and evaluating candidate engines.
 *
 * A row is: canonical OpportunityFeatures + its numeric vector + a RANGE
 * label + the band the label belongs to + split membership. Rows come from
 * the golden set today and from human labels (scoring_labels) and verified
 * outcomes as those accumulate; the engines never see where a label came
 * from, only the range.
 */

import { QUALIFICATION_BANDS, qualifyCanonicalScore, type CanonicalQualification } from '@/lib/scoring/qualification'
import type { OpportunityFeatures } from '../opportunity-features'
import { featureVector } from '../opportunity-features'
import type { RangeLabel } from '../metrics'
import { isAttackClone, splitFor, type Split } from './split'

export interface LabelledRow {
  id: string
  category: string
  features: OpportunityFeatures
  vector: number[]
  range: [number, number]
  band: CanonicalQualification
  split: Split
  attackClone: boolean
  /** Production (v3) score for the same row, for candidate A. */
  v3Score: number
  /** Base profile id for attack clones (invariance check). */
  baseId?: string | null
}

/** Band order from lowest to highest. */
export const BAND_ORDER_ASC: CanonicalQualification[] = [...QUALIFICATION_BANDS].map((b) => b.qualification).reverse()

export function bandIndex(q: CanonicalQualification): number {
  return BAND_ORDER_ASC.indexOf(q)
}

/** Range for a label that only names a band. */
export function rangeForBand(q: CanonicalQualification): [number, number] {
  const b = QUALIFICATION_BANDS.find((x) => x.qualification === q)!
  return [b.min, b.max]
}

export function midpoint(range: [number, number]): number {
  return (range[0] + range[1]) / 2
}

export function makeRow(params: {
  id: string
  category: string
  features: OpportunityFeatures
  v3Score: number
  range?: [number, number] | null
  bands?: CanonicalQualification[] | null
  baseId?: string | null
}): LabelledRow {
  let range = params.range ?? null
  if (!range && params.bands && params.bands.length > 0) {
    const idx = params.bands.map(bandIndex)
    range = [rangeForBand(BAND_ORDER_ASC[Math.min(...idx)])[0], rangeForBand(BAND_ORDER_ASC[Math.max(...idx)])[1]]
  }
  if (!range) range = [0, 100]
  const band = params.bands?.length === 1 ? params.bands[0] : qualifyCanonicalScore(midpoint(range)).qualification
  const clone = isAttackClone(params.id)
  return {
    id: params.id,
    category: params.category,
    features: params.features,
    vector: featureVector(params.features),
    range,
    band,
    split: clone ? 'train' : splitFor(params.id),
    attackClone: clone,
    v3Score: params.v3Score,
    baseId: params.baseId ?? null,
  }
}

export function toRangeLabels(rows: LabelledRow[]): RangeLabel[] {
  return rows.map((r) => ({ id: r.id, range: r.range, band: r.band, group: r.category }))
}

/** Pairs (hi, lo) from rows whose ranges are disjoint. */
export function disjointPairs(rows: LabelledRow[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      if (a.range[0] > b.range[1]) pairs.push([i, j])
      else if (b.range[0] > a.range[1]) pairs.push([j, i])
    }
  }
  return pairs
}
