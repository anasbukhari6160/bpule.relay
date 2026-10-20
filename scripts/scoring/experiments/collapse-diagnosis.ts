/**
 * Score-collapse diagnosis (Phase 9): why does 4/10–5/10 dominate?
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/experiments/collapse-diagnosis.ts
 *
 * Offline: scores every golden + ranking fixture through production V3 and
 * reports, per display bucket, the mean contribution of each of the seven
 * dimensions, plus the arithmetic ceiling an UNKNOWN-intent profile can
 * reach. No database, no model.
 */

import { GOLDEN_SET } from '../../../tests/golden/fixtures'
import { RANKING_FIXTURES } from '../../../tests/golden/fixtures-ranking'
import { runOffline } from '../../../tests/helpers/score-source'
import { displayScoreForCanonical } from '../../../src/lib/scoring/qualification'
import { V3_SCORING_WEIGHTS } from '../../../src/lib/intelligence-v3/config'

const REF = new Date('2026-10-20T00:00:00Z')

async function main() {
  const fixtures = [...GOLDEN_SET, ...RANKING_FIXTURES].filter((f) => !f.id.startsWith('attack-'))
  const rows: Array<{ id: string; display: number; intent: string; role: string; dims: Record<string, number> }> = []
  for (const f of fixtures) {
    const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: REF })
    const dims: Record<string, number> = {}
    for (const d of p.dimensions) dims[d.key] = d.contribution
    rows.push({ id: f.id, display: displayScoreForCanonical(p.score), intent: p.buyerIntent?.buyerIntentLevel ?? '?', role: p.buyerIntent?.relationshipRole ?? '?', dims })
  }
  const keys = ['buyerIntent', 'commercialPotential', 'fit', 'authority', 'timing', 'access', 'evidenceQuality']
  console.log(`\nSCORE COLLAPSE DIAGNOSIS — ${rows.length} distinct fixtures, production V3\n`)
  console.log('display  n   ' + keys.map((k) => k.slice(0, 10).padStart(11)).join('') + '   total')
  for (let d = 1; d <= 10; d++) {
    const set = rows.filter((r) => r.display === d)
    if (set.length === 0) continue
    const means = keys.map((k) => set.reduce((s, r) => s + (r.dims[k] ?? 0), 0) / set.length)
    console.log(`${String(d).padStart(5)}/10 ${String(set.length).padStart(3)}   ` + means.map((m) => m.toFixed(1).padStart(11)).join('') + `   ${means.reduce((a, b) => a + b, 0).toFixed(1)}`)
  }
  const unknown = rows.filter((r) => r.intent === 'UNKNOWN')
  const maxUnknown = Math.max(...unknown.map((r) => keys.reduce((s, k) => s + (r.dims[k] ?? 0), 0)))
  const w = V3_SCORING_WEIGHTS
  console.log(`\nUNKNOWN-intent fixtures: ${unknown.length}/${rows.length}. Buyer-intent contribution is capped at ${(0.25 * w.buyerIntent * 100).toFixed(2)} points for them (raw ≤ 0.25 × weight ${w.buyerIntent}).`)
  console.log(`Arithmetic ceiling with every other dimension at 1.0: ${((1 - w.buyerIntent) * 100 + 0.25 * w.buyerIntent * 100).toFixed(1)}. Highest UNKNOWN-intent score actually reached: ${maxUnknown.toFixed(1)}.`)
  const mid = rows.filter((r) => r.display === 4 || r.display === 5)
  const spread = (k: string) => { const xs = mid.map((r) => r.dims[k] ?? 0); return (Math.max(...xs) - Math.min(...xs)).toFixed(1) }
  console.log(`\nAmong the ${mid.length} fixtures at 4/10–5/10, contribution spread (max−min) per dimension: ` + keys.map((k) => `${k} ${spread(k)}`).join(' · '))
  const roles: Record<string, number> = {}
  for (const r of mid) roles[r.role] = (roles[r.role] ?? 0) + 1
  console.log(`Roles at 4/10–5/10: ${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
