/**
 * Canonical SourceFacts — the one verified reading of a pasted source.
 *
 * Every scoring layer (buyer intent, commercial potential, fit, authority,
 * timing, access, evidence quality, confidence) consumes this object. No
 * scorer scans raw text on its own once it exists; a scorer that needs a
 * new fact adds it here.
 *
 * Everything is deterministic (no AI). Each positive fact carries the
 * verbatim line it came from, and every candidate the readers REJECTED is
 * kept in `rejectedSignals` with the reason, so the admin inspector can show
 * "Budget $4,200 — rejected: illustrative example" instead of silently
 * dropping it.
 */

import { readBuyerSourceFacts, type BuyerSourceFacts } from './buyer-intent'
import {
  INDUSTRY_TAXONOMY,
  resolveCurrentOrgContext,
  splitCurrentAndPastLines,
} from './current-org'
import {
  classifyLine,
  detectSellerOwnership,
  extractExplicitDates,
  extractStatedTimeline,
  findContactInstruction,
  isRecruiterProfile,
  type ExplicitDateEvidence,
  type StatedTimeline,
} from './source-facts'
import { segmentLinkedInSource } from './source-segmenter'
import { extractSignals, type ExtractedSignals } from '@/lib/scoring/signal-extractor'
import {
  analyzeCustomerSegment,
  classifyTemporalProvenance,
  isHistoricalYear,
  parseAccessSignals,
  verifyBudgetProvenance,
  verifyHiringProvenance,
  type TemporalClass,
} from '@/lib/scoring/signal-attribution'
import { detectFunding } from '@/lib/evidence/provenance'
import { detectSourceLanguage, ML_FOUNDER_ROLE, type SourceLanguage } from './multilingual'
import { SOURCE_FACTS_VERSION } from './versions'

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivityRecency = 'FRESH' | 'RECENT' | 'AGING' | 'STALE' | 'UNKNOWN'
export type AuthorityLevel = 'FOUNDER' | 'EXECUTIVE' | 'VP_HEAD' | 'DIRECTOR' | 'MANAGER' | 'SENIOR_IC' | 'IC' | 'RECRUITER' | 'UNKNOWN'
export type ExtendedTemporalClass = TemporalClass | 'AGING' | 'UNKNOWN'

export interface RejectedSignal {
  /** What the candidate would have been: budget, hiring, buyer_request, industry, company_size, launch, urgency, funding, access. */
  signal: string
  /** The candidate value as the reader saw it. */
  value: string | null
  sourceLine: string
  sourceSection: string
  actor: 'prospect' | 'prospect_past' | 'third_party' | 'customer' | 'unknown'
  organization: string | null
  temporalClass: ExtendedTemporalClass
  reason: string
}

export interface AccessFacts {
  connectionDegree: '1st' | '2nd' | '3rd' | 'unknown'
  canMessage: boolean
  canConnect: boolean
  mutualConnections: number
  /** A contact route is stated in the source (email, "DM me", apply link). */
  directContactAvailable: boolean
  contactLine: string | null
  profileUrl: string | null
  hasEmail: boolean
}

export interface AuthorityEvidence {
  level: AuthorityLevel
  /** 0-1 decision authority for buying outside services. */
  decisionAuthority: number
  /** 0-1 technical authority. */
  technicalAuthority: number
  title: string | null
  line: string | null
}

export interface SourceCompleteness {
  score: number
  presentFields: string[]
  missingFields: string[]
}

