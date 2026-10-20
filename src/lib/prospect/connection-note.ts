import type { Profile, MatchedProof } from '@/lib/domain/types'

/**
 * Connection Note Quality
 *
 * Dedicated quality system for LinkedIn connection notes (not cold DMs).
 * Connection notes must be short, natural, low-pressure, and sender-aware.
 * Their purpose is to earn an acceptance — not to close a deal.
 */

/** LinkedIn connection notes stay in the 100–120 character range. 120 is the hard cap. */
export const CONNECTION_NOTE_MAX_CHARS = 120

export interface ConnectionNoteResult {
  text: string
  charCount: number
  maxChars: number
  withinLimit: boolean
  passed: boolean
  failures: string[]
  repaired: string | null
}

export const SURVEILLANCE_OPENERS = [
  /^(hey|hi|hello)\s+\w+,?\s*(i noticed|i saw|i came across|i was looking at|i found your)/i,
  /^(i came across your profile)/i,
  /^(i was impressed by)/i,
  /^(i noticed your impressive)/i,
  /^(your work at\s+\w+\s+caught my attention)/i,
  /^(congrats on (your|the|landing))/i,
]

export const BANNED_PHRASES_CONNECTION = [
  'i came across your profile',
  'i noticed your impressive',
  'i would love to connect',
  'explore synergies',
  'i would love to pick your brain',
  'hope you are doing well',
  'i would love to discuss how we can help',
  'we specialize in',
  'i help companies like yours',
  'let\'s connect',
  'would love to connect and',
  'your work at .+ caught my attention',
  'given your role',
  'as the (ceo|cto|founder|vp)',
  'i was impressed by',
  'i would love to connect and explore',
  "we're hiring",
  'we are hiring',
  'i am hiring',
  "i'm hiring",
  // Discovery / curiosity language — connection notes earn access, not start discovery
  'curious about',
  'how do you',
  'would love to learn',
  'would love to hear',
  'what your thoughts',
  'how your team',
  'what you think',
  'would be great to learn',
]

const GENERIC_CTAS_CONNECTION = [
  /let's connect!?$/i,
  /would love to connect!?$/i,
  /connect with me!?$/i,
  /looking forward to connecting/i,
  /happy to connect/i,
  /let me know if you're interested$/i,
  /would love to pick your brain/i,
]

const AI_CLICHES_CONNECTION = [
  'game[- ]chang',
  'revolutioniz',
  'cutting[- ]edge',
  'leverage (our|my) expertise',
  'synerg',
  'passionate about',
  'thrilled to',
  'honored to',
  'excited to reach out',
]

// General business-truism patterns ("growth causes strain", "scaling causes
// bottlenecks") stated as generalizations, not tied to any specific
// prospect fact — a fabricated diagnosis dressed as observed insight. The
// shape to catch: a generic subject (growth/scaling/teams "at this stage")
// paired with a generalizing verb ("tend to", "usually", "often", "can")
// and a negative-capacity outcome (strain/bottleneck/stretch resources).
const UNSUPPORTED_PROSPECT_PAIN = [
  /\bshipping\b.{0,40}\blagg/i,
  /\broadmap\b.{0,40}\b(?:strain|stretch)/i,
  /\b(?:strain|stretch)\w*.{0,40}\broadmap\b/i,
  /\bengineering bottleneck/i,
  /\bresource shortage/i,
  /\bdevelopment capacity/i,
  /\bscaling pain/i,
  /\bgrowth strains? engineering/i,
  /\bneed more capacity/i,
  /\bdelivery gets? difficult/i,
]

