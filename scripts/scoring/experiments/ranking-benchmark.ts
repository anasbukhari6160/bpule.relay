/**
 * Ranking benchmark (Phase 8): the program-truth fixtures in
 * tests/golden/fixtures-ranking.ts scored by production V3 and by every
 * candidate engine, with pass/fail against the independently authored
 * ranges and the five ordering rules.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/experiments/ranking-benchmark.ts [--verbose]
 *
 * Offline, no network. These fixtures are NOT part of the V3 calibration
 * contract, so V3 failures here are the measured gap, not a broken build.
 */

import { RANKING_FIXTURES } from '../../../tests/golden/fixtures-ranking'
import { runOffline } from '../../../tests/helpers/score-source'
import { featuresFromPacket } from '../../../src/lib/scoring-v4/opportunity-features'
import { ENGINES, ENGINE_IDS } from '../../../src/lib/scoring-v4/engines/registry'
import { qualifyCanonicalScore } from '../../../src/lib/scoring/qualification'
import { evaluate } from '../../../src/lib/scoring-v4/metrics'
import { makeRow, toRangeLabels, BAND_ORDER_ASC, type LabelledRow } from '../../../src/lib/scoring-v4/train/dataset'

const REF = new Date('2026-10-20T00:00:00Z')
const verbose = process.argv.includes('--verbose')

async function main() {
  const rows: LabelledRow[] = []
  const packets = new Map<string, { score: number; role: string; intent: string; action: string }>()
  for (const f of RANKING_FIXTURES) {
    const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: REF })
    const features = featuresFromPacket(p, f.rawText)!
    rows.push(makeRow({ id: f.id, category: f.category, features, v3Score: p.score, range: f.expect.scoreRange ?? null, bands: (f.expect.qualification as LabelledRow['band'][] | undefined) ?? null }))
    packets.set(f.id, { score: p.score, role: p.buyerIntent?.relationshipRole ?? '?', intent: p.buyerIntent?.buyerIntentLevel ?? '?', action: p.recommendedAction?.action ?? p.action })
  }
  const labels = toRangeLabels(rows)
  console.log(`\nRANKING BENCHMARK — ${rows.length} program-truth fixtures (offline)\n`)
  const header = ['fixture'.padEnd(52), 'expected'.padEnd(9), ...ENGINE_IDS.map((e) => e.padEnd(15))].join('')
  if (verbose) console.log(header)
  const passes: Record<string, number> = Object.fromEntries(ENGINE_IDS.map((e) => [e, 0]))
  const preds: Record<string, Array<{ id: string; score: number; band: string }>> = Object.fromEntries(ENGINE_IDS.map((e) => [e, []]))
  for (const r of rows) {
    const line: string[] = [r.id.padEnd(52), `${r.range[0]}-${r.range[1]}`.padEnd(9)]
    for (const e of ENGINE_IDS) {
      const c = ENGINES[e].score(r.features, { v3Score: r.v3Score })
      const ok = c.score >= r.range[0] && c.score <= r.range[1]
      if (ok) passes[e]++
      preds[e].push({ id: r.id, score: c.score, band: c.qualification })
      line.push(`${ok ? '✓' : '✗'} ${String(c.score).padStart(3)} ${qualifyCanonicalScore(c.score).qualification.slice(0, 5)}`.padEnd(15))
    }
    if (verbose) console.log(line.join(''))
  }
  console.log('\nPASS COUNTS (score inside the program-truth range)')
  for (const e of ENGINE_IDS) console.log(`  ${e.padEnd(15)} ${passes[e]}/${rows.length}`)
  console.log('\nMETRICS against program-truth ranges')
  for (const e of ENGINE_IDS) {
    const m = evaluate(preds[e], labels, BAND_ORDER_ASC)
    console.log(`  ${e.padEnd(15)} spearman ${m.spearman.toFixed(2)}  pairwise ${m.pairwise.accuracy.toFixed(2)} (${m.pairwise.pairs} pairs)  ndcg10 ${m.ndcg10.toFixed(2)}  top10% ${m.topDecile.precision.toFixed(2)}  inRange ${m.rangeMae.inRange.toFixed(2)}  mae ${m.rangeMae.mae.toFixed(1)}  band ${m.ordinal.exact.toFixed(2)}`)
  }
  if (!verbose) {
    console.log('\nV3 FAILURES (program truth vs production)')
    for (const r of rows) {
      const p = packets.get(r.id)!
      if (p.score < r.range[0] || p.score > r.range[1]) console.log(`  ${r.id.padEnd(52)} v3 ${String(p.score).padStart(3)} ∉ [${r.range}]  role ${p.role} intent ${p.intent} action ${p.action}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
