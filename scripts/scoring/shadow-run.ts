/**
 * Production shadow run (Phase 42).
 *
 * Re-scores stored sources under the CURRENT versions WITHOUT writing anything,
 * and reports how the new decision differs from what is stored: score deltas,
 * qualification flips, action flips, intent flips, role flips, plus the
 * false-buyer / false-skip candidates a human should review.
 *
 * Two modes:
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/shadow-run.ts --golden
 *       Uses the synthetic golden set as the "stored" baseline (no database,
 *       no personal data). Useful as a smoke test of the report itself.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/shadow-run.ts --db [--org <id>] [--limit 200] [--days 30] [--model]
 *       Reads leads/captured_prospects.raw_input via the service role and
 *       recomputes each with the deterministic path (or the replay provider
 *       stored in the packet when --model is NOT given; --model re-runs the
 *       live decision model and spends AI calls).
 *       This mode processes real prospect records. Run it only on a machine
 *       and account cleared for that data; it prints aggregates and record
 *       ids only, never names, text or contact details.
 *
 * Nothing is written to the database in either mode.
 */

import { qualifyCanonicalScore, displayScoreForCanonical } from '../../src/lib/scoring/qualification'
import { SCORING_VERSION } from '../../src/lib/intelligence-v3/versions'

interface ShadowRow {
  id: string
  kind: 'lead' | 'prospect' | 'golden'
  storedScore: number | null
  storedQualification: string | null
  storedAction: string | null
  storedIntent: string | null
  storedRole: string | null
  storedVersion: string | null
  newScore: number
  newQualification: string
  newAction: string | null
  newIntent: string | null
  newRole: string | null
  fallbackUsed: boolean
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : 'true'
}

async function runGolden(): Promise<ShadowRow[]> {
  const { GOLDEN_SET } = await import('../../tests/golden/fixtures')
  const { runOffline } = await import('../../tests/helpers/score-source')
  const rows: ShadowRow[] = []
  for (const f of GOLDEN_SET) {
    const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: new Date('2026-10-20T00:00:00Z') })
    const [lo, hi] = f.expect.scoreRange ?? [p.score, p.score]
    rows.push({
      id: f.id, kind: 'golden',
      storedScore: Math.round((lo + hi) / 2), storedQualification: f.expect.qualification?.[0] ?? null, storedAction: f.expect.action?.[0] ?? null,
      storedIntent: f.expect.buyerIntent?.[0] ?? null, storedRole: f.expect.relationshipRole?.[0] ?? null, storedVersion: 'golden_expectation',
      newScore: p.score, newQualification: qualifyCanonicalScore(p.score).qualification, newAction: p.recommendedAction?.action ?? null,
      newIntent: p.buyerIntent?.buyerIntentLevel ?? null, newRole: p.buyerIntent?.relationshipRole ?? null, fallbackUsed: Boolean(p.fallbackUsed),
    })
  }
  return rows
}