const GENERALIZED_PAIN_CLAIMS = [
  /\b(?:growth|scaling|scale[- ]?up)\s+(?:phases?\s+)?(?:tends?\s+to|usually|often|can|typically)\s+(?:strain|stretch|overwhelm|break|outpace)\b/i,
  /\bscaling\s+(?:usually\s+)?creates?\s+(?:engineering\s+)?bottlenecks?\b/i,
  /\bteams?\s+at\s+this\s+stage\s+(?:often|usually|typically)\s+need\b/i,
  /\brapid\s+growth\s+can\s+stretch\b/i,
  /\b(?:companies|founders|teams)\s+(?:at\s+your\s+stage\s+)?(?:often|usually|typically)\s+(?:struggle|need|lack|run\s+into)\b/i,
]

export interface ConnectionNoteInput {
  text: string
  profile: Profile | null
  prospectName: string | null
  prospectCompany: string | null
  matchedProof: MatchedProof[]
  /** Canonical evidence. A pain phrase is allowed only when this text already contains it. */
  evidenceText?: string | null
}

/**
 * Evaluate a connection note against all quality gates.
 */
export function evaluateConnectionNote(input: ConnectionNoteInput): ConnectionNoteResult {
  const { text } = input
  const failures: string[] = []
  const lower = text.toLowerCase().trim()

  // 1. Empty or too short
  if (text.trim().length < 10) {
    failures.push('Too short to be meaningful')
  }

  // 2. Over character limit
  const charCount = text.length
  const withinLimit = charCount <= CONNECTION_NOTE_MAX_CHARS
  if (!withinLimit) {
    failures.push(`Over character limit (${charCount}/${CONNECTION_NOTE_MAX_CHARS})`)
  }

  // 3. Semantic truth — flag invented pain claims NOT in evidence
  const evidence = (input.evidenceText ?? '').toLowerCase()
  for (const pattern of UNSUPPORTED_PROSPECT_PAIN) {
    if (pattern.test(lower) && !pattern.test(evidence)) {
      failures.push('Unsupported prospect pain claim')
      break
    }
  }

  // 4. Hard spam gates — always wrong in connection notes
  const spamPatterns = [
    /\b(i can help you|we can help you|let me help you|happy to help you (ship|build|grow|scale))\b/i,
    /\b(game[-]?chang|revolutioniz|cutting[-]?edge|leverage (our|my) expertise|synerg|passionate about|thrilled to|excited to|delighted to)\b/i,
    /\b(i have been following|i have been watching|big fan of your)\b/i,
    /\b(we can help|our team|we have|we are a|our expertise)\b/i,
  ]
  for (const pattern of spamPatterns) {
    if (pattern.test(lower)) {
      failures.push('Contains spam-like language')
      break
    }
  }

  // 5. Sender mismatch — claims experience without proof
  if (input.profile && input.matchedProof.length === 0) {
    if (/\b(i built|i helped|i worked on|my experience with)\b/i.test(lower)) {
      failures.push('Claims experience without verified proof match')
    }
  }

  return {
    text,
    charCount,
    maxChars: CONNECTION_NOTE_MAX_CHARS,
    withinLimit,
    passed: failures.length === 0,
    failures,
    repaired: null,
  }
}

/**
 * Repair a failed connection note. One-pass deterministic fix.
 */
