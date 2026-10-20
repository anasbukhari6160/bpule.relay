/**
 * Ranking benchmark (Phase 8): program-truth fixtures that are NOT part of
 * the V3 calibration contract. The test asserts the orderings the program
 * is written in for the two deterministic engines (production V3 and the
 * calibrated_v4 shadow candidate) and reports pass counts for all engines.
 * Per-fixture V3 misses are expected: they are the measured gap.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { RANKING_FIXTURES } from '../golden/fixtures-ranking'
import { runOffline } from '../helpers/score-source'
import { featuresFromPacket, type OpportunityFeatures } from '@/lib/scoring-v4/opportunity-features'
import { ENGINES, ENGINE_IDS } from '@/lib/scoring-v4/engines/registry'
import type { EngineId } from '@/lib/scoring-v4/engines/types'
import { pairwiseAccuracy, type RangeLabel } from '@/lib/scoring-v4/metrics'

const REF = new Date('2026-10-20T00:00:00Z')

interface Row { id: string; category: string; f: OpportunityFeatures; v3: number; range: [number, number] }
const rows: Row[] = []

beforeAll(async () => {
  for (const fx of RANKING_FIXTURES) {
    const p = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
    rows.push({ id: fx.id, category: fx.category, f: featuresFromPacket(p, fx.rawText)!, v3: p.score, range: fx.expect.scoreRange ?? [0, 100] })
  }
}, 120_000)

const score = (engine: EngineId, r: Row) => ENGINES[engine].score(r.f, { v3Score: r.v3 }).score
const meanOf = (engine: EngineId, ids: string[]) => { const xs = rows.filter((r) => ids.includes(r.id)).map((r) => score(engine, r)); return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) }

const RULES: Array<{ rule: string; hi: string[]; lo: string[] }> = [
  { rule: 'explicit in-stack buyer > best unknown-intent founder', hi: ['rank-buyer-saas-react-node-aws-exceptional-fit', 'rank-buyer-request-today-with-deadline'], lo: ['rank-founder-seriesA-fintech-cto-hiring', 'rank-founder-logistics-saas-30-people-v2'] },
  { rule: 'funded, hiring founder > idea-stage / side-project builder', hi: ['rank-founder-seriesA-fintech-cto-hiring', 'rank-founder-logistics-saas-30-people-v2'], lo: ['rank-builder-indie-side-project-public', 'rank-builder-idea-stage-no-product'] },
  { rule: 'external development need > employee hiring', hi: ['rank-design-agency-needs-dev-partner', 'rank-agency-owner-subcontract-overflow-buyer'], lo: ['rank-inhouse-ta-scaling-startup'] },
  { rule: 'founder > selling-only agency / recruiter', hi: ['rank-founder-seriesA-fintech-cto-hiring', 'rank-founder-healthtech-preseed-design-partners'], lo: ['rank-agency-owner-selling-only', 'rank-recruiter-agency-react-roles'] },
  { rule: 'fresh request > five-month-old request > fourteen-month-old request', hi: ['rank-buyer-request-today-with-deadline'], lo: ['rank-buyer-same-request-five-months-old'] },
  { rule: 'in-stack request > request we cannot serve', hi: ['rank-buyer-saas-react-node-aws-exceptional-fit'], lo: ['rank-buyer-marketing-agency-not-software', 'rank-buyer-unity-game-no-fit'] },
  { rule: 'hybrid with independent buy > seller-only', hi: ['rank-hybrid-data-consultancy-needs-react-frontend'], lo: ['rank-agency-owner-selling-only', 'rank-es-seller-agency'] },
]

describe('ranking benchmark (program truth, not the V3 contract)', () => {
  it('has at least 40 fixtures with ranges', () => {
    expect(RANKING_FIXTURES.length).toBeGreaterThanOrEqual(40)
    expect(RANKING_FIXTURES.every((f) => f.expect.scoreRange)).toBe(true)
  })

  for (const engine of ['v3', 'calibrated_v4'] as EngineId[]) {
    it(`${engine}: satisfies every program ordering rule`, () => {
      for (const r of RULES) {
        const a = meanOf(engine, r.hi), b = meanOf(engine, r.lo)
        expect(a, `${engine}: ${r.rule} (${a.toFixed(1)} vs ${b.toFixed(1)})`).toBeGreaterThan(b)
      }
    })
    it(`${engine}: pairwise accuracy against program-truth ranges is at least 0.85`, () => {
      const labels: RangeLabel[] = rows.map((r) => ({ id: r.id, range: r.range }))
      const preds = rows.map((r) => ({ id: r.id, score: score(engine, r) }))
      expect(pairwiseAccuracy(preds, labels).accuracy).toBeGreaterThanOrEqual(0.85)
    })
  }

  it('reports in-range pass counts for every engine (informational)', () => {
    const report = ENGINE_IDS.map((e) => `${e}: ${rows.filter((r) => { const s = score(e, r); return s >= r.range[0] && s <= r.range[1] }).length}/${rows.length}`)
    console.log(`ranking benchmark in-range: ${report.join(' · ')}`)
    expect(report.length).toBe(ENGINE_IDS.length)
  })
})
