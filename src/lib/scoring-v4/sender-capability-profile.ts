/**
 * SenderCapabilityProfile — canonical, semantic description of a sending
 * identity (Phase 5). Built from the same profile rows the routing engine
 * already loads (skills, industries, proof cards, proof items, portfolio
 * projects, historical outcomes), but expressed in capability FAMILIES so
 * that sender matching is a set comparison against OpportunityFeatures,
 * not loose keyword overlap.
 *
 * Deterministic, no AI. Historical rates are Bayesian-smoothed (Phase 21).
 */

import type { SenderProfile, SenderProof } from '@/lib/relay/sender-routing-engine'
import { mapToCapabilities, type CapabilityFamily } from './capability-taxonomy'

export const SENDER_CAPABILITY_PROFILE_VERSION = 'sender_capability_profile_v1'

export interface SenderProofRecord {
  text: string
  families: CapabilityFamily[]
  industries: string[]
  strong: boolean
  verified: boolean
}

export interface SmoothedRate {
  /** Posterior mean after smoothing toward the prior. */
  rate: number
  n: number
  /** True once n reaches the minimum sample size the program requires. */
  reliable: boolean
}

export interface SenderCapabilityProfile {
  version: typeof SENDER_CAPABILITY_PROFILE_VERSION
  identityId: string
  name: string | null
  role: string | null
  platform: string | null
  ownerReps: string[]
  accessibleToRep: boolean
  /** Families the identity can credibly deliver (skills + proof + portfolio). */
  capabilities: CapabilityFamily[]
  /** Families backed by at least one proof item. */
  provenCapabilities: CapabilityFamily[]
  /** Families backed by VERIFIED proof. */
  verifiedCapabilities: CapabilityFamily[]
  industries: string[]
  proof: SenderProofRecord[]
  history: {
    contacted: number
    replyRate: SmoothedRate
    meetingRate: SmoothedRate
  }
  /** Raw skill tokens retained for display and for terms the taxonomy does not cover. */
  rawSkills: string[]
}

/** Minimum contacted leads before a sender's own rate is trusted (Phase 21). */
export const HISTORY_MIN_SAMPLE = 10
/** Prior strength in pseudo-observations. */
const PRIOR_WEIGHT = 10
const PRIOR_REPLY_RATE = 0.12
const PRIOR_MEETING_RATE = 0.03

export function smoothRate(successes: number, n: number, prior: number, priorWeight = PRIOR_WEIGHT): SmoothedRate {
  const rate = (successes + prior * priorWeight) / (n + priorWeight)
  return { rate: Math.round(rate * 1000) / 1000, n, reliable: n >= HISTORY_MIN_SAMPLE }
}

const normIndustry = (s: string) => s.toLowerCase().trim()

function proofRecord(p: SenderProof): SenderProofRecord {
  const text = [p.text, ...(p.tags ?? []), ...(p.technologies ?? [])].join(' · ')
  const families = mapToCapabilities([...(p.tags ?? []), ...(p.technologies ?? [])], p.text).map((m) => m.family)
  return { text: p.text, families, industries: [], strong: p.strong, verified: p.verified && text.length > 0 }
}

/** Build the canonical profile from a loaded SenderProfile. */
export function buildSenderCapabilityProfile(sender: SenderProfile): SenderCapabilityProfile {
  const skillFamilies = mapToCapabilities(sender.skills, sender.role ?? '').map((m) => m.family)
  const proof = sender.proof.map(proofRecord)
  const proven = new Set<CapabilityFamily>()
  const verified = new Set<CapabilityFamily>()
  for (const p of proof) for (const f of p.families) { proven.add(f); if (p.verified) verified.add(f) }
  const capabilities = [...new Set([...skillFamilies, ...proven])].sort()
  const h = sender.historicalOutcomes
  const contacted = h?.leadsContacted ?? 0
  return {
    version: SENDER_CAPABILITY_PROFILE_VERSION,
    identityId: sender.id,
    name: sender.name,
    role: sender.role,
    platform: sender.platform,
    ownerReps: sender.holders.map((x) => x.repId),
    accessibleToRep: sender.accessibleToRep,
    capabilities,
    provenCapabilities: [...proven].sort(),
    verifiedCapabilities: [...verified].sort(),
    industries: [...new Set(sender.industries.map(normIndustry))],
    proof,
    history: {
      contacted,
      replyRate: smoothRate(h?.replies ?? 0, contacted, PRIOR_REPLY_RATE),
      meetingRate: smoothRate(h?.meetings ?? 0, contacted, PRIOR_MEETING_RATE),
    },
    rawSkills: [...new Set(sender.skills.map((s) => s.toLowerCase().trim()))],
  }
}
