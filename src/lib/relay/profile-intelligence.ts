import type { Profile, ProofCard, ProofItem, MatchedProof, ClaimSafety, FactSafety, SafeFact } from '@/lib/domain/types'

/**
 * Outreach Profile Intelligence
 *
 * Each outreach profile is a reusable Sales Identity.
 * Proof Cards are extracted from sources and tagged for matching.
 * Every fact retains provenance — never invent proof.
 */

export interface ProfileIntelligence {
  profile: Profile
  proofCards: ProofCard[]
  capabilities: string[]
  industries: string[]
  technologies: string[]
  strongestProof: ProofCard | null
  forbiddenClaims: string[]
}

/**
 * Build profile intelligence from raw profile data + proof items + proof cards.
 * Proof items from the existing system are converted to proof cards.
 */
export function buildProfileIntelligence(
  profile: Profile,
  proofItems: ProofItem[],
  proofCards: ProofCard[] = [],
): ProfileIntelligence {
  const cards = [...proofCards]

  for (const item of proofItems) {
    const alreadyMapped = cards.some((c) => c.sourceReference === item.projectSummary)
    if (!alreadyMapped) {
      cards.push({
        id: `legacy-${item.id}`,
        organizationId: item.organizationId,
        profileId: profile.id,
        capability: item.projectSummary.split('.')[0] ?? item.projectSummary,
        strength: item.reviewQuote ? 'strong' : 'moderate',
        safeClaim: item.projectSummary,
        sourceType: 'client_work',
        sourceReference: item.reviewQuote ?? null,
        tags: item.tags,
        verified: item.permissionOnFile,
        forbiddenClaims: [],
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
      })
    }
  }

  const v2Capabilities = [
    ...new Set([
      ...cards.map((c) => c.capability),
      ...(profile.primarySkills ?? []),
      ...(profile.serviceCapabilities ?? []),
    ]),
  ]
  const v2Technologies = [
    ...new Set([
      ...cards.flatMap((c) => c.tags),
      ...(profile.technologies ?? []),
    ]),
  ]
  const v2Industries = extractIndustriesV2(cards, profile.industries ?? [])
  const forbiddenClaims = [...new Set(cards.flatMap((c) => c.forbiddenClaims))]

  const safeCards = cards.filter((c) => isProductionSafeProof(c))
  const strongestProof = safeCards
    .filter((c) => c.strength === 'strong')
    .sort((a, b) => b.tags.length - a.tags.length)[0] ?? safeCards[0] ?? null

  return {
    profile,
    proofCards: cards,
    capabilities: v2Capabilities,
    industries: v2Industries,
    technologies: v2Technologies,
    strongestProof,
    forbiddenClaims,
  }
}

function extractIndustriesV2(cards: ProofCard[], profileIndustries: string[]): string[] {
  const industryKeywords: Record<string, string[]> = {
    fintech: ['fintech', 'payments', 'banking', 'trading', 'defi'],
    healthcare: ['healthcare', 'health', 'medical', 'pharma'],
    ecommerce: ['ecommerce', 'e-commerce', 'shopify', 'marketplace', 'retail'],
    saas: ['saas', 'b2b', 'enterprise', 'platform'],
    web3: ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'solana', 'ethereum'],
    ai: ['ai', 'ml', 'llm', 'machine-learning', 'gpt', 'openai'],
    education: ['edtech', 'education', 'learning', 'course'],
    logistics: ['logistics', 'supply-chain', 'shipping', 'freight'],
  }

  const allTags = cards.flatMap((c) => c.tags.map((t) => t.toLowerCase()))
  const found = new Set(profileIndustries.map((i) => i.toLowerCase()))

  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    if (keywords.some((kw) => allTags.some((t) => t.includes(kw)))) {
      found.add(industry)
    }
  }

  return [...found]
}

/**
 * A proof card is production-safe only when it is verified AND does not
 * self-declare as fake/test/demo/sample/rejected. The Facts library can hold
 * placeholder rows that are "approved" in the UI but must never be quoted in
 * an outbound message (QA RQA-026).
 */
const SELF_DECLARED_UNTRUSTED = /\b(fake|test|demo|sample|example|placeholder|rejected|do\s*not\s*use|not\s*real)\b/i

export function isProductionSafeProof(card: Pick<ProofCard, 'verified' | 'safeClaim' | 'capability'>): boolean {
  if (!card.verified) return false
  if (SELF_DECLARED_UNTRUSTED.test(card.safeClaim)) return false
  if (SELF_DECLARED_UNTRUSTED.test(card.capability)) return false
  return true
}

/**
 * Match a lead's tags to a profile's proof cards.
 * Returns the 1-3 most relevant proofs, ranked by relevance.
 */
