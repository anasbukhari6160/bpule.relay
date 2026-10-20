/**
 * Deterministic safety guards shared by every candidate engine (Phase 30:
 * "code should enforce safety"). Each guard is visible in the trace; none
 * is hidden inside a weight.
 *
 * The guards encode the program's non-negotiable orderings:
 *   - a closed or negated episode is never qualified;
 *   - a candidate seeking work never reaches MAYBE;
 *   - a supply-side profile (seller of what we sell, recruiter, candidate)
 *     with no verified buy never reaches WORTH_PURSUING;
 *   - a verified first-person request with budget or deadline is never
 *     LOW/SKIP — it is at least a MAYBE a rep must look at.
 */

import { QUALIFICATION_BANDS } from '@/lib/scoring/qualification'
import type { OpportunityFeatures } from '../opportunity-features'

const band = (q: string) => QUALIFICATION_BANDS.find((b) => b.qualification === q)!

export const GUARD_CEILINGS = {
  closed: band('SKIP').max,
  candidate: band('LOW').max,
  /** A recruiter sourcing for clients has no budget for what we sell. */
  recruiter: band('LOW').max,
  supplySide: band('MAYBE').max,
  /** A verified request for something outside our capability set is a real buyer, not our opportunity. */
  unservedNeed: band('MAYBE').max,
  /** A verified request with budget or deadline stays visible. */
  verifiedBuyerFloor: band('MAYBE').min,
} as const

export function supplySideWithoutBuy(f: OpportunityFeatures): boolean {
  if (f.intent.verifiedRequest && f.intent.level !== 'UNKNOWN') return false
  if (f.relationshipRole === 'RECRUITER' || f.relationshipRole === 'CANDIDATE') return true
  if (f.relationshipRole === 'SELLER' && f.supply.softwareServicesSeller) return true
  return false
}

export function applyGuards(raw: number, f: OpportunityFeatures): { score: number; guards: string[] } {
  const guards: string[] = []
  let score = Math.round(Math.max(0, Math.min(100, raw)))

  if (f.episodeClosed) {
    if (score > GUARD_CEILINGS.closed) guards.push(`closed episode → capped at ${GUARD_CEILINGS.closed}`)
    score = Math.min(score, GUARD_CEILINGS.closed)
    return { score, guards }
  }
  if (f.relationshipRole === 'CANDIDATE' && !f.intent.verifiedRequest) {
    if (score > GUARD_CEILINGS.candidate) guards.push(`candidate seeking work → capped at ${GUARD_CEILINGS.candidate}`)
    score = Math.min(score, GUARD_CEILINGS.candidate)
  }
  if (f.relationshipRole === 'RECRUITER' && !f.intent.verifiedRequest) {
    if (score > GUARD_CEILINGS.recruiter) guards.push(`recruiter sourcing for clients → capped at ${GUARD_CEILINGS.recruiter}`)
    score = Math.min(score, GUARD_CEILINGS.recruiter)
  }
  if (supplySideWithoutBuy(f)) {
    if (score > GUARD_CEILINGS.supplySide) guards.push(`supply-side with no verified buy → capped at ${GUARD_CEILINGS.supplySide}`)
    score = Math.min(score, GUARD_CEILINGS.supplySide)
  }
  // A verified request whose named need we cannot deliver (no capability
  // family overlap at all) is somebody's opportunity, not ours.
  if (f.intent.verifiedRequest && f.fit.needs.length > 0 && f.fit.orgNeedCoverage === 0 && f.fit.orgStackCoverage === 0) {
    if (score > GUARD_CEILINGS.unservedNeed) guards.push(`request names a need outside our capabilities → capped at ${GUARD_CEILINGS.unservedNeed}`)
    score = Math.min(score, GUARD_CEILINGS.unservedNeed)
  }
  const strongRequest = f.intent.verifiedRequest && f.intent.level === 'HIGH' && (f.intent.verifiedBudget || f.buyerTiming === 'URGENT' || f.buyerTiming === 'CURRENT')
  if (strongRequest && score < GUARD_CEILINGS.verifiedBuyerFloor) {
    guards.push(`verified current request → lifted to ${GUARD_CEILINGS.verifiedBuyerFloor}`)
    score = GUARD_CEILINGS.verifiedBuyerFloor
  }
  return { score, guards }
}
