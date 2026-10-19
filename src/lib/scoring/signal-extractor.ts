/**
 * Deterministic Signal Extraction Engine.
 *
 * Extracts structured signals from raw lead text WITHOUT AI calls.
 * This is Layer 1 of the composite scoring architecture — pure parsing,
 * zero cost, instant results.
 *
 * Signals extracted:
 *   - Company: size, industry, funding, growth stage
 *   - Person: seniority, decision authority, role type
 *   - Intent: hiring, launching, asking, job posts, urgency
 *   - Technology: frameworks, platforms, stack
 *   - Timing: recency, urgency indicators
 *   - Access: connection degree, mutual signals
 */

import { detectCommercialRequest } from '@/lib/intelligence-v3/source-facts'
import { detectFunding, parseHiringCount } from '@/lib/evidence/provenance'
import { verifyBudgetProvenance, verifyHiringProvenance, classifyTemporalProvenance, isHistoricalYear } from '@/lib/scoring/signal-attribution'

export interface ExtractedSignals {
  company: CompanySignals
  person: PersonSignals
  intent: IntentSignals
  technology: TechnologySignals
  timing: TimingSignals
  access: AccessSignals
}

export interface CompanySignals {
  name: string | null
  domain: string | null
  sizeCategory: 'startup' | 'small' | 'mid' | 'enterprise' | 'unknown'
  sizeHints: string[]
  industry: string | null
  fundingMentioned: boolean
  fundingStage: string | null
  growthSignals: string[]
  hasPhysicalProduct: boolean
  isHiring: boolean
  /**
   * Number of open roles the source explicitly states ("hiring 3
   * developers", "10 open roles"); 0 when no count is stated. Never derived
   * from how often hiring words appear.
   */
  hiringCount: number
  /** The source line stating the count, when there is one. */
  hiringCountQuote: string | null
}

export interface PersonSignals {
  name: string | null
  title: string | null
  seniority: 'executive' | 'senior' | 'mid' | 'junior' | 'unknown'
  isDecisionMaker: boolean
  isTechnical: boolean
  isRecruiter: boolean
  isFounder: boolean
  tenureMonths: number | null
  connectionDegree: '1st' | '2nd' | '3rd' | 'unknown'
  connectionCount: number | null
}

export interface IntentSignals {
  explicitAsk: boolean
  askingForHelp: boolean
  hiring: boolean
  hiringUrgency: 'immediate' | 'planned' | 'none'
  launching: boolean
  launchedProduct: string | null
  jobPosting: boolean
  seekingVendor: boolean
  budgetMentioned: boolean
  urgencyWords: string[]
  intentStrength: 'strong' | 'moderate' | 'weak' | 'none'
}

export interface TechnologySignals {
  languages: string[]
  frameworks: string[]
  platforms: string[]
  domains: string[]
  hasAI: boolean
  hasWeb: boolean
  hasMobile: boolean
  hasCloud: boolean
  hasDevOps: boolean
  stackComplexity: 'simple' | 'moderate' | 'complex'
}

export interface TimingSignals {
  mostRecentPostDays: number | null
  hasRecentActivity: boolean  // < 7 days
  hasUrgencyWords: boolean
  budgetCycleMentioned: boolean
  timelineMentioned: string | null
  recency: 'fresh' | 'recent' | 'stale' | 'unknown'
}

export interface AccessSignals {
  isFirstDegree: boolean
  mutualConnections: number | null
  canMessage: boolean
  hasEmail: boolean
  hasLinkedIn: boolean
  profileComplete: boolean
}


const SENIORITY_PATTERNS: Array<{ pattern: RegExp; level: PersonSignals['seniority'] }> = [
  { pattern: /\b(ceo|cto|cfo|coo|chief|founder|president|partner|managing director)\b/i, level: 'executive' },
  { pattern: /\b(vp|vice president|head of|director|principal|staff|senior lead)\b/i, level: 'senior' },
  { pattern: /\b(senior|sr\.?|lead|staff|principal)\b/i, level: 'senior' },
  { pattern: /\b(mid|intermediate|engineer|developer|manager|specialist)\b/i, level: 'mid' },
  { pattern: /\b(junior|jr\.?|entry|intern|associate|graduate)\b/i, level: 'junior' },
]

