import type { MarketRegion, RoleCategory } from '@/lib/domain/types'

// US states minus Georgia and Washington (also a country / a common name);
// those resolve through their cities instead.
const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
  'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma',
  'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
] as const

const CORE_REGIONS: Record<Exclude<MarketRegion, 'outside_core' | 'unknown'>, readonly string[]> = {
  US: [
    'united states', 'united states of america', 'usa', 'u.s.', 'u.s.a.', 'washington', 'washington dc', 'washington d.c.',
    ...US_STATES,
    'san francisco', 'bay area', 'silicon valley', 'los angeles', 'san diego', 'san jose', 'seattle', 'portland',
    'austin', 'dallas', 'houston', 'chicago', 'boston', 'atlanta', 'miami', 'denver', 'phoenix', 'nyc',
    'brooklyn', 'philadelphia', 'pittsburgh', 'detroit', 'minneapolis', 'nashville', 'raleigh', 'salt lake city',
  ],
  UK: ['united kingdom', 'uk', 'u.k.', 'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'london', 'manchester', 'edinburgh', 'glasgow', 'bristol', 'leeds', 'liverpool', 'belfast'],
  EU: [
    'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'sweden', 'denmark', 'ireland', 'portugal',
    'poland', 'austria', 'finland', 'greece', 'czech republic', 'czechia', 'romania', 'hungary', 'estonia',
    'latvia', 'lithuania', 'luxembourg', 'croatia', 'slovakia', 'slovenia', 'bulgaria', 'europe', 'european union',
    'berlin', 'munich', 'hamburg', 'paris', 'amsterdam', 'rotterdam', 'madrid', 'barcelona', 'dublin', 'lisbon',
    'stockholm', 'copenhagen', 'warsaw', 'vienna', 'prague', 'milan', 'rome', 'brussels', 'helsinki', 'tallinn',
  ],
  CA: ['canada', 'toronto', 'vancouver', 'montreal', 'ontario', 'british columbia', 'quebec', 'alberta', 'calgary', 'ottawa'],
  AU: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'new south wales', 'victoria', 'queensland'],
  UAE: ['uae', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah'],
  SG: ['singapore', 'sg'],
}

const OUTSIDE_MARKERS = [
  'pakistan', 'india', 'bangladesh', 'nepal', 'sri lanka', 'nigeria', 'kenya', 'philippines',
  'indonesia', 'vietnam', 'brazil', 'argentina', 'mexico', 'egypt', 'saudi arabia', 'georgia', 'tbilisi',
  'turkey', 'turkiye', 'ukraine', 'south africa', 'malaysia', 'thailand', 'china', 'japan', 'south korea',
  'israel', 'morocco', 'qatar', 'colombia', 'chile', 'peru', 'switzerland', 'norway', 'iceland', 'serbia',
]

// Country-level names: a location line names at most one of these.
const COUNTRIES = new Set([
  'united states', 'united states of america', 'usa', 'u.s.', 'u.s.a.', 'us', 'united kingdom', 'uk', 'u.k.',
  'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'germany', 'france', 'spain', 'italy',
  'netherlands', 'belgium', 'sweden', 'denmark', 'ireland', 'portugal', 'poland', 'austria', 'finland', 'greece',
  'czech republic', 'czechia', 'romania', 'hungary', 'estonia', 'latvia', 'lithuania', 'luxembourg', 'croatia',
  'slovakia', 'slovenia', 'bulgaria', 'canada', 'australia', 'uae', 'united arab emirates', 'singapore',
  ...OUTSIDE_MARKERS.filter((m) => m !== 'tbilisi'),
])

const ALL_PLACE_NAMES = new Set<string>([...Object.values(CORE_REGIONS).flat(), ...OUTSIDE_MARKERS, 'us', 'dc', 'd.c.'])

/** Whether a whole string is a known place name ("Texas", "USA", "Lahore" is not known). */
export function isKnownPlaceName(part: string | null | undefined): boolean {
  return ALL_PLACE_NAMES.has(norm(part ?? '').replace(/^the\s+/, ''))
}

/** Whether a whole string is a country name. */
export function isCountryName(part: string | null | undefined): boolean {
  return COUNTRIES.has(norm(part ?? '').replace(/^the\s+/, ''))
}

/**
 * Whether a short string reads as a stated place ("Lahore, Pakistan",
 * "Austin, Texas, USA", "San Francisco Bay Area") rather than a list of
 * countries or names that merely contain a place ("Texas Rangers").
 */
export function looksLikePlace(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().replace(/[.;]+$/, '')
  if (!v || v.length > 80 || mapLocationToRegion(v) === 'unknown') return false
  if (/^(?:greater\s+)?[\p{Lu}][\p{L}.'’ -]*?\s+(?:bay\s+area|metropolitan\s+area|metro(?:politan)?\s+area|area|region)$/iu.test(v)) return true
  const parts = v.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > 3) return false
  // After the city, every part is a known region, and only one is a country.
  if (!parts.slice(1).every(isKnownPlaceName)) return false
  return parts.filter(isCountryName).length <= 1
}

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

  // A stated country decides: "London, Ontario, Canada" is Canada. "Georgia"
  // is both a country and a US state, so it never decides on its own.
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean)
  for (const part of [...parts].reverse()) {
    if (part === 'georgia' || !COUNTRIES.has(part)) continue
    for (const [region, markers] of Object.entries(CORE_REGIONS)) {
      if (markers.includes(part)) return region as MarketRegion
    }
    if (OUTSIDE_MARKERS.includes(part)) return 'outside_core'
    if (part === 'us') return 'US'
  }

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
