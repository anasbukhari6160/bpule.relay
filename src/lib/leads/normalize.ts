const LEGAL_SUFFIXES = [
  'inc',
  'inc.',
  'llc',
  'ltd',
  'ltd.',
  'limited',
  'corp',
  'corporation',
  'co',
  'co.',
  'gmbh',
  'b.v',
  'bv',
  'sa',
  'sarl',
  'pte',
  'plc',
  'group',
  'holdings',
  'technologies',
  'technology',
  'tech',
  'labs',
  'studio',
  'studios',
]

/**
 * LinkedIn UI artifacts that leak into extracted organization names.
 * These are presentation labels in the LinkedIn DOM, NOT company identity.
 * e.g. "Lotus logo", "XYZ Company logo", "Acme profile image".
 * Only stripped when they appear as suffixes/prefixes — never blindly removed
 * from the middle of a name (some companies legitimately contain "tech", "labs").
 */
const LINKEDIN_ARTIFACTS = [
  'logo',
  'company logo',
  'profile image',
  'profile photo',
  'cover image',
  'banner image',
  'linkedin',
  'linkedin logo',
  'sponsored',
  'promoted',
]

/**
 * Clean an extracted organization name by stripping LinkedIn UI artifacts
 * and normalizing whitespace. Returns the cleaned name, or null if nothing
 * meaningful remains.
 *
 * This is the ONE canonical cleaner for company names extracted from
 * LinkedIn exports. Every extraction path must run its output through this.
 */
export function cleanCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null
  let name = raw.trim()
  if (!name) return null

  // Strip LinkedIn UI artifacts (case-insensitive) that appear as suffixes
  // or prefixes. Repeat until stable because "Company XYZ logo" has both
  // "Company" prefix noise and "logo" suffix.
  let prev = ''
  while (prev !== name) {
    prev = name
    const lower = name.toLowerCase()
    for (const artifact of LINKEDIN_ARTIFACTS) {
      if (lower.endsWith(artifact)) {
        name = name.slice(0, name.length - artifact.length).trim().replace(/[,\-\s]+$/, '').trim()
      }
      if (lower.startsWith(artifact)) {
        name = name.slice(artifact.length).trim().replace(/^[,\-\s]+/, '').trim()
      }
    }
  }

  if (!name) return null
  return name
}

/**
 * Mirrors the database generated column:
 * lower(regexp_replace(company, '[^a-z0-9]', '', 'gi')).
 */
export function companyKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Fuzzy key used by the app-level dedupe gate. Strips legal suffixes so
 * "Acme Inc", "Acme LLC", and "acme" all collide. The database unique index
 * is the hard backstop on the raw company_key; this is the softer gate that
 * catches suffix variations before a row is ever written.
 */
export function companyFuzzyKey(company: string): string {
  let key = company.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const suffix of LEGAL_SUFFIXES) {
    const plain = suffix.replace(/[^a-z0-9]/g, '')
    if (key.length > plain.length && key.endsWith(plain)) {
      key = key.slice(0, -plain.length)
    }
  }
  return key
}

export function normalizeLeadUrl(url: string | null | undefined): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/+$/, '')
    const normalized = `${host}${path}`.toLowerCase()
    return normalized.length > 0 ? normalized : null
  } catch {
    return raw.toLowerCase()
  }
}

export function contactKey(name: string | null | undefined): string | null {
  const key = (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return key.length > 0 ? key : null
}

// LinkedIn / UI chrome that must never be treated as a person's name.
const PERSON_NAME_BLOCKLIST = [
  'view', 'view profile', 'view connection', 'follow', 'follow back',
  'connect', 'message', 'recommend', 'endorse', 'more', 'see all',
  'load more', 'show all', 'skip', 'close', 'edit', 'share',
  'report', 'block', 'remove', 'accept', 'decline', 'pending',
  'invitation sent', 'mutual connections', 'connections', 'connection',
  'profile', 'profile photo', 'profile image', 'cover image',
  'banner image', 'linkedin', 'logo', 'company logo', 'sponsored',
  'promoted', 'see more', 'see less', 'show more', 'learn more',
  'join', 'sign in', 'search', 'filter', 'sort by',
]

/**
 * Clean an extracted person name by stripping LinkedIn UI artifacts and
 * rejecting names that are clearly not real people. Returns null if the
 * name is invalid or is UI chrome.
 */
export function cleanPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null
  let name = raw.trim()
  if (!name) return null

  const lower = name.toLowerCase()

  // Strip LinkedIn action prefixes like "View ", "View profile ", "Follow "
  // so "View John Gummadi's profile" becomes "John Gummadi's profile"
  for (const word of PERSON_NAME_BLOCKLIST) {
    if (lower.startsWith(word + ' ') || lower === word) {
      name = name.slice(word.length).trim()
      break
    }
  }
  if (!name) return null

  // Strip trailing LinkedIn chrome like "profile", "image", "photo"
  name = name.replace(/\s*(profile|image|photo|banner|logo|connection)s?$/i, '').trim()
  if (!name) return null

  // Reject single-word UI fragments that survived stripping
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 1 && words[0].length <= 4 && !/^[A-Z][a-z]+$/.test(words[0])) {
    return null
  }

  // Reject if it doesn't look like a name (needs at least one capital letter)
  if (!/[A-Z]/.test(name)) return null

  // Reject if it's mostly non-letter characters
  const letterCount = (name.match(/[A-Za-z]/g) || []).length
  if (letterCount < name.length * 0.5) return null

  return name
}