const DECISION_MAKER_TITLES = /\b(ceo|cto|cfo|coo|chief|founder|owner|president|vp|vice president|head of|director|partner|managing director)\b/i
const TECHNICAL_TITLES = /\b(engineer|developer|architect|programmer|technologist|engineering|technical|devops|sre|data scientist|ml engineer|ai engineer)\b/i
const RECRUITER_TITLES = /\b(recruiter|talent|acquisition|sourcing|hiring|people ops|hr)\b/i
const FOUNDER_TITLES = /\b(founder|co-founder|cofounder)\b/i

const HIRING_PATTERNS = [
  /\b(hiring|recruiting|looking for|seeking|open to hire|joining our team|we're hiring|we are hiring)\b/i,
  /\b(open position|job opening|role to fill|need a|searching for)\b/i,
]

const HIRING_URGENCY = [
  /\b(immediately|asap|urgent|right now|this week|starting now|ramping up)\b/i,
  /\b(this quarter|next quarter|this month|coming weeks|soon)\b/i,
]

const GROWTH_PATTERNS = [
  /\b(growing|scaling|expanding|rapidly growing|hiring across|multiple openings|new office|launched)\b/i,
  /\b(series [abc]|funded|backed|accelerator|incubator|y combinator)\b/i,
]

const URGENCY_WORDS = [
  'asap', 'urgent', 'immediately', 'right now', 'this week', 'deadline',
  'time-sensitive', 'pressing', 'critical', 'priority', 'ramp up', 'ramping',
]

const TECH_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'go', 'golang', 'rust', 'c\\+\\+',
  'c#', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab',
]

const TECH_FRAMEWORKS = [
  'react', 'next\\.js', 'nextjs', 'vue', 'angular', 'svelte', 'node\\.js', 'nodejs',
  'express', 'django', 'flask', 'fastapi', 'spring', 'rails', 'laravel',
  'tensorflow', 'pytorch', 'langchain', 'llamaindex',
]

const TECH_PLATFORMS = [
  'aws', 'azure', 'gcp', 'google cloud', 'heroku', 'vercel', 'netlify',
  'docker', 'kubernetes', 'terraform', 'postgresql', 'mysql', 'mongodb',
  'redis', 'elasticsearch', 'kafka', 'rabbitmq',
]

const TECH_DOMAINS = [
  'ai', 'machine learning', 'ml', 'deep learning', 'nlp', 'computer vision',
  'blockchain', 'web3', 'crypto', 'iot', 'embedded', 'cybersecurity',
  'data science', 'analytics', 'devops', 'cloud', 'mobile', 'frontend', 'backend',
]

const ASK_PATTERNS = [
  /\b(help me|looking for help|need advice|anyone know|recommendation|suggest)\b/i,
  /\b(looking for a|seeking a|need a|want to hire|searching for a)\b/i,
]

const LAUNCH_PATTERNS = [
  /\b(launched|launching|just released|new product|product hunt|show hn|built|shipped)\b/i,
  /\b(introducing|announcing|unveiling|beta|early access|waitlist)\b/i,
]

const BUDGET_PATTERNS = [
  /\b(budget|rate|hourly|fixed price|project budget|contract|engagement)\b/i,
  /\b(\$[\d,]+|\d+k|\d+ per hour|monthly retainer)\b/i,
]


export function extractSignals(rawText: string): ExtractedSignals {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
  const lower = rawText.toLowerCase()

  return {
    company: extractCompanySignals(rawText, lines, lower),
    person: extractPersonSignals(rawText, lines, lower),
    intent: extractIntentSignals(rawText, lower),
    technology: extractTechnologySignals(lower),
    timing: extractTimingSignals(rawText, lower),
    access: extractAccessSignals(rawText, lower),
  }
}


