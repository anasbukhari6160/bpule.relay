import type { Fact } from '@/lib/domain/types'

/**
 * The published facts guard, enforced here in code and not left to the model:
 *
 *  1. Any number in a draft that does not appear in an approved fact is
 *     stripped (replaced) before the draft is ever shown.
 *  2. Any em dash in a draft is replaced with a hyphen, because em dashes are
 *     banned everywhere in Scout output.
 *  3. When the public site is not live (facts flag `Site live` = false), any
 *     outbound link to that site is removed so a draft can never point a
 *     prospect somewhere that does not exist. CTAs then have to land in a
 *     reply or the free Read.
 */

const NUMBER_RE = /\b\d+(?:[.,]\d+)?\b/g

// Emojis are banned in Scout output. Covers pictographs, symbols, dingbats,
// emoticon faces, and the variation-selector FE0F suffixed to many emoji.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/gu

function digitsOnly(s: string): string {
  return s.replace(/\./g, '')
}

/**
 * Test/demo data must never approve a claim in a production draft. QA open
 * observation: the approved library contained facts labelled (FAKE) and a raw
 * internal JSON project proof whose numbers the guard would otherwise approve.
 */
export function isTestFact(fact: Pick<Fact, 'label' | 'value'>): boolean {
  const label = (fact.label ?? '').toLowerCase()
  if (/\b(fake|test|demo|sample|placeholder|lorem)\b/.test(label)) return true
  const value = (fact.value ?? '').trim()
  if (value.startsWith('{') && /fetch_status|permission_to_name_publicly/.test(value)) return true
  return false
}

/** Truthy when the facts table says the public site is live. */
export function siteIsLive(facts: Fact[]): boolean {
  const flag = facts.find(
    (f) => f.label.toLowerCase() === 'site live' || f.factType === 'config',
  )
  if (!flag) return false
  const v = flag.value.toLowerCase().trim()
  return v === 'true' || v === 'yes' || v === '1'
}

const PUBLIC_SITE_HOSTS = [
  (process.env.NEXT_PUBLIC_SITE_HOST ?? '').toLowerCase(),
]
  .filter(Boolean)

/**
 * Removes any https link to the team's public site when it is not live yet.
 * The replacement keeps the sentence readable; the CTA is gone, so the model
 * cannot route a prospect to a dead page.
 */
export function stripDeadSiteLinks(text: string, facts: Fact[]): string {
  if (siteIsLive(facts)) return text
  const hosts = PUBLIC_SITE_HOSTS
  if (hosts.length === 0) {
    // Without a configured site host there is nothing named worth stripping.
    return text
  }
  const hostRe = hosts.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return text.replace(
    new RegExp(`https?:\\/\\/(?:www\\.)?(?:${hostRe})[^\\s)]*`, 'gi'),
    '',
  )
}

/**
 * Returns a copy of text where every number token that is not backed by an
 * approved fact value is removed. Numbers the model could only have pulled
 * from the facts table survive. Unauthorized numbers are stripped entirely
 * — never replaced with a placeholder like '[number]' that could leak into
 * the final draft.
 */
export function stripUnauthorizedNumbers(
  draft: string,
  facts: Fact[],
): { text: string; stripped: string[] } {
  const approved = new Set<string>()
  for (const fact of facts) {
    if (isTestFact(fact)) continue
    const matches = fact.value.match(NUMBER_RE) ?? []
    for (const m of matches) {
      approved.add(digitsOnly(m))
    }
  }

  const stripped: string[] = []
  const text = draft.replace(NUMBER_RE, (token) => {
    if (approved.has(digitsOnly(token))) return token
    stripped.push(token)
    return ''
  })
  return { text: text.replace(/  +/g, ' ').trim(), stripped }
}

/** Em dashes are banned in every draft. Replace, never beautify. */
export function stripEmDashes(text: string): string {
  return text.replace(/[\u2014\u2013]/g, '-')
}

// The offer is always the free Read \u2014 a short written review. A draft must
// Checked here in code because the prompt instruction alone is not
// enforced anywhere once the model (or a fallback template) has responded.
const CALL_REQUEST_RE = /\b(hop on|jump on|get on)\s+(a\s+)?(call|zoom|meeting)\b|\bquick\s+call\b|\bintro\s+call\b|\bschedule\s+a\s+(call|meeting)\b|\b(book|grab)\s+(a\s+)?(call|time|meeting)\b|\bcall\s+or\s+meeting\b/i

/** True if the draft asks for a call, meeting, or similar live sync \u2014 always banned. */
export function requestsCall(text: string): boolean {
  return CALL_REQUEST_RE.test(text)
}

export function sanitizeDraft(
  draft: string,
  facts: Fact[],
): { text: string; strippedNumbers: string[]; hadEmDash: boolean; hadExclamation: boolean; hadEmoji: boolean; requestedCall: boolean } {
  const before = draft
  const hadEmoji = EMOJI_RE.test(before)
  EMOJI_RE.lastIndex = 0
  const hadEmDash = /[\u2014\u2013]/.test(before)
  const noEmoji = before.replace(EMOJI_RE, '')
  EMOJI_RE.lastIndex = 0
  const noDashes = stripEmDashes(noEmoji)
  const { text: noNumbers, stripped } = stripUnauthorizedNumbers(noDashes, facts)
  const withoutDeadLinks = stripDeadSiteLinks(noNumbers, facts)
  // Exclamation marks are banned in Scout output — strip them
  const hadExclamation = /!/.test(withoutDeadLinks)
  let clean = withoutDeadLinks
    .replace(/!/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+\./g, '.')
    .replace(/  +/g, ' ')
    .trim()
  // Remove incomplete claims: lines ending with "by", "at", "of", "with" (number was stripped)
  clean = clean.split('\n').map(l => l.trim()).filter(Boolean).filter(line => {
    if (/\b(by|at|of|with|for)\s*\.?$/.test(line)) return false
    if (/^\s*(improved|increased|reduced|enhanced|boosted|achieved|delivered|managed|led|grew)\s+(by|at|of|with|for)\s*\.?\s*$/i.test(line)) return false
    return true
  }).join('\n')
  // Remove incomplete claims: "by/at/of/with/for + period" (number was stripped, leaving dangling preposition)
  clean = clean.replace(/\s+(by|at|of|with|for)\s*\./g, '.')
  clean = clean.replace(/\s+\./g, '.').replace(/\.\s*\./g, '.')
  // Clean up double spaces and orphaned punctuation
  clean = clean.replace(/  +/g, ' ').replace(/\s+\./g, '.').trim()
  return {
    text: clean,
    strippedNumbers: stripped,
    hadEmDash,
    hadExclamation,
    hadEmoji,
    requestedCall: requestsCall(clean),
  }
}

/**
 * Normalizes typography in content captions: em dashes → hyphens,
 * exclamation marks → periods. This is style normalization, NOT
 * factual grounding. Factual accuracy (no invented numbers/claims) is
 * enforced separately via `stripUnauthorizedNumbers` + fact table.
 */
export function normalizeCaptionTypography(caption: string): string {
  let text = stripEmDashes(caption)
  text = text.replace(/!/g, '.')
  text = text.replace(/  +/g, ' ').trim()
  return text
}

