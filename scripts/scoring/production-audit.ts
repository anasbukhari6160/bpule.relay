/**
 * PRODUCTION CORPUS AUDIT — read-only, team-run.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/production-audit.ts [--org <id>] [--days 365] [--limit 500] [--out audit.json]
 *
 * Loads every stored LinkedIn / Upwork extraction, its messages, sender
 * assignment, versions and outcomes; recomputes each decision under the
 * CURRENT scoring versions WITHOUT any model call and WITHOUT writing; and
 * emits a row-level report of flags:
 *
 *   FALSE_HIGH   stored STRONG/WORTH_PURSUING, recomputed LOW/SKIP, or a seller /
 *                recruiter / candidate at WORTH_PURSUING+
 *   FALSE_LOW    verified buyer request (intent HIGH) stored at LOW/SKIP
 *   WRONG_BUYER  stored role BUYER / intent HIGH with no verified first-person request
 *   WRONG_SELLER seller language in the source but stored role BUYER
 *   WRONG_INDUSTRY  stored current industry ≠ industry the reader resolves now
 *   WRONG_TIMING stored timing CURRENT/URGENT while the source has no current request
 *   WRONG_ACCESS stored DIRECT access on a 3rd-degree / no-route source
 *   WRONG_SENDER current sender ≥ 20 points below the best sender
 *   BAD_MESSAGE  a sent or drafted message fails the message quality gate
 *   STALE_CACHE  stored packet predates the current versions
 *   CROSS_SURFACE_MISMATCH  stored qualification / display disagree with the band of the stored score
 *
 * PRIVACY: this script processes prospect records. Run it only from an
 * account and machine cleared for that data. The console shows aggregates
 * and ids only. The JSON report (--out) contains ids, scores, flags and
 * message-gate reasons — never names, source text or message text.
 */

import { writeFileSync } from 'node:fs'
import { createServiceSupabase } from '../../src/lib/supabase/service'
import { recomputePacketFromStored } from '../../src/lib/intelligence-v3/bridge'
import { parsePacket, loadSenderProfiles, routeLead } from '../../src/lib/relay/routing-context'
import { readSourceFacts } from '../../src/lib/intelligence-v3/source-facts-model'
import { qualifyCanonicalScore, displayScoreForCanonical, fromStoredQualification } from '../../src/lib/scoring/qualification'
import { isPacketCurrent, SCORING_VERSION } from '../../src/lib/intelligence-v3/versions'
import { ROUTING_MISMATCH_DELTA } from '../../src/lib/intelligence-v3/action/recommended-action'
import { evaluateMessage } from '../../src/lib/relay/message-forge'
import type { V3LeadDecisionPacket } from '../../src/lib/intelligence-v3/types'

type Flag = 'FALSE_HIGH' | 'FALSE_LOW' | 'WRONG_BUYER' | 'WRONG_SELLER' | 'WRONG_INDUSTRY' | 'WRONG_TIMING' | 'WRONG_ACCESS' | 'WRONG_SENDER' | 'BAD_MESSAGE' | 'STALE_CACHE' | 'CROSS_SURFACE_MISMATCH'

interface AuditRow {
  id: string
  kind: 'lead' | 'prospect'
  source: string | null
  createdAt: string
  status: string | null
  storedScore: number | null
  storedDisplay: number | null
  storedQualification: string | null
  storedIntent: string | null
  storedRole: string | null
  storedCP: string | null
  storedFit: string | null
  storedTiming: string | null
  storedAccess: string | null
  storedAction: string | null
  storedVersion: string | null
  newScore: number | null
  newQualification: string | null
  newIntent: string | null
  newRole: string | null
  newIndustry: string | null
  newTiming: string | null
  newAccess: string | null
  newAction: string | null
  currentSenderId: string | null
  bestSenderId: string | null
  currentSenderMatch: number | null
  bestSenderMatch: number | null
  matchDelta: number | null
  messages: { sent: number; drafts: number; inbound: number; gateFailures: Array<{ type: string; reasons: string[] }> }
  outcome: { replied: boolean; positive: boolean; meeting: boolean; won: boolean; lost: boolean }
  flags: Flag[]
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : 'true'
}

const HIGH = new Set(['STRONG', 'WORTH_PURSUING'])
const LOW = new Set(['LOW', 'SKIP'])