async function runDb(): Promise<ShadowRow[]> {
  const { createServiceSupabase } = await import('../../src/lib/supabase/service')
  const { recomputePacketFromStored, produceV3Intelligence } = await import('../../src/lib/intelligence-v3/bridge')
  const client = createServiceSupabase()
  const limit = Number(arg('limit', '200'))
  const days = Number(arg('days', '30'))
  const org = arg('org')
  const useModel = arg('model') === 'true'
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  let q = client.from('leads').select('id, raw_input, canonical_score, canonical_intelligence').not('raw_input', 'is', null).gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  if (org) q = q.eq('organization_id', org)
  const { data: leads, error } = await q
  if (error) throw new Error(error.message)
  let q2 = client.from('captured_prospects').select('id, raw_input, canonical_score, canonical_intelligence').eq('status', 'captured').gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  if (org) q2 = q2.eq('organization_id', org)
  const { data: prospects } = await q2

  const rows: ShadowRow[] = []
  const all = [
    ...((leads ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, kind: 'lead' as const })),
    ...((prospects ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, kind: 'prospect' as const })),
  ]
  for (const r of all) {
    const raw = typeof r.raw_input === 'string' ? r.raw_input : ''
    if (raw.length < 40) continue
    const stored = (typeof r.canonical_intelligence === 'string' ? JSON.parse(r.canonical_intelligence as string) : r.canonical_intelligence) as Record<string, unknown> | null
    const storedPacket = (stored?.v3Packet ?? stored?.packet ?? stored) as Record<string, unknown> | null
    try {
      const packet = useModel
        ? (await produceV3Intelligence(raw, {})).packet
        : await recomputePacketFromStored(raw, storedPacket as never)
      if (!packet) continue
      rows.push({
        id: r.id as string, kind: r.kind,
        storedScore: (r.canonical_score as number) ?? null,
        storedQualification: (r.canonical_score as number) != null ? qualifyCanonicalScore(r.canonical_score as number).qualification : null,
        storedAction: (storedPacket?.recommendedAction as { action?: string } | undefined)?.action ?? (storedPacket?.action as string) ?? null,
        storedIntent: (storedPacket?.buyerIntent as { buyerIntentLevel?: string } | undefined)?.buyerIntentLevel ?? null,
        storedRole: (storedPacket?.buyerIntent as { relationshipRole?: string } | undefined)?.relationshipRole ?? null,
        storedVersion: (storedPacket?.versions as { scoringVersion?: string } | undefined)?.scoringVersion ?? (storedPacket?.scoreVersion as string) ?? null,
        newScore: packet.score, newQualification: qualifyCanonicalScore(packet.score).qualification,
        newAction: packet.recommendedAction?.action ?? null, newIntent: packet.buyerIntent?.buyerIntentLevel ?? null,
        newRole: packet.buyerIntent?.relationshipRole ?? null, fallbackUsed: Boolean(packet.fallbackUsed),
      })
    } catch (e) {
      console.error(`shadow: ${r.kind} ${String(r.id).slice(0, 8)}… failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return rows
}

function report(rows: ShadowRow[]) {
  const n = rows.length
  const hist = (f: (r: ShadowRow) => string | number | null) => {
    const m: Record<string, number> = {}
    for (const r of rows) { const k = String(f(r) ?? 'none'); m[k] = (m[k] ?? 0) + 1 }
    return m
  }
  const deltas = rows.filter((r) => r.storedScore !== null).map((r) => r.newScore - (r.storedScore as number))
  const abs = deltas.map(Math.abs)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const qualFlips = rows.filter((r) => r.storedQualification && r.storedQualification !== r.newQualification)
  const actionFlips = rows.filter((r) => r.storedAction && r.storedAction !== r.newAction)
  const intentFlips = rows.filter((r) => r.storedIntent && r.storedIntent !== r.newIntent)
  const roleFlips = rows.filter((r) => r.storedRole && r.storedRole !== r.newRole)
  const up = rows.filter((r) => r.storedQualification && ['LOW', 'SKIP'].includes(r.storedQualification) && ['STRONG', 'WORTH_PURSUING'].includes(r.newQualification))
  const down = rows.filter((r) => r.storedQualification && ['STRONG', 'WORTH_PURSUING'].includes(r.storedQualification) && ['LOW', 'SKIP'].includes(r.newQualification))
  const sellersHigh = rows.filter((r) => r.newRole === 'SELLER' && ['STRONG', 'WORTH_PURSUING'].includes(r.newQualification))
  const recruitersHigh = rows.filter((r) => r.newRole === 'RECRUITER' && ['STRONG', 'WORTH_PURSUING'].includes(r.newQualification))
  const buyersLow = rows.filter((r) => r.newIntent === 'HIGH' && ['LOW', 'SKIP'].includes(r.newQualification))

  console.log(`\nSHADOW RUN — ${SCORING_VERSION} — ${n} records (no writes)\n`)
  console.log('new display histogram  ', hist((r) => displayScoreForCanonical(r.newScore)))
  console.log('new qualification      ', hist((r) => r.newQualification))
  console.log('new action             ', hist((r) => r.newAction))
  console.log('new intent             ', hist((r) => r.newIntent))
  console.log('new role               ', hist((r) => r.newRole))
  console.log('stored versions        ', hist((r) => r.storedVersion))
  console.log(`\nscore delta: mean ${mean(deltas).toFixed(1)}, mean |delta| ${mean(abs).toFixed(1)}, max |delta| ${abs.length ? Math.max(...abs) : 0}`)
  console.log(`qualification flips: ${qualFlips.length}/${n}  (up to high: ${up.length}, down to low: ${down.length})`)
  console.log(`action flips: ${actionFlips.length}/${n} · intent flips: ${intentFlips.length}/${n} · role flips: ${roleFlips.length}/${n}`)
  console.log(`fallback used: ${rows.filter((r) => r.fallbackUsed).length}/${n}`)
  console.log(`\nREVIEW QUEUE (ids only)`)
  console.log(`  service providers now WORTH_PURSUING+ (${sellersHigh.length}):`, sellersHigh.slice(0, 20).map((r) => r.id.slice(0, 8)).join(', '))
  console.log(`  recruiters now WORTH_PURSUING+ (${recruitersHigh.length}):`, recruitersHigh.slice(0, 20).map((r) => r.id.slice(0, 8)).join(', '))
  console.log(`  verified buyers now LOW/SKIP (${buyersLow.length}):`, buyersLow.slice(0, 20).map((r) => r.id.slice(0, 8)).join(', '))
  console.log(`  promoted LOW/SKIP → WORTH_PURSUING+ (${up.length}):`, up.slice(0, 20).map((r) => `${r.id.slice(0, 8)} ${r.storedScore}→${r.newScore}`).join(', '))
  console.log(`  demoted WORTH_PURSUING+ → LOW/SKIP (${down.length}):`, down.slice(0, 20).map((r) => `${r.id.slice(0, 8)} ${r.storedScore}→${r.newScore}`).join(', '))

  const gate = sellersHigh.length === 0 && recruitersHigh.length === 0 && buyersLow.length === 0
  console.log(`\nGATE: ${gate ? 'PASS' : 'REVIEW REQUIRED'}\n`)
  process.exitCode = gate ? 0 : 2
}

async function main() {
  const mode = arg('db') === 'true' ? 'db' : 'golden'
  const rows = mode === 'db' ? await runDb() : await runGolden()
  report(rows)
}

main().catch((e) => { console.error(e); process.exit(1) })
