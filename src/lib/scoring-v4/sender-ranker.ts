/**
 * Sender ranker v2 (Phase 12/13/20) — ranks every usable identity for an
 * opportunity from OpportunityFeatures × SenderCapabilityProfile.
 *
 * Three numbers, kept apart:
 *   ORG_CAPABILITY_MATCH  can the organisation deliver what is needed?
 *   SENDER_MATCH          how well does THIS identity cover it, with proof?
 *   PROOF_MATCH           does the identity hold verified proof for it?
 *
 * The opportunity score never enters here and the sender never enters the
 * opportunity score. History is a small, smoothed bonus. Output is
 * explainable: every rank carries the families matched, the proof used and
 * the risks. Deterministic.
 */

import { capabilityOverlap, type CapabilityFamily, DEFAULT_ORG_CAPABILITY_FAMILIES, CAPABILITY_FAMILY_LABEL } from './capability-taxonomy'
import type { OpportunityFeatures } from './opportunity-features'
import type { SenderCapabilityProfile } from './sender-capability-profile'

export const SENDER_RANKER_VERSION = 'sender_ranker_v2'

export interface SenderRankV2 {
  identityId: string
  name: string | null
  platform: string | null
  rank: number
  /** 0-100 */
  match: number
  /** 0-1 */
  confidence: number
  proofMatch: 'NONE' | 'ORG' | 'VERIFIED'
  matchedFamilies: CapabilityFamily[]
  missingFamilies: CapabilityFamily[]
  industryMatch: boolean
  reasons: string[]
  risks: string[]
  accessibleToRep: boolean
}

export interface SenderRankingV2 {
  version: typeof SENDER_RANKER_VERSION
  orgCapabilityMatch: number
  orgMissing: CapabilityFamily[]
  rankings: SenderRankV2[]
  bestSenderId: string | null
  currentSenderId: string | null
  currentSenderMatch: number | null
  bestSenderMatch: number | null
  mismatchDelta: number | null
}

/** Families the opportunity needs: explicit needs first, their stack as context. */
export function opportunityFamilies(f: OpportunityFeatures): { needs: CapabilityFamily[]; context: CapabilityFamily[] } {
  return { needs: f.fit.needs, context: f.fit.stack }
}

export function orgCapabilityMatch(f: OpportunityFeatures, org: readonly CapabilityFamily[] = DEFAULT_ORG_CAPABILITY_FAMILIES): { match: number; missing: CapabilityFamily[] } {
  const { needs, context } = opportunityFamilies(f)
  const n = capabilityOverlap(needs, org)
  const c = capabilityOverlap(context, org)
  if (needs.length === 0 && context.length === 0) return { match: 0, missing: [] }
  const match = needs.length > 0 ? 0.75 * n.coverage + 0.25 * (context.length ? c.coverage : n.coverage) : c.coverage * 0.8
  return { match: Math.round(match * 100), missing: [...n.missing, ...c.missing] }
}