function extractCompanySignals(text: string, lines: string[], lower: string): CompanySignals {
  const firstLine = lines[0] || ''
  const nameFromHeader = firstLine.split(/\s*[·|\-–]\s+/)[0].trim()

  const domainMatch = text.match(/\b([a-z0-9-]+\.(com|io|ai|co|dev|app|tech|studio|labs))\b/i)
  const domain = domainMatch ? domainMatch[1] : null

  const sizeHints: string[] = []
  let sizeCategory: CompanySignals['sizeCategory'] = 'unknown'

  // Customer segment vs company size: "Enterprise buyers" is NOT company size
  const sizePatterns: Array<{ pattern: RegExp; category: CompanySignals['sizeCategory']; hint: string }> = [
    { pattern: /\b(10,000\+?|fortune\s+500|global\s+team\s+of\s+\d{3,})\b/i, category: 'enterprise', hint: 'Enterprise size' },
    { pattern: /\b(500-999|200-499|100-199|50-99)\b/i, category: 'mid', hint: 'Mid-size company' },
    { pattern: /\b(10-49|20-50|small\s+team|boutique)\b/i, category: 'small', hint: 'Small company' },
    { pattern: /\b(1-9|just\s+me|solo|bootstrapped|early\s+stage|pre[- ]seed|stealth)\b/i, category: 'startup', hint: 'Startup' },
  ]
  for (const line of lines) {
    // Skip lines where "enterprise" refers to customer segment, not company size
    if (/\benterprise\s+(?:buyers|customers|clients|businesses|companies)\b/i.test(line)) {
      continue
    }
    // Skip lines where size refers to target market
    if (/\b(?:target\s+(?:market|audience)|our\s+(?:customers|clients|buyers)\s+(?:are|include))\b/i.test(line)) {
      continue
    }
    for (const sp of sizePatterns) {
      if (sp.pattern.test(line)) {
        sizeCategory = sp.category
        sizeHints.push(sp.hint)
        break
      }
    }
    if (sizeCategory !== 'unknown') break
  }

  // A funding EVENT, not vocabulary like "million users" or "venture into".
  const fundingMentioned = detectFunding(text) !== null
  const fundingStage = extractFundingStage(text)
  // BUG-07: extract the actual matched words, not the regex source string
  // (RegExp.source leaks raw regex like /\b(growing|scaling)\b/i into the UI).
  const hiringCount = parseHiringCount(text)
  const growthSignals = GROWTH_PATTERNS.flatMap((p) => {
    const m = text.match(p)
    return m ? [m[0]] : []
  }).filter(Boolean)

  return {
    name: nameFromHeader || null,
    domain,
    sizeCategory,
    sizeHints,
    industry: extractIndustry(text),
    fundingMentioned,
    fundingStage,
    growthSignals,
    hasPhysicalProduct: /\b(product|platform|app|saas|software|tool|service)\b/i.test(text),
    isHiring: HIRING_PATTERNS.some((p) => p.test(text)),
    hiringCount: hiringCount?.value ?? 0,
    hiringCountQuote: hiringCount?.sourceQuote ?? null,
  }
}

function extractFundingStage(text: string): string | null {
  if (/\b(series [abc]|series [def])\b/i.test(text)) return 'growth'
  if ((/\b(seed|angel|pre-seed)\b/i.test(text))) return 'early'
  if ((/\b(ipo|public|acquired|acquisition)\b/i.test(text))) return 'exit'
  return null
}

