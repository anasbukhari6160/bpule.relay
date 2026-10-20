/**
 * Stale decision packets — read-only report, dry-run by default.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/stale-backfill.ts --days 365
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/stale-backfill.ts --days 365 --apply
 *
 * Dry-run prints timing, access, score and action deltas for packets whose
 * scoring version is older than the current one. It writes nothing.
 *
 * --apply recomputes those packets under the current versions and stores the
 * previous packet on the row under canonical_intelligence.decisionHistory.
 * There is no other automatic rewrite.
 */

import { writeFileSync } from 'node:fs'
import { createServiceSupabase } from '../../src/lib/supabase/service'
import { recomputePacketFromStored } from '../../src/lib/intelligence-v3/bridge'
import { parsePacket } from '../../src/lib/relay/routing-context'
import { isPacketCurrent, SCORING_VERSION } from '../../src/lib/intelligence-v3/versions'
import type { V3LeadDecisionPacket } from '../../src/lib/intelligence-v3/types'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const apply = process.argv.includes('--apply')
const days = Number(arg('days') ?? 365)
const limit = Number(arg('limit') ?? 500)
const out = arg('out') ?? '/tmp/relay-stale-packets.json'

type SkipReason = 'missing raw source' | 'invalid packet' | 'recompute failed'

interface DeltaRow {
  id: string
  kind: 'lead' | 'prospect'
  storedVersion: string | null
  score: { from: number | null; to: number | null; delta: number | null }
  timing: { from: string | null; to: string | null }
  access: { from: string | null; to: string | null }
  action: { from: string | null; to: string | null }
  role: { from: string | null; to: string | null }
}

interface SkipRow {
  id: string
  kind: 'lead' | 'prospect'
  reason: SkipReason
  rawLength: number
  storedVersion: string | null
}

async function main() {
  const client = createServiceSupabase()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data: leads } = await client.from('leads').select('id, canonical_score, canonical_intelligence, raw_input').gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  const { data: prospects } = await client.from('captured_prospects').select('id, canonical_score, canonical_intelligence, raw_input').gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  const all = [
    ...((leads ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, kind: 'lead' as const })),
    ...((prospects ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, kind: 'prospect' as const })),
  ]

  const rows: DeltaRow[] = []
  const skipped: SkipRow[] = []
  let applied = 0
  let marked = 0
  for (const r of all) {
    const raw = typeof r.raw_input === 'string' ? r.raw_input : ''
    const ci = (typeof r.canonical_intelligence === 'string' ? JSON.parse(r.canonical_intelligence) : r.canonical_intelligence) as Record<string, unknown> | null
    const packet = parsePacket(ci)
    if (!packet || isPacketCurrent(packet.versions)) continue
    const table = r.kind === 'lead' ? 'leads' : 'captured_prospects'
    const storedVersion = packet.versions?.scoringVersion ?? packet.scoreVersion ?? null
    if (raw.length < 40) {
      skipped.push({ id: String(r.id), kind: r.kind, reason: 'missing raw source', rawLength: raw.length, storedVersion })
      if (apply) marked += await markReanalysis(client, table, String(r.id), ci)
      continue
    }
    let fresh: V3LeadDecisionPacket
    try { fresh = await recomputePacketFromStored(raw, packet) } catch {
      skipped.push({ id: String(r.id), kind: r.kind, reason: 'recompute failed', rawLength: raw.length, storedVersion })
      if (apply) marked += await markReanalysis(client, table, String(r.id), ci)
      continue
    }
    const fromScore = (r.canonical_score as number | null) ?? packet.score ?? null
    const toScore = fresh.score
    rows.push({
      id: String(r.id),
      kind: r.kind,
      storedVersion,
      score: { from: fromScore, to: toScore, delta: fromScore === null ? null : toScore - fromScore },
      timing: { from: packet.resolved?.buyerTiming ?? packet.decision?.timing ?? null, to: fresh.resolved?.buyerTiming ?? null },
      access: { from: packet.resolved?.access ?? packet.decision?.access ?? null, to: fresh.resolved?.access ?? null },
      action: { from: packet.recommendedAction?.action ?? packet.action ?? null, to: fresh.recommendedAction?.action ?? null },
      role: { from: packet.buyerIntent?.relationshipRole ?? null, to: fresh.buyerIntent?.relationshipRole ?? null },
    })

    if (!apply || !ci) continue
    const history = Array.isArray(ci.decisionHistory) ? ci.decisionHistory : []
    history.push({ archivedAt: new Date().toISOString(), score: fromScore, packet })
    const next = { ...ci, v3DecisionPacket: fresh, decisionHistory: history.slice(-5), qualification: fresh.qualification?.toLowerCase() ?? ci.qualification, reanalysisStatus: null }
    const { error } = await client.from(table).update({ canonical_intelligence: next, canonical_score: toScore }).eq('id', r.id)
    if (!error) applied++
  }

  const changed = (key: 'timing' | 'access' | 'action' | 'role') => rows.filter((r) => r[key].from !== r[key].to).length
  const scoreMoved = rows.filter((r) => r.score.delta !== null && r.score.delta !== 0).length
  console.log(`\nSTALE PACKETS — current ${SCORING_VERSION} — ${rows.length} recomputable — ${skipped.length} held — ${apply ? 'APPLY' : 'DRY RUN'}\n`)
  console.log(`timing changed   ${changed('timing')}`)
  console.log(`access changed   ${changed('access')}`)
  console.log(`action changed   ${changed('action')}`)
  console.log(`role changed     ${changed('role')}`)
  console.log(`score changed    ${scoreMoved}`)
  const byReason = new Map<string, SkipRow[]>()
  for (const s of skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s])
  for (const [reason, items] of byReason) console.log(`skip ${reason}  ${items.length}  ${items.map((s) => s.id.slice(0, 8)).join(' ')}`)
  if (apply) {
    console.log(`rows written     ${applied}`)
    console.log(`reanalysis marks ${marked}`)
  }
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), scoringVersion: SCORING_VERSION, apply, rows, skipped }, null, 1))
  console.log(`report ${out}`)
}

/** Leaves the stored packet and history in place. Records that a human replay is required. */
async function markReanalysis(
  client: ReturnType<typeof createServiceSupabase>,
  table: 'leads' | 'captured_prospects',
  id: string,
  ci: Record<string, unknown> | null,
): Promise<number> {
  if (!ci) return 0
  if (ci.reanalysisStatus === 'REANALYSIS_REQUIRED') return 0
  const next = { ...ci, reanalysisStatus: 'REANALYSIS_REQUIRED' }
  const { error } = await client.from(table).update({ canonical_intelligence: next }).eq('id', id)
  return error ? 0 : 1
}

main().catch((e) => { console.error(e); process.exit(1) })
