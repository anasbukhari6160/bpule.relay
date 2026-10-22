/**
 * Training-data surface (Phases 2, 3, 4, 23, 34).
 *
 * One row per UNIQUE opportunity (lead + captured prospect of the same
 * paste collapse to one row via opportunityKey), showing what Relay
 * decided, what the candidate engines would decide, what humans said, what
 * happened, and an active-learning priority that decides who gets reviewed
 * first. Nothing here recomputes a production score or calls a model.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { qualifyCanonicalScore, displayScoreForCanonical, QUALIFICATION_BANDS, type CanonicalQualification } from '@/lib/scoring/qualification'
import { isPacketCurrent } from '@/lib/intelligence-v3/versions'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import { parsePacket } from '@/lib/relay/routing-context'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'
import { computeShadowCandidates } from '@/lib/scoring-v4/shadow'
import { ENGINE_IDS } from '@/lib/scoring-v4/engines/registry'
import type { EngineId } from '@/lib/scoring-v4/engines/types'
import type { OpportunityFeatures } from '@/lib/scoring-v4/opportunity-features'

export const LABEL_VERSION = 'label_v1'

export const LABEL_ENUMS = {
  relationshipRole: ['BUYER', 'BUYER_AND_SELLER', 'SELLER', 'BUILDER', 'RECRUITER', 'CANDIDATE', 'UNKNOWN'],
  buyerIntent: ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'NONE'],
  commercialPotential: ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'],
  fit: ['NONE', 'WEAK', 'ADJACENT', 'GOOD', 'STRONG', 'EXCEPTIONAL'],
  authority: ['NONE', 'LOW', 'MEDIUM', 'HIGH'],
  timing: ['NONE', 'WEAK', 'CURRENT', 'URGENT'],
  access: ['DIRECT', 'CONNECTION', 'INDIRECT', 'NONE'],
  expectedAction: ['CONTACT_NOW', 'CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE', 'OBSERVE', 'WAIT', 'CLOSE'],
  labelerConfidence: ['HIGH', 'MEDIUM', 'LOW'],
} as const

/**
 * Quick-label enums (Phase F). A reviewer answers five things at a glance —
 * no score ranges, no role taxonomy. One label should take under 15 seconds.
 */
export const LABEL_QUICK_ENUMS = {
  prospectQuality: ['GREAT', 'GOOD', 'MAYBE', 'POOR', 'NEVER_CONTACT'],
  likelyOpportunity: ['YES', 'MAYBE', 'NO'],
  quickAction: ['CONTACT_NOW', 'CONNECT', 'RESEARCH', 'OBSERVE', 'CLOSE'],
  decisionCorrect: ['YES', 'NO'],
} as const

/** Score ranges reviewers pick from (Phase 4). Boundaries follow the band table so a label maps to a band. */
export const LABEL_SCORE_RANGES: Array<{ id: string; min: number; max: number; label: string }> = [
  { id: 'skip', min: 0, max: 14, label: '0–14 · Skip' },
  { id: 'low', min: 15, max: 34, label: '15–34 · Low' },
  { id: 'maybe_low', min: 35, max: 44, label: '35–44 · Maybe (weak)' },
  { id: 'maybe_high', min: 45, max: 54, label: '45–54 · Maybe (plausible)' },
  { id: 'wp_low', min: 55, max: 64, label: '55–64 · Worth pursuing' },
  { id: 'wp_high', min: 65, max: 74, label: '65–74 · Worth pursuing (strong)' },
  { id: 'strong', min: 75, max: 84, label: '75–84 · Strong' },
  { id: 'top', min: 85, max: 100, label: '85–100 · Top of the queue' },
]

export interface TrainingLabel {
  id: string
  labelerRepId: string
  labelVersion: string
  relationshipRole: string | null
  buyerIntent: string | null
  commercialPotential: string | null
  fit: string | null
  authority: string | null
  timing: string | null
  access: string | null
  expectedScoreMin: number | null
  expectedScoreMax: number | null
  expectedAction: string | null
  bestSenderProfileId: string | null
  labelerConfidence: string | null
  reason: string | null
  /** Quick-label fields (Phase F). */
  prospectQuality: string | null
  likelyOpportunity: string | null
  quickAction: string | null
  decisionCorrect: string | null
  createdAt: string
}

