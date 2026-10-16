/**
 * Deterministic facts read directly from the pasted source.
 *
 * Every fact carries the verbatim source line it came from, so scoring rows
 * and decision guards can cite the text instead of asserting an inference.
 * Pure functions — no AI calls — shared by input classification, the V3
 * decision guard, the score engine and the evidence ledger.
 */

export interface SourceLine {
  /** Verbatim line from the source (trimmed). */
  line: string
}

export interface CommercialRequestFacts {
  /** Explicit request to buy from an external provider (agency, vendor, contractor, outsourced team). */
  externalServiceRequest: SourceLine | null
  /** Employee recruitment (we're hiring, full-time role, submit your CV). */
  employmentHiring: SourceLine | null
}

export interface StatedBudget extends SourceLine {
  amount: string
  approved: boolean
}

export interface StatedTimeline extends SourceLine {
  /** Days until the stated start/deadline. 0 = immediately. */
  days: number
  label: string
}

const NEGATION_BEFORE = /\b(?:no|not|without|never)\s+(?:an?\s+|any\s+)?$/i

const EXTERNAL_PROVIDER =
  /\b(?:agenc(?:y|ies)|vendors?|outsourc\w*|external\s+(?:software\s+|development\s+|engineering\s+|dev\s+)?(?:team|partner|agency|provider|company|firm)s?|(?:development|software|engineering|technology)\s+partners?|staff\s+augmentation|dev(?:elopment)?\s+shops?|software\s+(?:house|consultancy|firm)s?|consultanc(?:y|ies)|contractors?|freelancers?)\b/i

const REQUEST_CONTEXT =
  /\b(?:looking\s+for|seeking|searching\s+for|need(?:s|ed)?|hire|hiring|engage|want(?:s|ed)?\s+to\s+(?:hire|work\s+with|engage)|invit(?:e|ing)|request(?:ing)?\s+(?:proposals?|quotes?)|rfp|should\s+(?:contact|reach|submit|send|apply)|send\s+(?:us\s+)?(?:a\s+)?(?:proposal|quote)|submit\s+(?:a\s+)?(?:proposal|quote))\b/i