export interface SourceFacts {
  version: string
  sourceLanguage: SourceLanguage
  person: { name: string | null; title: string | null }
  currentRole: string | null
  currentCompany: string | null
  currentOrganizations: string[]
  currentIndustry: string | null
  currentIndustryLine: string | null
  historicalIndustries: string[]
  targetCustomerSegment: string | null
  companySizeEvidence: string | null
  companySizeCategory: ExtractedSignals['company']['sizeCategory']
  access: AccessFacts
  location: string | null
  recentPostAgeDays: number | null
  activityRecency: ActivityRecency
  currentProductActivity: boolean
  historicalProductActivity: boolean
  currentHiringActivity: string | null
  hiringUrgent: boolean
  hiringCount: number
  candidateSeeking: boolean
  serviceOffering: string[]
  sellerActivity: boolean
  recruiterProfile: boolean
  buyerRequest: string | null
  /** Age in days of the post that carries the request, when the source dates it. */
  buyerRequestAgeDays: number | null
  helpRequest: string | null
  externalNeed: boolean
  budgetEvidence: { line: string; amount: string | null; approved: boolean } | null
  timelineEvidence: StatedTimeline | null
  /** Absolute dates the relative-age reader misses (QA BUG-PRO-023). */
  explicitDates: ExplicitDateEvidence
  /** The newest explicit terminal state (do-not-contact, filled, completed). */
  terminalState: { kind: 'DO_NOT_CONTACT' | 'CLOSED' | 'COMPLETED' | 'PARTNER_SELECTED'; line: string; index: number } | null
  authorityEvidence: AuthorityEvidence
  technologyContext: ExtractedSignals['technology']
  capabilityNeeds: string[]
  proofCandidates: string[]
  fundingEvidence: string | null
  founderOrBuilder: boolean
  sourceCompleteness: SourceCompleteness
  rejectedSignals: RejectedSignal[]
  /** The buyer-relevant subset, exactly as resolveVerifiedBuyerIntent reads it. */
  buyer: BuyerSourceFacts
  /** Deterministic signal check used as an attribution audit input. */
  signals: ExtractedSignals
  /** Lines the readers treat as career history. */
  pastRoleLines: string[]
}

export interface ReadSourceFactsOptions {
  /** Identity already extracted upstream (bridge/V2); avoids re-guessing. */
  identity?: { name?: string | null; title?: string | null; company?: string | null; location?: string | null }
  currentOrganizations?: string[]
  /** Roles held at current affiliations ("Founder", "CTO"), when structured data has them. */
  affiliationRoles?: string[]
}

// ── Readers ──────────────────────────────────────────────────────────────────

const TITLE_SEP = /\s*(?:\||·|—|–|\s-\s|,)\s*/
const AUTHORITY_PATTERNS: Array<{ level: AuthorityLevel; re: RegExp; decision: number; technical: number }> = [
  { level: 'RECRUITER', re: /\b(?:recruiter|talent\s+(?:acquisition|partner|specialist)|sourcer|headhunter|hiring\s+manager|rekruter(?:ka)?)\b/i, decision: 0.2, technical: 0.1 },
  // German and French titles carry a feminine suffix ("Geschäftsführerin",
  // "Gründerin", "Inhaberin"); "\b" does not end a word before "ä"/"ü", so
  // the non-ASCII titles are matched with explicit boundaries.
  { level: 'FOUNDER', re: /\b(?:founder|co-?founder|cofounder|owner|managing\s+partner|ceo|inhaber(?:in)?|mitgr[üu]nder(?:in)?|gr[üu]nder(?:in)?|fondateur|fondatrice|gerente\s+general)(?![\p{L}])|\bchief\s+executive\b/iu, decision: 1.0, technical: 0.5 },
  { level: 'EXECUTIVE', re: /(?<![\p{L}])(?:cto|cfo|coo|cpo|ciso|cio|chief\s+\w+\s+officer|president|managing\s+director|gesch[äa]ftsf[üu]hrer(?:in)?|gesch[äa]ftsleiter(?:in)?|vorstand|directeur\s+g[ée]n[ée]ral|director\s+general|genel\s+m[üu]d[üu]r)(?![\p{L}])/iu, decision: 0.9, technical: 0.7 },
  { level: 'VP_HEAD', re: /\b(?:vp|vice\s+president|head\s+of|svp|evp)\b/i, decision: 0.75, technical: 0.6 },
  { level: 'DIRECTOR', re: /\bdirector\b/i, decision: 0.65, technical: 0.5 },
  { level: 'MANAGER', re: /\b(?:manager|team\s+lead|engineering\s+lead|tech\s+lead|lead\s+engineer|product\s+owner)\b/i, decision: 0.5, technical: 0.6 },
  { level: 'SENIOR_IC', re: /\b(?:senior|sr\.?|staff|principal|architect)\b/i, decision: 0.35, technical: 0.8 },
  { level: 'IC', re: /\b(?:engineer|developer|designer|analyst|consultant|specialist|associate|scientist)\b/i, decision: 0.25, technical: 0.6 },
]

function sourceLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function resolveAuthority(title: string | null, headerLines: string[]): AuthorityEvidence {
  // The headline and the first header lines name the current role; a role
  // held at another current organization (structured affiliations) counts
  // too, so "Software Engineer at X | Founder at Y" is founder authority.
  const candidates = [title ?? '', ...headerLines.slice(0, 4), ...headerLines.slice(4)].filter(Boolean)
  let best: { level: AuthorityLevel; decision: number; technical: number; line: string } | null = null
  for (const line of candidates) {
    const matches = AUTHORITY_PATTERNS.filter((p) => p.re.test(line))
    if (matches.length === 0) continue
    const top = matches.reduce((a, b) => (b.decision > a.decision ? b : a))
    const technical = Math.max(...matches.map((m) => m.technical), /\b(?:cto|engineer|developer|architect|technical)\b/i.test(line) ? 0.8 : 0)
    if (!best || top.decision > best.decision) best = { level: top.level, decision: top.decision, technical, line }
  }
  if (best) return { level: best.level, decisionAuthority: best.decision, technicalAuthority: best.technical, title: title ?? best.line, line: best.line }
  if (title && ML_FOUNDER_ROLE.test(title)) {
    return { level: 'FOUNDER', decisionAuthority: 1.0, technicalAuthority: 0.5, title, line: title }
  }
  return { level: 'UNKNOWN', decisionAuthority: 0.3, technicalAuthority: 0.3, title, line: null }
}

function activityRecencyFromDays(days: number | null): ActivityRecency {
  if (days === null) return 'UNKNOWN'
  if (days <= 7) return 'FRESH'
  if (days <= 30) return 'RECENT'
  if (days <= 90) return 'AGING'
  return 'STALE'
}

/** Age of the post containing `line`, from the nearest LinkedIn relative-age marker above it. */
export function postAgeDaysForLine(rawText: string, line: string | null): number | null {
  if (!line) return null
  const segments = segmentLinkedInSource(rawText)
  const hit = segments.find((s) => s.type === 'post' && s.text.includes(line))
  if (hit && hit.ageDays !== null) return hit.ageDays
  const lines = rawText.split('\n').map((l) => l.trim())
  const idx = lines.findIndex((l) => l === line)
  if (idx < 0) return null
  for (let i = idx; i >= 0 && i > idx - 8; i--) {
    const m = lines[i].match(/^(\d+)\s*(mo|w|d|h|y)\b/i) ?? lines[i].match(/•\s*(\d+)\s*(mo|w|d|h|y)\b/i)
    if (m) {
      const n = Number(m[1])
      const u = m[2].toLowerCase()
      return u === 'h' ? 0 : u === 'd' ? n : u === 'w' ? n * 7 : u === 'mo' ? n * 30 : n * 365
    }
  }
  return null
}

/** Most recent dated post in the source, from LinkedIn relative-age lines ("3d •", "2mo"). */
export function mostRecentPostAgeDays(rawText: string): number | null {
  const segments = segmentLinkedInSource(rawText)
  const ages = segments.map((s) => s.ageDays).filter((a): a is number => a !== null)
  // Inline post ages are LinkedIn's "3d •", "posted this • 2w", "5 days ago".
  // Tenure durations ("2 yrs 8 mos", "10 mos") are NOT activity dates.
  const inline = [...rawText.matchAll(/(?:(?:posted\s+this|•|·)\s*)?(\d+)\s*(h|hr|hour|d|day|w|week|mo|month|y|year)s?\b(\s*(?:ago|•|·))?/gi)]
    .filter((m) => {
      const prefixed = /^(?:posted\s+this|•|·)/i.test(m[0])
      const suffixed = Boolean(m[3])
      const unit = m[2].toLowerCase()
      const longForm = unit === 'hour' || unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year'
      // Long forms need "ago"; short forms need a marker on either side.
      return longForm ? /ago/i.test(m[3] ?? '') : (prefixed || suffixed)
    })
    .map((m) => {
      const n = Number(m[1])
      const u = m[2].toLowerCase()
      if (u.startsWith('h')) return 0
      if (u.startsWith('d')) return n
      if (u.startsWith('w')) return n * 7
      if (u.startsWith('mo')) return n * 30
      if (u.startsWith('y')) return n * 365
      return null
    })
    .filter((a): a is number => a !== null && a <= 365 * 5)
  // German relative ages: "vor 5 Tagen", "5 Tage •", "• 2 Wochen", "3 Std.",
  // or a line that is only "5 Tage". A bare duration inside prose ("2 Jahre
  // 3 Monate" tenure) needs the "vor" prefix or a marker, as in English.
  const german = [...rawText.matchAll(/(?:^|(vor)\s+|[•·]\s*)(\d+)\s*(std|stunden?|tag(?:e|en)?|wochen?|monat(?:e|en)?|jahr(?:e|en)?)\.?(?=\s*(?:[•·]|$))?/gim)]
    .filter((m) => {
      const prefixed = Boolean(m[1]) || /^[•·]/.test(m[0])
      const after = rawText.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3)
      const suffixed = /^\s*(?:[•·]|$)/m.test(after)
      const lineStart = (m.index ?? 0) === 0 || rawText[(m.index ?? 0) - 1] === '\n'
      return prefixed || suffixed || lineStart
    })
    .map((m) => {
      const n = Number(m[2])
      const u = m[3].toLowerCase()
      if (u.startsWith('st')) return 0
      if (u.startsWith('t')) return n
      if (u.startsWith('w')) return n * 7
      if (u.startsWith('m')) return n * 30
      if (u.startsWith('j')) return n * 365
      return null
    })
    .filter((a): a is number => a !== null && a <= 365 * 5)
  const all = [...ages, ...inline, ...german]
  return all.length > 0 ? Math.min(...all) : null
}