async function main() {
  const client = createServiceSupabase()
  const org = arg('org')
  const days = Number(arg('days', '365'))
  const limit = Number(arg('limit', '500'))
  const out = arg('out', 'production-audit.json')!
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  let lq = client.from('leads').select('id, organization_id, owner_rep_id, source, status, created_at, raw_input, canonical_score, canonical_intelligence, sender_profile_id, best_profile_id, best_profile_match_score, connection_accepted_at').gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  if (org) lq = lq.eq('organization_id', org)
  const { data: leads, error } = await lq
  if (error) throw new Error(error.message)
  let pq = client.from('captured_prospects').select('id, organization_id, owner_rep_id, status, created_at, raw_input, canonical_score, canonical_intelligence, sender_profile_id').eq('status', 'captured').gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  if (org) pq = pq.eq('organization_id', org)
  const { data: prospects } = await pq

  const leadIds = (leads ?? []).map((l) => l.id as string)
  const { data: messages } = leadIds.length ? await client.from('messages').select('lead_id, type, direction, draft_text, sent_text, sent_at').in('lead_id', leadIds) : { data: [] }
  const { data: outcomes } = leadIds.length ? await client.from('outcomes').select('lead_id, stage').in('lead_id', leadIds) : { data: [] }
  const msgByLead = new Map<string, Array<Record<string, unknown>>>()
  for (const m of (messages ?? []) as Array<Record<string, unknown>>) { const k = m.lead_id as string; msgByLead.set(k, [...(msgByLead.get(k) ?? []), m]) }
  const outByLead = new Map<string, Set<string>>()
  for (const o of (outcomes ?? []) as Array<Record<string, unknown>>) { const k = o.lead_id as string; outByLead.set(k, new Set([...(outByLead.get(k) ?? []), o.stage as string])) }

  const senderCache = new Map<string, Awaited<ReturnType<typeof loadSenderProfiles>>>()
  const rows: AuditRow[] = []
  const all = [
    ...((leads ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, kind: 'lead' as const })),
    ...((prospects ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, kind: 'prospect' as const })),
  ]

  for (const r of all) {
    const id = r.id as string
    const raw = typeof r.raw_input === 'string' ? r.raw_input : ''
    const packet = parsePacket(r.canonical_intelligence)
    const ci = (typeof r.canonical_intelligence === 'string' ? JSON.parse(r.canonical_intelligence as string) : r.canonical_intelligence) as Record<string, unknown> | null
    const storedScore = (r.canonical_score as number | null) ?? packet?.score ?? null
    const storedBand = storedScore === null ? null : qualifyCanonicalScore(storedScore).qualification
    const flags = new Set<Flag>()

    const row: AuditRow = {
      id, kind: r.kind, source: (r.source as string) ?? null, createdAt: r.created_at as string, status: (r.status as string) ?? null,
      storedScore, storedDisplay: storedScore === null ? null : displayScoreForCanonical(storedScore), storedQualification: storedBand,
      storedIntent: packet?.buyerIntent?.buyerIntentLevel ?? null, storedRole: packet?.buyerIntent?.relationshipRole ?? null,
      storedCP: packet?.resolved?.commercialPotential ?? null, storedFit: packet?.resolved?.fit ?? packet?.decision?.fit ?? null,
      storedTiming: packet?.resolved?.buyerTiming ?? packet?.decision?.timing ?? null, storedAccess: packet?.resolved?.access ?? packet?.decision?.access ?? null,
      storedAction: packet?.recommendedAction?.action ?? packet?.action ?? null, storedVersion: packet?.versions?.scoringVersion ?? packet?.scoreVersion ?? null,
      newScore: null, newQualification: null, newIntent: null, newRole: null, newIndustry: null, newTiming: null, newAccess: null, newAction: null,
      currentSenderId: (r.sender_profile_id as string) ?? null, bestSenderId: null, currentSenderMatch: null, bestSenderMatch: null, matchDelta: null,
      messages: { sent: 0, drafts: 0, inbound: 0, gateFailures: [] },
      outcome: { replied: false, positive: false, meeting: false, won: r.status === 'won', lost: r.status === 'lost' || r.status === 'dead' || r.status === 'no' },
      flags: [],
    }

    // Stored-vs-stored consistency (what every surface showed).
    if (typeof ci?.qualification === 'string' && storedBand && fromStoredQualification(ci.qualification as string) !== storedBand) flags.add('CROSS_SURFACE_MISMATCH')
    if (packet && !isPacketCurrent(packet.versions)) flags.add('STALE_CACHE')

    // Recompute under current versions (deterministic replay, no model call).
    let fresh: V3LeadDecisionPacket | null = null
    if (packet && raw.length >= 40) {
      try { fresh = await recomputePacketFromStored(raw, packet) } catch (e) { console.error(`recompute failed ${id.slice(0, 8)}: ${e instanceof Error ? e.message : e}`) }
    }
    const facts = raw.length >= 40 ? readSourceFacts(raw) : null
    if (fresh) {
      row.newScore = fresh.score
      row.newQualification = qualifyCanonicalScore(fresh.score).qualification
      row.newIntent = fresh.buyerIntent?.buyerIntentLevel ?? null
      row.newRole = fresh.buyerIntent?.relationshipRole ?? null
      row.newTiming = fresh.resolved?.buyerTiming ?? null
      row.newAccess = fresh.resolved?.access ?? null
      row.newAction = fresh.recommendedAction?.action ?? null
    }
    row.newIndustry = facts?.currentIndustry ?? null

    if (storedBand && HIGH.has(storedBand)) {
      if (row.newQualification && LOW.has(row.newQualification)) flags.add('FALSE_HIGH')
      if (['SELLER', 'RECRUITER', 'CANDIDATE'].includes(row.newRole ?? row.storedRole ?? '')) flags.add('FALSE_HIGH')
    }
    if (storedBand && LOW.has(storedBand) && (row.newIntent === 'HIGH' || (row.newQualification === 'STRONG'))) flags.add('FALSE_LOW')
    if ((row.storedRole === 'BUYER' || row.storedIntent === 'HIGH') && facts && !facts.buyerRequest) flags.add('WRONG_BUYER')
    if (facts?.sellerActivity && row.storedRole === 'BUYER') flags.add('WRONG_SELLER')
    const storedIndustry = packet?.sourceFacts?.currentIndustry ?? null
    if (storedIndustry && row.newIndustry && storedIndustry !== row.newIndustry) flags.add('WRONG_INDUSTRY')
    if (['CURRENT', 'URGENT'].includes(row.storedTiming ?? '') && row.newTiming && !['CURRENT', 'URGENT'].includes(row.newTiming)) flags.add('WRONG_TIMING')
    if (row.storedAccess === 'DIRECT' && row.newAccess && row.newAccess !== 'DIRECT') flags.add('WRONG_ACCESS')

    // Sender routing.
    const orgId = r.organization_id as string
    const repId = (r.owner_rep_id as string) ?? ''
    const cacheKey = `${orgId}:${repId}`
    if (!senderCache.has(cacheKey)) {
      try { senderCache.set(cacheKey, await loadSenderProfiles(client, orgId, repId)) } catch { senderCache.set(cacheKey, []) }
    }
    const senders = senderCache.get(cacheKey) ?? []
    if (senders.length > 0) {
      const routing = routeLead({ rawInput: raw, company: null, contactName: null, canonicalIntelligence: r.canonical_intelligence, senderProfileId: row.currentSenderId }, fresh ?? packet, senders)
      row.bestSenderId = routing.bestSenderId
      row.bestSenderMatch = routing.bestSenderMatch
      row.currentSenderMatch = routing.currentSenderMatch
      row.matchDelta = routing.mismatchDelta
      if ((routing.mismatchDelta ?? 0) >= ROUTING_MISMATCH_DELTA) flags.add('WRONG_SENDER')
    }

    // Messages and the quality gate.
    for (const m of msgByLead.get(id) ?? []) {
      const dir = (m.direction as string) ?? 'outbound'
      if (dir === 'inbound') { row.messages.inbound++; row.outcome.replied = true; continue }
      const text = (m.sent_text as string) || (m.draft_text as string) || ''
      if (m.sent_text) row.messages.sent++; else row.messages.drafts++
      if (!text) continue
      const type = (m.type as string) ?? 'dm'
      const stage = type === 'connection' ? 'connection' : type === 'followup' ? 'follow_up' : type === 'reply' ? 'reply' : 'first_dm'
      try {
        const gate = evaluateMessage(text, null, 'linkedin', stage as never)
        if (!gate.passed) { row.messages.gateFailures.push({ type, reasons: gate.reasons.slice(0, 4) }); flags.add('BAD_MESSAGE') }
      } catch { /* gate unavailable for this stage */ }
    }
    const stages = outByLead.get(id) ?? new Set<string>()
    if (stages.has('replied') || r.status === 'replied') row.outcome.replied = true
    if (stages.has('check') || stages.has('slice')) row.outcome.positive = true
    if (stages.has('close')) row.outcome.meeting = true

    row.flags = [...flags]
    rows.push(row)
  }

  report(rows)
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), scoringVersion: SCORING_VERSION, rows }, null, 1))
  console.log(`\nRow-level report written to ${out} (ids, scores, flags; no text).`)
}

