/**
 * Profile Match Engine — reusable service for matching a profile to an opportunity.
 *
 * Answers: "Is this opportunity good for THIS sender profile?"
 *
 * Used by:
 * - LinkedIn lead extraction (prospect/analyze)
 * - Upwork job analysis
 * - Lead referral (recommend better profile)
 *
 * Input: opportunity capabilities + profile data
 * Output: match score, matching/missing capabilities, relevant proof, confidence
 */

// Profile match types defined locally

export interface ProfileMatchInput {
  opportunityCapabilities: string[]    // tech stack, skills needed
  opportunityIndustries: string[]      // industry context
  opportunitySeniority?: string        // seniority level
  opportunityType: 'lead' | 'upwork_job'
  leadId?: string
  jobId?: string
}

export interface ProfileData {
  profileId: string
  identityName: string
  skills: string[]
  technologies: string[]
  expertise: string[]
  industries: string[]
  allowedClaims: string[]
  projects?: ProofItem[]
  reviews?: ReviewItem[]
}

export interface ProofItem {
  id: string
  title: string
  description?: string
  technologies: string[]
  clientName?: string
  reviewQuote?: string
}

export interface ReviewItem {
  id: string
  clientName: string
  rating: number
  comment?: string
}

export interface ProfileMatchResult {
  profileId: string
  identityName: string
  matchScore: number           // 0-100
  matchingCapabilities: string[]
  missingCapabilities: string[]
  relevantProof: ProofItem[]
  confidence: number           // 0-1
  reason: string
}

/**
 * Compute match between an opportunity and a single profile.
 * Deterministic + semantic. Fast path for obvious mismatches.
 */
export function computeProfileMatch(
  input: ProfileMatchInput,
  profile: ProfileData,
): ProfileMatchResult {
  const oppCaps = normalizeCaps(input.opportunityCapabilities)
  const profileSkills = [...profile.skills, ...profile.technologies, ...profile.expertise].map(normalize)

  // Short-circuit: zero overlap
  if (oppCaps.length > 0 && profileSkills.length === 0) {
    return {
      profileId: profile.profileId,
      identityName: profile.identityName,
      matchScore: 0,
      matchingCapabilities: [],
      missingCapabilities: oppCaps,
      relevantProof: [],
      confidence: 0.3,
      reason: 'No matching skills or technologies found.',
    }
  }

  const matching = oppCaps.filter(cap =>
    profileSkills.some(skill => skill.includes(cap) || cap.includes(skill) || fuzzyMatch(cap, skill))
  )

  const missing = oppCaps.filter(cap =>
    !profileSkills.some(skill => skill.includes(cap) || cap.includes(skill) || fuzzyMatch(cap, skill))
  )

  // Industry bonus
  const industryMatch = input.opportunityIndustries.filter(ind =>
    profile.industries.some(pi => normalize(pi) === normalize(ind))
  ).length

  // Proof relevance: projects that use matching technologies
  const relevantProof = (profile.projects || []).filter(proj =>
    matching.some(m => proj.technologies.some(t => normalize(t) === normalize(m)))
  ).slice(0, 3)

  const matchRatio = oppCaps.length > 0 ? matching.length / oppCaps.length : 0.5
  const baseScore = Math.round(matchRatio * 70)  // Up to 70 from skills
  const industryBonus = Math.min(20, industryMatch * 7)  // Up to 20 from industry
  const proofBonus = Math.min(10, relevantProof.length * 3)  // Up to 10 from proof

  const matchScore = Math.min(100, baseScore + industryBonus + proofBonus)

  // Confidence based on evidence richness
  const confidence = Math.min(1, 0.3 + (profileSkills.length > 5 ? 0.2 : 0) + (relevantProof.length > 0 ? 0.3 : 0) + (industryMatch > 0 ? 0.2 : 0))

  const reason = buildMatchReason(matching, missing, industryMatch, relevantProof.length)

  return {
    profileId: profile.profileId,
    identityName: profile.identityName,
    matchScore,
    matchingCapabilities: matching,
    missingCapabilities: missing,
    relevantProof,
    confidence,
    reason,
  }
}

/**
 * Rank multiple profiles against one opportunity.
 * Returns sorted by match score descending.
 */
export function rankProfilesForOpportunity(
  input: ProfileMatchInput,
  profiles: ProfileData[],
): ProfileMatchResult[] {
  return profiles
    .map(profile => computeProfileMatch(input, profile))
    .sort((a, b) => b.matchScore - a.matchScore)
}

/**
 * Get the best profile recommendation for an opportunity.
 */
export function recommendBestProfile(
  input: ProfileMatchInput,
  profiles: ProfileData[],
  currentProfileId?: string,
): { best: ProfileMatchResult | null; current: ProfileMatchResult | null; improvement: number } {
  const ranked = rankProfilesForOpportunity(input, profiles)
  const best = ranked[0] || null
  const current = ranked.find(r => r.profileId === currentProfileId) || null

  const improvement = best && current ? best.matchScore - current.matchScore : 0

  return { best, current, improvement }
}


function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.#+]/g, '').trim()
}

function normalizeCaps(caps: string[]): string[] {
  return caps.map(normalize).filter(c => c.length > 1)
}

function fuzzyMatch(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false
  return a.includes(b) || b.includes(a)
}

function buildMatchReason(
  matching: string[],
  missing: string[],
  industryMatch: number,
  proofCount: number,
): string {
  const parts: string[] = []

  if (matching.length > 0) {
    parts.push(`Matches ${matching.length} capabilities: ${matching.slice(0, 3).join(', ')}${matching.length > 3 ? '…' : ''}`)
  }

  if (missing.length > 0) {
    parts.push(`Missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`)
  }

  if (industryMatch > 0) {
    parts.push(`${industryMatch} industry match`)
  }

  if (proofCount > 0) {
    parts.push(`${proofCount} relevant proof items`)
  }

  return parts.join('. ') || 'No specific match data.'
}
