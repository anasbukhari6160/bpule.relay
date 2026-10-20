/**
 * MASTER AUDIT DATASET (Phases 1, 2, 3, 27, 28) — read-only.
 *
 *   --counts            Exact row counts per table and score/qualification
 *                       histograms. Reads only ids, numeric scores and
 *                       timestamps: no names, no source text. Safe to run
 *                       from any account.
 *
 *   --db [--org <id>] [--days 365] [--limit 2000] [--out audit-dataset.jsonl]
 *                       One row per stored LinkedIn extraction (leads +
 *                       captured prospects), deduplicated to UNIQUE
 *                       opportunities by opportunityKey. Each row carries
 *                       the current decision, OpportunityFeatures, every
 *                       candidate engine's score/action, sender routing,
 *                       message/outcome/feedback counts and versions. Reads
 *                       prospect records: run only from an account cleared
 *                       for that data. The JSONL contains ids, hashes,
 *                       numbers and enums — never names or text.
 *
 *   --golden            Same table built from the synthetic golden set, for
 *                       smoke-testing the report without a database.
 *
 * Nothing is written to the database in any mode.
 */

import { writeFileSync } from 'node:fs'
import { qualifyCanonicalScore, displayScoreForCanonical, QUALIFICATION_BANDS } from '../../src/lib/scoring/qualification'
import { isPacketCurrent, SCORING_VERSION } from '../../src/lib/intelligence-v3/versions'
import type { V3LeadDecisionPacket } from '../../src/lib/intelligence-v3/types'
import { opportunityKey } from '../../src/lib/scoring-v4/opportunity-key'
import { computeShadowCandidates } from '../../src/lib/scoring-v4/shadow'
import { ENGINE_IDS } from '../../src/lib/scoring-v4/engines/registry'
import { featureRecord } from '../../src/lib/scoring-v4/opportunity-features'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : 'true'
}

const CANDIDATE_ENGINES = ENGINE_IDS.filter((e) => e !== 'v3')

interface AuditRow {
  opportunityKey: string
  representations: Array<{ kind: 'lead' | 'prospect' | 'golden'; id: string }>
  platform: 'linkedin'
  createdAt: string | null
  sourceLength: number
  language: string | null
  sourceCompleteness: number | null
  production: {
    score: number | null; display: number | null; qualification: string | null; buyerIntent: string | null; relationshipRole: string | null
    commercialPotential: string | null; fit: string | null; authority: string | null; timing: string | null; access: string | null
    confidence: string | null; action: string | null; contradictions: number; fallbackUsed: boolean; stale: boolean
    currentSenderId: string | null; bestSenderId: string | null; bestSenderMatch: number | null
  }
  versions: Record<string, string | undefined> | null
  evidence: { acceptedQuotes: number; rejectedSignals: number; rejectedByActor: Record<string, number> }
  features: Record<string, number> | null
  candidates: Array<{ engine: string; version: string; score: number; qualification: string; action: string; confidence: number; accountValue: number; intentValue: number; guards: string[] }>
  messages: { drafts: number; sent: number; inbound: number }
  outcome: { connectionAccepted: boolean; replied: boolean; meeting: boolean; won: boolean; lost: boolean; status: string | null }
  feedback: Record<string, number>
  labels: number
  /** Phase 8 flags computable from stored data + features (recompute flags live in production-audit.ts). */
  flags: string[]
}