export interface TrainingCandidate {
  engine: EngineId
  version: string
  score: number
  qualification: CanonicalQualification
  action: string
  confidence: number
  accountValue: number
  intentValue: number
  guards: string[]
  reasons: string[]
}

export interface TrainingRow {
  opportunityKey: string
  /** The representation reviewers open: the lead when one exists, else the prospect. */
  primary: { kind: 'lead' | 'prospect'; id: string }
  representations: Array<{ kind: 'lead' | 'prospect'; id: string }>
  platform: 'linkedin'
  createdAt: string
  repId: string | null
  company: string | null
  contactName: string | null
  rawSource: string
  sourceLength: number
  language: string | null
  sourceCompleteness: number | null
  production: {
    score: number | null
    display: number | null
    qualification: CanonicalQualification | null
    buyerIntent: string | null
    relationshipRole: string | null
    commercialPotential: string | null
    fit: string | null
    authority: string | null
    timing: string | null
    access: string | null
    confidence: string | null
    action: string | null
    reasons: string[]
    watchOut: string[]
    contradictions: number
    fallbackUsed: boolean
    stale: boolean
    versions: V3LeadDecisionPacket['versions'] | null
    decisionRunId: string | null
    currentSenderId: string | null
    bestSenderId: string | null
    bestSenderMatch: number | null
  }
  evidence: {
    quotes: Array<{ quote: string; verbatim: boolean }>
    rejected: Array<{ signal: string; value: string | null; sourceLine: string; reason: string; actor: string }>
  }
  features: OpportunityFeatures | null
  candidates: TrainingCandidate[]
  messages: { drafts: number; sent: number; inbound: number; edited: number; firstSentPreview: string | null }
  outcome: { connectionAccepted: boolean; replied: boolean; meeting: boolean; won: boolean; lost: boolean; status: string | null }
  feedback: Array<{ type: string; note: string | null; createdAt: string }>
  labels: TrainingLabel[]
  priority: { score: number; reasons: string[] }
}

export interface TrainingQueueSummary {
  rawRecords: number
  uniqueOpportunities: number
  labelled: number
  unlabelled: number
  withOutcome: number
  withFeedback: number
  priorityReasons: Record<string, number>
}

function safeParse(s: unknown): unknown {
  if (typeof s !== 'string') return s
  try { return JSON.parse(s) } catch { return null }
}

function nearThreshold(score: number): boolean {
  return QUALIFICATION_BANDS.some((b) => Math.abs(score - b.min) <= 4 || Math.abs(score - b.max) <= 4)
}

/** Active-learning priority (Phase 23). Higher = review sooner. */
export function computePriority(row: Omit<TrainingRow, 'priority'>): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  const p = row.production
  if (row.labels.length === 0) { score += 10; reasons.push('unlabelled') }
  if (p.confidence === 'LOW') { score += 25; reasons.push('low confidence') }
  if (p.contradictions > 0) { score += 20; reasons.push('contradiction') }
  const bands = new Set([p.qualification, ...row.candidates.map((c) => c.qualification)].filter(Boolean))
  if (bands.size >= 2) { score += 30; reasons.push('engines disagree') }
  if (p.score !== null && nearThreshold(p.score)) { score += 15; reasons.push('near band edge') }
  if (p.qualification === 'STRONG' || p.qualification === 'WORTH_PURSUING') { score += 10; reasons.push('high value') }
  if (row.feedback.length > 0) { score += 20; reasons.push('human feedback') }
  if (row.feedback.some((f) => f.type === 'WRONG_SENDER')) { score += 15; reasons.push('wrong sender feedback') }
  if (row.feedback.some((f) => f.type === 'SCORE_TOO_HIGH' || f.type === 'SCORE_TOO_LOW')) { score += 15; reasons.push('wrong score feedback') }
  if (row.messages.edited > 0) { score += 10; reasons.push('human-edited message') }
  const o = row.outcome
  if ((p.qualification === 'LOW' || p.qualification === 'SKIP') && (o.replied || o.meeting || o.won)) { score += 50; reasons.push('unexpected positive outcome') }
  if (p.qualification === 'STRONG' && row.messages.sent >= 2 && !o.replied) { score += 15; reasons.push('strong lead, no reply') }
  if (p.fallbackUsed) { score += 10; reasons.push('fallback decision') }
  return { score, reasons }
}

