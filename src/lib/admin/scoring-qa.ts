/**
 * Admin Scoring QA Center + production monitoring (Phases 29, 30, 43).
 *
 * Reads stored decisions (leads and captured prospects), projects each
 * through the canonical display/qualification policy and summarizes:
 * distributions, UNKNOWN / contradiction / fallback / routing-mismatch
 * rates, action mix, feedback counts, and alert flags for drift.
 *
 * No AI calls, no recomputation of scores: what is shown is what was stored,
 * under the versions that stored it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { qualifyCanonicalScore, displayScoreForCanonical, type CanonicalQualification } from '@/lib/scoring/qualification'
import { isPacketCurrent, SCORING_VERSION } from '@/lib/intelligence-v3/versions'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import type { RejectedSignal } from '@/lib/intelligence-v3/source-facts-model'
import { parsePacket } from '@/lib/relay/routing-context'
import { computeShadowCandidates } from '@/lib/scoring-v4/shadow'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'
import { ENGINE_IDS } from '@/lib/scoring-v4/engines/registry'
import type { EngineId } from '@/lib/scoring-v4/engines/types'

const QA_CANDIDATE_ENGINES: EngineId[] = ENGINE_IDS.filter((e) => e !== 'v3')

export interface QaDecisionRow {
  id: string
  kind: 'lead' | 'prospect'
  company: string | null
  contactName: string | null
  repId: string | null
  createdAt: string
  canonicalScore: number | null
  displayScore: number | null
  qualification: CanonicalQualification | null
  storedQualification: string | null
  buyerIntent: string | null
  relationshipRole: string | null
  commercialPotential: string | null
  fit: string | null
  timing: string | null
  access: string | null
  confidence: string | null
  action: string | null
  currentSenderId: string | null
  bestSenderId: string | null
  bestSenderMatch: number | null
  contradictions: number
  fallbackUsed: boolean
  eventSource: string | null
  versions: V3LeadDecisionPacket['versions'] | null
  stale: boolean
  rejectedSignals: RejectedSignal[]
  decisionRunId: string | null
  /** Candidate-engine results for the same row (Phase 34: production vs candidate). */
  candidates: QaCandidate[]
  /** Unique-opportunity key so a lead and its captured prospect can be grouped. */
  opportunityKey: string | null
}

export interface QaCandidate {
  engine: EngineId
  version: string
  score: number
  display: number
  qualification: CanonicalQualification
  action: string
  confidence: number
  accountValue: number
  intentValue: number
  fit: string | null
}

export interface QaFilters {
  lowConfidence?: boolean
  contradiction?: boolean
  seller?: boolean
  buyer?: boolean
  recruiter?: boolean
  candidate?: boolean
  highScore?: boolean
  lowScore?: boolean
  routingMismatch?: boolean
  fallback?: boolean
  repId?: string | null
  since?: string | null
  stale?: boolean
}