function report(rows: AuditRow[]) {
  const n = rows.length
  const count = (f: (r: AuditRow) => boolean) => rows.filter(f).length
  const pct = (x: number) => (n ? `${Math.round((x / n) * 100)}%` : '0%')
  console.log(`\nPRODUCTION CORPUS AUDIT — ${SCORING_VERSION} — ${n} extractions (read-only)\n`)
  const flags: Flag[] = ['FALSE_HIGH', 'FALSE_LOW', 'WRONG_BUYER', 'WRONG_SELLER', 'WRONG_INDUSTRY', 'WRONG_TIMING', 'WRONG_ACCESS', 'WRONG_SENDER', 'BAD_MESSAGE', 'STALE_CACHE', 'CROSS_SURFACE_MISMATCH']
  for (const f of flags) {
    const hits = rows.filter((r) => r.flags.includes(f))
    console.log(`${f.padEnd(24)} ${String(hits.length).padStart(4)}  ${pct(hits.length).padStart(4)}  ${hits.slice(0, 12).map((r) => r.id.slice(0, 8)).join(' ')}`)
  }
  const hist = (key: (r: AuditRow) => string | number | null) => { const m: Record<string, number> = {}; for (const r of rows) { const k = String(key(r) ?? 'none'); m[k] = (m[k] ?? 0) + 1 } return m }
  console.log('\nstored qualification ', hist((r) => r.storedQualification))
  console.log('recomputed qualif.   ', hist((r) => r.newQualification))
  console.log('stored display       ', hist((r) => r.storedDisplay))
  console.log('recomputed intent    ', hist((r) => r.newIntent))
  console.log('recomputed role      ', hist((r) => r.newRole))
  console.log('stored versions      ', hist((r) => r.storedVersion))

  // Precision / recall proxies for "buyer" against the recomputed verified request.
  const storedBuyer = rows.filter((r) => r.storedIntent === 'HIGH')
  const trueBuyer = rows.filter((r) => r.newIntent === 'HIGH')
  const tp = rows.filter((r) => r.storedIntent === 'HIGH' && r.newIntent === 'HIGH').length
  console.log(`\nbuyer precision (stored HIGH confirmed by source): ${storedBuyer.length ? Math.round((tp / storedBuyer.length) * 100) : 0}%  (${tp}/${storedBuyer.length})`)
  console.log(`buyer recall (source HIGH that was stored HIGH):   ${trueBuyer.length ? Math.round((tp / trueBuyer.length) * 100) : 0}%  (${tp}/${trueBuyer.length})`)
  console.log(`action agreement (stored action == recomputed):    ${pct(count((r) => r.storedAction !== null && r.storedAction === r.newAction))}`)

  // Outcome linking — directional only.
  const withMsgs = rows.filter((r) => r.messages.sent > 0)
  const byBand = (band: Set<string>) => withMsgs.filter((r) => band.has(r.newQualification ?? r.storedQualification ?? ''))
  const rate = (xs: AuditRow[], f: (r: AuditRow) => boolean) => (xs.length ? `${Math.round((xs.filter(f).length / xs.length) * 100)}% of ${xs.length}` : 'n/a')
  console.log(`\nOUTCOMES (directional, small samples — not causal)`)
  console.log(`  replied  | STRONG/WP ${rate(byBand(HIGH), (r) => r.outcome.replied)} | MAYBE ${rate(byBand(new Set(['MAYBE'])), (r) => r.outcome.replied)} | LOW/SKIP ${rate(byBand(LOW), (r) => r.outcome.replied)}`)
  console.log(`  positive | STRONG/WP ${rate(byBand(HIGH), (r) => r.outcome.positive)} | MAYBE ${rate(byBand(new Set(['MAYBE'])), (r) => r.outcome.positive)} | LOW/SKIP ${rate(byBand(LOW), (r) => r.outcome.positive)}`)
  console.log(`  won      | STRONG/WP ${rate(byBand(HIGH), (r) => r.outcome.won)} | MAYBE ${rate(byBand(new Set(['MAYBE'])), (r) => r.outcome.won)} | LOW/SKIP ${rate(byBand(LOW), (r) => r.outcome.won)}`)
  const mism = withMsgs.filter((r) => r.flags.includes('WRONG_SENDER'))
  const ok = withMsgs.filter((r) => !r.flags.includes('WRONG_SENDER') && r.bestSenderId)
  console.log(`  replied  | sender mismatch ${rate(mism, (r) => r.outcome.replied)} | sender ok ${rate(ok, (r) => r.outcome.replied)}`)
  const bad = withMsgs.filter((r) => r.flags.includes('BAD_MESSAGE'))
  const good = withMsgs.filter((r) => !r.flags.includes('BAD_MESSAGE'))
  console.log(`  replied  | message failed gate ${rate(bad, (r) => r.outcome.replied)} | message passed gate ${rate(good, (r) => r.outcome.replied)}`)

  const top = [...rows].filter((r) => r.flags.length).sort((a, b) => b.flags.length - a.flags.length).slice(0, 20)
  console.log(`\nTOP ${top.length} FLAGGED ROWS (ids only)`)
  for (const r of top) console.log(`  ${r.kind} ${r.id.slice(0, 8)}  stored ${r.storedScore ?? '—'}→${r.newScore ?? '—'}  ${r.flags.join(',')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
