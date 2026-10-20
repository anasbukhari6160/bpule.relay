/**
 * Offline calibration runner — scores every golden fixture through the
 * production pipeline with no network and prints distributions + failures.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/calibrate.ts [--json out.json] [--verbose]
 */
import { writeFileSync } from 'node:fs'
import { GOLDEN_SET, type GoldenFixture } from '../../tests/golden/fixtures'
import { runOffline } from '../../tests/helpers/score-source'
import { qualifyCanonicalScore, displayScoreForCanonical } from '../../src/lib/scoring/qualification'

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null

interface Row {
  id: string
  category: string
  score: number
  display: number
  qualification: string
  expectedQualification: string[]
  intent: string
  expectedIntent: string[]
  cp: string
  action: string
  expectedAction: string[]
  confidence: string
  role: string
  pass: boolean
  errors: string[]
}

function inRange(v: number, [lo, hi]: [number, number]) { return v >= lo && v <= hi }

async function main() {
  const rows: Row[] = []
  for (const f of GOLDEN_SET as GoldenFixture[]) {
    const packet = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: new Date('2026-10-20T00:00:00Z') })
    const q = qualifyCanonicalScore(packet.score).qualification
    const errors: string[] = []
    if (f.expect.scoreRange && !inRange(packet.score, f.expect.scoreRange)) errors.push(`score ${packet.score} ∉ [${f.expect.scoreRange}]`)
    if (f.expect.qualification && !f.expect.qualification.includes(q)) errors.push(`qualification ${q} ∉ ${f.expect.qualification.join('|')}`)
    const intent = packet.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN'
    if (f.expect.buyerIntent && !f.expect.buyerIntent.includes(intent)) errors.push(`intent ${intent} ∉ ${f.expect.buyerIntent.join('|')}`)
    const cp = packet.resolved?.commercialPotential ?? 'LOW'
    if (f.expect.commercialPotential && !f.expect.commercialPotential.includes(cp)) errors.push(`cp ${cp} ∉ ${f.expect.commercialPotential.join('|')}`)
    const action = packet.recommendedAction?.action ?? packet.action
    if (f.expect.action && !f.expect.action.includes(action)) errors.push(`action ${action} ∉ ${f.expect.action.join('|')}`)
    const role = packet.buyerIntent?.relationshipRole ?? 'UNKNOWN'
    if (f.expect.relationshipRole && !f.expect.relationshipRole.includes(role)) errors.push(`role ${role} ∉ ${f.expect.relationshipRole.join('|')}`)
    if (f.expect.currentIndustry !== undefined && (packet.orgContext?.currentIndustry ?? null) !== f.expect.currentIndustry) errors.push(`industry ${packet.orgContext?.currentIndustry} ≠ ${f.expect.currentIndustry}`)
    if (f.expect.notIndustry && (packet.orgContext?.currentIndustry ?? null) === f.expect.notIndustry) errors.push(`industry must not be ${f.expect.notIndustry}`)
    if (f.expect.confidence && !f.expect.confidence.includes(packet.confidenceDetail?.label ?? 'LOW')) errors.push(`confidence ${packet.confidenceDetail?.label} ∉ ${f.expect.confidence.join('|')}`)
    for (const phrase of f.mustNotCredit ?? []) {
      const hay = [...packet.reasons, ...packet.dimensions.flatMap((d: { evidence?: Array<{ kind: string; text: string }> }) => (d.evidence ?? []).filter((e) => e.kind !== 'inference').map((e) => e.text))].join(' | ')
      if (hay.includes(phrase)) errors.push(`credited forbidden "${phrase}"`)
    }
    if (f.expect.verifiedBudget !== undefined && Boolean(packet.buyerIntent?.verifiedBudget) !== f.expect.verifiedBudget) errors.push(`budget ${packet.buyerIntent?.verifiedBudget} ≠ ${f.expect.verifiedBudget}`)
    if (f.expect.verifiedHiring !== undefined && Boolean(packet.buyerIntent?.verifiedHiringNeed) !== f.expect.verifiedHiring) errors.push(`hiring ${packet.buyerIntent?.verifiedHiringNeed} ≠ ${f.expect.verifiedHiring}`)
    rows.push({
      id: f.id, category: f.category, score: packet.score, display: displayScoreForCanonical(packet.score), qualification: q,
      expectedQualification: f.expect.qualification ?? [], intent, expectedIntent: f.expect.buyerIntent ?? [], cp, action, expectedAction: f.expect.action ?? [],
      confidence: packet.confidenceDetail?.label ?? '?', role, pass: errors.length === 0, errors,
    })
  }

  const hist = (key: (r: Row) => string | number) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(String(key(r)), (m.get(String(key(r))) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }
  const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`

  console.log(`\nGolden set: ${rows.length} fixtures, ${rows.filter((r) => r.pass).length} pass, ${rows.filter((r) => !r.pass).length} fail\n`)
  const distinct = rows.filter((r) => !r.id.startsWith('attack-'))
  const histOf = (set: Row[], key: (r: Row) => string | number) => {
    const m = new Map<string, number>()
    for (const r of set) m.set(String(key(r)), (m.get(String(key(r))) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, v]) => `${k}:${v} (${Math.round((v / set.length) * 100)}%)`).join('  ')
  }
  console.log('ALL fixtures')
  console.log('  Canonical histogram (by decile):', hist((r) => Math.floor(r.score / 10) * 10).map(([k, v]) => `${k}:${v}`).join('  '))
  console.log('  Display histogram:', hist((r) => r.display).map(([k, v]) => `${k}:${v} (${pct(v)})`).join('  '))
  console.log('  Qualification histogram:', hist((r) => r.qualification).map(([k, v]) => `${k}:${v} (${pct(v)})`).join('  '))
  console.log('  Action histogram:', hist((r) => r.action).map(([k, v]) => `${k}:${v}`).join('  '))
  console.log('  Confidence histogram:', hist((r) => r.confidence).map(([k, v]) => `${k}:${v}`).join('  '))
  console.log(`DISTINCT profiles (excluding the ${rows.length - distinct.length} attack clones of one base profile): n=${distinct.length}`)
  console.log('  Display histogram:', histOf(distinct, (r) => r.display))
  console.log('  Qualification histogram:', histOf(distinct, (r) => r.qualification))
  console.log('  Action histogram:', histOf(distinct, (r) => r.action))
  console.log('  Confidence histogram:', histOf(distinct, (r) => r.confidence))

  const byCat = new Map<string, Row[]>()
  for (const r of rows) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r])
  console.log('\nPer category (n, mean score, pass):')
  for (const [cat, rs] of [...byCat.entries()].sort()) {
    const mean = Math.round(rs.reduce((s, r) => s + r.score, 0) / rs.length)
    console.log(`  ${cat.padEnd(28)} n=${String(rs.length).padStart(3)}  mean=${String(mean).padStart(3)}  pass=${rs.filter((r) => r.pass).length}/${rs.length}`)
  }

  const failures = rows.filter((r) => !r.pass)
  if (failures.length > 0) {
    console.log('\nFAILURES (EXPECTED vs ACTUAL):')
    for (const r of failures) console.log(`  ${r.id.padEnd(34)} score=${String(r.score).padStart(3)} q=${r.qualification.padEnd(15)} intent=${r.intent.padEnd(7)} cp=${r.cp.padEnd(6)} act=${r.action.padEnd(22)} :: ${r.errors.join('; ')}`)
  }
  if (verbose) {
    console.log('\nALL:')
    for (const r of rows) console.log(`  ${r.pass ? '✓' : '✗'} ${r.id.padEnd(34)} ${String(r.score).padStart(3)} ${String(r.display).padStart(2)}/10 ${r.qualification.padEnd(15)} ${r.intent.padEnd(7)} ${r.cp.padEnd(6)} ${r.action.padEnd(22)} ${r.confidence}`)
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