export function projectDecisionRow(input: {
  id: string
  kind: 'lead' | 'prospect'
  company: string | null
  contactName: string | null
  repId: string | null
  createdAt: string
  canonicalScore: number | null
  canonicalIntelligence: unknown
  currentSenderId: string | null
  bestSenderId?: string | null
  bestSenderMatch?: number | null
  /** Raw source, used only to derive candidate features; never returned. */
  rawInput?: string | null
}): QaDecisionRow {
  const packet = parsePacket(input.canonicalIntelligence)
  const ci = (typeof input.canonicalIntelligence === 'string' ? safeParse(input.canonicalIntelligence) : input.canonicalIntelligence) as Record<string, unknown> | null
  const score = input.canonicalScore ?? packet?.score ?? null
  const band = score === null ? null : qualifyCanonicalScore(score)
  let candidates: QaCandidate[] = []
  if (packet) {
    try {
      const shadow = computeShadowCandidates(packet, input.rawInput ?? null, { engines: QA_CANDIDATE_ENGINES })
      candidates = shadow.rows.map((r) => ({
        engine: r.engine, version: r.candidate.version, score: r.candidate.score, display: displayScoreForCanonical(r.candidate.score),
        qualification: r.candidate.qualification, action: r.candidateAction, confidence: r.candidate.confidence,
        accountValue: r.candidate.accountValue, intentValue: r.candidate.intentValue, fit: shadow.features?.fit.level ?? null,
      }))
    } catch { candidates = [] }
  }
  return {
    id: input.id,
    kind: input.kind,
    company: input.company,
    contactName: input.contactName,
    repId: input.repId,
    createdAt: input.createdAt,
    canonicalScore: score,
    displayScore: score === null ? null : displayScoreForCanonical(score),
    qualification: band?.qualification ?? null,
    storedQualification: typeof ci?.qualification === 'string' ? (ci.qualification as string) : null,
    buyerIntent: packet?.buyerIntent?.buyerIntentLevel ?? null,
    relationshipRole: packet?.buyerIntent?.relationshipRole ?? null,
    commercialPotential: packet?.resolved?.commercialPotential ?? packet?.latentPotential ?? null,
    fit: packet?.resolved?.fit ?? packet?.decision?.fit ?? null,
    timing: packet?.resolved?.buyerTiming ?? packet?.decision?.timing ?? null,
    access: packet?.resolved?.access ?? packet?.decision?.access ?? null,
    confidence: packet?.confidenceDetail?.label ?? (typeof packet?.confidence === 'number' ? (packet.confidence >= 0.7 ? 'HIGH' : packet.confidence >= 0.45 ? 'MEDIUM' : 'LOW') : null),
    action: packet?.recommendedAction?.action ?? packet?.action ?? null,
    currentSenderId: input.currentSenderId,
    bestSenderId: input.bestSenderId ?? null,
    bestSenderMatch: input.bestSenderMatch ?? null,
    contradictions: packet?.buyerIntent?.contradictions.length ?? 0,
    fallbackUsed: packet?.fallbackUsed ?? packet?.decisionProvider === 'deterministic_fallback',
    eventSource: packet?.eventSource ?? null,
    versions: packet?.versions ?? null,
    stale: !isPacketCurrent(packet?.versions),
    rejectedSignals: packet?.sourceFacts?.rejectedSignals ?? [],
    decisionRunId: packet?.decisionRunId ?? null,
    candidates,
    opportunityKey: opportunityKey(input.rawInput),
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

export function applyQaFilters(rows: QaDecisionRow[], f: QaFilters): QaDecisionRow[] {
  return rows.filter((r) => {
    if (f.lowConfidence && r.confidence !== 'LOW') return false
    if (f.contradiction && r.contradictions === 0) return false
    if (f.seller && r.relationshipRole !== 'SELLER') return false
    if (f.buyer && r.relationshipRole !== 'BUYER' && r.relationshipRole !== 'BUYER_AND_SELLER') return false
    if (f.recruiter && r.relationshipRole !== 'RECRUITER') return false
    if (f.candidate && r.relationshipRole !== 'CANDIDATE') return false
    if (f.highScore && !(r.qualification === 'STRONG' || r.qualification === 'WORTH_PURSUING')) return false
    if (f.lowScore && !(r.qualification === 'LOW' || r.qualification === 'SKIP')) return false
    if (f.routingMismatch && !(r.bestSenderId && r.currentSenderId && r.bestSenderId !== r.currentSenderId)) return false
    if (f.fallback && !r.fallbackUsed) return false
    if (f.stale && !r.stale) return false
    if (f.repId && r.repId !== f.repId) return false
    if (f.since && r.createdAt < f.since) return false
    return true
  })
}

export interface ScoringMonitor {
  window: { since: string; count: number }
  scoreHistogram: Record<string, number>
  displayHistogram: Record<string, number>
  qualificationHistogram: Record<string, number>
  actionHistogram: Record<string, number>
  intentHistogram: Record<string, number>
  roleHistogram: Record<string, number>
  rates: {
    unknownIntent: number
    contradiction: number
    fallback: number
    routingMismatch: number
    lowConfidence: number
    staleVersions: number
    deterministicEvents: number
  }
  feedback: Record<string, number>
  alerts: Array<{ level: 'warn' | 'critical'; message: string }>
  scoringVersion: string
}

export function buildScoringMonitor(rows: QaDecisionRow[], feedback: Array<{ feedback_type: string }>, since: string): ScoringMonitor {
  const n = rows.length
  const hist = (key: (r: QaDecisionRow) => string | number | null) => {
    const m: Record<string, number> = {}
    for (const r of rows) { const k = String(key(r) ?? 'none'); m[k] = (m[k] ?? 0) + 1 }
    return m
  }
  const rate = (pred: (r: QaDecisionRow) => boolean) => (n === 0 ? 0 : Math.round((rows.filter(pred).length / n) * 1000) / 1000)
  const displayHistogram = hist((r) => r.displayScore)
  const qualificationHistogram = hist((r) => r.qualification)
  const rates = {
    unknownIntent: rate((r) => r.buyerIntent === 'UNKNOWN'),
    contradiction: rate((r) => r.contradictions > 0),
    fallback: rate((r) => r.fallbackUsed),
    routingMismatch: rate((r) => Boolean(r.bestSenderId && r.currentSenderId && r.bestSenderId !== r.currentSenderId)),
    lowConfidence: rate((r) => r.confidence === 'LOW'),
    staleVersions: rate((r) => r.stale),
    deterministicEvents: rate((r) => r.eventSource === 'deterministic'),
  }
  const fb: Record<string, number> = {}
  for (const f of feedback) fb[f.feedback_type] = (fb[f.feedback_type] ?? 0) + 1

  const alerts: ScoringMonitor['alerts'] = []
  if (n >= 20) {
    for (const [k, v] of Object.entries(displayHistogram)) if (v / n > 0.3) alerts.push({ level: 'warn', message: `${Math.round((v / n) * 100)}% of decisions show ${k}/10 — display collapse` })
    for (const [k, v] of Object.entries(qualificationHistogram)) if (v / n > 0.4) alerts.push({ level: 'warn', message: `${Math.round((v / n) * 100)}% of decisions are ${k} — qualification collapse` })
    const sellersHigh = rows.filter((r) => r.relationshipRole === 'SELLER' && (r.qualification === 'STRONG' || r.qualification === 'WORTH_PURSUING')).length
    if (sellersHigh / n > 0.1) alerts.push({ level: 'critical', message: `${sellersHigh} service providers scored WORTH_PURSUING or above` })
    const recruitersHigh = rows.filter((r) => r.relationshipRole === 'RECRUITER' && (r.qualification === 'STRONG' || r.qualification === 'WORTH_PURSUING')).length
    if (recruitersHigh > 0) alerts.push({ level: 'critical', message: `${recruitersHigh} recruiters scored WORTH_PURSUING or above` })
    const buyersLow = rows.filter((r) => r.buyerIntent === 'HIGH' && (r.qualification === 'LOW' || r.qualification === 'SKIP')).length
    if (buyersLow > 0) alerts.push({ level: 'critical', message: `${buyersLow} verified buyers scored LOW or SKIP` })
    if (rates.fallback > 0.2) alerts.push({ level: 'warn', message: `Fallback rate ${Math.round(rates.fallback * 100)}% — decision model failing often` })
    if (rates.contradiction > 0.35) alerts.push({ level: 'warn', message: `Contradiction rate ${Math.round(rates.contradiction * 100)}% — model and source disagree often` })
    if (rates.staleVersions > 0.5) alerts.push({ level: 'warn', message: `${Math.round(rates.staleVersions * 100)}% of stored decisions predate ${SCORING_VERSION} — re-analyze on open` })
  }
  const falseBuyer = (fb.SCORE_TOO_HIGH ?? 0) + (fb.WRONG_INTENT ?? 0)
  const falseSkip = fb.SCORE_TOO_LOW ?? 0
  if (falseBuyer >= 5) alerts.push({ level: 'warn', message: `${falseBuyer} "too high / wrong intent" feedback items — review false-buyer cases` })
  if (falseSkip >= 5) alerts.push({ level: 'warn', message: `${falseSkip} "too low" feedback items — review false-skip cases` })

  return {
    window: { since, count: n },
    scoreHistogram: hist((r) => (r.canonicalScore === null ? null : Math.floor(r.canonicalScore / 10) * 10)),
    displayHistogram,
    qualificationHistogram,
    actionHistogram: hist((r) => r.action),
    intentHistogram: hist((r) => r.buyerIntent),
    roleHistogram: hist((r) => r.relationshipRole),
    rates,
    feedback: fb,
    alerts,
    scoringVersion: SCORING_VERSION,
  }
}

/** Load recent decisions for an org from leads and captured prospects. */
export async function loadRecentDecisions(client: SupabaseClient, orgId: string, opts: { since: string; limit?: number }): Promise<QaDecisionRow[]> {
  const limit = opts.limit ?? 300
  const [{ data: leads }, { data: prospects }] = await Promise.all([
    client
      .from('leads')
      .select('id, company, contact_name, owner_rep_id, created_at, canonical_score, canonical_intelligence, sender_profile_id, best_profile_id, best_profile_match_score, raw_input')
      .eq('organization_id', orgId)
      .not('canonical_intelligence', 'is', null)
      .gte('created_at', opts.since)
      .order('created_at', { ascending: false })
      .limit(limit),
    client
      .from('captured_prospects')
      .select('id, extracted_company, extracted_name, owner_rep_id, created_at, canonical_score, canonical_intelligence, sender_profile_id, raw_input')
      .eq('organization_id', orgId)
      .eq('status', 'captured')
      .not('canonical_intelligence', 'is', null)
      .gte('created_at', opts.since)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])
  const rows: QaDecisionRow[] = []
  for (const l of (leads ?? []) as Array<Record<string, unknown>>) {
    rows.push(projectDecisionRow({
      id: l.id as string, kind: 'lead', company: (l.company as string) ?? null, contactName: (l.contact_name as string) ?? null, repId: (l.owner_rep_id as string) ?? null,
      createdAt: l.created_at as string, canonicalScore: (l.canonical_score as number) ?? null, canonicalIntelligence: l.canonical_intelligence,
      currentSenderId: (l.sender_profile_id as string) ?? null, bestSenderId: (l.best_profile_id as string) ?? null, bestSenderMatch: (l.best_profile_match_score as number) ?? null,
      rawInput: (l.raw_input as string) ?? null,
    }))
  }
  for (const p of (prospects ?? []) as Array<Record<string, unknown>>) {
    rows.push(projectDecisionRow({
      id: p.id as string, kind: 'prospect', company: (p.extracted_company as string) ?? null, contactName: (p.extracted_name as string) ?? null, repId: (p.owner_rep_id as string) ?? null,
      createdAt: p.created_at as string, canonicalScore: (p.canonical_score as number) ?? null, canonicalIntelligence: p.canonical_intelligence,
      currentSenderId: (p.sender_profile_id as string) ?? null,
      rawInput: (p.raw_input as string) ?? null,
    }))
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return rows
}
