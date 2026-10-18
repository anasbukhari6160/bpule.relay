import type { Lead, Profile } from '@/lib/domain/types'
import { pickSuggestion, scoreSender } from './sender-suggestion'

export interface RoutingExplanation {
  recommendedProfileId: string | null
  recommendedProfileName: string | null
  currentScore: number
  recommendedScore: number
  reasons: string[]
  actions: Array<{
    label: string
    action: 'keep' | 'refer' | 'assign'
    description: string
  }>
}

/**
 * Explain opportunity routing with match reasons.
 * Extends existing sender-suggestion.ts with explanations.
 */
export function explainRouting(
  lead: Lead,
  profiles: Profile[],
  currentProfileId: string | null,
): RoutingExplanation {
  // Extract lead terms from intelligence
  const leadTerms = extractLeadTerms(lead)

  // Score all profiles
  const scores = profiles.map(p => ({
    profile: p,
    result: scoreSender(p as any, leadTerms),
  })).sort((a, b) => b.result.score - a.result.score)

  const current = currentProfileId
    ? scores.find(s => s.profile.id === currentProfileId)
    : scores.find(s => s.profile.id === lead.senderProfileId)

  const best = scores[0] ?? null

  const reasons: string[] = []
  if (best && current && best.result.score > current.result.score) {
    const overlap = findSkillOverlap(best.profile, leadTerms)
    if (overlap.length > 0) {
      reasons.push(`${overlap.join(', ')} overlap`)
    }
    if (best.profile.id !== current.profile.id) {
      reasons.push(`Higher profile match (${best.result.score} vs ${current.result.score})`)
    }
    if ((best.profile as any).proofCards?.length ?? 0 > 0) {
      reasons.push('Has relevant proof')
    }
  }

  return {
    recommendedProfileId: best?.profile.id ?? null,
    recommendedProfileName: best?.profile.displayName ?? best?.profile.fullName ?? null,
    currentScore: current?.result.score ?? 0,
    recommendedScore: best?.result.score ?? 0,
    reasons,
    actions: [
      {
        label: 'Keep mine',
        action: 'keep',
        description: currentProfileId === best?.profile.id
          ? 'Current sender is already the best match'
          : `Continue with current sender (${current?.result.score ?? 0} pts)`,
      },
      {
        label: 'Refer',
        action: 'refer',
        description: best && current && best.result.score > current.result.score
          ? `Best sender: ${best.profile.displayName ?? best.profile.fullName} (${best.result.score} pts)`
          : 'No better match found',
      },
    ],
  }
}

function extractLeadTerms(lead: Lead): string[] {
  const terms: string[] = []
  const intel = lead.canonicalIntelligence as Record<string, unknown> | null

  if (intel) {
    const normalized = intel.intelligence as Record<string, unknown> | null
    if (normalized) {
      for (const [key, val] of Object.entries(normalized)) {
        if (val && typeof val === 'string') terms.push(val)
        if (val && Array.isArray(val)) terms.push(...val.filter(v => typeof v === 'string'))
      }
    }
  }

  if (lead.contactTitle) terms.push(lead.contactTitle)
  if (lead.company) terms.push(lead.company)

  return [...new Set(terms)].filter(Boolean)
}

function findSkillOverlap(profile: Profile, leadTerms: string[]): string[] {
  const profileSkills = ((profile as any).skills as string[] ?? [])
    .map((s: string) => s.toLowerCase())
  const leadTermsLower = leadTerms.map(t => t.toLowerCase())

  return profileSkills.filter((skill: string) =>
    leadTermsLower.some(term => term.includes(skill) || skill.includes(term))
  ).slice(0, 3)
}
