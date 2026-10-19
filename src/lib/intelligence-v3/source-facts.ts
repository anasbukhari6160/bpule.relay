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
  /\b(?:agenc(?:y|ies)|vendors?|outsourc\w*|external\s+(?:software\s+|development\s+|engineering\s+|dev\s+)?(?:team|partner|agency|provider|company|firm)s?|(?:development|software|engineering|technology)\s+partners?|staff\s+augmentation|dev(?:elopment)?\s+shops?|software\s+(?:house|consultancy|firm)s?|consultanc(?:y|ies)|contractors?|freelancers?|developers?)\b/i

const REQUEST_CONTEXT =
  /\b(?:looking\s+for|seeking|searching\s+for|need(?:s|ed)?(?:\s+a\s+(?:developer|agency|contractor|vendor|freelancer))?|hire|hiring|engage|want(?:s|ed)?\s+to\s+(?:hire|work\s+with|engage)|invit(?:e|ing)|request(?:ing)?\s+(?:proposals?|quotes?)|rfp|should\s+(?:contact|reach|submit|send|apply)|send\s+(?:us\s+)?(?:a\s+)?(?:proposal|quote)|submit\s+(?:a\s+)?(?:proposal|quote))\b/i

/**
 * Explicit request for a developer/provider to help with a product/project.
 * "Looking for a developer to help scale our product" is a buyer request.
 * Excludes internal hiring: "hiring a developer to join our internal team".
 */
const DEVELOPER_REQUEST =
  /\b(?:looking\s+for|seeking|need(?:s|ed)?|want(?:s|ed)?\s+(?:to\s+)?(?:hire|work\s+with|engage))\s+(?:a\s+)?(?:developer|dev|engineer|programmer)\b/i

/** Internal hiring context that overrides developer request classification. */
const INTERNAL_HIRING_CONTEXT =
  /\b(?:join\s+(?:our|the|my)\s+(?:internal\s+)?(?:team|company|startup|firm|crew)|as\s+(?:a\s+)?(?:full[- ]time|permanent|in[- ]?house))\b/i

const EMPLOYMENT_HIRING: RegExp[] = [
  /\b(?:we(?:'|')?re|we\s+are|now|currently|is)\s+hiring\b/i,
  /\bhiring\s+(?:a|an|for|our|multiple|several|\d+)\b/i,
  /\bjoin\s+our\s+(?:\w+\s+){0,3}team\b/i,
  /\b(?:submit|send|share|attach)\s+(?:your|their|a|an)?\s*(?:cv|resume|résumé)\b/i,
  /\b(?:interested|qualified|suitable)\s+candidates\b/i,
  /\bopen\s+(?:role|position|vacanc(?:y|ies))\b/i,
  /\bjob\s+(?:opening|vacancy|description)\b/i,
  /\bapply\s+(?:now|here|via|through|on)\b/i,
  /\bcontractors?\s+needed\b/i,
]

// Historical hiring patterns — reject these as current hiring signals
const HISTORICAL_HIRING_CTX = [
  /\b(?:people\s+hired\s+(?:to|for|by)|hired\s+(?:people|folks|team|developers?)\s+(?:to|for))\b/i,
  /\b(?:my\s+(?:team|crew|staff)\s+(?:has|includes|grew\s+to))\b/i,
  /\b(?:previously\s+(?:hired|employed)|former\s+(?:team|employee|hire))\b/i,
  /\b(?:experience\s+(?:of\s+|in\s+)?hiring|years?\s+(?:of\s+)?(?:hiring|recruiting))\b/i,
  /\b(?:at\s+my\s+(?:previous|former)\s+(?:company|role|firm))\b/i,
  /\b(?:headcount|team\s+size|grew\s+from|scaled\s+(?:the\s+)?team)\b/i,
  /\b(?:people\s+hired\s+to\s+(?:protect|defend|maintain|support))\b/i,
]

function isHistoricalHiring(line: string): boolean {
  return HISTORICAL_HIRING_CTX.some(re => {
    re.lastIndex = 0
    return re.test(line)
  })
}

/**
 * Service offering patterns: a person/company offering their services to
 * others who might be hiring. "If you're hiring for X, let's connect" is a
 * service offering — NOT a buyer request, NOT a hiring event.
 */
const SERVICE_OFFERING =
  /\b(?:if\s+you(?:'|’)?re\s+(?:hiring|looking|seeking|need)|if\s+you\s+(?:hiring|looking|seeking|need)|hiring\?|looking\?|need\?)\b.*\b(?:let(?:|')s\s+(?:connect|talk|chat)|dm\s+(?:me|us)|reach\s+(?:out|me)|contact\s+(?:me|us)|know\s+(?:great|good|awesome)|i\s+(?:can|may)|message\s+(?:me|us))\b/i

/**
 * Customer discovery patterns: asking for feedback on a product, talking to
 * users/founders. NOT an external help request.
 */