const CAPABILITY_TERMS = [
  'react', 'next.js', 'nextjs', 'node', 'node.js', 'typescript', 'javascript', 'python', 'django', 'flask', 'fastapi', 'go', 'golang', 'rust', 'java', 'kotlin', 'swift', 'flutter', 'react native', '.net', 'c#', 'php', 'laravel', 'ruby', 'rails', 'vue', 'angular', 'svelte',
  'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform', 'devops', 'ci/cd', 'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'graphql', 'rest api', 'api',
  'ai', 'ml', 'machine learning', 'llm', 'rag', 'nlp', 'computer vision', 'data engineering', 'data pipeline', 'analytics', 'dashboard', 'mobile app', 'ios', 'android', 'web app', 'saas', 'mvp', 'backend', 'frontend', 'full-stack', 'fullstack', 'ui/ux', 'design system', 'security', 'compliance', 'automation', 'integration', 'shopify', 'wordpress', 'salesforce', 'hubspot',
]

function capabilityTermsIn(text: string): string[] {
  const lower = text.toLowerCase()
  const found = CAPABILITY_TERMS.filter((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(lower)
  })
  return [...new Set(found)]
}

function sectionOf(rawText: string, line: string): string {
  const lines = rawText.split('\n').map((l) => l.trim())
  const idx = lines.indexOf(line)
  if (idx < 0) return 'unknown'
  const header = /^(about|activity|posts?|experience|education|skills|featured|services|highlights|licenses?.*|recommendations|projects)$/i
  for (let i = idx; i >= 0; i--) {
    if (header.test(lines[i])) return lines[i].toLowerCase()
  }
  return idx <= 6 ? 'header' : 'body'
}

const LAUNCH_WORDS = /\b(?:launched|launching|just\s+released|shipped|introducing|announcing|is\s+live|went\s+live|product\s+hunt|beta|early\s+access)\b/i
const SIZE_WORDS = /\b(?:enterprise|fortune\s+500|\d{2,4}\+?\s*(?:employees|people|engineers|staff)|10,000\+|small\s+team|solo|bootstrapped)\b/i
const URGENCY_WORDS = /\b(?:asap|urgent(?:ly)?|immediately|right\s+now|this\s+week|deadline|time-sensitive)\b/i
const MONEY_LINE = /(?:[$€£]\s?\d[\d,.]*\s*(?:k|m|million|thousand)?|\b\d[\d,.]*\s*(?:k|m)?\s*(?:usd|eur|gbp|dollars)\b)/i
const BUDGET_WORD = /\b(?:budget(?:ed)?|funded|allocated|fixed\s+price|project\s+value|rate\s+card|retainer)\b/i
const REQUEST_WORDS = /\b(?:looking\s+for|seeking|need(?:s|ed)?|hire|hiring|bring\s+us|request|rfp|proposal|quote)\b/i
const THIRD_PARTY = /\b(?:our\s+(?:customers?|clients?|users?)|customers?\s+(?:are|need|want|ask)|clients?\s+(?:are|need|want|ask)|an?\s+(?:auditor|regulator|investor|customer|client)\s+asked|companies\s+need|teams\s+need|via\s+@|reposted|shared\s+from)\b/i