function rowFromPacket(params: { key: string; reps: AuditRow['representations']; createdAt: string | null; raw: string; packet: V3LeadDecisionPacket | null; storedScore: number | null; currentSenderId: string | null; bestSenderId: string | null; bestSenderMatch: number | null }): AuditRow {
  const { packet } = params
  const score = params.storedScore ?? packet?.score ?? null
  const shadow = packet ? computeShadowCandidates(packet, params.raw, { engines: CANDIDATE_ENGINES }) : { features: null, rows: [] }
  const rejected = packet?.sourceFacts?.rejectedSignals ?? []
  const byActor: Record<string, number> = {}
  for (const r of rejected) byActor[r.actor] = (byActor[r.actor] ?? 0) + 1
  return {
    opportunityKey: params.key,
    representations: params.reps,
    platform: 'linkedin',
    createdAt: params.createdAt,
    sourceLength: params.raw.length,
    language: packet?.sourceFacts?.sourceLanguage ?? null,
    sourceCompleteness: packet?.sourceFacts?.sourceCompleteness?.score ?? null,
    production: {
      score, display: score === null ? null : displayScoreForCanonical(score), qualification: score === null ? null : qualifyCanonicalScore(score).qualification,
      buyerIntent: packet?.buyerIntent?.buyerIntentLevel ?? null, relationshipRole: packet?.buyerIntent?.relationshipRole ?? null,
      commercialPotential: packet?.resolved?.commercialPotential ?? null, fit: packet?.resolved?.fit ?? null, authority: packet?.resolved?.authority ?? null,
      timing: packet?.resolved?.buyerTiming ?? null, access: packet?.resolved?.access ?? null, confidence: packet?.confidenceDetail?.label ?? null,
      action: packet?.recommendedAction?.action ?? packet?.action ?? null, contradictions: packet?.buyerIntent?.contradictions.length ?? 0,
      fallbackUsed: Boolean(packet?.fallbackUsed), stale: !isPacketCurrent(packet?.versions),
      currentSenderId: params.currentSenderId, bestSenderId: params.bestSenderId, bestSenderMatch: params.bestSenderMatch,
    },
    versions: packet?.versions ? { ...packet.versions } : null,
    evidence: { acceptedQuotes: packet?.evidenceQuotes?.length ?? 0, rejectedSignals: rejected.length, rejectedByActor: byActor },
    features: shadow.features ? featureRecord(shadow.features) : null,
    candidates: shadow.rows.map((r) => ({ engine: r.engine, version: r.candidate.version, score: r.candidate.score, qualification: r.candidate.qualification, action: r.candidateAction, confidence: r.candidate.confidence, accountValue: r.candidate.accountValue, intentValue: r.candidate.intentValue, guards: r.candidate.guards })),
    messages: { drafts: 0, sent: 0, inbound: 0 },
    outcome: { connectionAccepted: false, replied: false, meeting: false, won: false, lost: false, status: null },
    feedback: {},
    labels: 0,
    flags: [],
  }
}

/** Flags that do not need a recompute: contradictions, confidence, versions, role/fit disagreements, candidate disagreement. */
function flagRow(row: AuditRow, features: ReturnType<typeof computeShadowCandidates>['features']): string[] {
  const f: string[] = []
  const p = row.production
  if (p.confidence === 'LOW') f.push('LOW_CONFIDENCE')
  if (p.contradictions > 0) f.push('CONTRADICTION')
  if (p.stale) f.push('STALE_VERSION')
  if (p.fallbackUsed) f.push('FALLBACK')
  if (features) {
    if (p.relationshipRole === 'BUYER' && (features.supply.candidateSeeking || features.supply.recruiterProfile)) f.push('WRONG_ROLE')
    if ((p.relationshipRole === 'BUILDER' || p.relationshipRole === 'UNKNOWN') && features.supply.softwareServicesSeller) f.push('WRONG_ROLE')
    if ((p.fit === 'STRONG' || p.fit === 'EXCELLENT') && (features.fit.level === 'NONE' || features.fit.level === 'WEAK')) f.push('WRONG_FIT')
    if ((p.fit === 'POOR' || p.fit === 'WEAK' || p.fit === 'UNKNOWN') && (features.fit.level === 'STRONG' || features.fit.level === 'EXCEPTIONAL')) f.push('WRONG_FIT')
    if (p.buyerIntent === 'HIGH' && !features.intent.verifiedRequest) f.push('WRONG_BUYER')
  }
  const bands = new Set(row.candidates.map((c) => c.qualification))
  if (p.qualification && bands.size > 0 && (bands.size > 1 || !bands.has(p.qualification))) f.push('CANDIDATE_DISAGREE')
  if (row.candidates.some((c) => c.action !== p.action)) f.push('CANDIDATE_ACTION_DIFFERS')
  if ((p.qualification === 'STRONG' || p.qualification === 'WORTH_PURSUING') && (p.relationshipRole === 'SELLER' || p.relationshipRole === 'RECRUITER' || p.relationshipRole === 'CANDIDATE')) f.push('FALSE_HIGH')
  if ((p.qualification === 'LOW' || p.qualification === 'SKIP') && p.buyerIntent === 'HIGH') f.push('FALSE_LOW')
  if (p.bestSenderId && p.currentSenderId && p.bestSenderId !== p.currentSenderId && (p.bestSenderMatch ?? 0) >= 60) f.push('WRONG_SENDER')
  return f
}