const CUSTOMER_DISCOVERY =
  /\b(?:feedback\s+(?:on\s+)?(?:my|our|this|the)\s+(?:product|app|platform|feature|idea|mvp|prototype|saas)|talking\s+(?:to|with)\s+(?:founders|users|customers|people)|customer\s+discovery|interviewing\s+(?:founders|users|customers)|research\s+(?:with|on)\s+(?:founders|users|customers)|would\s+love\s+(?:your\s+)?feedback|i(?:|')d\s+love\s+(?:your\s+)?feedback)\b/i

/**
 * Job-seeking patterns: the person themselves is looking for opportunities.
 * "I'm open to contract/full-time opportunities" is CANDIDATE, not HIRING.
 */
const JOB_SEEKING =
  /\b(?:(?:i(?:|')m|i\s+am)\s+(?:open\s+to|looking\s+for|seeking|available\s+for)\s+(?:new\s+)?(?:contract|full[- ]time|part[- ]time|permanent|freelance|work|employment|opportunities|roles|positions|challenges|gigs|projects)|open\s+to\s+(?:new\s+)?(?:work|opportunities|roles|positions|contract|freelance)|available\s+for\s+(?:hire|work|contract|freelance|projects)|looking\s+for\s+(?:my\s+)?(?:next\s+(?:role|position|opportunity|challenge|gig)))\b/i

/**
 * Employment metadata rows like "Tencyle · Full-time", "CEO · Full-time",
 * "VP Engineering · Full-time" describe a person's employment status — they
 * are NOT hiring events. Guard: a line matching hiring patterns must also
 * contain a hiring verb, not just a position/employment-type word.
 */
const HIRING_VERB = /\b(?:hiring|recruiting|join|submit|apply|looking\s+for|seeking|need\s+(?:a|an|our)|open\s+(?:role|position)|job\s+(?:opening|vacancy))\b/i
const EMPLOYMENT_METADATA = /·.*\b(?:full[- ]time|part[- ]time|permanent|contract)\b|·\s*\b(?:ceo|cto|cfo|vp|director|manager|engineer|developer|founder|lead|head)\b.*\b(?:full[- ]time|part[- ]time|permanent|contract)\b/i

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
  if (DEVELOPER_REQUEST.test(line) && !INTERNAL_HIRING_CONTEXT.test(line)) return true
  const provider = firstAffirmedMatch(line, EXTERNAL_PROVIDER)
  if (!provider) return false
  return REQUEST_CONTEXT.test(line)
}

/**
 * Recruiter header patterns: the person is recruiting for clients, not buying.
 * "Looking for developers for multiple clients" from a recruiter is not a
 * buyer request — the recruiter is the intermediary.
 */
const RECRUITER_HEADER =
  /\b(?:technical\s+recruiter|tech\s+recruiter|it\s+recruiter|recruiter|rekruter(?:ka)?|talent\s+(?:acquisition|partner|specialist)|sourcer|headhunter|hiring\s+manager)\b/i
const RECRUITER_CTX = /\b(?:for\s+(?:my|our|multiple)\s+clients?|at\s+(?:my|our|multiple)\s+clients?|(?:my|our)\s+clients?\s+(?:is|are|needs?|wants?))\b/i

/**
 * Classify a single line of source text.
 * Priority: service_offering > customer_discovery > job_seeking > recruiter > external_request > employment_hiring
 */
export type LineClassification = 'service_offering' | 'customer_discovery' | 'job_seeking' | 'recruiter' | 'external_request' | 'employment_hiring' | 'neutral'

export function classifyLine(line: string): LineClassification {
  if (SERVICE_OFFERING.test(line)) return 'service_offering'
  if (CUSTOMER_DISCOVERY.test(line)) return 'customer_discovery'
  if (JOB_SEEKING.test(line)) return 'job_seeking'
  if (RECRUITER_CTX.test(line)) return 'recruiter'
  if (DEVELOPER_REQUEST.test(line) && !INTERNAL_HIRING_CONTEXT.test(line)) return 'external_request'
    if (!isHistoricalHiring(line) && EMPLOYMENT_HIRING.some((re) => firstAffirmedMatch(line, re))) return 'employment_hiring'
  if (EMPLOYMENT_METADATA.test(line) && !HIRING_VERB.test(line)) return 'neutral'
  if (isExternalServiceLine(line)) return 'external_request'
  return 'neutral'
}

export function isRecruiterProfile(rawText: string): boolean {
  const header = lines(rawText).slice(0, 8).join('\n')
  return RECRUITER_HEADER.test(header)
}

export function detectCommercialRequest(rawText: string): CommercialRequestFacts {
  const all = lines(rawText)
  let external: string | null = null
  let employment: string | null = null

  for (const line of all) {
    const classification = classifyLine(line)
    if (classification === 'recruiter') continue
    if (classification === 'service_offering') continue
    if (classification === 'customer_discovery') continue
    if (classification === 'job_seeking') continue
    if (classification === 'external_request' && !external) external = line
    if (classification === 'employment_hiring' && !employment) employment = line
    if (external && employment) break
  }

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

// Historical budget markers — reject these as current buyer budget
const HISTORICAL_BUDGET_CTX = [
  /\b(?:back\s+in|when\s+I|years?\s+ago|previously|at\s+my\s+(?:previous|former)|in\s+\d{4}|from\s+\d{4})\b/i,
  /\b(?:a\s+reasonable\s+budget|typically\s+budget|for\s+example\s+a\s+budget|as\s+an?\s+example)\b/i,
  /\b(?:needed\s+to\s+build|budget\s+(?:was|had|required\s+for))\b/i,
  /\b(?:if\s+you(?:|'ve)\s+gotten\s+a\s+budget|investing\s+in|spent\s+on)\b/i,
]

export function extractStatedBudget(rawText: string): StatedBudget | null {
  for (const line of lines(rawText)) {
    if (!/\b(?:budget|budgeted|funded|allocated|fixed\s+price|project\s+value)\b/i.test(line)) continue

    // Reject historical/example budgets
    if (HISTORICAL_BUDGET_CTX.some(re => {
      re.lastIndex = 0
      return re.test(line)
    })) continue

    // Reject product metrics (CPI, LTV, etc.)
    if (/\b(?:cpi|ltv|roi|roas|arpu|cac|mrr|arr|revenue|profit|burn\s+rate|runway|churn)\b/i.test(line)) continue

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