const EMPLOYMENT_HIRING: RegExp[] = [
  /\b(?:we(?:'|’)?re|we\s+are|now|currently|is)\s+hiring\b/i,
  /\bhiring\s+(?:a|an|for|our|multiple|several|\d+)\b/i,
  /\bjoin\s+our\s+(?:\w+\s+){0,3}team\b/i,
  /\bfull[- ]time\b/i,
  /\bpermanent\s+(?:role|position|hire|contract)\b/i,
  /\b(?:submit|send|share|attach)\s+(?:your|their|a|an)?\s*(?:cv|resume|résumé)\b/i,
  /\b(?:interested|qualified|suitable)\s+candidates\b/i,
  /\bopen\s+(?:role|position|vacanc(?:y|ies))\b/i,
  /\bjob\s+(?:opening|vacancy|description)\b/i,
  /\bapply\s+(?:now|here|via|through|on)\b/i,
]

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function isNegatedAt(line: string, index: number): boolean {
  return NEGATION_BEFORE.test(line.slice(Math.max(0, index - 14), index))
}

/** First match of `re` in `line` that is not preceded by a negation. */
function firstAffirmedMatch(line: string, re: RegExp): RegExpExecArray | null {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m: RegExpExecArray | null
  while ((m = global.exec(line)) !== null) {
    if (!isNegatedAt(line, m.index)) return m
  }
  return null
}

function isExternalServiceLine(line: string): boolean {
  const provider = firstAffirmedMatch(line, EXTERNAL_PROVIDER)
  if (!provider) return false
  // The request verb must sit in the same sentence as the provider noun.
  return REQUEST_CONTEXT.test(line)
}

export function detectCommercialRequest(rawText: string): CommercialRequestFacts {
  const all = lines(rawText)
  const external = all.find(isExternalServiceLine) ?? null
  const employment = all.find((line) => EMPLOYMENT_HIRING.some((re) => firstAffirmedMatch(line, re))) ?? null
  return {
    externalServiceRequest: external ? { line: external } : null,
    employmentHiring: employment ? { line: employment } : null,
  }
}

/** Employee recruitment with no request to buy from an external provider. */
export function isEmploymentHiringOnly(rawText: string): boolean {
  const facts = detectCommercialRequest(rawText)
  return facts.employmentHiring !== null && facts.externalServiceRequest === null
}

const MONEY = /(?:[$€£]\s?\d[\d,.]*\s*(?:k|m|million|thousand)?|\b\d[\d,.]*\s*(?:k|m)?\s*(?:usd|eur|gbp|dollars)\b)/i

export function extractStatedBudget(rawText: string): StatedBudget | null {
  for (const line of lines(rawText)) {
    if (!/\b(?:budget|budgeted|funded|allocated|fixed\s+price|project\s+value)\b/i.test(line)) continue
    const money = line.match(MONEY)
    if (!money) continue
    return {
      line,
      amount: money[0].replace(/\s+/g, ' ').trim(),
      approved: /\b(?:approved|allocated|confirmed|secured|signed[- ]off)\b/i.test(line),
    }
  }
  return null
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, few: 3, couple: 2 }

function unitDays(unit: string): number {
  const u = unit.toLowerCase()
  if (u.startsWith('day')) return 1
  if (u.startsWith('week')) return 7
  return 30
}

export function extractStatedTimeline(rawText: string): StatedTimeline | null {
  for (const line of lines(rawText)) {
    const within = line.match(/\b(?:within|in\s+the\s+next|over\s+the\s+next)\s+(\d+|a|an|one|two|three|four|five|six|few|couple(?:\s+of)?)\s*(days?|weeks?|months?)\b/i)
    if (within) {
      const n = /^\d+$/.test(within[1]) ? Number(within[1]) : WORD_NUMBERS[within[1].toLowerCase().replace(/\s+of$/, '')] ?? 1
      return { line, days: n * unitDays(within[2]), label: within[0].replace(/\s+/g, ' ') }
    }
    const startIn = line.match(/\b(?:start(?:ing)?|kick(?:ing)?[- ]?off|begin(?:ning)?|deliver(?:y)?|launch(?:ing)?|go[- ]live)\b[^.\n]{0,30}?\bin\s+(\d+|a|an|one|two|three|four|five|six|few)\s*(days?|weeks?|months?)\b/i)
    if (startIn) {
      const n = /^\d+$/.test(startIn[1]) ? Number(startIn[1]) : WORD_NUMBERS[startIn[1].toLowerCase()] ?? 1
      return { line, days: n * unitDays(startIn[2]), label: `start in ${startIn[1]} ${startIn[2]}` }
    }
    const immediate = line.match(/\b(?:asap|immediately|immediate\s+start|right\s+away|urgent(?:ly)?)\b/i)
    if (immediate && !isNegatedAt(line, immediate.index ?? 0)) {
      return { line, days: 0, label: immediate[0] }
    }
    const thisWeek = line.match(/\b(?:start(?:ing)?|begin(?:ning)?|kick(?:ing)?[- ]?off)\b[^.\n]{0,20}?\b(this|next)\s+(week|month)\b/i)
    if (thisWeek) {
      const days = thisWeek[2].toLowerCase() === 'week' ? (thisWeek[1].toLowerCase() === 'this' ? 3 : 10) : (thisWeek[1].toLowerCase() === 'this' ? 15 : 45)
      return { line, days, label: thisWeek[0] }
    }
  }
  return null
}

const CONTACT_INSTRUCTION =
  /\b(?:contact\s+us|reach\s+out|get\s+in\s+touch|dm\s+(?:me|us)|message\s+(?:me|us)|email\s+(?:me|us)|send\s+(?:us|me|your|their)|submit\s+(?:your|their|a)|apply\s+(?:now|here|via|through)|should\s+(?:contact|reach|send|submit|apply))\b/i

export function findContactInstruction(rawText: string): SourceLine | null {
  const line = lines(rawText).find((l) => CONTACT_INSTRUCTION.test(l))
  return line ? { line } : null
}

/** A source line containing any of the given terms (case-insensitive, whole word). */
export function findLineMentioning(rawText: string, terms: string[]): SourceLine | null {
  const usable = terms.map((t) => t.trim()).filter((t) => t.length >= 2)
  if (usable.length === 0) return null
  const escaped = usable.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(?<![a-z0-9])(?:${escaped.join('|')})(?![a-z0-9])`, 'i')
  const line = lines(rawText).find((l) => re.test(l))
  return line ? { line } : null
}

/**
 * Whether `quote` appears verbatim in the source (whitespace- and
 * quote-style-insensitive). Used to keep paraphrases out of "source quote" slots.
 */
export function isVerbatimInSource(quote: string | null | undefined, rawText: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
  const q = norm(quote ?? '')
  if (q.length < 12) return false
  return norm(rawText).includes(q)
}