async function runCounts() {
  const { createServiceSupabase } = await import('../../src/lib/supabase/service')
  const client = createServiceSupabase()
  const org = arg('org')
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = client.from(table).select('id', { count: 'exact', head: true })
    if (org && !['organizations', 'reps'].includes(table)) q = q.eq('organization_id', org)
    if (filter) q = filter(q)
    const { count: c, error } = await q
    return error ? `error: ${error.message}` : (c ?? 0)
  }
  const tables = ['organizations', 'reps', 'leads', 'captured_prospects', 'upwork_jobs', 'messages', 'upwork_messages', 'outcomes', 'conversation_states', 'action_events', 'scoring_feedback', 'scoring_labels', 'scoring_shadow_decisions', 'intelligence_samples', 'intelligence_sample_events', 'profiles', 'revenue_identities', 'proof_cards', 'proof_items', 'portfolio_projects', 'profile_claims', 'ai_traces', 'extraction_runs', 'edit_learning']
  console.log(`\nEXACT ROW COUNTS${org ? ` (org ${org.slice(0, 8)}…)` : ''}\n`)
  for (const t of tables) console.log(`  ${t.padEnd(28)} ${String(await count(t)).padStart(8)}`)
  console.log(`  ${'leads with raw_input'.padEnd(28)} ${String(await count('leads', (q) => q.not('raw_input', 'is', null))).padStart(8)}`)
  console.log(`  ${'leads with canonical score'.padEnd(28)} ${String(await count('leads', (q) => q.not('canonical_score', 'is', null))).padStart(8)}`)
  console.log(`  ${'prospects (captured)'.padEnd(28)} ${String(await count('captured_prospects', (q) => q.eq('status', 'captured'))).padStart(8)}`)
  console.log(`  ${'messages sent'.padEnd(28)} ${String(await count('messages', (q) => q.not('sent_text', 'is', null))).padStart(8)}`)
  console.log(`  ${'messages inbound'.padEnd(28)} ${String(await count('messages', (q) => q.eq('direction', 'inbound'))).padStart(8)}`)
  console.log(`  ${'leads won'.padEnd(28)} ${String(await count('leads', (q) => q.eq('status', 'won'))).padStart(8)}`)
  console.log(`  ${'leads lost'.padEnd(28)} ${String(await count('leads', (q) => q.eq('status', 'lost'))).padStart(8)}`)
  console.log(`  ${'leads replied'.padEnd(28)} ${String(await count('leads', (q) => q.eq('status', 'replied'))).padStart(8)}`)
  console.log(`  ${'leads w/ decisionHistory'.padEnd(28)} ${String(await count('leads', (q) => q.not('canonical_intelligence->decisionHistory', 'is', null))).padStart(8)}`)
  console.log(`  ${'prospects converted→lead'.padEnd(28)} ${String(await count('captured_prospects', (q) => q.not('converted_lead_id', 'is', null))).padStart(8)}`)
  console.log(`  ${'leads with latest_sample'.padEnd(28)} ${String(await count('leads', (q) => q.not('latest_sample_id', 'is', null))).padStart(8)}`)
  console.log(`  ${'samples legacy hash'.padEnd(28)} ${String(await count('intelligence_samples', (q) => q.like('raw_input_hash', '%:%'))).padStart(8)}`)

  // Dataset funnel completeness (Phase 4): samples by stage, events by type.
  console.log('\nDATASET FUNNEL (intelligence_samples by funnel_stage)')
  for (const stage of ['RAW_INPUT', 'EXTRACTION', 'VERIFIED_FACTS', 'SCORE', 'ROUTING', 'MESSAGE_GENERATION', 'HUMAN_EDIT', 'SENT', 'CLIENT_REPLY', 'LIFECYCLE_CHANGE', 'OUTCOME', 'HUMAN_FEEDBACK']) {
    console.log(`  ${stage.padEnd(28)} ${String(await count('intelligence_samples', (q) => q.eq('funnel_stage', stage))).padStart(8)}`)
  }
  console.log('\nSAMPLE EVENTS (intelligence_sample_events by event_type; not org-scoped)')
  for (const t of ['SCORE_CAPTURED', 'ROUTING_CAPTURED', 'MESSAGE_GENERATED', 'MESSAGE_EDITED', 'MESSAGE_SENT', 'CLIENT_REPLY', 'OUTCOME_CHANGED', 'FEEDBACK_SUBMITTED', 'LABEL_APPROVED']) {
    const { count: c, error } = await client.from('intelligence_sample_events').select('id', { count: 'exact', head: true }).eq('event_type', t)
    console.log(`  ${t.padEnd(28)} ${String(error ? `error: ${error.message}` : (c ?? 0)).padStart(8)}`)
  }
  console.log('\nLABEL STATES (intelligence_samples by label_status)')
  for (const s of ['UNLABELED', 'AI_ONLY', 'HUMAN_REVIEWED', 'HUMAN_CORRECTED', 'OUTCOME_VERIFIED', 'TRAINING_APPROVED']) {
    console.log(`  ${s.padEnd(28)} ${String(await count('intelligence_samples', (q) => q.eq('label_status', s))).padStart(8)}`)
  }
  console.log(`  ${'training_approved=true'.padEnd(28)} ${String(await count('intelligence_samples', (q) => q.eq('training_approved', true))).padStart(8)}`)
  console.log(`  ${'needs_review=true'.padEnd(28)} ${String(await count('intelligence_samples', (q) => q.eq('needs_review', true))).padStart(8)}`)
  console.log(`  ${'with capture failures'.padEnd(28)} ${String(await count('intelligence_samples', (q) => q.not('last_capture_error', 'is', null))).padStart(8)}`)
  console.log('\nACTION EVENTS by type')
  for (const t of ['RECOMMENDATION_SHOWN', 'RECOMMENDATION_ACTED', 'PROFILE_RECOMMENDED', 'MESSAGE_SENT', 'CONNECTION_SENT', 'CLIENT_WON', 'OPPORTUNITY_CREATED', 'LEAD_REFERRED', 'HELP_REQUESTED']) {
    console.log(`  ${t.padEnd(28)} ${String(await count('action_events', (q) => q.eq('action_type', t))).padStart(8)}`)
  }
  console.log('\nSHADOW DECISIONS by candidate engine')
  for (const e of ['calibrated_v4', 'ordinal_logit', 'gbdt_pairwise', 'knn_features']) {
    console.log(`  ${e.padEnd(28)} ${String(await count('scoring_shadow_decisions', (q) => q.eq('candidate_engine', e))).padStart(8)}`)
  }

  // Score distributions from numeric columns only.
  const hist = (xs: Array<number | null>) => {
    const d: Record<string, number> = {}, q: Record<string, number> = {}
    for (const x of xs) { if (x === null) { d.none = (d.none ?? 0) + 1; continue } const k = String(displayScoreForCanonical(x)); d[k] = (d[k] ?? 0) + 1; const b = qualifyCanonicalScore(x).qualification; q[b] = (q[b] ?? 0) + 1 }
    return { display: d, qualification: q }
  }
  for (const [table, filter] of [['leads', null], ['captured_prospects', 'captured']] as const) {
    let q = client.from(table).select('canonical_score, created_at').not('canonical_score', 'is', null).order('created_at', { ascending: false }).limit(5000)
    if (org) q = q.eq('organization_id', org)
    if (filter) q = q.eq('status', filter)
    const { data } = await q
    const scores = ((data ?? []) as Array<{ canonical_score: number }>).map((r) => r.canonical_score)
    const h = hist(scores)
    const n = scores.length
    const pct = (v: number) => `${Math.round((v / Math.max(1, n)) * 100)}%`
    console.log(`\n${table}: ${n} scored rows`)
    console.log('  display  ', Object.entries(h.display).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${v} (${pct(v)})`).join('  '))
    console.log('  band     ', [...QUALIFICATION_BANDS].map((b) => `${b.qualification}:${h.qualification[b.qualification] ?? 0} (${pct(h.qualification[b.qualification] ?? 0)})`).join('  '))
  }
  console.log(`\n(production ${SCORING_VERSION}; counts only — no personal data read)\n`)
}

async function runGolden(): Promise<AuditRow[]> {
  const { GOLDEN_SET } = await import('../../tests/golden/fixtures')
  const { runOffline } = await import('../../tests/helpers/score-source')
  const rows: AuditRow[] = []
  for (const f of GOLDEN_SET) {
    const packet = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: new Date('2026-10-20T00:00:00Z') })
    const key = opportunityKey(f.rawText) ?? f.id
    const row = rowFromPacket({ key, reps: [{ kind: 'golden', id: f.id }], createdAt: null, raw: f.rawText, packet, storedScore: packet.score, currentSenderId: null, bestSenderId: null, bestSenderMatch: null })
    row.flags = flagRow(row, packet ? computeShadowCandidates(packet, f.rawText, { engines: [] }).features : null)
    rows.push(row)
  }
  return rows
}

async function runDb(): Promise<AuditRow[]> {
  const { createServiceSupabase } = await import('../../src/lib/supabase/service')
  const { parsePacket } = await import('../../src/lib/relay/routing-context')
  const client = createServiceSupabase()
  const org = arg('org')
  const days = Number(arg('days', '365'))
  const limit = Number(arg('limit', '2000'))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  let lq = client.from('leads').select('id, organization_id, created_at, status, raw_input, canonical_score, canonical_intelligence, sender_profile_id, best_profile_id, best_profile_match_score, connection_accepted_at').not('raw_input', 'is', null).gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  if (org) lq = lq.eq('organization_id', org)
  const { data: leads, error } = await lq
  if (error) throw new Error(error.message)
  let pq = client.from('captured_prospects').select('id, organization_id, created_at, status, raw_input, canonical_score, canonical_intelligence, sender_profile_id').eq('status', 'captured').gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  if (org) pq = pq.eq('organization_id', org)
  const { data: prospects } = await pq

  type Rec = { kind: 'lead' | 'prospect'; id: string; createdAt: string; raw: string; score: number | null; ci: unknown; sender: string | null; best: string | null; bestMatch: number | null; status: string | null; accepted: boolean }
  const recs: Rec[] = [
    ...((leads ?? []) as Array<Record<string, unknown>>).map((r) => ({ kind: 'lead' as const, id: r.id as string, createdAt: r.created_at as string, raw: (r.raw_input as string) ?? '', score: (r.canonical_score as number) ?? null, ci: r.canonical_intelligence, sender: (r.sender_profile_id as string) ?? null, best: (r.best_profile_id as string) ?? null, bestMatch: (r.best_profile_match_score as number) ?? null, status: (r.status as string) ?? null, accepted: Boolean(r.connection_accepted_at) })),
    ...((prospects ?? []) as Array<Record<string, unknown>>).map((r) => ({ kind: 'prospect' as const, id: r.id as string, createdAt: r.created_at as string, raw: (r.raw_input as string) ?? '', score: (r.canonical_score as number) ?? null, ci: r.canonical_intelligence, sender: (r.sender_profile_id as string) ?? null, best: null, bestMatch: null, status: (r.status as string) ?? null, accepted: false })),
  ]
  const leadIds = recs.filter((r) => r.kind === 'lead').map((r) => r.id)
  const [{ data: messages }, { data: outcomes }, { data: feedback }, { data: labels }] = await Promise.all([
    leadIds.length ? client.from('messages').select('lead_id, direction, sent_text').in('lead_id', leadIds) : Promise.resolve({ data: [] }),
    leadIds.length ? client.from('outcomes').select('lead_id, stage').in('lead_id', leadIds) : Promise.resolve({ data: [] }),
    client.from('scoring_feedback').select('lead_id, captured_prospect_id, feedback_type').gte('created_at', since).limit(5000),
    client.from('scoring_labels').select('opportunity_key').limit(5000),
  ])
  const msgs = new Map<string, Array<Record<string, unknown>>>()
  for (const m of (messages ?? []) as Array<Record<string, unknown>>) { const k = m.lead_id as string; msgs.set(k, [...(msgs.get(k) ?? []), m]) }
  const outs = new Map<string, Set<string>>()
  for (const o of (outcomes ?? []) as Array<Record<string, unknown>>) { const k = o.lead_id as string; outs.set(k, new Set([...(outs.get(k) ?? []), o.stage as string])) }
  const fb = new Map<string, Record<string, number>>()
  for (const f of (feedback ?? []) as Array<Record<string, unknown>>) { const k = (f.lead_id as string) ?? (f.captured_prospect_id as string); if (!k) continue; const cur = fb.get(k) ?? {}; cur[f.feedback_type as string] = (cur[f.feedback_type as string] ?? 0) + 1; fb.set(k, cur) }
  const labelCount = new Map<string, number>()
  for (const l of (labels ?? []) as Array<Record<string, unknown>>) { const k = l.opportunity_key as string; labelCount.set(k, (labelCount.get(k) ?? 0) + 1) }

  const byKey = new Map<string, Rec[]>()
  for (const r of recs) { const k = opportunityKey(r.raw) ?? `${r.kind}:${r.id}`; byKey.set(k, [...(byKey.get(k) ?? []), r]) }
  const rows: AuditRow[] = []
  for (const [key, reps] of byKey) {
    const primary = reps.find((r) => r.kind === 'lead') ?? reps[0]
    const packet = parsePacket(primary.ci)
    const row = rowFromPacket({ key, reps: reps.map((r) => ({ kind: r.kind, id: r.id })), createdAt: primary.createdAt, raw: primary.raw, packet, storedScore: primary.score, currentSenderId: primary.sender, bestSenderId: primary.best, bestSenderMatch: primary.bestMatch })
    const leadReps = reps.filter((r) => r.kind === 'lead')
    const ms = leadReps.flatMap((r) => msgs.get(r.id) ?? [])
    row.messages = { drafts: ms.filter((m) => m.direction !== 'inbound' && !m.sent_text).length, sent: ms.filter((m) => m.direction !== 'inbound' && m.sent_text).length, inbound: ms.filter((m) => m.direction === 'inbound').length }
    const stages = new Set(leadReps.flatMap((r) => [...(outs.get(r.id) ?? [])]))
    const lead = leadReps[0] ?? null
    row.outcome = { connectionAccepted: Boolean(lead?.accepted), replied: stages.has('replied') || row.messages.inbound > 0 || lead?.status === 'replied', meeting: stages.has('close') || lead?.status === 'meeting_booked', won: lead?.status === 'won', lost: lead?.status === 'lost' || lead?.status === 'dead' || lead?.status === 'no', status: lead?.status ?? primary.status }
    const f: Record<string, number> = {}
    for (const r of reps) for (const [k, v] of Object.entries(fb.get(r.id) ?? {})) f[k] = (f[k] ?? 0) + v
    row.feedback = f
    row.labels = labelCount.get(key) ?? 0
    row.flags = flagRow(row, packet ? computeShadowCandidates(packet, primary.raw, { engines: [] }).features : null)
    rows.push(row)
  }
  console.log(`RAW RECORD COUNT: ${recs.length} (leads ${leadIds.length}, prospects ${recs.length - leadIds.length})`)
  console.log(`UNIQUE OPPORTUNITY COUNT: ${rows.length} (${recs.length - rows.length} duplicate representations collapsed)`)
  return rows
}

function report(rows: AuditRow[]) {
  const n = rows.length
  const pct = (x: number) => (n ? `${Math.round((x / n) * 100)}%` : '0%')
  const hist = (f: (r: AuditRow) => string | number | null) => { const m: Record<string, number> = {}; for (const r of rows) { const k = String(f(r) ?? 'none'); m[k] = (m[k] ?? 0) + 1 } return m }
  const fmt = (h: Record<string, number>) => Object.entries(h).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, v]) => `${k}:${v} (${pct(v)})`).join('  ')
  console.log(`\nMASTER AUDIT DATASET — ${n} unique opportunities — production ${SCORING_VERSION}\n`)
  console.log('display        ', fmt(hist((r) => r.production.display)))
  console.log('qualification  ', fmt(hist((r) => r.production.qualification)))
  console.log('buyer intent   ', fmt(hist((r) => r.production.buyerIntent)))
  console.log('role           ', fmt(hist((r) => r.production.relationshipRole)))
  console.log('fit            ', fmt(hist((r) => r.production.fit)))
  console.log('commercial pot.', fmt(hist((r) => r.production.commercialPotential)))
  console.log('confidence     ', fmt(hist((r) => r.production.confidence)))
  console.log('action         ', fmt(hist((r) => r.production.action)))
  console.log('language       ', fmt(hist((r) => r.language)))
  console.log('stale versions ', fmt(hist((r) => (r.production.stale ? 'stale' : 'current'))))
  console.log('labelled       ', fmt(hist((r) => (r.labels > 0 ? 'yes' : 'no'))))
  console.log('with outcome   ', fmt(hist((r) => (r.outcome.replied || r.outcome.meeting || r.outcome.won || r.outcome.lost ? 'yes' : 'no'))))
  for (const engine of CANDIDATE_ENGINES) {
    const q: Record<string, number> = {}
    let agree = 0, scored = 0, sumDelta = 0, actionAgree = 0
    for (const r of rows) {
      const c = r.candidates.find((x) => x.engine === engine)
      if (!c || r.production.score === null) continue
      scored++
      q[c.qualification] = (q[c.qualification] ?? 0) + 1
      if (c.qualification === r.production.qualification) agree++
      if (c.action === r.production.action) actionAgree++
      sumDelta += Math.abs(c.score - r.production.score)
    }
    console.log(`\n${engine.padEnd(15)} band ${Object.entries(q).map(([k, v]) => `${k}:${v}`).join(' ')} · band agreement ${scored ? Math.round((agree / scored) * 100) : 0}% · action agreement ${scored ? Math.round((actionAgree / scored) * 100) : 0}% · mean |Δ| ${scored ? (sumDelta / scored).toFixed(1) : '0'}`)
  }
  const flagCounts: Record<string, number> = {}
  for (const r of rows) for (const fl of r.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1
  console.log('\nFLAGS (Phase 8; stored data + features, no recompute)')
  for (const [k, v] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${String(v).padStart(5)}  ${pct(v)}`)
  // Disagreement queue (Phase 28): biggest production-vs-candidate deltas.
  const disagreements = rows
    .map((r) => ({ key: r.opportunityKey.slice(0, 10), delta: Math.max(0, ...r.candidates.map((c) => Math.abs(c.score - (r.production.score ?? c.score)))), bands: new Set([r.production.qualification, ...r.candidates.map((c) => c.qualification)]).size, actions: new Set([r.production.action, ...r.candidates.map((c) => c.action)]).size }))
    .sort((a, b) => b.delta - a.delta || b.bands - a.bands)
    .slice(0, 20)
  console.log('\nTOP DISAGREEMENTS (opportunity key prefix · max |Δ| · distinct bands · distinct actions)')
  for (const d of disagreements) console.log(`  ${d.key}  Δ${String(d.delta).padStart(3)}  bands ${d.bands}  actions ${d.actions}`)
}