export function repairConnectionNote(text: string, failures: string[]): string {
  let repaired = text

  if (failures.some((f) => f.includes('surveillance'))) {
    repaired = stripSurveillanceAnywhere(repaired)
  }

  // The AI model may place "let's connect", "we specialize in", etc.
  // mid-sentence, so we must remove them globally, not just at ^.
  if (failures.some((f) => f.includes('Banned phrase'))) {
    repaired = stripPhrasesAnywhere(repaired, BANNED_PHRASES_CONNECTION)
  }

  if (failures.some((f) => f.includes('praise'))) {
    repaired = repaired.replace(/\bamazing|incredible|impressive|fantastic|brilliant\b/gi, '')
    repaired = repaired.replace(/\blove what you\b/gi, 'interested in what you')
  }

  if (failures.some((f) => f.includes('Sales pitch'))) {
    repaired = repaired.replace(/\b(?:i can help|we can help|let me help)\b/gi, '')
    repaired = repaired.replace(/\bhappy to help you (?:ship|build|grow|scale)\b/gi, '')
  }

  if (failures.some((f) => f.includes('AI cliché'))) {
    repaired = repaired.replace(/\bgame[- ]?chang\w*\b/gi, '')
    repaired = repaired.replace(/\brevolutioni[sz]\w*\b/gi, '')
    repaired = repaired.replace(/\bcutting[- ]?edge\b/gi, '')
    repaired = repaired.replace(/\bleverage (?:our|my) expertise\b/gi, '')
    repaired = repaired.replace(/\bsynerg\w*\b/gi, '')
    repaired = repaired.replace(/\bpassionate about\b/gi, '')
    repaired = repaired.replace(/\bthrilled to\b/gi, '')
    repaired = repaired.replace(/\bhonored to\b/gi, '')
    repaired = repaired.replace(/\bexcited to reach out\b/gi, '')
  }

  if (failures.some((f) => f.includes('fake familiarity'))) {
    repaired = repaired.replace(/\bi have been following\b/gi, '')
    repaired = repaired.replace(/\bi have been watching\b/gi, '')
    repaired = repaired.replace(/\bbig fan of your\b/gi, '')
  }

  if (failures.some((f) => f.includes('Service description'))) {
    repaired = repaired.replace(/\bwe (?:build|ship|deliver|help)\b/gi, '')
    repaired = repaired.replace(/\bi (?:build|ship|deliver|help)\b/gi, '')
    repaired = repaired.replace(/\bour (?:work|focus|practice)\b/gi, '')
  }

  if (failures.some((f) => f.includes('Manufactured personalization'))) {
    repaired = repaired.replace(/\bcurious about\b/gi, '')
    repaired = repaired.replace(/\bhow do you\b/gi, '')
    repaired = repaired.replace(/\bwould love to learn\b/gi, '')
    repaired = repaired.replace(/\bwould love to hear\b/gi, '')
    repaired = repaired.replace(/\bwhat your thoughts\b/gi, '')
    repaired = repaired.replace(/\bwould be great to learn\b/gi, '')
  }

  if (failures.some((f) => f.includes('Generic or forced CTA'))) {
    repaired = stripPhrasesAnywhere(repaired, [
      "let's connect",
      'would love to connect',
      'connect with me',
      'looking forward to connecting',
      'happy to connect',
      "let me know if you're interested",
      'would love to pick your brain',
    ])
  }

  if (failures.some((f) => f.includes('funding = budget'))) {
    repaired = repaired.replace(/\bwhich likely gives you some budget to spend\b/gi, '')
    repaired = repaired.replace(/\bgives you some budget\b/gi, '')
    repaired = repaired.replace(/\bbudget to spend\b/gi, '')
    repaired = repaired.replace(/\bwith that (budget|funding|raise)\b/gi, '')
    repaired = repaired.replace(/\bnow that you (have )?(raised|closed|funded)\b/gi, 'you')
    repaired = repaired.replace(/\byour (series [abc]|funding|raise) (gives|means|allows)\b/gi, '')
    repaired = repaired.replace(/\b(just )?closed (a )?(round|series|funding)\b.{0,40}\b(budget|spend|afford)\b/gi, '')
    repaired = repaired.replace(/\braised (a )?(round|series|funding)\b.{0,40}\b(budget|spend|afford)\b/gi, '')
    repaired = repaired.replace(/\bafford to (hire|build|ship|spend)\b/gi, 'can $1')
  }

  // Fix "we" → "I"
  if (failures.some((f) => f.includes('"we"'))) {
    repaired = repaired.replace(/\bwe can help\b/gi, 'I can share')
    repaired = repaired.replace(/\bour team\b/gi, 'I')
    repaired = repaired.replace(/\bwe have\b/gi, 'I have')
  }

  if (failures.some((f) => f.includes('question'))) {
    repaired = repaired.replace(/\?/g, '.')
    repaired = repaired.replace(/\bhave you considered\b/gi, 'consider')
    repaired = repaired.replace(/\bhave you thought about\b/gi, 'think about')
    repaired = repaired.replace(/\bdo you need\b/gi, 'you may need')
    repaired = repaired.replace(/\bwould you be open to\b/gi, 'open to')
    repaired = repaired.replace(/\bcan we\b/gi, 'we can')
    repaired = repaired.replace(/\bcould you\b/gi, 'you could')
    repaired = repaired.replace(/\bwould you\b/gi, 'you would')
    repaired = repaired.replace(/\bare you looking\b/gi, 'looking')
  }

  repaired = repaired.replace(/[\u2014\u2013]/g, '-')

  repaired = repaired.replace(/!/g, '.')

  repaired = repaired.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')

  // double spaces, double periods, dangling commas before periods,
  // orphaned sentence fragments ("word. ."), leading punctuation.
  repaired = repaired.replace(/  +/g, ' ').trim()
  repaired = repaired.replace(/\.\s*\./g, '.')
  repaired = repaired.replace(/,\s*\./g, '.')
  repaired = repaired.replace(/^\.\s*/, '')
  repaired = repaired.replace(/^\,\s*/, '')
  repaired = repaired.replace(/\s+\.$/g, '.')

  // Shorten if over limit
  if (repaired.length > CONNECTION_NOTE_MAX_CHARS) {
    repaired = shortenConnectionNote(repaired)
  }

  return repaired.trim()
}

