/**
 * Upwork job facts — the single deterministic reader for a pasted Upwork job.
 *
 * Reads the RAW paste before any cleaning so client history, proposal
 * counts and multi-line rate layouts ("$25\n-\n$60\nHourly") are not lost.
 * Every numeric fact comes from the source, never from a model; the AI
 * extraction (upwork-v2.ts) only fills descriptive gaps (title, summary).
 *
 * Nothing here calls the network. Same text in → same facts out.
 */

import { detectSourceLanguage } from '@/lib/intelligence-v3/multilingual'

export const UPWORK_FACTS_VERSION = 'upwork_facts_v1'

export type RateType = 'hourly' | 'fixed' | 'monthly' | 'unknown'
export type ExperienceLevel = 'entry' | 'intermediate' | 'expert'
export type StartUrgency = 'asap' | 'soon' | 'scheduled' | 'ongoing' | 'none'

export interface UpworkRejectedSignal {
  signal: string
  value: string
  reason: string
}

export interface UpworkJobFacts {
  version: typeof UPWORK_FACTS_VERSION
  language: string
  title: string | null
  rate: {
    type: RateType
    hourlyMin: number | null
    hourlyMax: number | null
    fixedBudget: number | null
    monthlyBudget: number | null
    evidence: string | null
    multiline: boolean
  }
  duration: { label: string | null; months: number | null }
  weeklyHours: { label: string | null; hours: number | null }
  engagement: 'full_time' | 'part_time' | 'contract_to_hire' | null
  experience: { level: ExperienceLevel | null; yearsRequired: number | null; evidence: string | null }
  proposals: { count: number | null; range: [number, number] | null; evidence: string | null }
  connects: number | null
  client: {
    paymentVerified: boolean | null
    totalSpent: number | null
    hireRate: number | null
    jobsPosted: number | null
    openJobs: number | null
    hires: number | null
    activeHires: number | null
    rating: number | null
    reviews: number | null
    avgHourlyPaid: number | null
    hoursBilled: number | null
    memberSince: string | null
    location: string | null
    isNew: boolean
  }
  skills: string[]
  screeningQuestions: string[]
  applicationRequirements: string[]
  start: { urgency: StartUrgency; evidence: string | null }
  posted: { hoursAgo: number | null; evidence: string | null }
  suspicious: string[]
  scope: { wordCount: number; bulletCount: number; hasDeliverables: boolean; hasTimeline: boolean; hasTechSpecifics: boolean; vague: boolean }
  completeness: { score: number; present: string[]; missing: string[] }
  rejectedSignals: UpworkRejectedSignal[]
  descriptionText: string
}

// ── Skill dictionary (token aware; synonyms collapse to one canonical key) ──