function extractIndustry(text: string): string | null {
  const textLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const industries: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\b(healthcare|health|medical|pharma|biotech|clinical)\b/i, name: 'healthcare' },
    { pattern: /\b(fintech|finance|banking|insurance|payments|trading)\b/i, name: 'fintech' },
    { pattern: /\b(cybersecurity|security|infosec)\b/i, name: 'cybersecurity' },
    { pattern: /\b(edtech|education|e-learning|training)\b/i, name: 'edtech' },
    { pattern: /\b(logistics|supply chain|shipping|freight|transportation)\b/i, name: 'logistics' },
    { pattern: /\b(ecommerce|e-commerce|retail|dtc|shopify)\b/i, name: 'ecommerce' },
    { pattern: /\b(real estate|proptech|construction)\b/i, name: 'proptech' },
    { pattern: /\b(media|entertainment|gaming|streaming)\b/i, name: 'media' },
  ]

  // Find the first industry match that belongs to the current organization
  // (not a use-case example from another domain)
  for (const line of textLines) {
    const normalized = line.toLowerCase()
    // Skip lines that are clearly use-case examples
    if (/\b(?:for\s+example|such\s+as|like\s+how|use\s+case|helps?\s+(?:with|for)|imagine|consider)\b/i.test(normalized)) {
      continue
    }
    // Prefer lines with ownership markers
    const hasOwnership = /\b(?:we\s+(?:are|build|offer|provide|work\s+with)|our\s+(?:company|startup|platform|agency|firm))\b/i.test(normalized)
      || /\b(?:co[- ]?founder|ceo|cto|cfo|vp|director)\s+(?:of|at)\b/i.test(normalized)

    for (const ind of industries) {
      if (ind.pattern.test(line)) {
        if (hasOwnership) return ind.name
      }
    }
  }

  // Fallback: return first match if no ownership-scoped match found
  for (const ind of industries) {
    if (ind.pattern.test(text)) return ind.name
  }
  return null
}



function extractPersonSignals(text: string, lines: string[], lower: string): PersonSignals {
  const firstLine = lines[0] || ''
  const nameParts = firstLine.split(/\s*[·|\-–]\s+/)[0].trim().split(' ')
  const name = nameParts.length >= 2 && nameParts.length <= 4 ? nameParts.join(' ') : null

  const titleLine = lines.find((l) => /·|\-–/.test(l) && !l.startsWith('http')) || ''
  const title = titleLine.split(/·|\-–/).pop()?.trim() || null

  let seniority: PersonSignals['seniority'] = 'unknown'
  for (const sp of SENIORITY_PATTERNS) {
    if (sp.pattern.test(lower)) {
      seniority = sp.level
      break
    }
  }

  const connectionMatch = text.match(/(\d+)\s*connections/i)
  const connectionCount = connectionMatch ? parseInt(connectionMatch[1]) : null

  const degreeMatch = text.match(/·\s*(1st|2nd|3rd)\b/i)
  const connectionDegree = (degreeMatch ? degreeMatch[1].toLowerCase() : 'unknown') as PersonSignals['connectionDegree']

  return {
    name,
    title,
    seniority,
    isDecisionMaker: DECISION_MAKER_TITLES.test(lower),
    isTechnical: TECHNICAL_TITLES.test(lower),
    isRecruiter: RECRUITER_TITLES.test(lower),
    isFounder: FOUNDER_TITLES.test(lower),
    tenureMonths: extractTenure(text),
    connectionDegree,
    connectionCount,
  }
}

function extractTenure(text: string): number | null {
  const yearMatch = text.match(/(\d{4})\s*[-–]\s*(present|now|current)/i)
  if (yearMatch) {
    const startYear = parseInt(yearMatch[1])
    return (new Date().getFullYear() - startYear) * 12
  }
  const monthMatch = text.match(/(\d+)\s*months?\s*(at|with)/i)
  if (monthMatch) return parseInt(monthMatch[1])
  return null
}


