/**
 * Sender routing v1 ↔ v2 comparison (shadow).
 *
 * `rankSendersV2` is built and tested but not yet wired into any surface. This
 * module puts the two engines side by side for the same opportunity so the
 * admin QA center and the training-data page can show what v2 would change —
 * and why — without replacing v1.
 *
 * The opportunity score never enters here, and the sender never enters the
 * opportunity score. Deterministic.
 */

import type { OpportunityFeatures } from './opportunity-features'
import type { SenderCapabilityProfile } from './sender-capability-profile'
import { rankSendersV2, SENDER_RANKER_VERSION, type SenderRankingV2 } from './sender-ranker'

export const ROUTING_COMPARE_VERSION = 'routing_compare_v1'

export interface RoutingV1Result {
  senderId: string | null
  score: number | null
}

export interface RoutingComparison {
  version: typeof ROUTING_COMPARE_VERSION
  rankerVersion: typeof SENDER_RANKER_VERSION
  v1: RoutingV1Result
  v2: SenderRankingV2
  difference: {
    senderChanged: boolean
    /** v2 best match minus the v1 best score, when both exist. */
    delta: number | null
    reason: string | null
  }
  proofUsed: {
    senderId: string | null
    families: string[]
    strength: 'NONE' | 'ORG' | 'VERIFIED'
  }
  eligibility: {
    senderId: string | null
    accessible: boolean
    note: string | null
  }
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

/**
 * Compare the production router (v1) with the semantic router (v2) for one
 * opportunity. `v1` is optional: without it only the v2 ranking is reported.
 */
export function compareRouting(input: {
  features: OpportunityFeatures
  senders: SenderCapabilityProfile[]
  currentSenderId: string | null
  v1?: RoutingV1Result | null
}): RoutingComparison {
  const v2 = rankSendersV2(input.features, input.senders, input.currentSenderId)
  const best = v2.rankings[0] ?? null
  const v1 = input.v1 ?? null

  const senderChanged = Boolean(v1?.senderId && best && v1.senderId !== best.identityId)
  const delta = v1?.score != null && best ? best.match - v1.score : null
  const reason = !best
    ? 'v2 found no eligible sender'
    : senderChanged
      ? `v2 prefers ${best.name ?? best.identityId} over ${v1?.senderId ?? 'the current sender'}`
      : `v2 agrees with the current sender (${best.name ?? best.identityId})`

  const proofUsed = best
    ? {
        senderId: best.identityId,
        families: best.matchedFamilies.map((f) => f),
        strength: best.proofMatch,
      }
    : { senderId: null, families: [], strength: 'NONE' as const }

  const eligibility = best
    ? {
        senderId: best.identityId,
        accessible: best.accessibleToRep,
        note: best.accessibleToRep ? null : 'v2 top pick is not accessible to the rep — v1 must not be displaced by it',
      }
    : { senderId: null, accessible: false, note: 'No eligible sender' }

  let confidence: RoutingComparison['confidence'] = 'MEDIUM'
  if (best && best.confidence >= 0.7 && best.accessibleToRep) confidence = 'HIGH'
  else if (!best || !best.accessibleToRep) confidence = 'LOW'

  return {
    version: ROUTING_COMPARE_VERSION,
    rankerVersion: SENDER_RANKER_VERSION,
    v1: { senderId: v1?.senderId ?? null, score: v1?.score ?? null },
    v2,
    difference: { senderChanged, delta, reason },
    proofUsed,
    eligibility,
    confidence,
  }
}