const SKILL_SYNONYMS: Array<[string, RegExp]> = [
  ['react', /\breact(?:\.?js)?\b(?!\s*native)/i],
  ['react native', /\breact[\s-]?native\b/i],
  ['next.js', /\bnext(?:\.?js)\b/i],
  ['vue', /\bvue(?:\.?js)?\b/i],
  ['nuxt', /\bnuxt(?:\.?js)?\b/i],
  ['angular', /\bangular(?:\.?js)?\b/i],
  ['svelte', /\bsvelte(?:kit)?\b/i],
  ['typescript', /\btypescript\b|\bts\b(?=\s*(?:\/|,|and|&|\+))/i],
  ['javascript', /\bjavascript\b|\bjs\b(?=\s*(?:\/|,|and|&|\+|developer))/i],
  ['node', /\bnode(?:\.?js)?\b/i],
  ['express', /\bexpress(?:\.?js)?\b/i],
  ['nestjs', /\bnest(?:\.?js)\b/i],
  ['python', /\bpython\b/i],
  ['django', /\bdjango\b/i],
  ['fastapi', /\bfastapi\b/i],
  ['flask', /\bflask\b/i],
  ['php', /\bphp\b/i],
  ['laravel', /\blaravel\b/i],
  ['wordpress', /\bwordpress\b|\bwp\b(?=\s*(?:theme|plugin|site))/i],
  ['shopify', /\bshopify\b/i],
  ['webflow', /\bwebflow\b/i],
  ['ruby on rails', /\bruby\s+on\s+rails\b|\brails\b/i],
  ['ruby', /\bruby\b(?!\s+on)/i],
  ['go', /\bgolang\b|\bgo\b(?=\s*(?:developer|backend|engineer|,|\/))/i],
  ['rust', /\brust\b/i],
  ['java', /\bjava\b(?!\s*script)/i],
  ['kotlin', /\bkotlin\b/i],
  ['swift', /\bswift(?:ui)?\b/i],
  ['ios', /\bios\b/i],
  ['android', /\bandroid\b/i],
  ['flutter', /\bflutter\b/i],
  ['c#', /\bc#\b|\bcsharp\b/i],
  ['.net', /\.net\b|\bdotnet\b/i],
  ['postgresql', /\bpostgres(?:ql)?\b/i],
  ['mysql', /\bmysql\b/i],
  ['mongodb', /\bmongo(?:db)?\b/i],
  ['redis', /\bredis\b/i],
  ['graphql', /\bgraphql\b/i],
  ['rest api', /\brest(?:ful)?\s*apis?\b|\bapi\s+(?:integration|development)\b/i],
  ['aws', /\baws\b|\bamazon\s+web\s+services\b/i],
  ['azure', /\bazure\b/i],
  ['gcp', /\bgcp\b|\bgoogle\s+cloud\b/i],
  ['docker', /\bdocker\b/i],
  ['kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['terraform', /\bterraform\b/i],
  ['devops', /\bdevops\b|\bci\s*\/\s*cd\b/i],
  ['supabase', /\bsupabase\b/i],
  ['firebase', /\bfirebase\b/i],
  ['stripe', /\bstripe\b/i],
  ['openai', /\bopenai\b|\bgpt[-\s]?\d/i],
  ['llm', /\bllms?\b|\blarge\s+language\s+models?\b/i],
  ['rag', /\brag\b|\bretrieval[-\s]augmented\b/i],
  ['langchain', /\blangchain\b/i],
  ['ai', /\bai\b|\bartificial\s+intelligence\b/i],
  ['machine learning', /\bmachine\s+learning\b|\bml\b(?=\s*(?:model|pipeline|engineer|,|\/))/i],
  ['nlp', /\bnlp\b/i],
  ['computer vision', /\bcomputer\s+vision\b|\bopencv\b/i],
  ['data engineering', /\bdata\s+engineering\b|\betl\b|\bairflow\b|\bdbt\b/i],
  ['automation', /\bautomation\b|\bzapier\b|\bmake\.com\b|\bn8n\b/i],
  ['scraping', /\bscrap(?:ing|er)\b|\bcrawler\b/i],
  ['ui/ux', /\bui\s*\/?\s*ux\b|\bfigma\b|\bproduct\s+design\b/i],
  ['tailwind', /\btailwind\b/i],
  ['saas', /\bsaas\b/i],
  ['mvp', /\bmvp\b/i],
  ['dashboard', /\bdashboard\b/i],
  ['mobile app', /\bmobile\s+app\b/i],
  ['web app', /\bweb\s+app(?:lication)?\b/i],
  ['chrome extension', /\bchrome\s+extension\b|\bbrowser\s+extension\b/i],
  ['salesforce', /\bsalesforce\b/i],
  ['hubspot', /\bhubspot\b/i],
  ['security', /\bpenetration\s+test|\bpentest|\bsecurity\s+audit\b/i],
  ['blockchain', /\bblockchain\b|\bsolidity\b|\bweb3\b|\bsmart\s+contracts?\b/i],
  ['unity', /\bunity\b/i],
  ['data entry', /\bdata\s+entry\b/i],
  ['video editing', /\bvideo\s+editing\b/i],
  ['copywriting', /\bcopywriting\b|\bcontent\s+writing\b/i],
  ['seo', /\bseo\b/i],
]

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`
const money = (whole: string, frac?: string) => Number(`${whole.replace(/,/g, '')}${frac ? `.${frac}` : ''}`)
const HOURLY_MARK = String.raw`(?:\/\s*(?:hr|hour)|per\s+hour|hourly|an\s+hour|pro\s+stunde|por\s+hora|par\s+heure|saatlik|\bhr\b)`
const FIXED_MARK = String.raw`(?:fixed[-\s]?price|fixed\s+budget|est\.?\s*budget|project\s+budget|budget|total\s+price|festpreis|precio\s+fijo|prix\s+fixe|sabit\s+fiyat)`

function clean(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[  ]+/g, ' ')
}

/** Join "X\n-\nY" and "X\n–\nY" layouts, and bare "Hourly" lines to the amount above. */
function collapseLayout(text: string): { text: string; multiline: boolean } {
  let multiline = false
  const joined = text
    .replace(/\s*\n\s*[-–—]\s*\n\s*/g, () => { multiline = true; return ' - ' })
    .replace(/\n\s*(?=[-–—]\s*\$)/g, () => { multiline = true; return ' ' })
    .replace(/(\$\s*[\d,]+(?:\.\d+)?)\s*\n\s*(hourly|fixed[-\s]?price|\/\s*hr)/gi, (_m, a, b) => { multiline = true; return `${a} ${b}` })
    .replace(/(hourly|fixed[-\s]?price)\s*:?\s*\n\s*(\$)/gi, (_m, a, b) => { multiline = true; return `${a}: ${b}` })
  return { text: joined, multiline }
}

function parseRate(raw: string): UpworkJobFacts['rate'] & { rejected: UpworkRejectedSignal[] } {
  const rejected: UpworkRejectedSignal[] = []
  const { text, multiline } = collapseLayout(raw)
  const sane = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi

  // Hourly range, marker after: "$25 - $60 Hourly", "$25.00-$60.00/hr"
  const hrRangeAfter = new RegExp(String.raw`\$\s*${NUM}\s*(?:[-–—]|to)\s*\$?\s*${NUM}\s*${HOURLY_MARK}`, 'i')
  // Hourly range, marker before: "Hourly: $25 - $60", "Hourly rate $25-$60"
  const hrRangeBefore = new RegExp(String.raw`${HOURLY_MARK}(?:\s*rate)?\s*:?\s*\$\s*${NUM}\s*(?:[-–—]|to)\s*\$?\s*${NUM}`, 'i')
  const hrSingleAfter = new RegExp(String.raw`\$\s*${NUM}\s*${HOURLY_MARK}`, 'i')
  const hrSingleBefore = new RegExp(String.raw`${HOURLY_MARK}(?:\s*rate)?\s*:?\s*\$\s*${NUM}(?!\s*(?:[-–—]|to))`, 'i')
  const monthly = new RegExp(String.raw`\$\s*${NUM}\s*(?:\/\s*(?:mo|month)|per\s+month|monthly)`, 'i')
  const fixedAfter = new RegExp(String.raw`\$\s*${NUM}\s*(?:\n\s*)?${FIXED_MARK}`, 'i')
  const fixedBefore = new RegExp(String.raw`${FIXED_MARK}\s*[:\-–]?\s*(?:\n\s*)?\$\s*${NUM}`, 'i')

  let m = text.match(hrRangeAfter) ?? text.match(hrRangeBefore)
  if (m) {
    const a = money(m[1], m[2]); const b = money(m[3], m[4])
    if (sane(a, 3, 500) && sane(b, 3, 1000) && b >= a) return { type: 'hourly', hourlyMin: a, hourlyMax: b, fixedBudget: null, monthlyBudget: null, evidence: m[0].trim(), multiline, rejected }
    rejected.push({ signal: 'hourly_rate', value: m[0].trim(), reason: 'Out of a plausible hourly range' })
  }
  m = text.match(hrSingleAfter) ?? text.match(hrSingleBefore)
  if (m) {
    const a = money(m[1], m[2])
    if (sane(a, 3, 500)) return { type: 'hourly', hourlyMin: a, hourlyMax: a, fixedBudget: null, monthlyBudget: null, evidence: m[0].trim(), multiline, rejected }
  }
  m = text.match(monthly)
  if (m) {
    const a = money(m[1], m[2])
    if (sane(a, 100, 100000)) return { type: 'monthly', hourlyMin: null, hourlyMax: null, fixedBudget: null, monthlyBudget: a, evidence: m[0].trim(), multiline, rejected }
  }
  m = text.match(fixedAfter) ?? text.match(fixedBefore)
  if (m) {
    const a = money(m[1], m[2])
    if (sane(a, 20, 5000000)) return { type: 'fixed', hourlyMin: null, hourlyMax: null, fixedBudget: a, monthlyBudget: null, evidence: m[0].trim(), multiline, rejected }
  }
  // A lone "$X" with no marker is NOT credited as a budget — it could be a
  // product price, a revenue figure or a bonus mention.
  const lone = text.match(new RegExp(String.raw`\$\s*${NUM}`, 'i'))
  if (lone) rejected.push({ signal: 'budget', value: lone[0].trim(), reason: 'Dollar amount without an hourly or fixed-price marker' })
  return { type: 'unknown', hourlyMin: null, hourlyMax: null, fixedBudget: null, monthlyBudget: null, evidence: null, multiline, rejected }
}

function parseDuration(text: string): UpworkJobFacts['duration'] {
  const m = text.match(/\b(less\s+than\s+(?:1|one)\s+month|1\s+to\s+3\s+months|3\s+to\s+6\s+months|more\s+than\s+6\s+months|6\s+months\s+to\s+(?:1|one)\s+year|(\d+)\s*(?:-|to)\s*(\d+)\s+(?:months?|weeks?)|(\d+)\s+(?:months?|weeks?))\b/i)
  if (!m) {
    if (/\b(?:long[-\s]?term|ongoing|indefinite)\b/i.test(text)) return { label: 'ongoing', months: 9 }
    if (/\b(?:one[-\s]?off|short[-\s]?term|quick\s+(?:task|fix|job))\b/i.test(text)) return { label: 'short-term', months: 0.5 }
    return { label: null, months: null }
  }
  const label = m[1]
  const weeks = /week/i.test(label)
  if (/less\s+than/i.test(label)) return { label, months: 0.5 }
  if (/1\s+to\s+3/i.test(label)) return { label, months: 2 }
  if (/3\s+to\s+6/i.test(label)) return { label, months: 4.5 }
  if (/more\s+than\s+6|6\s+months\s+to/i.test(label)) return { label, months: 9 }
  if (m[2] && m[3]) { const avg = (Number(m[2]) + Number(m[3])) / 2; return { label, months: weeks ? avg / 4.3 : avg } }
  if (m[4]) { const n = Number(m[4]); return { label, months: weeks ? n / 4.3 : n } }
  return { label, months: null }
}

function parseWeeklyHours(text: string): UpworkJobFacts['weeklyHours'] {
  const m = text.match(/\b(less\s+than\s+(\d+)|more\s+than\s+(\d+)|(\d+)\s*\+|(\d+)\s*(?:-|to)\s*(\d+)|(\d+))\s*(?:hrs?|hours?)\s*(?:\/|per|a)\s*(?:week|wk)\b/i)
  if (!m) return { label: null, hours: null }
  if (m[2]) return { label: m[0], hours: Number(m[2]) }
  if (m[3]) return { label: m[0], hours: Number(m[3]) + 10 }
  if (m[4]) return { label: m[0], hours: Number(m[4]) + 5 }
  if (m[5] && m[6]) return { label: m[0], hours: (Number(m[5]) + Number(m[6])) / 2 }
  return { label: m[0], hours: Number(m[7]) }
}

function parseExperience(text: string): UpworkJobFacts['experience'] {
  const years = text.match(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:\w+\s+){0,3}?experience\b/i)
  const yearsRequired = years ? Number(years[1]) : null
  const lvl = text.match(/^\s*(entry|intermediate|expert)(?:\s+level)?\s*$/im) ?? text.match(/\b(entry|intermediate|expert)\s+level\b/i) ?? text.match(/\bexperience\s+level\s*:?\s*(entry|intermediate|expert)\b/i)
  let level: ExperienceLevel | null = lvl ? (lvl[1].toLowerCase() as ExperienceLevel) : null
  if (!level && yearsRequired !== null) level = yearsRequired >= 5 ? 'expert' : yearsRequired >= 2 ? 'intermediate' : 'entry'
  if (!level && /\bsenior\b/i.test(text)) level = 'expert'
  if (!level && /\bjunior\b/i.test(text)) level = 'entry'
  return { level, yearsRequired, evidence: (lvl ?? years)?.[0]?.trim() ?? null }
}

function parseProposals(text: string): UpworkJobFacts['proposals'] {
  const m = text.match(/\bproposals?\s*:?\s*\n?\s*(less\s+than\s+(\d+)|(\d+)\s*(?:to|-|–)\s*(\d+)|(\d+)\s*\+|(\d+))\b/i)
    ?? text.match(/\b(less\s+than\s+(\d+)|(\d+)\s*(?:to|-|–)\s*(\d+)|(\d+)\s*\+)\s+proposals?\b/i)
  if (!m) return { count: null, range: null, evidence: null }
  if (m[2]) return { count: Number(m[2]) / 2, range: [0, Number(m[2])], evidence: m[0].trim() }
  if (m[3] && m[4]) return { count: (Number(m[3]) + Number(m[4])) / 2, range: [Number(m[3]), Number(m[4])], evidence: m[0].trim() }
  if (m[5]) return { count: Number(m[5]) + 25, range: [Number(m[5]), Number(m[5]) * 2], evidence: m[0].trim() }
  return { count: Number(m[6]), range: [Number(m[6]), Number(m[6])], evidence: m[0].trim() }
}

function parseConnects(text: string): number | null {
  const scrubbed = text.replace(/available\s+connects\s*:?\s*\d+/gi, '')
  const m = scrubbed.match(/\b(?:required\s+)?connects(?:\s+to\s+submit\s+a\s+proposal)?\s*:?\s*\n?\s*(\d{1,3})\b/i)
    ?? scrubbed.match(/\bsend\s+a\s+proposal\s+for\s*:?\s*(\d{1,3})\s+connects\b/i)
    ?? scrubbed.match(/\b(\d{1,3})\s+connects\b/i)
  return m ? Number(m[1]) : null
}

function parseClient(text: string): UpworkJobFacts['client'] {
  const section = text.match(/about\s+the\s+client[\s\S]*$/i)?.[0] ?? text
  const spend = section.match(new RegExp(String.raw`\$\s*${NUM}\s*([kKmM])?\+?\s*(?:total\s+)?spent`, 'i'))
  const totalSpent = spend ? money(spend[1], spend[2]) * (/k/i.test(spend[3] ?? '') ? 1000 : /m/i.test(spend[3] ?? '') ? 1_000_000 : 1) : null
  const hireRate = section.match(/(\d{1,3})\s*%\s*hire\s+rate/i) ?? section.match(/hire\s+rate\s*:?\s*(\d{1,3})\s*%/i)
  const jobsPosted = section.match(/(\d+)\s+jobs?\s+posted/i)
  const openJobs = section.match(/(\d+)\s+open\s+jobs?/i)
  const hires = section.match(/(\d+)\s+hires?\b/i)
  const active = section.match(/(\d+)\s+active\b/i)
  const rating = section.match(/(\d(?:\.\d{1,2})?)\s*(?:of\s+5|\/\s*5|stars?|★)/i) ?? section.match(/★\s*(\d(?:\.\d{1,2})?)/)
  const reviews = section.match(/(\d+)\s+reviews?\b/i)
  const avgPaid = section.match(new RegExp(String.raw`\$\s*${NUM}\s*\/\s*hr\s+avg`, 'i')) ?? section.match(new RegExp(String.raw`avg(?:erage)?\s+hourly\s+rate\s+paid\s*:?\s*\$\s*${NUM}`, 'i'))
  const hoursBilled = section.match(/([\d,]+)\s+hours?\b(?!\s*(?:\/|per))/i)
  const memberSince = section.match(/member\s+since\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{4}|\d{4})/i)
  const paymentVerified = /payment\s+(?:method\s+)?verified/i.test(section) ? true : /payment\s+(?:method\s+)?(?:un|not\s+)verified/i.test(section) ? false : null
  const location = section.match(/\n\s*([A-Z][A-Za-z .'-]{2,40}(?:,\s*[A-Z][A-Za-z .'-]{2,30})?)\s*\n\s*(?:\d{1,2}:\d{2}\s*[AP]M|[A-Z][a-z]+\s+\d{1,2}:\d{2})/)
  const totalSpentValue = totalSpent
  const isNew = totalSpentValue === null && !hires && !jobsPosted
  return {
    paymentVerified,
    totalSpent: totalSpentValue,
    hireRate: hireRate ? Number(hireRate[1]) : null,
    jobsPosted: jobsPosted ? Number(jobsPosted[1]) : null,
    openJobs: openJobs ? Number(openJobs[1]) : null,
    hires: hires ? Number(hires[1]) : null,
    activeHires: active ? Number(active[1]) : null,
    rating: rating ? Number(rating[1]) : null,
    reviews: reviews ? Number(reviews[1]) : null,
    avgHourlyPaid: avgPaid ? money(avgPaid[1], avgPaid[2]) : null,
    hoursBilled: hoursBilled ? Number(hoursBilled[1].replace(/,/g, '')) : null,
    memberSince: memberSince ? memberSince[1] : null,
    location: location ? location[1].trim() : null,
    isNew,
  }
}

function parseSkills(text: string): string[] {
  const body = text.replace(/about\s+the\s+client[\s\S]*$/i, '')
  const found: string[] = []
  for (const [key, re] of SKILL_SYNONYMS) if (re.test(body) && !found.includes(key)) found.push(key)
  return found
}

function parseScreeningQuestions(text: string): string[] {
  const out: string[] = []
  const section = text.match(/(?:screening\s+questions?|you\s+will\s+be\s+asked\s+to\s+answer\s+the\s+following\s+questions?[^\n]*|questions?\s+to\s+answer\s+in\s+your\s+proposal)[^\n]*\n([\s\S]{0,2000}?)(?:\n\s*\n\s*\n|\n\s*(?:about\s+the\s+client|activity\s+on\s+this\s+job|skills\s+and\s+expertise)|$)/i)
  const lines = (section?.[1] ?? '').split('\n').map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim()).filter((l) => l.length > 8)
  for (const l of lines) if (l.endsWith('?') || /^(?:describe|explain|share|tell\s+us|provide|include|what|how|which|why|have\s+you|do\s+you|are\s+you|list)\b/i.test(l)) out.push(l)
  if (out.length === 0) {
    for (const l of text.split('\n').map((s) => s.trim())) if (/^(?:\d+[.)]\s*)?(?:what|how|which|why|have\s+you|do\s+you|are\s+you|can\s+you|describe)\b[^?\n]{8,160}\?$/i.test(l)) out.push(l.replace(/^\d+[.)]\s*/, ''))
  }
  return [...new Set(out)].slice(0, 10)
}

function parseApplicationRequirements(text: string): string[] {
  const reqs: Array<[RegExp, string]> = [
    [/\b(?:resume|cv|curriculum\s+vitae)\b/i, 'Résumé or CV'],
    [/\bportfolio\b|\bexamples?\s+of\s+(?:previous|past|similar)\s+work\b|\bsimilar\s+projects?\s+you\b/i, 'Portfolio or examples of similar work'],
    [/\b(?:your|proposed|hourly)\s+rate\b|\bmonthly\s+retainer\b/i, 'Proposed rate'],
    [/\bavailability\b|\bhours\s+you\s+can\s+commit\b|\btime\s*zone\b/i, 'Availability'],
    [/\breferences?\b|\btestimonials?\b/i, 'References or testimonials'],
    [/\bgithub\b|\bcode\s+samples?\b/i, 'GitHub or code samples'],
    [/\bloom\b|\bvideo\s+(?:intro|introduction)\b/i, 'Video introduction'],
    [/\bstart\s+your\s+(?:proposal|reply|application)\s+with\b|\bbegin\s+your\s+(?:proposal|cover\s+letter)\s+with\b|\binclude\s+the\s+word\b/i, 'Attention keyword in the proposal'],
  ]
  return reqs.filter(([re]) => re.test(text)).map(([, label]) => label)
}

function parseStart(text: string): UpworkJobFacts['start'] {
  const asap = text.match(/\b(?:asap|as\s+soon\s+as\s+possible|immediately|right\s+away|start\s+(?:today|tomorrow|this\s+week)|urgent(?:ly)?|within\s+(?:24|48)\s+hours|deadline\s+(?:is\s+)?(?:tomorrow|this\s+week))\b/i)
  if (asap) return { urgency: 'asap', evidence: asap[0] }
  const soon = text.match(/\b(?:start\s+(?:next\s+week|within\s+(?:a|one|two|2)\s+weeks?)|next\s+(?:1|2|two)\s+weeks|by\s+(?:end\s+of\s+)?(?:this|next)\s+(?:week|month))\b/i)
  if (soon) return { urgency: 'soon', evidence: soon[0] }
  const sched = text.match(/\b(?:start\s+(?:date|on)\s*:?\s*[A-Za-z0-9 ,]+|starting\s+(?:in\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])\b[^\n]{0,20})/i)
  if (sched) return { urgency: 'scheduled', evidence: sched[0].trim() }
  if (/\b(?:ongoing|long[-\s]?term|no\s+rush|flexible\s+(?:timeline|start))\b/i.test(text)) return { urgency: 'ongoing', evidence: null }
  return { urgency: 'none', evidence: null }
}

function parsePosted(text: string): UpworkJobFacts['posted'] {
  const m = text.match(/\bposted\s+(?:(\d+)\s+(minute|hour|day|week|month)s?\s+ago|(yesterday)|(just\s+now)|(last\s+week))/i)
  if (!m) return { hoursAgo: null, evidence: null }
  if (m[3]) return { hoursAgo: 24, evidence: m[0] }
  if (m[4]) return { hoursAgo: 0, evidence: m[0] }
  if (m[5]) return { hoursAgo: 24 * 7, evidence: m[0] }
  const n = Number(m[1]); const unit = m[2].toLowerCase()
  const hours = unit === 'minute' ? n / 60 : unit === 'hour' ? n : unit === 'day' ? n * 24 : unit === 'week' ? n * 168 : n * 720
  return { hoursAgo: hours, evidence: m[0] }
}

function parseSuspicious(text: string, rate: UpworkJobFacts['rate'], client: UpworkJobFacts['client'], experience: UpworkJobFacts['experience']): string[] {
  const out: string[] = []
  if (/\b(?:whatsapp|telegram|signal\s+app|skype\s+me|contact\s+me\s+(?:outside|off)\b|off[-\s]?platform|outside\s+(?:of\s+)?upwork|gmail\.com|pay(?:ment)?\s+(?:outside|off)\s+upwork)/i.test(text)) out.push('Asks to move contact or payment off Upwork')
  if (/\b(?:free\s+(?:sample|trial|test)\s+(?:task|work|project)|unpaid\s+(?:test|trial|sample)|do\s+a\s+(?:small\s+)?test\s+task\s+first)\b/i.test(text)) out.push('Asks for unpaid test work')
  if (/\b(?:send|upload|share)\s+(?:a\s+)?(?:copy\s+of\s+)?(?:your\s+)?(?:id|passport|driver'?s\s+licen[cs]e|ssn|bank\s+(?:details|account))\b/i.test(text)) out.push('Requests identity or bank documents')
  if (/\b(?:guaranteed\s+(?:income|returns|profit)|earn\s+\$\d[\d,]*\s*(?:per|a)\s*(?:day|week)|investment\s+opportunity|crypto\s+(?:investment|trading\s+bot\s+guaranteed))\b/i.test(text)) out.push('Too-good-to-be-true earnings claim')
  if (/\b(?:install\s+(?:our|this)\s+(?:app|software)\s+(?:on\s+your|first)|download\s+(?:the\s+)?(?:apk|exe)\b|remote\s+access\s+to\s+your)\b/i.test(text)) out.push('Asks to install software or grant remote access')
  if (rate.type === 'hourly' && (rate.hourlyMax ?? 0) >= 150 && experience.level === 'entry') out.push('Very high hourly rate for an entry-level post')
  if (rate.type === 'fixed' && (rate.fixedBudget ?? 0) >= 20000 && client.isNew && client.paymentVerified === false) out.push('Large budget from an unverified new client')
  if (/\b(?:data\s+entry|typing|copy\s+paste)\b/i.test(text) && rate.type === 'hourly' && (rate.hourlyMax ?? 0) >= 50) out.push('Trivial task with an implausible rate')
  return out
}

function parseScope(description: string, questions: string[]): UpworkJobFacts['scope'] {
  const words = description.split(/\s+/).filter(Boolean)
  const bullets = description.split('\n').filter((l) => /^\s*(?:[-•*]|\d+[.)])\s+/.test(l)).length
  const hasDeliverables = /\b(?:deliverables?|milestones?|scope\s+of\s+work|requirements?\s*:|features?\s*:|must\s+(?:have|include)|should\s+(?:be\s+able\s+to|include)|we\s+need\s+(?:you\s+to|a)\b)/i.test(description)
  const hasTimeline = /\b(?:deadline|timeline|by\s+(?:end\s+of\s+)?(?:week|month|q[1-4]|[a-z]+\s+\d{1,2})|within\s+\d+\s+(?:days?|weeks?|months?)|\d+\s*(?:-|to)\s*\d+\s+(?:weeks?|months?))\b/i.test(description)
  const hasTechSpecifics = SKILL_SYNONYMS.filter(([, re]) => re.test(description)).length >= 2 || /\b(?:api|database|schema|architecture|integration|repo(?:sitory)?|codebase|existing\s+(?:app|code|system))\b/i.test(description)
  const vague = words.length < 40 && !hasDeliverables && !hasTechSpecifics && questions.length === 0
  return { wordCount: words.length, bulletCount: bullets, hasDeliverables, hasTimeline, hasTechSpecifics, vague }
}

function descriptionOf(text: string): string {
  return text
    .replace(/about\s+the\s+client[\s\S]*$/i, '')
    .replace(/activity\s+on\s+this\s+job[\s\S]*$/i, '')
    .replace(/^\s*(?:proposals?|connects|required\s+connects|available\s+connects|interviewing|invites\s+sent|unanswered\s+invites|last\s+viewed\s+by\s+client)\b.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function titleOf(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const l of lines.slice(0, 6)) {
    if (/^(?:current\s+page|posted\s+|job\s+details|featured|promoted|hourly|fixed|budget|\$)/i.test(l)) continue
    if (l.length >= 8 && l.length <= 140 && !/[.:]$/.test(l)) return l.replace(/^(?:sf|sps|sp|sv|sb)\s+/i, '')
  }
  return null
}

export function readUpworkJobFacts(rawText: string): UpworkJobFacts {
  const text = clean(rawText ?? '')
  const rate = parseRate(text)
  const client = parseClient(text)
  const experience = parseExperience(text)
  const screeningQuestions = parseScreeningQuestions(text)
  const descriptionText = descriptionOf(text)
  const scope = parseScope(descriptionText, screeningQuestions)
  const rejectedSignals = [...rate.rejected]

  const present: string[] = []
  const missing: string[] = []
  const mark = (ok: boolean, field: string) => (ok ? present : missing).push(field)
  mark(rate.type !== 'unknown', 'rate')
  mark(scope.wordCount >= 40, 'description')
  mark(parseSkills(text).length > 0, 'skills')
  mark(experience.level !== null, 'experience_level')
  mark(parseDuration(text).label !== null, 'duration')
  mark(parseProposals(text).count !== null, 'proposals')
  mark(client.paymentVerified !== null || client.totalSpent !== null || client.hires !== null, 'client_history')
  mark(parsePosted(text).hoursAgo !== null, 'posted_date')

  return {
    version: UPWORK_FACTS_VERSION,
    language: detectSourceLanguage(text),
    title: titleOf(text),
    rate: { type: rate.type, hourlyMin: rate.hourlyMin, hourlyMax: rate.hourlyMax, fixedBudget: rate.fixedBudget, monthlyBudget: rate.monthlyBudget, evidence: rate.evidence, multiline: rate.multiline },
    duration: parseDuration(text),
    weeklyHours: parseWeeklyHours(text),
    engagement: /\bfull[-\s]?time\b/i.test(text) ? 'full_time' : /\bcontract[-\s]to[-\s]hire\b/i.test(text) ? 'contract_to_hire' : /\bpart[-\s]?time\b/i.test(text) ? 'part_time' : null,
    experience,
    proposals: parseProposals(text),
    connects: parseConnects(text),
    client,
    skills: parseSkills(text),
    screeningQuestions,
    applicationRequirements: parseApplicationRequirements(text),
    start: parseStart(text),
    posted: parsePosted(text),
    suspicious: parseSuspicious(text, rate, client, experience),
    scope,
    completeness: { score: Math.round((present.length / (present.length + missing.length)) * 100), present, missing },
    rejectedSignals,
    descriptionText,
  }
}