function extractIntentSignals(text: string, lower: string): IntentSignals {
  const explicitAsk = ASK_PATTERNS.some((p) => p.test(text))
  const askingForHelp = /\b(help me|need\s+\w*\s*help|anyone who knows|recommendation|advice on)\b/i.test(text)
  const commercial = detectCommercialRequest(text)
  // "Looking for an agency" is a vendor search, not hiring. Generic
  // looking-for wording only counts as hiring when no external provider is
  // being sought and nothing else says employment.
  // Hiring provenance: verify current, not historical/background
  const rawHiringMatch = commercial.employmentHiring !== null
    || (commercial.externalServiceRequest === null && HIRING_PATTERNS.some((p) => p.test(text)))
  const textLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const hiring = rawHiringMatch && textLines.some(line => {
    if (!HIRING_PATTERNS.some(p => p.test(line)) && !commercial.employmentHiring) return false
    const check = verifyHiringProvenance(line)
    return check.valid
  })

  let hiringUrgency: IntentSignals['hiringUrgency'] = 'none'
  if (HIRING_URGENCY[0].test(text)) hiringUrgency = 'immediate'
  else if (HIRING_URGENCY[1].test(text)) hiringUrgency = 'planned'

  // Temporal guard: check if launch signals are current
  const launchMatches = LAUNCH_PATTERNS.flatMap((p) => {
    const m = text.match(p)
    return m ? [m[0]] : []
  }).filter(Boolean)
  const launching = launchMatches.length > 0 && launchMatches.some(quote => {
    const temporal = classifyTemporalProvenance(quote)
    return temporal !== 'HISTORICAL' && !isHistoricalYear(quote)
  })
  const launchedProduct = extractProductName(text)

  const jobPosting = /\b(job|role|position|hiring for|apply now|we're hiring)\b/i.test(text)
  const seekingVendor = commercial.externalServiceRequest !== null
    || (!hiring && /\b(looking for a|seeking a|need a vendor|need a partner|need a dev)\b/i.test(text))
  // Budget provenance: verify current, not historical/example
  const rawBudgetMatch = BUDGET_PATTERNS.some((p) => p.test(text))
  const budgetMentioned = rawBudgetMatch && textLines.some(line => {
    if (!BUDGET_PATTERNS.some(p => p.test(line))) return false
    const check = verifyBudgetProvenance(line)
    return check.valid
  })

  const urgencyWords = URGENCY_WORDS.filter((w) => lower.includes(w))

  let intentStrength: IntentSignals['intentStrength'] = 'none'
  if (explicitAsk || (hiring && hiringUrgency === 'immediate') || seekingVendor) {
    intentStrength = 'strong'
  } else if (hiring || launching || jobPosting) {
    intentStrength = 'moderate'
  } else if (askingForHelp || budgetMentioned) {
    intentStrength = 'weak'
  }

  return {
    explicitAsk,
    askingForHelp,
    hiring,
    hiringUrgency,
    launching,
    launchedProduct,
    jobPosting,
    seekingVendor,
    budgetMentioned,
    urgencyWords,
    intentStrength,
  }
}

function extractProductName(text: string): string | null {
  const launchMatch = text.match(/(?:launched|introducing|just released|check out)\s+["']?([A-Z][A-Za-z0-9\s]{2,30})["']?/i)
  if (launchMatch) return launchMatch[1].trim()
  const productHuntMatch = text.match(/\b([A-Z][A-Za-z0-9]{2,20})\s*[|–-]\s*(product hunt|app|platform|tool)/i)
  if (productHuntMatch) return productHuntMatch[1].trim()
  return null
}


function extractTechnologySignals(lower: string): TechnologySignals {
  const languages = TECH_LANGUAGES.filter((l) => {
    const re = new RegExp(`\\b${l}\\b`, 'i')
    return re.test(lower)
  })
  const frameworks = TECH_FRAMEWORKS.filter((f) => {
    const re = new RegExp(`\\b${f}\\b`, 'i')
    return re.test(lower)
  })
  const platforms = TECH_PLATFORMS.filter((p) => {
    const re = new RegExp(`\\b${p}\\b`, 'i')
    return re.test(lower)
  })
  const domains = TECH_DOMAINS.filter((d) => {
    const re = new RegExp(`\\b${d}\\b`, 'i')
    return re.test(lower)
  })

  const totalTech = languages.length + frameworks.length + platforms.length
  let stackComplexity: TechnologySignals['stackComplexity'] = 'simple'
  if (totalTech >= 8) stackComplexity = 'complex'
  else if (totalTech >= 4) stackComplexity = 'moderate'

  return {
    languages,
    frameworks,
    platforms,
    domains,
    hasAI: /\b(ai|machine learning|ml|artificial intelligence|llm|gpt|neural)\b/i.test(lower),
    hasWeb: /\b(react|vue|angular|nextjs?|node|html|css|frontend|backend|full.?stack)\b/i.test(lower),
    hasMobile: /\b(ios|android|react native|flutter|mobile app|swift|kotlin)\b/i.test(lower),
    hasCloud: /\b(aws|azure|gcp|cloud|kubernetes|docker|devops|infrastructure)\b/i.test(lower),
    hasDevOps: /\b(devops|sre|ci\/cd|terraform|kubernetes|docker|infrastructure|deployment)\b/i.test(lower),
    stackComplexity,
  }
}


function extractTimingSignals(text: string, lower: string): TimingSignals {
  const hasUrgencyWords = URGENCY_WORDS.some((w) => lower.includes(w))
  const budgetCycleMentioned = /\b(q[1-4]|this quarter|next quarter|fiscal year|budget cycle|annual)\b/i.test(text)

  const timelineMatch = text.match(/\b(within|by|before)\s+(\d+\s*(days?|weeks?|months?)|q[1-4]|end of \w+)/i)
  const timelineMentioned = timelineMatch ? timelineMatch[0] : null

  // Estimate recency from post dates
  const recentMatch = text.match(/(\d+)\s*(h|hour|d|day|w|week)\s*ago/i)
  let mostRecentPostDays: number | null = null
  if (recentMatch) {
    const num = parseInt(recentMatch[1])
    const unit = recentMatch[2].toLowerCase()
    if (unit.startsWith('h')) mostRecentPostDays = 0
    else if (unit.startsWith('d')) mostRecentPostDays = num
    else if (unit.startsWith('w')) mostRecentPostDays = num * 7
  }

  let recency: TimingSignals['recency'] = 'unknown'
  if (mostRecentPostDays !== null) {
    if (mostRecentPostDays <= 1) recency = 'fresh'
    else if (mostRecentPostDays <= 7) recency = 'recent'
    else recency = 'stale'
  } else if (hasUrgencyWords) {
    recency = 'fresh'
  }

  return {
    mostRecentPostDays,
    hasRecentActivity: mostRecentPostDays !== null && mostRecentPostDays <= 7,
    hasUrgencyWords,
    budgetCycleMentioned,
    timelineMentioned,
    recency,
  }
}


function extractAccessSignals(text: string, lower: string): AccessSignals {
  const isFirstDegree = /\b1st\b/.test(text) || /·\s*1st/.test(text)
  const mutualMatch = text.match(/(\d+)\s*mutual/i)
  const namedMutualMatch = text.match(/(\w+(?:\s+)?\w+)\s*,\s*(\w+(?:\s+)?\w+)\s+and\s+(\d+)\s+other\s+mutual/i)
    ?? text.match(/(\w+(?:\s+)?\w+)\s+and\s+(\w+(?:\s+)?\w+)\s+and\s+(\d+)\s+other\s+mutual/i)
  const mutualConnections = namedMutualMatch
    ? 2 + parseInt(namedMutualMatch[3])
    : mutualMatch
      ? parseInt(mutualMatch[1])
      : null

  return {
    isFirstDegree,
    mutualConnections,
    canMessage: isFirstDegree || (mutualConnections !== null && mutualConnections > 0),
    hasEmail: /[\w.-]+@[\w.-]+\.\w+/.test(text),
    hasLinkedIn: /linkedin\.com\/in\//i.test(text),
    profileComplete: text.length > 200 && /\b(about|experience|skills|education)\b/i.test(text),
  }
}