interface RawRecord {
  kind: 'lead' | 'prospect'
  id: string
  createdAt: string
  repId: string | null
  company: string | null
  contactName: string | null
  rawInput: string
  canonicalScore: number | null
  canonicalIntelligence: unknown
  senderProfileId: string | null
  bestProfileId: string | null
  bestProfileMatch: number | null
  status: string | null
  connectionAcceptedAt: string | null
}

export async function loadTrainingQueue(client: SupabaseClient, orgId: string, opts: { since: string; limit?: number; engines?: EngineId[] }): Promise<{ rows: TrainingRow[]; summary: TrainingQueueSummary }> {
  const limit = opts.limit ?? 400
  const [{ data: leads }, { data: prospects }] = await Promise.all([
    client.from('leads')
      .select('id, company, contact_name, owner_rep_id, created_at, raw_input, canonical_score, canonical_intelligence, sender_profile_id, best_profile_id, best_profile_match_score, status, connection_accepted_at')
      .eq('organization_id', orgId).not('canonical_intelligence', 'is', null).gte('created_at', opts.since).order('created_at', { ascending: false }).limit(limit),
    client.from('captured_prospects')
      .select('id, extracted_company, extracted_name, owner_rep_id, created_at, raw_input, canonical_score, canonical_intelligence, sender_profile_id, status')
      .eq('organization_id', orgId).eq('status', 'captured').not('canonical_intelligence', 'is', null).gte('created_at', opts.since).order('created_at', { ascending: false }).limit(limit),
  ])
  const records: RawRecord[] = []
  for (const l of (leads ?? []) as Array<Record<string, unknown>>) {
    records.push({ kind: 'lead', id: l.id as string, createdAt: l.created_at as string, repId: (l.owner_rep_id as string) ?? null, company: (l.company as string) ?? null, contactName: (l.contact_name as string) ?? null, rawInput: (l.raw_input as string) ?? '', canonicalScore: (l.canonical_score as number) ?? null, canonicalIntelligence: l.canonical_intelligence, senderProfileId: (l.sender_profile_id as string) ?? null, bestProfileId: (l.best_profile_id as string) ?? null, bestProfileMatch: (l.best_profile_match_score as number) ?? null, status: (l.status as string) ?? null, connectionAcceptedAt: (l.connection_accepted_at as string) ?? null })
  }
  for (const p of (prospects ?? []) as Array<Record<string, unknown>>) {
    records.push({ kind: 'prospect', id: p.id as string, createdAt: p.created_at as string, repId: (p.owner_rep_id as string) ?? null, company: (p.extracted_company as string) ?? null, contactName: (p.extracted_name as string) ?? null, rawInput: (p.raw_input as string) ?? '', canonicalScore: (p.canonical_score as number) ?? null, canonicalIntelligence: p.canonical_intelligence, senderProfileId: (p.sender_profile_id as string) ?? null, bestProfileId: null, bestProfileMatch: null, status: (p.status as string) ?? null, connectionAcceptedAt: null })
  }

  // ── Dedup by underlying opportunity (Phase 3) ─────────────────────────
  const byKey = new Map<string, RawRecord[]>()
  for (const r of records) {
    const key = opportunityKey(r.rawInput) ?? `${r.kind}:${r.id}`
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  }

  const leadIds = records.filter((r) => r.kind === 'lead').map((r) => r.id)
  const prospectIds = records.filter((r) => r.kind === 'prospect').map((r) => r.id)
  const keys = [...byKey.keys()]
  const [msgRes, outRes, fbRes, labelRes] = await Promise.all([
    leadIds.length ? client.from('messages').select('lead_id, direction, draft_text, sent_text, sent_at, original_draft').in('lead_id', leadIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    leadIds.length ? client.from('outcomes').select('lead_id, stage').in('lead_id', leadIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    client.from('scoring_feedback').select('lead_id, captured_prospect_id, feedback_type, note, created_at').eq('organization_id', orgId).or([leadIds.length ? `lead_id.in.(${leadIds.join(',')})` : '', prospectIds.length ? `captured_prospect_id.in.(${prospectIds.join(',')})` : ''].filter(Boolean).join(',') || 'lead_id.is.null').limit(2000),
    keys.length ? client.from('scoring_labels').select('*').eq('organization_id', orgId).in('opportunity_key', keys.slice(0, 500)).order('created_at', { ascending: false }).limit(2000) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  const msgsByLead = new Map<string, Array<Record<string, unknown>>>()
  for (const m of (msgRes.data ?? []) as Array<Record<string, unknown>>) { const k = m.lead_id as string; msgsByLead.set(k, [...(msgsByLead.get(k) ?? []), m]) }
  const outByLead = new Map<string, Set<string>>()
  for (const o of (outRes.data ?? []) as Array<Record<string, unknown>>) { const k = o.lead_id as string; outByLead.set(k, new Set([...(outByLead.get(k) ?? []), o.stage as string])) }
  const fbById = new Map<string, Array<{ type: string; note: string | null; createdAt: string }>>()
  for (const f of (fbRes.data ?? []) as Array<Record<string, unknown>>) {
    const k = (f.lead_id as string) ?? (f.captured_prospect_id as string)
    if (!k) continue
    fbById.set(k, [...(fbById.get(k) ?? []), { type: f.feedback_type as string, note: (f.note as string) ?? null, createdAt: f.created_at as string }])
  }
  const labelsByKey = new Map<string, TrainingLabel[]>()
  for (const l of (labelRes.data ?? []) as Array<Record<string, unknown>>) {
    const k = l.opportunity_key as string
    labelsByKey.set(k, [...(labelsByKey.get(k) ?? []), {
      id: l.id as string, labelerRepId: l.labeler_rep_id as string, labelVersion: l.label_version as string,
      relationshipRole: (l.relationship_role as string) ?? null, buyerIntent: (l.buyer_intent as string) ?? null, commercialPotential: (l.commercial_potential as string) ?? null,
      fit: (l.fit as string) ?? null, authority: (l.authority as string) ?? null, timing: (l.timing as string) ?? null, access: (l.access as string) ?? null,
      expectedScoreMin: (l.expected_score_min as number) ?? null, expectedScoreMax: (l.expected_score_max as number) ?? null, expectedAction: (l.expected_action as string) ?? null,
      bestSenderProfileId: (l.best_sender_profile_id as string) ?? null, labelerConfidence: (l.labeler_confidence as string) ?? null, reason: (l.reason as string) ?? null,
      prospectQuality: (l.prospect_quality as string) ?? null, likelyOpportunity: (l.likely_opportunity as string) ?? null,
      quickAction: (l.quick_action as string) ?? null, decisionCorrect: (l.decision_correct as string) ?? null,
      createdAt: l.created_at as string,
    }])
  }

  const engines = opts.engines ?? ENGINE_IDS.filter((e) => e !== 'v3')
  const rows: TrainingRow[] = []
  for (const [key, reps] of byKey) {
    const primary = reps.find((r) => r.kind === 'lead') ?? reps[0]
    const packet = parsePacket(primary.canonicalIntelligence)
    const ci = safeParse(primary.canonicalIntelligence) as Record<string, unknown> | null
    const score = primary.canonicalScore ?? packet?.score ?? null
    const band = score === null ? null : qualifyCanonicalScore(score)
    const shadow = packet ? computeShadowCandidates(packet, { engines }) : { features: null, rows: [] }
    const msgs = reps.filter((r) => r.kind === 'lead').flatMap((r) => msgsByLead.get(r.id) ?? [])
    const sent = msgs.filter((m) => m.direction !== 'inbound' && m.sent_text)
    const firstSent = sent.sort((a, b) => String(a.sent_at ?? '').localeCompare(String(b.sent_at ?? '')))[0]
    const stages = new Set(reps.filter((r) => r.kind === 'lead').flatMap((r) => [...(outByLead.get(r.id) ?? [])]))
    const lead = reps.find((r) => r.kind === 'lead') ?? null
    const feedback = reps.flatMap((r) => fbById.get(r.id) ?? [])
    const row: Omit<TrainingRow, 'priority'> = {
      opportunityKey: key,
      primary: { kind: primary.kind, id: primary.id },
      representations: reps.map((r) => ({ kind: r.kind, id: r.id })),
      platform: 'linkedin',
      createdAt: primary.createdAt,
      repId: primary.repId,
      company: primary.company,
      contactName: primary.contactName,
      rawSource: primary.rawInput,
      sourceLength: primary.rawInput.length,
      language: packet?.sourceFacts?.sourceLanguage ?? null,
      sourceCompleteness: packet?.sourceFacts?.sourceCompleteness?.score ?? null,
      production: {
        score, display: score === null ? null : displayScoreForCanonical(score), qualification: band?.qualification ?? null,
        buyerIntent: packet?.buyerIntent?.buyerIntentLevel ?? null, relationshipRole: packet?.buyerIntent?.relationshipRole ?? null,
        commercialPotential: packet?.resolved?.commercialPotential ?? null, fit: packet?.resolved?.fit ?? packet?.decision?.fit ?? null,
        authority: packet?.resolved?.authority ?? null, timing: packet?.resolved?.buyerTiming ?? null, access: packet?.resolved?.access ?? null,
        confidence: packet?.confidenceDetail?.label ?? null, action: packet?.recommendedAction?.action ?? packet?.action ?? null,
        reasons: packet?.reasons ?? [], watchOut: packet?.watchOut ?? [],
        contradictions: packet?.buyerIntent?.contradictions.length ?? 0, fallbackUsed: Boolean(packet?.fallbackUsed), stale: !isPacketCurrent(packet?.versions),
        versions: packet?.versions ?? null, decisionRunId: packet?.decisionRunId ?? null,
        currentSenderId: primary.senderProfileId, bestSenderId: lead?.bestProfileId ?? null, bestSenderMatch: lead?.bestProfileMatch ?? null,
      },
      evidence: {
        quotes: (packet?.evidenceQuotes ?? []).slice(0, 8).map((q) => ({ quote: q.quote, verbatim: q.verbatim })),
        rejected: (packet?.sourceFacts?.rejectedSignals ?? []).slice(0, 12).map((r) => ({ signal: r.signal, value: r.value, sourceLine: r.sourceLine, reason: r.reason, actor: r.actor })),
      },
      features: shadow.features,
      candidates: shadow.rows.map((r) => ({ engine: r.engine, version: r.candidate.version, score: r.candidate.score, qualification: r.candidate.qualification, action: r.candidateAction, confidence: r.candidate.confidence, accountValue: r.candidate.accountValue, intentValue: r.candidate.intentValue, guards: r.candidate.guards, reasons: r.candidate.reasons })),
      messages: { drafts: msgs.filter((m) => m.direction !== 'inbound' && !m.sent_text).length, sent: sent.length, inbound: msgs.filter((m) => m.direction === 'inbound').length, edited: sent.filter((m) => typeof m.original_draft === 'string' && m.original_draft.trim() && m.original_draft.trim() !== String(m.sent_text).trim()).length, firstSentPreview: firstSent ? String(firstSent.sent_text).slice(0, 240) : null },
      outcome: {
        connectionAccepted: Boolean(lead?.connectionAcceptedAt),
        replied: stages.has('replied') || msgs.some((m) => m.direction === 'inbound') || lead?.status === 'replied',
        meeting: stages.has('close') || lead?.status === 'meeting_booked',
        won: lead?.status === 'won', lost: lead?.status === 'lost' || lead?.status === 'dead' || lead?.status === 'no',
        status: lead?.status ?? primary.status,
      },
      feedback,
      labels: labelsByKey.get(key) ?? [],
    }
    rows.push({ ...row, priority: computePriority(row) })
    void ci
  }
  rows.sort((a, b) => b.priority.score - a.priority.score || b.createdAt.localeCompare(a.createdAt))

  const priorityReasons: Record<string, number> = {}
  for (const r of rows) for (const reason of r.priority.reasons) priorityReasons[reason] = (priorityReasons[reason] ?? 0) + 1
  const summary: TrainingQueueSummary = {
    rawRecords: records.length,
    uniqueOpportunities: rows.length,
    labelled: rows.filter((r) => r.labels.length > 0).length,
    unlabelled: rows.filter((r) => r.labels.length === 0).length,
    withOutcome: rows.filter((r) => r.outcome.replied || r.outcome.meeting || r.outcome.won || r.outcome.lost).length,
    withFeedback: rows.filter((r) => r.feedback.length > 0).length,
    priorityReasons,
  }
  return { rows, summary }
}

export interface LabelInput {
  opportunityKey: string
  leadId?: string | null
  capturedProspectId?: string | null
  decisionRunId?: string | null
  relationshipRole?: string | null
  buyerIntent?: string | null
  commercialPotential?: string | null
  fit?: string | null
  authority?: string | null
  timing?: string | null
  access?: string | null
  expectedRangeId?: string | null
  expectedScoreMin?: number | null
  expectedScoreMax?: number | null
  expectedAction?: string | null
  bestSenderProfileId?: string | null
  labelerConfidence?: string | null
  reason?: string | null
  evidenceLines?: string[]
  observed?: Record<string, unknown>
}

/** A quick label (Phase F): five glanceable answers, under 15 seconds. */
export interface QuickLabelInput {
  opportunityKey: string
  leadId?: string | null
  capturedProspectId?: string | null
  decisionRunId?: string | null
  prospectQuality?: string | null
  likelyOpportunity?: string | null
  quickAction?: string | null
  bestSenderProfileId?: string | null
  decisionCorrect?: string | null
  reason?: string | null
  observed?: Record<string, unknown>
}

/** Validate a quick-label body. */
export function validateQuickLabel(body: Record<string, unknown>): { ok: true; label: QuickLabelInput } | { ok: false; error: string } {
  const str = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : null)
  const key = str('opportunityKey')
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return { ok: false, error: 'opportunityKey must be a sha256 hex string.' }
  const fields = {
    prospectQuality: str('prospectQuality'), likelyOpportunity: str('likelyOpportunity'),
    quickAction: str('quickAction'), decisionCorrect: str('decisionCorrect'),
  }
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && !(LABEL_QUICK_ENUMS[k as keyof typeof LABEL_QUICK_ENUMS] as readonly string[]).includes(v)) {
      return { ok: false, error: `${k} must be one of ${(LABEL_QUICK_ENUMS[k as keyof typeof LABEL_QUICK_ENUMS] as readonly string[]).join(', ')}.` }
    }
  }
  const hasAny = Object.values(fields).some(Boolean) || str('bestSenderProfileId') || str('reason')
  if (!hasAny) return { ok: false, error: 'A quick label needs at least one answer.' }
  return {
    ok: true,
    label: {
      opportunityKey: key,
      leadId: str('leadId'), capturedProspectId: str('capturedProspectId'), decisionRunId: str('decisionRunId'),
      ...fields,
      bestSenderProfileId: str('bestSenderProfileId'),
      reason: str('reason')?.slice(0, 1000) ?? null,
      observed: body.observed && typeof body.observed === 'object' ? (body.observed as Record<string, unknown>) : {},
    },
  }
}

/** A pairwise preference: work A before B, or tie. */
export interface PairwiseLabelInput {
  opportunityKeyA: string
  opportunityKeyB: string
  winner: 'A' | 'B' | 'TIE'
  reason?: string | null
}

/** Validate a pairwise label body. */
export function validatePairwiseLabel(body: Record<string, unknown>): { ok: true; label: PairwiseLabelInput } | { ok: false; error: string } {
  const keyA = typeof body.opportunityKeyA === 'string' ? body.opportunityKeyA : null
  const keyB = typeof body.opportunityKeyB === 'string' ? body.opportunityKeyB : null
  if (!keyA || !/^[a-f0-9]{64}$/.test(keyA)) return { ok: false, error: 'opportunityKeyA must be a sha256 hex string.' }
  if (!keyB || !/^[a-f0-9]{64}$/.test(keyB)) return { ok: false, error: 'opportunityKeyB must be a sha256 hex string.' }
  if (keyA === keyB) return { ok: false, error: 'The two opportunities must be different.' }
  const winner = body.winner
  if (winner !== 'A' && winner !== 'B' && winner !== 'TIE') return { ok: false, error: 'winner must be A, B or TIE.' }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null
  return { ok: true, label: { opportunityKeyA: keyA, opportunityKeyB: keyB, winner, reason } }
}

/** Validate a label body. Returns the row to insert or an error message. */
export function validateLabel(body: Record<string, unknown>): { ok: true; label: LabelInput } | { ok: false; error: string } {
  const str = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : null)
  const key = str('opportunityKey')
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return { ok: false, error: 'opportunityKey must be a sha256 hex string.' }
  const check = (k: keyof typeof LABEL_ENUMS, v: string | null) => v === null || (LABEL_ENUMS[k] as readonly string[]).includes(v)
  const fields = {
    relationshipRole: str('relationshipRole'), buyerIntent: str('buyerIntent'), commercialPotential: str('commercialPotential'), fit: str('fit'),
    authority: str('authority'), timing: str('timing'), access: str('access'), expectedAction: str('expectedAction'), labelerConfidence: str('labelerConfidence'),
  }
  for (const [k, v] of Object.entries(fields)) if (!check(k as keyof typeof LABEL_ENUMS, v)) return { ok: false, error: `${k} must be one of ${(LABEL_ENUMS[k as keyof typeof LABEL_ENUMS] as readonly string[]).join(', ')}.` }
  let min: number | null = null, max: number | null = null
  const rangeId = str('expectedRangeId')
  if (rangeId) {
    const r = LABEL_SCORE_RANGES.find((x) => x.id === rangeId)
    if (!r) return { ok: false, error: `expectedRangeId must be one of ${LABEL_SCORE_RANGES.map((x) => x.id).join(', ')}.` }
    min = r.min; max = r.max
  } else if (typeof body.expectedScoreMin === 'number' || typeof body.expectedScoreMax === 'number') {
    min = typeof body.expectedScoreMin === 'number' ? body.expectedScoreMin : null
    max = typeof body.expectedScoreMax === 'number' ? body.expectedScoreMax : null
    if (min === null || max === null || min < 0 || max > 100 || min > max || !Number.isInteger(min) || !Number.isInteger(max)) return { ok: false, error: 'expectedScoreMin/Max must be integers 0-100 with min <= max.' }
  }
  const hasAny = Object.values(fields).some(Boolean) || min !== null || str('bestSenderProfileId') || str('reason')
  if (!hasAny) return { ok: false, error: 'A label needs at least one field.' }
  const evidenceLines = Array.isArray(body.evidenceLines) ? (body.evidenceLines as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, 500)) : []
  return {
    ok: true,
    label: {
      opportunityKey: key,
      leadId: str('leadId'), capturedProspectId: str('capturedProspectId'), decisionRunId: str('decisionRunId'),
      ...fields,
      expectedScoreMin: min, expectedScoreMax: max,
      bestSenderProfileId: str('bestSenderProfileId'),
      reason: str('reason')?.slice(0, 2000) ?? null,
      evidenceLines,
      observed: body.observed && typeof body.observed === 'object' ? (body.observed as Record<string, unknown>) : {},
    },
  }
}
