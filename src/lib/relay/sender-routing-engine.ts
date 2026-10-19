/**
 * Unified Sender Routing Engine — ONE canonical rankSendersForLead().
 *
 * Consolidates the scattered sender-matching logic from:
 * - relay/sender-suggestion.ts (keyword match)
 * - relay/opportunity-routing.ts (wrapper)
 * - profile-match.ts (capability overlap)
 *
 * Deterministic from structured sender profiles + proof. No AI calls.
 * Same input → same output (stable across rerenders).
 *
 * Routing version invalidates cached rankings when the algorithm changes.
 */

import type { Lead } from '@/lib/domain/types'

export interface SenderProfile {
  id: string
  name: string | null
  role: string | null
  platform: string | null
  skills: string[]
  industries: string[]
  proof: SenderProof[]
  holders: Array<{ repId: string; name: string }>
  accessibleToRep: boolean
  historicalOutcomes?: {
    leadsContacted: number
    replies: number
    meetings: number
  }
}

export interface SenderProof {
  text: string
  tags: string[]
  strong: boolean
  verified: boolean
  clientName?: string
  technologies?: string[]
}

export interface RoutingLeadContext {
  capabilities: string[]       // from V3 episodes requestedCapabilities
  industries: string[]
  buyerRequestProbability: number
  fitLevel: string
  rawTerms: string[]           // extracted lead terms (title, company, signals)
  platform?: string | null
}

export interface SenderRanking {
  senderId: string
  name: string | null
  role: string | null
  platform: string | null
  profileMatch: number         // 0-100
  confidence: number           // 0-1
  reasons: string[]
  risks: string[]
  accessibleToRep: boolean
  holders: string[]
  primaryProof: string | null
}

export interface RoutingResult {
  rankings: SenderRanking[]
  routingVersion: string
  bestSenderId: string | null
  currentSenderId: string | null
  currentSenderRank: number | null   // 1-based index in rankings
  currentSenderMatch: number | null
  bestSenderMatch: number | null
  mismatchDelta: number | null       // best - current
  generatedAt: string
}

/** Bumped when ranking algorithm changes. Cached results with older versions are stale. */
export const ROUTING_VERSION = 'routing_v1'

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}.+#\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/**
 * Canonical single entry point. Ranks all eligible senders for a lead.
 */
export function rankSendersForLead(
  lead: RoutingLeadContext,
  senders: SenderProfile[],
  currentSenderId?: string | null,
): RoutingResult {
  const eligible = lead.platform
    ? senders.filter((s) => !s.platform || s.platform === lead.platform)
    : senders

  const rankings: SenderRanking[] = eligible.map((sender) => {
    const result = scoreSenderAgainstLead(sender, lead)
    return {
      senderId: sender.id,
      name: sender.name,
      role: sender.role,
      platform: sender.platform,
      profileMatch: result.matchScore,
      confidence: result.confidence,
      reasons: result.reasons,
      risks: result.risks,
      accessibleToRep: sender.accessibleToRep,
      holders: sender.holders.map((h) => h.name),
      primaryProof: result.primaryProof,
    }
  })

  rankings.sort((a, b) => b.profileMatch - a.profileMatch || b.confidence - a.confidence)

  const best = rankings[0] ?? null
  const current = currentSenderId
    ? rankings.find((r) => r.senderId === currentSenderId) ?? null
    : null

  const currentRank = current
    ? rankings.findIndex((r) => r.senderId === currentSenderId) + 1
    : null

  return {
    rankings,
    routingVersion: ROUTING_VERSION,
    bestSenderId: best?.senderId ?? null,
    currentSenderId: currentSenderId ?? null,
    currentSenderRank: currentRank,
    currentSenderMatch: current?.profileMatch ?? null,
    bestSenderMatch: best?.profileMatch ?? null,
    mismatchDelta: current && best ? best.profileMatch - current.profileMatch : null,
    generatedAt: new Date().toISOString(),
  }
}

interface SenderScoreResult {
  matchScore: number
  confidence: number
  reasons: string[]
  risks: string[]
  primaryProof: string | null
}

function scoreSenderAgainstLead(
  sender: SenderProfile,
  lead: RoutingLeadContext,
): SenderScoreResult {
  const reasons: string[] = []
  const risks: string[] = []
  let score = 0

  const leadTerms = [...new Set(lead.rawTerms.map(norm).filter((t) => t.length > 1))]
  const capabilityTerms = [...new Set(lead.capabilities.map(norm).filter((t) => t.length > 1))]
  const allTerms = [...leadTerms, ...capabilityTerms]
  const matched = new Set<string>()

  const skillSet = new Set(sender.skills.map(norm))
  let skillHits = 0
  for (const t of allTerms) {
    if (skillSet.has(t) || [...skillSet].some((s) => s.length > 2 && (s.includes(t) || t.includes(s)))) {
      score += 4
      matched.add(t)
      skillHits++
    }
  }
  if (skillHits >= 3) reasons.push(`Strong skill overlap: ${[...matched].slice(0, 3).join(', ')}`)
  else if (skillHits >= 1) reasons.push(`Skill overlap: ${[...matched].slice(0, 3).join(', ')}`)

  // Proof relevance — proof outweighs self-declared skills
  let bestProof: { text: string; points: number } | null = null
  for (const p of sender.proof) {
    const hay = norm(`${p.text} ${p.tags.join(' ')}`)
    const hits = allTerms.filter((t) =>
      new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(hay)
    )
    if (hits.length === 0) continue
    const points = hits.length * 5 + (p.strong ? 4 : 0) + (p.verified ? 4 : 0)
    score += points
    hits.forEach((h) => matched.add(h))
    if (!bestProof || points > bestProof.points) bestProof = { text: p.text, points }
  }
  if (bestProof) {
    reasons.push('Verified proof directly relevant to lead needs')
  }

  // Industry match
  const industryHits = lead.industries.filter((ind) =>
    sender.industries.some((si) => norm(si) === norm(ind))
  ).length
  if (industryHits > 0) {
    score += industryHits * 8
    reasons.push(`${industryHits} industry match${industryHits > 1 ? 'es' : ''}`)
  }

  // Historical outcomes — small bonus for senders who win this lead type
  if (sender.historicalOutcomes) {
    const { leadsContacted, replies, meetings } = sender.historicalOutcomes
    if (leadsContacted >= 5) {
      const replyRate = replies / leadsContacted
      if (replyRate >= 0.3) {
        score += Math.min(10, Math.round(replyRate * 20))
        reasons.push(`Strong reply rate on similar leads (${Math.round(replyRate * 100)}%)`)
      }
      if (meetings >= 2) {
        score += 5
      }
    }
  }

  // Accessibility risk
  if (!sender.accessibleToRep && sender.holders.length > 0) {
    risks.push(`Not accessible — held by ${sender.holders.join(', ')}`)
  }

  // Cap at 100
  const matchScore = Math.min(100, score)

  // Confidence from evidence richness
  const confidence = Math.min(
    1,
    0.3 +
      (skillHits > 3 ? 0.2 : skillHits > 0 ? 0.1 : 0) +
      (bestProof?.points ?? 0 > 10 ? 0.2 : bestProof ? 0.1 : 0) +
      (industryHits > 0 ? 0.15 : 0) +
      (sender.historicalOutcomes ? 0.1 : 0),
  )

  if (matchScore === 0) risks.push('No matching skills, proof, or industries')

  return {
    matchScore,
    confidence,
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 2),
    primaryProof: bestProof?.text ?? null,
  }
}

