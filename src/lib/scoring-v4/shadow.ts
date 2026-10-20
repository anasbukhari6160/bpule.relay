/**
 * Shadow mode (Phase 27): every real analysis is also scored by the
 * candidate engines named in SCORING_SHADOW_ENGINES, and the results are
 * stored beside the production decision in `scoring_shadow_decisions`.
 *
 * Nothing here changes what reps see. Failures are logged and swallowed —
 * a shadow write must never break a save. No model calls: candidates run
 * on OpportunityFeatures derived from the packet that production already
 * produced.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import { deriveRecommendedAction } from '@/lib/intelligence-v3/action/recommended-action'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import { parsePacket } from '@/lib/relay/routing-context'
import { ENGINES, productionEngineId, shadowEngineIds } from './engines/registry'
import type { CandidateScore, EngineId } from './engines/types'
import { featuresFromPacket, OPPORTUNITY_FEATURES_VERSION, type OpportunityFeatures, type Platform } from './opportunity-features'
import { opportunityKey } from './opportunity-key'

export interface ShadowRecordInput {
  client: SupabaseClient
  organizationId: string
  platform?: Platform
  leadId?: string | null
  capturedProspectId?: string | null
  rawText: string | null | undefined
  /** The stored canonical blob or a bare packet. */
  canonicalIntelligence: unknown
  productionSenderId?: string | null
  /** Sender the v2 ranker would pick, when the caller computed it. */
  candidateSenderId?: string | null
  /** Override for tests. */
  env?: NodeJS.ProcessEnv
}

export interface ShadowCandidateRow {
  engine: EngineId
  candidate: CandidateScore
  candidateAction: string
}

/** Pure part: compute every shadow candidate for a packet. Exported for tests and the audit script. */
export function computeShadowCandidates(packet: V3LeadDecisionPacket, rawText: string | null | undefined, opts: { platform?: Platform; engines?: EngineId[]; env?: NodeJS.ProcessEnv } = {}): { features: OpportunityFeatures | null; rows: ShadowCandidateRow[] } {
  const features = featuresFromPacket(packet, rawText, { platform: opts.platform })
  if (!features) return { features: null, rows: [] }
  const engines = opts.engines ?? shadowEngineIds(opts.env)
  const rows: ShadowCandidateRow[] = []
  for (const id of engines) {
    const engine = ENGINES[id]
    const candidate = engine.score(features, { v3Score: packet.score })
    const band = qualifyCanonicalScore(candidate.score)
    const action = deriveRecommendedAction({
      opportunity: {
        score: candidate.score,
        qualification: band.qualification,
        buyerIntentLevel: packet.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN',
        verifiedBuyerRequest: packet.buyerIntent?.verifiedBuyerRequest ?? false,
        relationshipRole: packet.buyerIntent?.relationshipRole ?? 'UNKNOWN',
        access: features.access.level,
        buyerTiming: features.buyerTiming,
        activityRecency: features.activityRecency,
        commercialPotential: candidate.accountValue >= 75 ? 'VERY_HIGH' : candidate.accountValue >= 50 ? 'HIGH' : candidate.accountValue >= 30 ? 'MEDIUM' : candidate.accountValue >= 15 ? 'LOW' : 'VERY_LOW',
        episodeClosed: features.episodeClosed,
      },
      confidence: { label: candidate.confidence >= 0.7 ? 'HIGH' : candidate.confidence >= 0.45 ? 'MEDIUM' : 'LOW', researchMore: candidate.confidence < 0.45 },
      channel: features.platform === 'upwork' ? 'upwork' : 'linkedin',
    })
    rows.push({ engine: id, candidate, candidateAction: action.action })
  }
  return { features, rows }
}

/** Best-effort persistence. Resolves to the number of rows written (0 when shadow is off). */
export async function recordShadowDecisions(input: ShadowRecordInput): Promise<number> {
  const engines = shadowEngineIds(input.env)
  if (engines.length === 0) return 0
  try {
    const packet = parsePacket(input.canonicalIntelligence)
    if (!packet) return 0
    const key = opportunityKey(input.rawText)
    if (!key) return 0
    const { features, rows } = computeShadowCandidates(packet, input.rawText, { platform: input.platform, engines, env: input.env })
    if (!features || rows.length === 0) return 0
    const production = productionEngineId(input.env)
    const inserts = rows.map((r) => ({
      organization_id: input.organizationId,
      opportunity_key: key,
      lead_id: input.leadId ?? null,
      captured_prospect_id: input.capturedProspectId ?? null,
      decision_run_id: packet.decisionRunId ?? null,
      platform: input.platform ?? 'linkedin',
      production_engine: production,
      production_score: packet.score,
      production_qualification: qualifyCanonicalScore(packet.score).qualification,
      production_action: packet.recommendedAction?.action ?? packet.action ?? null,
      production_sender_id: input.productionSenderId ?? null,
      candidate_engine: r.engine,
      candidate_version: r.candidate.version,
      candidate_score: r.candidate.score,
      candidate_qualification: r.candidate.qualification,
      candidate_action: r.candidateAction,
      candidate_sender_id: input.candidateSenderId ?? null,
      candidate_confidence: r.candidate.confidence,
      candidate_detail: { accountValue: r.candidate.accountValue, intentValue: r.candidate.intentValue, rawScore: r.candidate.rawScore, guards: r.candidate.guards, reasons: r.candidate.reasons },
      features: { ...features, fit: { ...features.fit, matches: undefined } },
      features_version: OPPORTUNITY_FEATURES_VERSION,
    }))
    const { error } = await input.client.from('scoring_shadow_decisions').insert(inserts)
    if (error) { console.warn('[scoring-v4/shadow] insert failed:', error.message); return 0 }
    return inserts.length
  } catch (err) {
    console.warn('[scoring-v4/shadow] skipped:', err instanceof Error ? err.message : err)
    return 0
  }
}
