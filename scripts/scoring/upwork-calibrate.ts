/**
 * Upwork golden-set calibration report.
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/upwork-calibrate.ts
 */
import { UPWORK_GOLDEN } from '../../tests/upwork-golden/fixtures'
import { readUpworkJobFacts } from '../../src/lib/upwork/facts'
import { scoreUpworkFacts, UPWORK_SCORING_VERSION } from '../../src/lib/upwork/score'

const rows = UPWORK_GOLDEN.map((f) => {
  const facts = readUpworkJobFacts(f.rawText)
  const s = scoreUpworkFacts(facts)
  const e = f.expect
  const problems: string[] = []
  if (e.rateType && facts.rate.type !== e.rateType) problems.push(`rateType ${facts.rate.type}≠${e.rateType}`)
  if (e.hourlyMax !== undefined && facts.rate.hourlyMax !== e.hourlyMax) problems.push(`hourlyMax ${facts.rate.hourlyMax}≠${e.hourlyMax}`)
  if (e.fixedBudget !== undefined && facts.rate.fixedBudget !== e.fixedBudget) problems.push(`fixed ${facts.rate.fixedBudget}≠${e.fixedBudget}`)
  if (e.proposalsRange && JSON.stringify(facts.proposals.range) !== JSON.stringify(e.proposalsRange)) problems.push('proposals')
  if (e.scoreRange && (s.score < e.scoreRange[0] || s.score > e.scoreRange[1])) problems.push(`score ${s.score}∉[${e.scoreRange}]`)
  if (e.verdict && !e.verdict.includes(s.verdict)) problems.push(`verdict ${s.verdict}`)
  if (e.suspicious !== undefined && (facts.suspicious.length > 0) !== e.suspicious) problems.push('suspicious')
  return { id: f.id, category: f.category, score: s.score, display: s.display, qualification: s.qualification, verdict: s.verdict, rate: facts.rate.type, cap: s.cap?.reason ?? null, problems }
})

const n = rows.length
const pass = rows.filter((r) => r.problems.length === 0).length
console.log(`Upwork golden set (${UPWORK_SCORING_VERSION}): ${n} fixtures, ${pass} pass, ${n - pass} fail\n`)
const hist = (k: (r: typeof rows[number]) => string | number) => { const m: Record<string, number> = {}; for (const r of rows) { const key = String(k(r)); m[key] = (m[key] ?? 0) + 1 } return Object.entries(m).sort().map(([a, b]) => `${a}:${b} (${Math.round((b / n) * 100)}%)`).join('  ') }
console.log('Display histogram: ', hist((r) => r.display))
console.log('Qualification:     ', hist((r) => r.qualification))
console.log('Verdict:           ', hist((r) => r.verdict))
console.log('Rate type parsed:  ', hist((r) => r.rate))
console.log('Caps applied:      ', hist((r) => r.cap ?? 'none'))
console.log('\nPer category (n, mean, pass):')
const cats = [...new Set(rows.map((r) => r.category))].sort()
for (const c of cats) { const rs = rows.filter((r) => r.category === c); console.log(`  ${c.padEnd(18)} n=${String(rs.length).padStart(3)}  mean=${String(Math.round(rs.reduce((a, r) => a + r.score, 0) / rs.length)).padStart(3)}  pass=${rs.filter((r) => !r.problems.length).length}/${rs.length}`) }
const failed = rows.filter((r) => r.problems.length)
if (failed.length) { console.log('\nFailures:'); for (const r of failed) console.log(`  ${r.id}: ${r.problems.join('; ')}`) }
process.exitCode = failed.length ? 1 : 0
