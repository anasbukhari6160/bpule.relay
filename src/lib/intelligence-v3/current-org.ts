/**
 * Current-organization context, read from the source without AI calls.
 *
 * A profile mixes the prospect's CURRENT company with their career history.
 * Past roles are background experience: they can explain expertise but must
 * never set the current company's industry or create current signals.
 * This module is the single place that decides which lines describe the
 * current organization; industry resolution reads only those lines.
 */

import { classifyTemporalProvenance, isHistoricalYear, analyzeProductActivity } from '@/lib/scoring/signal-attribution'
import { detectSellerOwnership } from './source-facts'
import { ML_PAST_PHRASE, ML_PRODUCT_ACTIVITY } from './multilingual'

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE_RANGE = new RegExp(
  `(?:\\b${MONTH}\\s+)?\\b(?:19|20)\\d{2}\\s*(?:-|–|—|to)\\s*(?:present|now|current|(?:${MONTH}\\s+)?(?:19|20)\\d{2})\\b`,
  'i',
)
const ONGOING = /\b(?:present|now|current)\b/i
const EXPERIENCE_HEADER = /^(?:experience|work\s+experience|employment(?:\s+history)?)$/i
const NEXT_SECTION = /^(?:education|skills|licenses?(?:\s+&\s+certifications)?|certifications|volunteering|volunteer\s+experience|projects|recommendations|courses|honors(?:\s+&\s+awards)?|languages|interests|publications|activity|posts|about|featured|organizations|causes)$/i

/** Use-case / example lines describe customers' domains, not the prospect's. */
const EXAMPLE_LINE = /\b(?:for\s+example|e\.g\.|such\s+as|like\s+how|use\s+cases?|imagine|consider|for\s+instance)\b/i
/** Career-history phrasing outside the Experience section. */
const PAST_ROLE_PHRASE = /\b(?:previously|formerly|before\s+(?:moving|joining|founding|starting)|spent\s+\d+\s+years|career\s+in|background\s+in|years\s+(?:of\s+experience\s+)?in|ex-|former)\b/i

function sourceLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

export interface CurrentAndPastLines {
  /** Current-organization text: whole lines from current roles, and current sentences of prose lines. */
  current: string[]
  /** Career-history text: past Experience entries and past sentences of prose lines. */
  past: string[]
  /** Lines that are entirely history (every sentence past, or inside a past Experience entry). */
  pastLines: string[]
}

function sentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((x) => x.trim()).filter(Boolean)
}

function isPastSentence(sentence: string): boolean {
  return PAST_ROLE_PHRASE.test(sentence) || ML_PAST_PHRASE.test(sentence) || classifyTemporalProvenance(sentence) === 'HISTORICAL' || isHistoricalYear(sentence)
}

/**
 * Split source text into current-organization text and past-role text.
 * Experience entries are grouped around their date line (title and company
 * sit just above it); an entry whose range does not run to "Present" is past.
 * Outside Experience, history is marked in the prose, sentence by sentence.
 */
export function splitCurrentAndPastLines(rawText: string): CurrentAndPastLines {
  const all = sourceLines(rawText)
  const pastEntry = new Set<number>()

  let i = 0
  while (i < all.length) {
    if (!EXPERIENCE_HEADER.test(all[i])) { i++; continue }
    const start = i + 1
    let end = start
    while (end < all.length && !NEXT_SECTION.test(all[end]) && !EXPERIENCE_HEADER.test(all[end])) end++

    const dateIdx: number[] = []
    for (let j = start; j < end; j++) if (DATE_RANGE.test(all[j])) dateIdx.push(j)
    dateIdx.forEach((d, k) => {
      const entryStart = Math.max(start, d - 2)
      const entryEnd = k + 1 < dateIdx.length ? Math.max(entryStart, dateIdx[k + 1] - 2) : end
      if (ONGOING.test(all[d])) return
      for (let j = entryStart; j < entryEnd; j++) pastEntry.add(j)
    })
    i = end
  }

  const current: string[] = []
  const past: string[] = []
  const pastLines: string[] = []
  all.forEach((line, idx) => {
    if (pastEntry.has(idx)) { past.push(line); pastLines.push(line); return }
    const parts = sentences(line)
    const pastParts = parts.filter(isPastSentence)
    const currentParts = parts.filter((p) => !isPastSentence(p))
    past.push(...pastParts)
    current.push(...currentParts)
    if (currentParts.length === 0) pastLines.push(line)
  })

  return { current, past, pastLines }
}