/**
 * Migration status (Phase 23): every `create table if not exists` in
 * supabase/migrations is probed with a head-only count. A table that
 * answers is APPLIED; a relation error is MISSING. Column-level drift is
 * probed for the columns the scoring program depends on.
 */
async function runMigrationStatus() {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { createServiceSupabase } = await import('../../src/lib/supabase/service')
  const client = createServiceSupabase()
  const dir = 'supabase/migrations'
  const tables = new Map<string, string>()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8')
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) if (!tables.has(m[1])) tables.set(m[1], f)
  }
  console.log(`\nMIGRATION STATUS — ${tables.size} tables declared in ${dir}\n`)
  let applied = 0, missing = 0
  for (const [t, f] of [...tables.entries()].sort()) {
    const { error } = await client.from(t).select('*', { count: 'exact', head: true }).limit(1)
    const ok = !error
    if (ok) applied++; else missing++
    console.log(`  ${ok ? 'APPLIED' : 'MISSING'}  ${t.padEnd(36)} ${f}${ok ? '' : `  (${error?.message})`}`)
  }
  const columns: Array<[string, string]> = [
    ['leads', 'v3_reuse_key'], ['leads', 'latest_sample_id'], ['leads', 'best_profile_id'], ['captured_prospects', 'converted_lead_id'],
    ['intelligence_samples', 'decision_run_id'], ['intelligence_samples', 'sender_profile_id'], ['intelligence_sample_events', 'idempotency_key'],
    ['scoring_feedback', 'versions'], ['scoring_labels', 'expected_score_min'], ['scoring_shadow_decisions', 'candidate_engine'],
    ['ai_traces', 'prompt_version'], ['action_events', 'idempotency_key'], ['upwork_jobs', 'canonical_score'],
  ]
  console.log('\nCOLUMN PROBES')
  for (const [t, c] of columns) {
    const { error } = await client.from(t).select(c, { count: 'exact', head: true }).limit(1)
    console.log(`  ${error ? 'MISSING' : 'APPLIED'}  ${`${t}.${c}`.padEnd(48)}${error ? ` (${error.message})` : ''}`)
  }
  console.log(`\n${applied} applied, ${missing} missing\n`)
}

