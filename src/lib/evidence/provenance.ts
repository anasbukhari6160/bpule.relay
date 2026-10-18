/**
 * Evidence provenance — the one contract for "is this score-affecting claim
 * supported by the original research?".
 *
 * Users may correct fields, but a correction is not evidence. Scoring credit
 * that represents a fact (a quote, a funding event, a hiring count, the
 * signal behind a lead) is only awarded when the claim can be found in the
 * source text. Everything here is deterministic: no model calls.
 */
import type { SignalId } from '@/lib/domain/types'
import { detectCommercialRequest, isVerbatimInSource } from '@/lib/intelligence-v3/source-facts'

export type Verification = 'VERIFIED_EXACT' | 'VERIFIED_NORMALIZED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'UNVERIFIABLE'
export type ClaimOrigin = 'AI_EXTRACTED' | 'USER_ENTERED' | 'INFERRED'

export interface EvidenceClaim<T = string> {
  kind: 'quote' | 'signal' | 'hiring_count' | 'funding' | 'company' | 'location'
  value: T
  origin: ClaimOrigin
  status: Verification
  /** The source line that supports the claim, when found. */
  sourceQuote: string | null
}

export function isVerified(status: Verification): boolean {
  return status === 'VERIFIED_EXACT' || status === 'VERIFIED_NORMALIZED'
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function firstLineMatching(text: string, re: RegExp): string | null {
  return lines(text).find((l) => re.test(l)) ?? null
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
}

// ── Quotes ──────────────────────────────────────────────────────────────

const MIN_QUOTE_CHARS = 12

/**
 * A quote is verified when it appears in the source: exactly, or after
 * whitespace / quote-style / case normalization. Very short quotes match
 * too much to count as evidence and are AMBIGUOUS.
 */
export function verifyQuote(quote: string | null | undefined, source: string | null | undefined, origin: ClaimOrigin = 'USER_ENTERED'): EvidenceClaim {
  const q = (quote ?? '').trim().replace(/^["“'‘]+|["”'’]+$/g, '').trim()
  const src = source ?? ''
  const base = { kind: 'quote' as const, value: q, origin }
  if (!q) return { ...base, status: 'NOT_FOUND', sourceQuote: null }
  if (!src.trim()) return { ...base, status: 'UNVERIFIABLE', sourceQuote: null }
  if (q.length < MIN_QUOTE_CHARS) {
    return { ...base, status: norm(src).includes(norm(q)) ? 'AMBIGUOUS' : 'NOT_FOUND', sourceQuote: null }
  }
  if (src.includes(q)) return { ...base, status: 'VERIFIED_EXACT', sourceQuote: q }
  if (isVerbatimInSource(q, src)) return { ...base, status: 'VERIFIED_NORMALIZED', sourceQuote: q }
  // End punctuation is not part of the evidence ("faster." vs "faster!").
  const trimmed = q.replace(/[.!?,;:]+$/, '').trim()
  if (trimmed.length >= MIN_QUOTE_CHARS && isVerbatimInSource(trimmed, src)) {
    return { ...base, status: 'VERIFIED_NORMALIZED', sourceQuote: q }
  }
  // An elided quote ("we need … to ship faster") verifies when every part
  // appears in the source in order. Each part must still be evidence-sized.
  const parts = q.split(/\s*(?:…|\.\.\.)\s*/).map((p) => p.replace(/[.!?,;:]+$/, '').trim()).filter(Boolean)
  if (parts.length > 1 && parts.every((p) => p.length >= MIN_QUOTE_CHARS)) {
    const hay = norm(src)
    let from = 0
    const inOrder = parts.every((p) => {
      const at = hay.indexOf(norm(p), from)
      if (at < 0) return false
      from = at + norm(p).length
      return true
    })
    if (inOrder) return { ...base, status: 'VERIFIED_NORMALIZED', sourceQuote: q }
  }
  return { ...base, status: 'NOT_FOUND', sourceQuote: null }
}

// ── Funding ─────────────────────────────────────────────────────────────

/**
 * A funding EVENT, not funding vocabulary. "million users", "venture into",
 * "angel" or "investment in quality" are not funding rounds.
 */
const FUNDING_EVENT = new RegExp(
  [
    String.raw`\b(?:raised|closed|secured|announc\w*|landed)\b[^.\n]{0,60}\b(?:round|funding|seed|series\s+[a-e]|investment|financing|[$€£]\s?\d)`,
    String.raw`\b(?:pre-?seed|seed|series\s+[a-e])\s+(?:round|funding|raise|financing)\b`,
    String.raw`\bfunding\s+round\b`,
    String.raw`\b(?:backed|funded)\s+by\b[^.\n]{0,50}\b(?:capital|ventures|vc|partners|combinator|accelerator|investors)\b`,
  ].join('|'),
  'i',
)

export function detectFunding(source: string | null | undefined): string | null {
  return firstLineMatching(source ?? '', FUNDING_EVENT)
}

// ── Hiring counts ───────────────────────────────────────────────────────

const WORD_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, 'a dozen': 12, dozen: 12,
}
const NUM = String.raw`(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a dozen)`
const ROLE_NOUN = String.raw`(?:developers?|engineers?|designers?|roles?|positions?|openings?|vacancies|hires|people|devs)`
const HIRING_COUNT_PATTERNS = [
  // "hiring 3 developers", "recruiting 2 engineers", "looking to hire 4 people"
  new RegExp(String.raw`\b(?:hiring|recruiting|looking\s+to\s+hire|adding)\s+${NUM}\+?\s+(?:[\w.+#-]+\s+){0,3}?${ROLE_NOUN}\b`, 'i'),
  // "10 open roles", "3 new positions", "5 vacancies" — an opening, not a job done
  new RegExp(String.raw`\b${NUM}\+?\s+(?:open|new|available|vacant|unfilled)\s+(?:[\w.+#-]+\s+){0,2}?(?:roles?|positions?|openings?|jobs)\b|\b${NUM}\+?\s+(?:openings?|vacancies)\b`, 'i'),
]
// Lines describing past work or someone else's numbers are not current openings.
const PAST_OR_OTHER_CONTEXT = /\b(?:placed|filled|held|have\s+held|shipped|led|managed|hired|contributors?|top\s+\d+|ranked)\b/i
// "5 years experience hiring 3 people" is a recruiter's track record; "hiring
// 3 engineers with 5+ years of experience" is an opening. Only the former is skipped.
const HIRING_AS_EXPERIENCE = /\b(?:experience|years?)\s+(?:of\s+|in\s+)?(?:hiring|recruiting)\b/i

export interface HiringCountClaim extends EvidenceClaim<number> {
  kind: 'hiring_count'
  unit: 'roles'
}

/**
 * A hiring count only exists when the source states one ("hiring 3
 * developers", "10 open roles"). Generic hiring language has no count —
 * "multiple roles" is hiring, not a number.
 */
export function parseHiringCount(source: string | null | undefined): HiringCountClaim | null {
  for (const line of lines(source ?? '')) {
    if (PAST_OR_OTHER_CONTEXT.test(line) || HIRING_AS_EXPERIENCE.test(line)) continue
    for (const re of HIRING_COUNT_PATTERNS) {
      const m = line.match(re)
      if (!m) continue
      const raw = m[1].toLowerCase()
      const value = /^\d+$/.test(raw) ? Number(raw) : WORD_NUM[raw]
      if (!value || value < 1 || value > 500) continue
      return { kind: 'hiring_count', value, unit: 'roles', origin: 'AI_EXTRACTED', status: 'VERIFIED_EXACT', sourceQuote: line }
    }
  }
  return null
}

// ── Signal types ────────────────────────────────────────────────────────

// Signals about the prospect's own company: a past project ("led a migration
// of legacy CRMs", "fixed bugs") is the author's experience, not a current need.
const SELF_REFERENCE = /\b(?:our|we|we're|we’re|we are|my|i'm|i’m|i am|us)\b/i

// "Led migration of our monolith", "Rebuilt our checkout" — the author's track record.
const PAST_ACHIEVEMENT = /^\s*(?:[-•*·▪►✓✔]\s*)?(?:led|built|migrated|shipped|delivered|managed|drove|spearheaded|implemented|designed|developed|launched|created|oversaw|rebuilt|rewrote|modernized|modernised|helped|architected|owned|scaled|reduced|cut|improved|replaced)\b|\b(?:i|we)\s+(?:led|migrated|rebuilt|rewrote|modernized|modernised|helped|delivered|shipped)\b/i
// A consultant describing clients' problems is selling, not buying.
const CLIENTS_AS_SUBJECT = /\b(?:my|our)\s+(?:clients?|customers'?\s+teams?)\b|\b(?:i|we)\s+help\s+(?:companies|clients|businesses|teams|startups|brands|founders|organi[sz]ations)\b/i

function firstSelfLine(source: string, re: RegExp): string | null {
  return lines(source).find((l) => re.test(l) && SELF_REFERENCE.test(l) && !PAST_ACHIEVEMENT.test(l) && !CLIENTS_AS_SUBJECT.test(l)) ?? null
}

const ASKING_FOR_HELP = /\b(?:looking\s+for\s+(?:an?\s+)?(?:\w+\s+){0,2}?(?:agency|agencies|dev\s+shop|development\s+partner|technical\s+(?:co-?founder|partner)|freelancer|contractor|consultant)|need\s+(?:help|outside\s+help|an?\s+(?:agency|developer|engineer)|someone\s+to\s+build)|recommend\s+(?:an?\s+)?(?:agency|developer|dev\s+shop)|anyone\s+know\s+(?:an?\s+)?(?:good\s+)?(?:developer|agency|dev\s+shop))\b/i

// "I never need outside help" / "we don't need an agency" is not a request.
const NOT_NEEDED = /\b(?:never|don'?t|do\s+not|doesn'?t|does\s+not|won'?t|no\s+longer|not)\s+(?:really\s+|actually\s+)?(?:need|looking\s+for|want)\b/i

const SIGNAL_DETECTORS: Record<SignalId, (source: string) => string | null> = {
  // Hiring ramp: explicit, current hiring language.
  1: (s) => firstLineMatching(s, /\b(?:we(?:'|’)?re\s+hiring|we\s+are\s+hiring|now\s+hiring|is\s+hiring|are\s+hiring|hiring\s+(?:a|an|for|our|\d|two|three|several|multiple)|open\s+(?:roles?|positions?)|job\s+openings?|recruiting\s+(?:a|an|for|\d))\b/i),
  // Tiny team: a solo founder / one-to-three-person team / capacity strain.
  2: (s) => firstSelfLine(s, /\b(?:solo\s+(?:founder|developer|dev)|one[- ]person\s+(?:team|company)|team\s+of\s+(?:one|two|three|[1-3])\b|just\s+me\b|only\s+(?:developer|engineer)|single\s+developer|can'?t\s+keep\s+up|understaffed|stretched\s+thin|need\s+more\s+(?:engineers|developers|capacity))/i),
  // Raised money: a funding event.
  3: (s) => detectFunding(s),
  // Stale product: the prospect's own product is outdated or unmaintained.
  4: (s) => firstSelfLine(s, /\b(?:app|product|site|website|platform|listing)\b[^.\n]{0,50}\b(?:outdated|out\s+of\s+date|no\s+(?:recent\s+)?updates?|hasn'?t\s+been\s+updated|not\s+been\s+updated|abandoned|unmaintained|broken|deprecated)\b|\b(?:outdated|unmaintained|abandoned|broken)\s+(?:app|product|site|website|platform)\b/i),
  // Aging stack: the prospect's own legacy technology or rebuild/migration.
  5: (s) => firstSelfLine(s, /\b(?:legacy|outdated|aging|deprecated|unsupported|end[- ]of[- ]life|migrat(?:e|ing)|rewrit(?:e|ing)|rebuild(?:ing)?|re-?platform\w*|jquery|php\s?5|angularjs|monolith|no\s+mobile\s+app)\b/i),
  // Recorded pain: delivery speed / quality / cost complaints about themselves.
  6: (s) => firstSelfLine(s, /\b(?:missed\s+(?:our\s+)?deadlines?|behind\s+schedule|backlog\s+(?:is\s+)?(?:growing|killing|piling|keeps)|keeps?\s+(?:growing|slipping)|slow\s+(?:releases?|delivery|shipping)|release\s+cycle\s+is\s+(?:killing|too\s+slow)|too\s+expensive|cost\s+overrun|frustrat\w+\s+with|struggl\w+\s+(?:to|with)\s+(?:ship|deliver|keep\s+up|scale|hire|find)|can'?t\s+ship)/i),
  // Asking for help: an explicit request for outside help (not a recruiter's job post).
  7: (s) => [
    detectCommercialRequest(s).externalServiceRequest?.line ?? null,
    ...lines(s).filter((l) => ASKING_FOR_HELP.test(l)),
  ].find((l): l is string => Boolean(l) && !NOT_NEEDED.test(l!)) ?? null,
}

export type SignalVerification = 'AI_EXTRACTED_VERIFIED' | 'USER_SELECTED_VERIFIED' | 'USER_SELECTED_UNVERIFIED' | 'UNVERIFIABLE'

export interface SignalClaim extends EvidenceClaim<SignalId> {
  kind: 'signal'
  signalVerification: SignalVerification
}

/** The supporting source line for a signal type, or null. */
export function findSignalSupport(signalId: SignalId, source: string | null | undefined): string | null {
  const detector = SIGNAL_DETECTORS[signalId]
  return detector ? detector(source ?? '') : null
}

/** Signal types the source supports, strongest weight first is the caller's choice. */
export function supportedSignals(source: string | null | undefined): SignalId[] {
  return (Object.keys(SIGNAL_DETECTORS).map(Number) as SignalId[]).filter((id) => findSignalSupport(id, source) !== null)
}

export function verifySignal(signalId: SignalId, source: string | null | undefined, origin: ClaimOrigin = 'USER_ENTERED'): SignalClaim {
  const base = { kind: 'signal' as const, value: signalId, origin }
  if (!(source ?? '').trim()) {
    return { ...base, status: 'UNVERIFIABLE', sourceQuote: null, signalVerification: 'UNVERIFIABLE' }
  }
  const line = findSignalSupport(signalId, source)
  if (line) {
    return {
      ...base,
      status: 'VERIFIED_NORMALIZED',
      sourceQuote: line,
      signalVerification: origin === 'AI_EXTRACTED' ? 'AI_EXTRACTED_VERIFIED' : 'USER_SELECTED_VERIFIED',
    }
  }
  return { ...base, status: 'NOT_FOUND', sourceQuote: null, signalVerification: 'USER_SELECTED_UNVERIFIED' }
}

// ── Company / location ──────────────────────────────────────────────────

/** Whether a field value (company, location) appears in the source. */
export function verifyFieldInSource(
  kind: 'company' | 'location',
  value: string | null | undefined,
  source: string | null | undefined,
  origin: ClaimOrigin,
): EvidenceClaim {
  const v = (value ?? '').trim()
  const base = { kind, value: v, origin }
  if (!v || /^unknown( company)?$/i.test(v)) return { ...base, status: 'NOT_FOUND', sourceQuote: null }
  if (!(source ?? '').trim()) return { ...base, status: 'UNVERIFIABLE', sourceQuote: null }
  const line = lines(source ?? '').find((l) => norm(l).includes(norm(v))) ?? null
  if (line) return { ...base, status: line.includes(v) ? 'VERIFIED_EXACT' : 'VERIFIED_NORMALIZED', sourceQuote: line }
  return { ...base, status: 'NOT_FOUND', sourceQuote: null }
}