export function matchProofToLead(
  profileIntelligence: ProfileIntelligence,
  leadTags: string[],
  limit = 3,
): MatchedProof[] {
  const lead = new Set(leadTags.map((t) => t.toLowerCase()))

  const scored = profileIntelligence.proofCards
    .filter((card) => isProductionSafeProof(card))
    .map((card) => {
    const matchingTags = card.tags.filter((t) => lead.has(t.toLowerCase()))
    let relevanceScore = matchingTags.length * 3

    // Bonus for verified cards
    if (card.verified) relevanceScore += 2

    // Bonus for strong proof
    if (card.strength === 'strong') relevanceScore += 3
    else if (card.strength === 'moderate') relevanceScore += 1

    // Capability match
    if (leadTags.some((t) => card.capability.toLowerCase().includes(t.toLowerCase()))) {
      relevanceScore += 2
    }

    return {
      proofCard: card,
      relevanceScore,
      matchingTags,
      safeClaim: card.safeClaim,
    }
  })

  return scored
    .filter((s) => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit)
}

/**
 * Classify a sender claim against available proof.
 * Returns whether the claim is safe to make.
 */
export function classifyClaimSafety(
  claim: string,
  profileIntelligence: ProfileIntelligence,
): ClaimSafety {
  const lower = claim.toLowerCase()

  for (const forbidden of profileIntelligence.forbiddenClaims) {
    if (lower.includes(forbidden.toLowerCase())) {
      return 'UNSUPPORTED'
    }
  }

  // word from the capability (4+ chars, exact word match or substring of claim word)
  for (const card of profileIntelligence.proofCards) {
    if (!isProductionSafeProof(card)) continue
    const capWords = card.capability.toLowerCase().split(/\s+/)
    const claimWords = lower.split(/\s+/)
    // Match if any significant word from capability appears as a whole word in the claim
    const hasMatch = capWords.some((cw) => cw.length >= 4 && claimWords.some((w) => w === cw || (cw.length >= 6 && w.startsWith(cw))))
    if (hasMatch) return 'VERIFIED_PROFILE_PROOF'
  }

  for (const card of profileIntelligence.proofCards) {
    if (!isProductionSafeProof(card)) continue
    if (card.safeClaim && lower.includes(card.safeClaim.toLowerCase().slice(0, 30))) {
      return 'APPROVED_CLAIM'
    }
  }

  // Partial match with tags
  const allTags = profileIntelligence.technologies.map((t) => t.toLowerCase())
  if (allTags.some((t) => lower.includes(t))) {
    return 'INFERRED'
  }

  return 'UNSUPPORTED'
}

/**
 * Classify lead facts for safety in messaging.
 * INTERNAL signals increase score but are NOT automatically safe to mention.
 */
export function classifyLeadFact(
  fact: string,
  evidence: string,
  signalType: number | null,
): SafeFact {
  const lower = evidence.toLowerCase()

  // Funding signal
  if (signalType === 3) {
    return {
      fact,
      safety: 'VERIFIED_PUBLIC',
      source: 'public funding announcement',
      safeToMention: false, // "you raised money" is surveillance-like
    }
  }

  // Hiring signal
  if (signalType === 1 && /\bhiring\b|\bopen role\b/i.test(lower)) {
    return {
      fact,
      safety: 'VERIFIED_PUBLIC',
      source: 'job posting / hiring activity',
      safeToMention: true,
    }
  }

  // Pain signals
  if (signalType === 6 && /\bstuck\b|\bbehind\b|\bdelayed\b|\bpain\b/i.test(lower)) {
    return {
      fact,
      safety: 'INFERRED',
      source: 'observed activity pattern',
      safeToMention: false, // "you're stuck" assumes too much
    }
  }

  // Asking for help
  if (signalType === 7 && /\blooking for\b|\bneed help\b|\bseeking\b/i.test(lower)) {
    return {
      fact,
      safety: 'VERIFIED_PUBLIC',
      source: 'explicitly stated need',
      safeToMention: true,
    }
  }

  // Weak signals
  if (signalType === 4 || signalType === 5) {
    return {
      fact,
      safety: 'WEAK_SIGNAL',
      source: 'inferred from patterns',
      safeToMention: false,
    }
  }

  return {
    fact,
    safety: 'UNVERIFIED',
    source: 'unspecified',
    safeToMention: false,
  }
}

/**
 * Get the safe-to-mention facts from a set of lead intelligence.
 * Only facts classified as safeToMention=true should appear in messages.
 */
export function getSafeFacts(
  facts: SafeFact[],
): SafeFact[] {
  return facts.filter((f) => f.safeToMention)
}

/**
 * Check if one profile has substantially stronger proof for a lead than another.
 * Used to suggest profile switching.
 */
export function compareProfileFit(
  a: { profile: Profile; matchedProof: MatchedProof[] },
  b: { profile: Profile; matchedProof: MatchedProof[] },
): { stronger: Profile | null; reason: string } {
  const scoreA = a.matchedProof.reduce((s, m) => s + m.relevanceScore, 0)
  const scoreB = b.matchedProof.reduce((s, m) => s + m.relevanceScore, 0)

  if (scoreB > scoreA + 5) {
    return {
      stronger: b.profile,
      reason: `${b.profile.label ?? b.profile.headline ?? 'Another profile'} has stronger proof for this lead.`,
    }
  }

  if (scoreA > scoreB + 5) {
    return {
      stronger: a.profile,
      reason: `${a.profile.label ?? a.profile.headline ?? 'Current profile'} has stronger proof for this lead.`,
    }
  }

  return { stronger: null, reason: 'Both profiles are similarly matched.' }
}