/**
 * Strip any banned phrase from anywhere in the text. The banned phrases list
 * contains regex patterns (not plain strings), so each entry is compiled as
 * a regex. Also removes dangling connector words (and, to, commas) left
 * behind after the phrase is removed.
 */
export function stripPhrasesAnywhere(
  text: string,
  phrases: string[],
): string {
  let result = text
  for (const phrase of phrases) {
    // Each phrase is a regex pattern. Compile it with global + case-insensitive
    // flags so it matches anywhere in the text, not just at boundaries.
    const re = new RegExp(
      `[,.\\s]*${phrase}\\s*(?:and\\s+|to\\s+)?`,
      'gi',
    )
    result = result.replace(re, '. ')
  }
  result = result.replace(/  +/g, ' ')
  result = result.replace(/\.\s*\./g, '.')
  result = result.replace(/^\.\s*/, '')
  return result.trim()
}

/**
 * Strip any surveillance opener from anywhere in the text, not just the start.
 */
function stripSurveillanceAnywhere(text: string): string {
  let result = text
  // Match surveillance patterns with optional leading text/greeting
  const surveillancePatterns = [
    /(?:hey|hi|hello)\s+\w+,?\s*(?:i noticed|i saw|i came across|i was looking at|i found your)\s*/gi,
    /i came across your profile/gi,
    /i was impressed by/gi,
    /i noticed your impressive/gi,
    /your work at\s+\w+\s+caught my attention/gi,
    /congrats on (?:(?:your|the|landing)\s+)?/gi,
  ]
  for (const re of surveillancePatterns) {
    result = result.replace(re, '')
  }
  result = result.replace(/^(?:hi|hey|hello)\s*,?\s*$/i, '')
  return result.trim()
}

/**
 * Shorten a connection note without truncating mid-sentence.
 */
function shortenConnectionNote(text: string): string {
  if (text.length <= CONNECTION_NOTE_MAX_CHARS) return text

  const withinLimit = text.slice(0, CONNECTION_NOTE_MAX_CHARS - 3)
  const lastPeriod = withinLimit.lastIndexOf('.')
  const lastSpace = withinLimit.lastIndexOf(' ')

  if (lastPeriod > CONNECTION_NOTE_MAX_CHARS * 0.6) {
    return withinLimit.slice(0, lastPeriod + 1)
  }
  if (lastSpace > CONNECTION_NOTE_MAX_CHARS * 0.5) {
    return withinLimit.slice(0, lastSpace) + '.'
  }
  return withinLimit + '.'
}