export function readSourceFacts(rawText: string, options: ReadSourceFactsOptions = {}): SourceFacts {
  const text = rawText ?? ''
  const lines = sourceLines(text)
  const header = lines.slice(0, 8)
  const buyer = readBuyerSourceFacts(text)
  const signals = extractSignals(text)
  const org = resolveCurrentOrgContext(text)
  const split = splitCurrentAndPastLines(text)
  const pastSet = new Set(split.pastLines)
  const seller = detectSellerOwnership(text)
  const sellerSet = new Set(seller.lines)
  const access = parseAccessSignals(text)
  const contact = findContactInstruction(text)
  const segment = analyzeCustomerSegment(text)
  const rejected: RejectedSignal[] = []

  const name = options.identity?.name ?? signals.person.name ?? null
  const title = options.identity?.title ?? signals.person.title ?? null
  const company = options.identity?.company ?? null
  const location = options.identity?.location ?? null

  // ── Historical industries + rejected industry candidates ──────────────
  const historicalIndustries = new Set<string>()
  for (const line of split.past) {
    for (const ind of INDUSTRY_TAXONOMY) {
      if (ind.pattern.test(line) && ind.name !== org.currentIndustry) {
        historicalIndustries.add(ind.name)
        rejected.push({
          signal: 'industry', value: ind.name, sourceLine: line, sourceSection: sectionOf(text, line),
          actor: 'prospect_past', organization: null, temporalClass: 'HISTORICAL',
          reason: 'historical role — industry belongs to a past employer, not the current organization',
        })
      }
    }
  }
  for (const line of split.current) {
    if (!/\b(?:for\s+example|e\.g\.|such\s+as|use\s+cases?|imagine|for\s+instance)\b/i.test(line)) continue
    for (const ind of INDUSTRY_TAXONOMY) {
      if (ind.pattern.test(line) && ind.name !== org.currentIndustry) {
        rejected.push({
          signal: 'industry', value: ind.name, sourceLine: line, sourceSection: sectionOf(text, line),
          actor: 'customer', organization: null, temporalClass: 'EVERGREEN',
          reason: 'use-case example — describes customers\' domain, not the prospect\'s industry',
        })
      }
    }
  }

  // ── Budget candidates the buyer reader did not keep ───────────────────
  lines.forEach((line) => {
    if (!(BUDGET_WORD.test(line) || MONEY_LINE.test(line))) return
    if (buyer.statedBudget && buyer.statedBudget.line === line) return
    if (!BUDGET_WORD.test(line) && !/\b(?:budget|price|cost|rate|pay|spend|fee)\b/i.test(line)) return
    const check = verifyBudgetProvenance(line)
    const amount = line.match(MONEY_LINE)?.[0] ?? null
    let reason = check.valid ? null : check.reason
    if (sellerSet.has(line)) reason = 'seller-owned pricing — the prospect\'s own rate or offer, not a buyer budget'
    else if (pastSet.has(line)) reason = 'historical — stated in a past role'
    else if (THIRD_PARTY.test(line)) reason = 'third-party — a customer\'s or example figure, not the prospect\'s budget'
    else if (!reason && !buyer.externalServiceRequest) reason = 'no verified request to buy — a figure without a buyer request is not a budget'
    if (!reason) return
    rejected.push({
      signal: 'budget', value: amount, sourceLine: line, sourceSection: sectionOf(text, line),
      actor: pastSet.has(line) ? 'prospect_past' : THIRD_PARTY.test(line) ? 'third_party' : 'prospect',
      organization: null, temporalClass: check.temporalClass, reason,
    })
  })

  // ── Hiring candidates the buyer reader did not keep ───────────────────
  lines.forEach((line) => {
    if (buyer.employmentHiring?.line === line) return
    const kind = classifyLine(line)
    const looksHiring = kind === 'employment_hiring' || /\b(?:hiring|hired\s+\d+|open\s+roles?|join\s+our\s+team|we(?:'|’)?re\s+growing\s+the\s+team|grew\s+(?:the\s+)?team|built\s+(?:the\s+|an?\s+)?(?:engineering\s+)?team)\b/i.test(line)
    if (!looksHiring) return
    const check = verifyHiringProvenance(line)
    let reason: string | null = null
    if (kind === 'service_offering') reason = 'service offering — "if you\'re hiring, contact me" is the prospect selling, not hiring'
    else if (kind === 'seller_offering' || sellerSet.has(line)) reason = 'seller-owned — describes the prospect\'s offer, not an opening'
    else if (kind === 'job_seeking') reason = 'candidate seeking — the prospect wants a role, the organization is not hiring'
    else if (kind === 'recruiter' || buyer.recruiter) reason = 'recruiter — hiring for clients, not the prospect\'s own organization'
    else if (pastSet.has(line) || isHistoricalYear(line) || classifyTemporalProvenance(line) === 'HISTORICAL') reason = 'historical hiring — a past role or past event'
    else if (THIRD_PARTY.test(line)) reason = 'third-party — someone else\'s hiring (customers, reposts, market commentary)'
    else if (!check.valid) reason = check.reason
    else if (/\b(?:if\s+you(?:'|’)?re|companies|teams|anyone)\b/i.test(line)) reason = 'generic or hypothetical hiring remark, not the prospect\'s opening'
    if (!reason) return
    rejected.push({
      signal: 'hiring', value: line.slice(0, 80), sourceLine: line, sourceSection: sectionOf(text, line),
      actor: pastSet.has(line) ? 'prospect_past' : THIRD_PARTY.test(line) ? 'third_party' : 'prospect',
      organization: null, temporalClass: check.temporalClass, reason,
    })
  })

  // ── Buyer-request candidates that were not credited ───────────────────
  lines.forEach((line) => {
    if (buyer.externalServiceRequest?.line === line) return
    const kind = classifyLine(line)
    const requestWording = REQUEST_WORDS.test(line) && /\b(?:agenc(?:y|ies)|vendor|contractor|freelancer|developer|team|partner|workflow|help)\b/i.test(line)
    if (!requestWording) return
    let reason: string | null = null
    if (kind === 'seller_offering' || kind === 'service_offering' || sellerSet.has(line)) reason = 'seller-owned offer — the prospect is offering, not asking'
    else if (kind === 'customer_discovery') reason = 'customer discovery — asking for feedback, not for a vendor'
    else if (kind === 'job_seeking') reason = 'candidate seeking — looking for a role, not a provider'
    else if (kind === 'recruiter' || (buyer.recruiter && kind !== 'external_request')) reason = 'recruiter intermediary — sourcing for clients, not buying services'
    else if (pastSet.has(line) || isHistoricalYear(line) || classifyTemporalProvenance(line) === 'HISTORICAL') reason = 'historical — a past search, not a current request'
    else if (/\b(?:thinking\s+about|considering|might|could|would\s+love\s+to|hope\s+to|someday|eventually|if\s+(?:we|i)\s+(?:ever|could))\b/i.test(line)) reason = 'hypothetical — not a current request'
    else if (THIRD_PARTY.test(line)) reason = 'third-party need — customers, market or a repost, not the prospect\'s organization'
    else if (kind === 'employment_hiring') reason = 'employee hiring — recruiting staff is not buying outside services'
    else if (kind === 'neutral' && /\b(?:partnership|partners|collaborat)\b/i.test(line) && !/\b(?:development|engineering|technical|technology)\s+partners?\b/i.test(line)) reason = 'partnership outreach — not a request to buy services'
    else if (kind === 'neutral') reason = 'no prospect-owned request grammar — wording does not state that this organization wants to buy'
    if (!reason) return
    rejected.push({
      signal: 'buyer_request', value: line.slice(0, 80), sourceLine: line, sourceSection: sectionOf(text, line),
      actor: pastSet.has(line) ? 'prospect_past' : THIRD_PARTY.test(line) ? 'third_party' : 'prospect',
      organization: null, temporalClass: classifyTemporalProvenance(line), reason,
    })
  })

  // ── Launch / product activity ─────────────────────────────────────────
  let historicalProductActivity = false
  lines.forEach((line) => {
    if (!LAUNCH_WORDS.test(line)) return
    const historical = pastSet.has(line) || isHistoricalYear(line) || classifyTemporalProvenance(line) === 'HISTORICAL'
    if (historical) {
      historicalProductActivity = true
      rejected.push({
        signal: 'launch', value: line.slice(0, 80), sourceLine: line, sourceSection: sectionOf(text, line),
        actor: 'prospect_past', organization: null, temporalClass: 'HISTORICAL',
        reason: 'historical launch — supports experience, not current activity',
      })
    }
  })

  // ── Company size vs customer segment ──────────────────────────────────
  lines.forEach((line) => {
    if (!SIZE_WORDS.test(line)) return
    if (/\benterprise\s+(?:buyers|customers|clients|businesses|companies)\b|\b(?:target\s+(?:market|audience)|our\s+(?:customers|clients|buyers)\s+(?:are|include))\b/i.test(line)) {
      rejected.push({
        signal: 'company_size', value: line.match(SIZE_WORDS)?.[0] ?? null, sourceLine: line, sourceSection: sectionOf(text, line),
        actor: 'customer', organization: null, temporalClass: 'EVERGREEN',
        reason: 'target customer segment — describes who they sell to, not how large they are',
      })
    }
  })

  // ── Urgency without a buyer request ───────────────────────────────────
  lines.forEach((line) => {
    if (!URGENCY_WORDS.test(line)) return
    if (buyer.externalServiceRequest?.line === line) return
    if (buyer.employmentHiring?.line === line) return
    rejected.push({
      signal: 'urgency', value: line.match(URGENCY_WORDS)?.[0] ?? null, sourceLine: line, sourceSection: sectionOf(text, line),
      actor: sellerSet.has(line) ? 'prospect' : THIRD_PARTY.test(line) ? 'third_party' : 'prospect',
      organization: null, temporalClass: classifyTemporalProvenance(line),
      reason: sellerSet.has(line)
        ? 'seller urgency — a pitch deadline, not a buyer deadline'
        : 'urgency not tied to a verified buyer request — recent or urgent wording is not buyer timing',
    })
  })

  // ── Funding ───────────────────────────────────────────────────────────
  const fundingLine = detectFunding(text)
  let fundingEvidence: string | null = null
  if (fundingLine) {
    if (pastSet.has(fundingLine) || isHistoricalYear(fundingLine) || /\b(?:previously|back\s+in|years?\s+ago)\b/i.test(fundingLine)) {
      rejected.push({
        signal: 'funding', value: fundingLine.slice(0, 80), sourceLine: fundingLine, sourceSection: sectionOf(text, fundingLine),
        actor: 'prospect_past', organization: null, temporalClass: 'HISTORICAL',
        reason: 'historical funding — a past round is not current company maturity evidence',
      })
    } else if (THIRD_PARTY.test(fundingLine)) {
      rejected.push({
        signal: 'funding', value: fundingLine.slice(0, 80), sourceLine: fundingLine, sourceSection: sectionOf(text, fundingLine),
        actor: 'third_party', organization: null, temporalClass: classifyTemporalProvenance(fundingLine),
        reason: 'third-party funding — a customer\'s or portfolio company\'s round',
      })
    } else {
      fundingEvidence = fundingLine
    }
  }

  // ── Access ────────────────────────────────────────────────────────────
  const profileUrl = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?|linkedin\.com\/in\/[\w%-]+/i)?.[0] ?? null
  // A stated invitation to write counts as a message route in any source
  // language: "DM me", "message me", "gerne per Nachricht melden",
  // "schreibt mir", "écrivez-moi".
  const MESSAGE_INVITATION = /\b(?:dm|message|msg)\s+me\b|\bper\s+(?:nachricht|dm|pn)\b|\bnachricht\s+(?:an\s+mich|schicken|senden|schreiben)\b|\bschreib(?:t|en)?\s+mir\b|\bmeldet?\s+euch\b|\bgerne\s+(?:per\s+)?(?:nachricht|dm)\b|\b[ée]crivez-moi\b|\benvoyez-moi\s+un\s+message\b/iu
  const canMessage = access.canMessage || /\bmessage\b/i.test(header.join('\n')) || MESSAGE_INVITATION.test(text)
  const accessFacts: AccessFacts = {
    connectionDegree: access.connectionDegree,
    canMessage,
    canConnect: /\bconnect\b/i.test(header.join('\n')) || access.connectionDegree === '2nd' || access.connectionDegree === '3rd' || access.connectionDegree === 'unknown',
    mutualConnections: access.mutualConnections,
    directContactAvailable: Boolean(contact) || signals.access.hasEmail,
    contactLine: contact?.line ?? null,
    profileUrl,
    hasEmail: signals.access.hasEmail,
  }

  // ── Timing / activity ─────────────────────────────────────────────────
  const recentPostAgeDays = mostRecentPostAgeDays(text)
  const timelineCandidate = extractStatedTimeline(text)
  const timelineEvidence = buyer.externalServiceRequest
    && timelineCandidate
    && !sellerSet.has(timelineCandidate.line)
    && !THIRD_PARTY.test(timelineCandidate.line)
    ? timelineCandidate
    : null
  const dateCandidates = extractExplicitDates(text)
  const explicitDates = buyer.externalServiceRequest
    ? dateCandidates
    : { ...dateCandidates, buyerStartDate: null, deadline: null, durationDays: null }

  // ── Authority ─────────────────────────────────────────────────────────
  const authorityEvidence = resolveAuthority(title, [...header, ...(options.affiliationRoles ?? [])])

  // ── Capabilities ──────────────────────────────────────────────────────
  const requestLines = [buyer.externalServiceRequest?.line, buyer.helpRequest?.line, buyer.employmentHiring?.line].filter((l): l is string => Boolean(l))
  const capabilityNeeds = capabilityTermsIn(requestLines.join('\n'))
  const proofCandidates = [...new Set([
    ...capabilityTermsIn(split.current.join('\n')),
    ...signals.technology.domains,
    ...(org.currentIndustry ? [org.currentIndustry.toLowerCase()] : []),
  ])]

  // ── Completeness ──────────────────────────────────────────────────────
  const bodyLength = lines.slice(header.length).join(' ').length
  const checks: Array<[string, boolean]> = [
    ['name', Boolean(name)],
    ['title', Boolean(title)],
    ['company', Boolean(company || org.currentIndustryLine)],
    ['about_or_posts', bodyLength >= 200],
    ['dated_activity', recentPostAgeDays !== null],
    ['contact_or_url', Boolean(profileUrl || contact)],
  ]
  const presentFields = checks.filter(([, ok]) => ok).map(([f]) => f)
  const missingFields = checks.filter(([, ok]) => !ok).map(([f]) => f)

  const currentOrganizations = [...new Set([
    ...(options.currentOrganizations ?? []),
    ...(company ? [company] : []),
  ])]

  return {
    version: SOURCE_FACTS_VERSION,
    sourceLanguage: detectSourceLanguage(text),
    person: { name, title },
    currentRole: title ? title.split(TITLE_SEP)[0]?.trim() || title : null,
    currentCompany: company,
    currentOrganizations,
    currentIndustry: org.currentIndustry,
    currentIndustryLine: org.currentIndustryLine,
    historicalIndustries: [...historicalIndustries],
    targetCustomerSegment: segment.targetCustomerSegment,
    companySizeEvidence: segment.companySizeEvidence,
    companySizeCategory: signals.company.sizeCategory,
    access: accessFacts,
    location,
    recentPostAgeDays,
    activityRecency: activityRecencyFromDays(recentPostAgeDays),
    currentProductActivity: org.currentProductActivity,
    historicalProductActivity,
    currentHiringActivity: buyer.employmentHiring?.line ?? null,
    hiringUrgent: buyer.hiringUrgent,
    hiringCount: signals.company.hiringCount,
    candidateSeeking: buyer.candidateSeeking,
    serviceOffering: seller.lines,
    sellerActivity: seller.isSeller,
    recruiterProfile: buyer.recruiter || isRecruiterProfile(text),
    buyerRequest: buyer.externalServiceRequest?.line ?? null,
    buyerRequestAgeDays: postAgeDaysForLine(text, buyer.externalServiceRequest?.line ?? null),
    helpRequest: buyer.helpRequest?.line ?? null,
    externalNeed: buyer.externalServiceRequest !== null,
    budgetEvidence: buyer.statedBudget,
    timelineEvidence,
    explicitDates,
    terminalState: buyer.terminalState ?? null,
    authorityEvidence,
    technologyContext: signals.technology,
    capabilityNeeds,
    proofCandidates,
    fundingEvidence,
    founderOrBuilder: buyer.founderOrBuilder,
    sourceCompleteness: {
      score: Math.round((presentFields.length / checks.length) * 100),
      presentFields,
      missingFields,
    },
    rejectedSignals: dedupeRejected(rejected),
    buyer,
    signals,
    pastRoleLines: split.pastLines,
  }
}

function dedupeRejected(items: RejectedSignal[]): RejectedSignal[] {
  const seen = new Set<string>()
  return items.filter((r) => {
    const key = `${r.signal}|${r.sourceLine}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Serializable form of `SourceFacts` stored on the decision packet.
 *
 * It is the full fact set (bounded only by capping `rejectedSignals`), so every
 * downstream layer — scoring, features, routing, messaging — consumes this
 * object and never re-reads the raw source.
 */
export type SourceFactsSummary = SourceFacts & {
  /** Flat aliases for the authority fields, kept for existing consumers. */
  authority: AuthorityLevel
  decisionAuthority: number
}

export function summarizeSourceFacts(f: SourceFacts): SourceFactsSummary {
  return {
    ...f,
    authority: f.authorityEvidence.level,
    decisionAuthority: f.authorityEvidence.decisionAuthority,
    rejectedSignals: f.rejectedSignals.slice(0, 40),
  }
}