function scoreSender(f: OpportunityFeatures, s: SenderCapabilityProfile): Omit<SenderRankV2, 'rank'> {
  const { needs, context } = opportunityFamilies(f)
  const reasons: string[] = []
  const risks: string[] = []

  const needOverlap = capabilityOverlap(needs, s.capabilities)
  const ctxOverlap = capabilityOverlap(context, s.capabilities)
  const provenNeeds = capabilityOverlap(needs, s.provenCapabilities)
  const verifiedNeeds = capabilityOverlap(needs, s.verifiedCapabilities)
  const provenCtx = capabilityOverlap(context, s.provenCapabilities)
  const verifiedCtx = capabilityOverlap(context, s.verifiedCapabilities)

  let score = 0
  if (needs.length > 0) {
    score += 50 * needOverlap.coverage
    score += 20 * provenNeeds.coverage
    score += 10 * verifiedNeeds.coverage
    if (context.length > 0) score += 10 * ctxOverlap.coverage
  } else if (context.length > 0) {
    score += 40 * ctxOverlap.coverage
    score += 15 * provenCtx.coverage
    score += 10 * verifiedCtx.coverage
  } else {
    // Nothing named: a generalist with proof is the safest sender.
    score += Math.min(25, s.provenCapabilities.length * 4)
    risks.push('Opportunity names no capability — ranking is by breadth of proof only')
  }

  const matched = [...new Set([...needOverlap.matched, ...ctxOverlap.matched])]
  const missing = [...new Set([...needOverlap.missing, ...ctxOverlap.missing])]
  if (needOverlap.matched.length > 0) reasons.push(`Covers requested: ${needOverlap.matched.map((x) => CAPABILITY_FAMILY_LABEL[x]).join(', ')}`)
  else if (ctxOverlap.matched.length > 0) reasons.push(`Works in their stack: ${ctxOverlap.matched.map((x) => CAPABILITY_FAMILY_LABEL[x]).join(', ')}`)
  if (verifiedNeeds.matched.length > 0 || verifiedCtx.matched.length > 0) reasons.push('Verified proof for the matched capability')
  else if (provenNeeds.matched.length > 0 || provenCtx.matched.length > 0) reasons.push('Proof item for the matched capability')
  if (missing.length > 0 && needs.length > 0) risks.push(`No coverage for: ${missing.map((x) => CAPABILITY_FAMILY_LABEL[x]).join(', ')}`)

  const industryMatch = Boolean(f.currentIndustry && s.industries.includes(f.currentIndustry.toLowerCase()))
  if (industryMatch) { score += 8; reasons.push(`Industry experience: ${f.currentIndustry}`) }

  // History: smoothed, bounded, never above proof (Phase 21).
  if (s.history.replyRate.reliable && s.history.replyRate.rate >= 0.2) {
    const bonus = Math.min(7, Math.round((s.history.replyRate.rate - 0.12) * 40))
    if (bonus > 0) { score += bonus; reasons.push(`Reply rate ${Math.round(s.history.replyRate.rate * 100)}% over ${s.history.contacted} contacts`) }
  }
  if (s.history.meetingRate.reliable && s.history.meetingRate.rate >= 0.08) score += 3

  if (f.platform === 'upwork' && s.platform && s.platform !== 'upwork') { score = Math.min(score, 20); risks.push('Identity is not an Upwork profile') }
  if (!s.accessibleToRep) risks.push(`Not accessible — held by ${s.ownerReps.length} other rep${s.ownerReps.length === 1 ? '' : 's'}`)

  const proofMatch: SenderRankV2['proofMatch'] = verifiedNeeds.matched.length > 0 || verifiedCtx.matched.length > 0 ? 'VERIFIED'
    : provenNeeds.matched.length > 0 || provenCtx.matched.length > 0 ? 'ORG' : 'NONE'
  const confidence = Math.min(1, 0.3 + (matched.length > 0 ? 0.25 : 0) + (proofMatch === 'VERIFIED' ? 0.25 : proofMatch === 'ORG' ? 0.15 : 0) + (industryMatch ? 0.1 : 0) + (s.history.replyRate.reliable ? 0.1 : 0))

  return {
    identityId: s.identityId,
    name: s.name,
    platform: s.platform,
    match: Math.round(Math.max(0, Math.min(100, score))),
    confidence: Math.round(confidence * 100) / 100,
    proofMatch,
    matchedFamilies: matched,
    missingFamilies: missing,
    industryMatch,
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
    accessibleToRep: s.accessibleToRep,
  }
}

export function rankSendersV2(f: OpportunityFeatures, senders: SenderCapabilityProfile[], currentSenderId: string | null = null, org: readonly CapabilityFamily[] = DEFAULT_ORG_CAPABILITY_FAMILIES): SenderRankingV2 {
  const eligible = f.platform === 'linkedin' ? senders.filter((s) => !s.platform || s.platform === 'linkedin') : senders
  const scored = eligible.map((s) => scoreSender(f, s)).sort((a, b) => b.match - a.match || b.confidence - a.confidence || a.identityId.localeCompare(b.identityId))
  const rankings: SenderRankV2[] = scored.map((r, i) => ({ ...r, rank: i + 1 }))
  const best = rankings[0] ?? null
  const current = currentSenderId ? rankings.find((r) => r.identityId === currentSenderId) ?? null : null
  const orgMatch = orgCapabilityMatch(f, org)
  return {
    version: SENDER_RANKER_VERSION,
    orgCapabilityMatch: orgMatch.match,
    orgMissing: orgMatch.missing,
    rankings,
    bestSenderId: best?.identityId ?? null,
    currentSenderId,
    currentSenderMatch: current?.match ?? null,
    bestSenderMatch: best?.match ?? null,
    mismatchDelta: current && best ? best.match - current.match : null,
  }
}
