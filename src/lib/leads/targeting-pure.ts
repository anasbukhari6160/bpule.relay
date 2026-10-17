import type { MarketRegion, RoleCategory } from '@/lib/domain/types'

const CORE_REGIONS: Record<Exclude<MarketRegion, 'outside_core' | 'unknown'>, readonly string[]> = {
  US: ['united states', 'usa', 'u.s.', 'california', 'new york', 'texas', 'florida', 'washington', 'new mexico'],
  UK: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'london', 'manchester'],
  EU: ['germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'sweden', 'denmark', 'europe'],
  CA: ['canada', 'toronto', 'vancouver', 'montreal', 'ontario', 'british columbia'],
  AU: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth'],
  UAE: ['uae', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah'],
  SG: ['singapore', 'sg'],
}

const OUTSIDE_MARKERS = [
  'pakistan', 'india', 'bangladesh', 'nepal', 'sri lanka', 'nigeria', 'kenya', 'philippines',
  'indonesia', 'vietnam', 'brazil', 'argentina', 'mexico', 'egypt', 'saudi arabia',
]

function norm(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function classifyRoleFromTitle(titleRaw: string | null | undefined): RoleCategory {
  const title = norm(titleRaw ?? '')
  if (!title) return 'other'

  if (/\b(co[- ]?founder|founder)\b/.test(title)) return 'founder_cofounder'
  if (/\bchief executive officer\b|\bceo\b/.test(title)) return 'ceo'
  if (/\bcto\b|chief technology officer|vp engineering|vice president engineering|head of engineering|engineering director/.test(title)) {
    return 'technical_leadership'
  }
  if (/\bproduct manager\b|\bproduct owner\b|head of product|vp product|director of product/.test(title)) {
    return 'product'
  }
  if (/\brecruiter\b|talent|hiring manager|people ops|human resources|\bhr\b|staffing/.test(title)) {
    return 'hiring_manager_recruiter'
  }
  return 'other'
}

export function mapLocationToRegion(locationRaw: string | null | undefined): MarketRegion {
  const location = norm(locationRaw ?? '')
  if (!location) return 'unknown'

  // Whole-word markers: substring matching put "Milwaukee" and "Ukraine" in
  // the UK and "Jerusalem" in the US.
  const has = (marker: string) => new RegExp(`(?<![a-z])${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(location)

  for (const [region, markers] of Object.entries(CORE_REGIONS)) {
    if (markers.some(has)) return region as MarketRegion
  }
  if (OUTSIDE_MARKERS.some(has)) return 'outside_core'
  return 'unknown'
}

export function rolePromptGuidance(role: RoleCategory): string {
  switch (role) {
    case 'founder_cofounder':
    case 'ceo':
      return 'Role cue: this contact owns product and business outcomes. Frame the message around delivery risk to roadmap and revenue.'
    case 'technical_leadership':
      return 'Role cue: this contact can evaluate technical detail. Be concrete about inherited code, release gaps, and architecture risk.'
    case 'product':
      return 'Role cue: this contact owns roadmap commitments. Frame around blocked releases, delivery predictability, and stakeholder pressure.'
    case 'hiring_manager_recruiter':
      return 'Role cue: this contact may not own the technical buying decision. Ask who owns engineering delivery decisions instead of assuming authority.'
    default:
      return 'Role cue: use the default play framing.'
  }
}
