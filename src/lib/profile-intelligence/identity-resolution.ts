import type { IdentityCandidate, IdentityResolution } from '@/lib/domain/types'

export interface ResolutionResult {
  resolution: IdentityResolution
  matchedProfileId: string | null
  confidence: number
  reasons: string[]
}

export function resolveIdentity(
  candidate: IdentityCandidate,
  existingProfiles: Array<{
    id: string
    fullName: string | null
    displayName: string | null
    label: string | null
    headline: string | null
    currentRole: string | null
    company: string | null
    profileUrl: string | null
  }>,
): ResolutionResult {
  if (existingProfiles.length === 0) {
    return { resolution: 'create_new', matchedProfileId: null, confidence: 1, reasons: ['No existing profiles to match against.'] }
  }

  const scores = existingProfiles.map((profile) => ({
    profile,
    score: computeMatchScore(candidate, profile),
    reasons: [] as string[],
  }))

  for (const entry of scores) {
    entry.reasons = buildReasons(candidate, entry.profile, entry.score)
  }

  const sorted = scores.sort((a, b) => b.score - a.score)
  const best = sorted[0]

  if (best.score >= 70) {
    return {
      resolution: 'match_existing',
      matchedProfileId: best.profile.id,
      confidence: best.score / 100,
      reasons: best.reasons,
    }
  }

  if (best.score >= 50) {
    return {
      resolution: 'possible_duplicate',
      matchedProfileId: best.profile.id,
      confidence: best.score / 100,
      reasons: best.reasons,
    }
  }

  if (best.score >= 30) {
    return {
      resolution: 'needs_review',
      matchedProfileId: best.profile.id,
      confidence: best.score / 100,
      reasons: best.reasons,
    }
  }

  return {
    resolution: 'create_new',
    matchedProfileId: null,
    confidence: 1 - best.score / 100,
    reasons: [`Best match "${best.profile.fullName ?? best.profile.label ?? 'unknown'}" scored ${best.score} — below threshold.`],
  }
}

function computeMatchScore(candidate: IdentityCandidate, profile: { fullName: string | null; displayName: string | null; label: string | null; headline: string | null; currentRole: string | null; company: string | null; profileUrl: string | null }): number {
  let score = 0

  const candidateName = normalizeName(candidate.normalizedName)
  const profileNames = [
    profile.fullName,
    profile.displayName,
    profile.label,
  ].filter((n): n is string => n != null).map(normalizeName)

  let nameScore = 0
  for (const pn of profileNames) {
    if (pn === candidateName) {
      nameScore = 75
      break
    }
    if (pn.includes(candidateName) || candidateName.includes(pn)) {
      nameScore = Math.max(nameScore, 45)
    }
    if (levenshtein(pn, candidateName) <= 2 && pn.length > 3) {
      nameScore = Math.max(nameScore, 40)
    }
  }
  score += nameScore

  for (const alias of candidate.aliases) {
    const normAlias = normalizeName(alias)
    for (const pn of profileNames) {
      if (normAlias === pn) {
        score = Math.max(score, 55)
      }
    }
  }

  if (candidate.linkedinUrl && profile.profileUrl && candidate.linkedinUrl === profile.profileUrl) {
    score += 75
  }

  if (candidate.company && profile.company) {
    if (normalizeName(candidate.company) === normalizeName(profile.company)) {
      score += 10
    }
  }

  if (candidate.role && profile.currentRole) {
    if (normalizeName(candidate.role) === normalizeName(profile.currentRole)) {
      score += 10
    }
  }

  return Math.min(score, 100)
}

function buildReasons(candidate: IdentityCandidate, profile: { fullName: string | null; displayName: string | null; label: string | null }, score: number): string[] {
  const reasons: string[] = []
  const candidateName = normalizeName(candidate.normalizedName)
  const profileNames = [profile.fullName, profile.displayName, profile.label].filter((n): n is string => n != null).map(normalizeName)

  for (const pn of profileNames) {
    if (pn === candidateName) {
      reasons.push(`Exact name match: "${candidate.normalizedName}"`)
      break
    }
    if (pn.includes(candidateName) || candidateName.includes(pn)) {
      reasons.push(`Partial name match: "${candidate.normalizedName}" ~ "${pn}"`)
      break
    }
  }

  if (score < 30) {
    reasons.push('No strong name or identity match found.')
  }

  return reasons
}

function normalizeName(name: string): string {
  if (!name || typeof name !== 'string') return ''
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }
  return matrix[b.length][a.length]
}