/**
 * "Could this be sent to 100 other prospects?" check.
 */
function couldSendTo100Prospects(text: string, company: string | null): boolean {
  let check = text
  if (company) {
    check = check.replace(new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'COMPANY')
  }

  const genericPatterns = [
    /\b(i came across your profile)\b/i,
    /\b(i would love to connect)\b/i,
    /\b(would love to connect)\b/i,
    /\b(let's connect)\b/i,
    /\b(i help (teams|companies|businesses))\b/i,
    /\b(i noticed (your|the))\b/i,
    /\b(would love to pick your brain)\b/i,
    /\b(hope you are doing well)\b/i,
    /\b(looking forward to connecting)\b/i,
  ]

  let hits = 0
  for (const pattern of genericPatterns) {
    if (pattern.test(check)) hits++
  }

  return hits >= 2
}

/**
 * Normalize greeting to use first name consistently.
 * - "Hi Sarah Chen," → "Hi Sarah,"
 * - "Hey Sarah," → "Hey Sarah," (unchanged)
 * - No greeting + name available → "Hi {firstName},"
 * - No name available → leave as-is (don't fabricate)
 */
export function normalizeGreeting(text: string, prospectName: string | null): string {
  if (!text) return text

  const firstName = extractFirstName(prospectName)
  const trimmed = text.trim()

  // Already has a natural first-name greeting
  if (firstName) {
    const greetingPatterns = [
      /^(hi|hey|hello)\s+,/i,
      /^(hi|hey|hello)\s+there,?\s*/i,
    ]
    for (const pattern of greetingPatterns) {
      if (pattern.test(trimmed)) {
        return trimmed.replace(pattern, `${RegExp.$1} ${firstName}, `)
      }
    }

    // Greeting with full name → replace with first name. Consume ALL
    // remaining name-like tokens after the first name (not just one) up to
    // the comma — a multi-token or honorific-like display name (e.g. "MD
    // ABUL MANSUR") otherwise leaves trailing tokens dangling: matching only
    // "MD Abul" out of "Hi MD Abul Mansur," produces the malformed "Hi MD,
    // Mansur," instead of the intended "Hi MD,".
    const fullNameGreeting = new RegExp(`^(hi|hey|hello)\\s+${firstName}(?:\\s+\\w+){1,4}?,\\s*`, 'i')
    if (fullNameGreeting.test(trimmed)) {
      return trimmed.replace(fullNameGreeting, `${RegExp.$1} ${firstName}, `)
    }

    // No greeting at all but name available → prepend
    if (!/^(hi|hey|hello)\s/i.test(trimmed) && firstName) {
      return `Hi ${firstName}, ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`
    }
  }

  return text
}

/**
 * Extract first name from a full name string.
 * Returns null if name is unreliable (too short, too long, no spaces).
 */
export function extractFirstName(name: string | null): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 40) return null
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  const first = parts[0]
  // Basic filter: must be alphabetic, 2-20 chars
  if (!/^[A-Za-z][A-Za-z'-]{1,19}$/.test(first)) return null
  return first
}

/**
 * Validate character count and auto-repair if needed.
 */
export function validateAndRepair(input: ConnectionNoteInput): ConnectionNoteResult {
  let result = evaluateConnectionNote(input)

  if (!result.passed) {
    const repaired = repairConnectionNote(input.text, result.failures)
    const reEval = evaluateConnectionNote({ ...input, text: repaired })

    let finalText = repaired
    if (!reEval.withinLimit) {
      finalText = shortenConnectionNote(repaired)
    }

    result = {
      ...reEval,
      text: finalText,
      charCount: finalText.length,
      withinLimit: finalText.length <= CONNECTION_NOTE_MAX_CHARS,
      repaired: finalText !== input.text ? finalText : null,
    }
  }

  return result
}