async function main() {
  if (arg('counts') === 'true') { await runCounts(); return }
  if (arg('migrations') === 'true') { await runMigrationStatus(); return }
  const rows = arg('db') === 'true' ? await runDb() : await runGolden()
  report(rows)
  const out = arg('out')
  if (out) {
    writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    console.log(`\nJSONL written → ${out} (ids, hashes, numbers, enums; no text)`)
  }
  // Phase 20 review set: the top disagreements, one record each, for human review.
  const reviewN = Number(arg('review-set', '0'))
  if (reviewN > 0) {
    const ranked = [...rows]
      .map((r) => ({ r, delta: Math.max(0, ...r.candidates.map((c) => Math.abs(c.score - (r.production.score ?? c.score)))) }))
      .sort((a, b) => b.delta - a.delta || b.r.flags.length - a.r.flags.length)
      .slice(0, reviewN)
    const file = arg('review-out', 'review-set.jsonl')!
    writeFileSync(file, ranked.map(({ r, delta }) => JSON.stringify({ opportunityKey: r.opportunityKey, representations: r.representations, delta, flags: r.flags, production: r.production, candidates: r.candidates, labels: r.labels, outcome: r.outcome, feedback: r.feedback })).join('\n') + '\n')
    console.log(`review set (${ranked.length}) → ${file}. Open each record in /admin/training-data by its representation id to see the raw source and record a label.`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