export const INDUSTRY_TAXONOMY: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'AI Governance / RegTech', pattern: /\b(?:ai\s+governance|model\s+governance|ai\s+(?:risk|compliance|assurance|audits?)|regtech|regulatory\s+(?:technology|compliance|reporting|frameworks?)|compliance\s+(?:automation|platform|workflows?)|responsible\s+ai|governance,?\s+risk)\b/i },
  { name: 'healthcare', pattern: /\b(?:healthcare|health(?:tech|care)?|tele-?health|medical|medizin\w*|pharma|biotech|clinical|clinics?|cliniques?|clínicas?|klinik\w*|hospitals?|hôpita\w+|hospitales|krankenh\w+|patients?|therapists?|santé|gesundheit\w*|salud|sağlık)\b/i },
  { name: 'fintech', pattern: /\b(?:fintech|finance|financial|banking|banks?|banken|banque|bancos?|insurance|insurtech|versicherung\w*|assurance|seguros|payments?|zahlung\w*|paiements?|pagos|trading|lending|ödeme)\b/i },
  { name: 'cybersecurity', pattern: /\b(?:cybersecurity|cyber\s*security|infosec|security\s+(?:platform|software|tooling|audits?))\b/i },
  { name: 'edtech', pattern: /\b(?:edtech|education|educational|e-learning|online\s+learning|vocational|schools?|universit\w+|bildung\w*|éducation|educación|eğitim)\b/i },
  { name: 'logistics', pattern: /\b(?:logistics|logistik|logistique|logística|lojistik|supply\s+chain|shipping|freight|transportation|transport\w*|delivery\s+(?:fleets?|companies|operators?)|last[- ]mile|fleets?|dispatch|kargo|spediteur|spedition|container\w*|bus\s+operators?)\b/i },
  { name: 'ecommerce', pattern: /\b(?:ecommerce|e-commerce|e-ticaret|retail(?!\s+banks?)|retailers?|dtc|shopify|merchants?|skincare|marketplace)\b/i },
  { name: 'proptech', pattern: /\b(?:real\s+estate|proptech|construction|immobilien)\b/i },
  { name: 'media', pattern: /\b(?:media|entertainment|gaming|streaming|podcast\w*)\b/i },
  { name: 'agtech', pattern: /\b(?:agtech|agriculture|farmers?|çiftçi\w*|tarım|agricult\w+|producteurs\s+locaux)\b/i },
  { name: 'energy', pattern: /\b(?:energy|grid\s+operators?|smart\s+grid|utilities|solar|renewables?)\b/i },
  { name: 'legaltech', pattern: /\b(?:legal\s*tech|legal\s+teams?|law\s+firms?|contract\s+review)\b/i },
  { name: 'robotics', pattern: /\b(?:robotics|robots?|warehouse\s+automation|automation\s+software\s+for\s+warehouses)\b/i },
  { name: 'developer tools', pattern: /\b(?:developer\s+tools?|devtools?|pair-programming|ci\/cd\s+platform|code\s+review\s+tool)\b/i },
]

const OWNERSHIP = /\b(?:we\s+(?:are|build|built|offer|provide|evaluate|help|work\s+with)|our\s+(?:company|startup|platform|product|agency|firm)|(?:co[- ]?founder|founder|ceo|cto|cfo|vp|director|head)\s+(?:of|at|@)|is\s+an?\s+)/i

export interface CurrentIndustry {
  industry: string
  line: string
}

/**
 * Industry of the prospect's CURRENT organization. Reads only current lines,
 * prefers lines that state ownership ("Founder at…", "We build…"), and
 * returns null rather than falling back to a past role's industry.
 */
/** Reposts and lines about customers/clients describe someone else's business. */
const SOMEONE_ELSE = /\b(?:via\s+@\w+|repost(?:ed|ing)?|shared\s+from|originally\s+posted\s+by|our\s+(?:customers|clients)\s+(?:are|include)|one\s+of\s+(?:our|my)\s+(?:customers|clients)|portfolio\s+compan(?:y|ies))\b/i

export function resolveCurrentIndustry(rawText: string): CurrentIndustry | null {
  const { current } = splitCurrentAndPastLines(rawText)
  const candidates = current.filter((l) => !EXAMPLE_LINE.test(l) && !SOMEONE_ELSE.test(l))
  const owned = candidates.filter((l) => OWNERSHIP.test(l))
  for (const pool of [owned, candidates]) {
    for (const ind of INDUSTRY_TAXONOMY) {
      const line = pool.find((l) => ind.pattern.test(l))
      if (line) return { industry: ind.name, line }
    }
  }
  return null
}

export interface CurrentOrgContext {
  currentIndustry: string | null
  currentIndustryLine: string | null
  /** The current organization is building or selling its own product. */
  currentProductActivity: boolean
  /** Lines describing past roles — background, never current signals. */
  pastRoleLines: string[]
}

const PRODUCT_WORD = /\b(?:product|platform|tool|software|app|saas|engine)\b|\bwe(?:(?:'|’)ve)?\s+built\b/i

/**
 * The organization makes a product: "X is a payments startup", "we build
 * routing software for fleets", "Quillstack helps legal teams review…".
 * Describes the current company, independent of post recency.
 */
const PRODUCT_COMPANY_LINE = new RegExp([
  String.raw`\b(?:is|are)\s+an?\s+(?:[\w-]+\s+){0,4}?(?:startup|platform|saas|app|software|marketplace|tool|product|api|infrastructure|brand|company\s+building)\b`,
  String.raw`\b(?:we|i)\s+(?:are\s+)?(?:build|builds|building|develop|develops|developing|make|makes|making|run|runs|operate|ship|shipping)\s+(?:[\w-]+\s+){0,4}?(?:software|platform|app|apps|product|products|saas|tool|tools|api|apis|marketplace|infrastructure|copilots?|dashboards?|engine|store|brand)\b`,
  String.raw`\b[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,2}\s+(?:builds|develops|makes|provides|automates|connects|moves|runs|provides|edits|édite|entwickelt|construye|geliştiriyor)\s+`,
  String.raw`\b(?:building|shipping|launching|launched|scaling)\s+(?:[\w-]+\s+){0,3}?(?:platform|product|app|saas|tool|infrastructure|copilot|marketplace)\b`,
  String.raw`\b(?:paying\s+customers|beta\s+users|design\s+partners|firms\s+use\s+it|stores\s+live|users\s+every\s+day|customers\s+this\s+spring|downloads)\b`,
].join('|'), 'i')

export function resolveCurrentOrgContext(rawText: string): CurrentOrgContext {
  const split = splitCurrentAndPastLines(rawText)
  const industry = resolveCurrentIndustry(rawText)
  const seller = detectSellerOwnership(split.current.join('\n'))
  const currentText = split.current.join('\n')
  const currentProductActivity = analyzeProductActivity(currentText).hasCurrentProductActivity
    || seller.lines.some((l) => PRODUCT_WORD.test(l))
    || ML_PRODUCT_ACTIVITY.test(currentText)
    || split.current.some((l) => PRODUCT_COMPANY_LINE.test(l))
  return {
    currentIndustry: industry?.industry ?? null,
    currentIndustryLine: industry?.line ?? null,
    currentProductActivity,
    pastRoleLines: split.pastLines,
  }
}
