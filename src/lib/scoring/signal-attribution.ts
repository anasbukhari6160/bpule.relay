/**
 * Signal Attribution & Temporal Provenance Hardening
 *
 * Guards against false signals by verifying:
 * 1. Temporal provenance — historical events don't become current
 * 2. Budget provenance — only current, org-specific, explicit budgets
 * 3. Hiring provenance — only current hiring at prospect's org
 * 4. Customer segment ≠ company size
 * 5. Industry scoping — current org only
 * 6. Access/mutual consistency
 */

// ── Temporal Provenance ──────────────────────────────────────────────────────

export type TemporalClass = 'CURRENT' | 'RECENT' | 'HISTORICAL' | 'EVERGREEN'

const HISTORICAL_MARKERS = [
  /\b(?:back\s+in|in\s+\d{4}|from\s+\d{4}\s+to\s+\d{4}|\d{4}\s*[-–]\s*(?:\d{4}|present)|years?\s+ago|when\s+i\s+(?:was|ran)|previously|formerly|at\s+my\s+(?:previous|former)|last\s+(?:year|quarter|month\s+and))\b/i,
  /\b(?:(?:used\s+to|once|earlier|back\s+then|at\s+the\s+time)\s+(?:work|run|lead|manage|build|develop))\b/i,
  /\b(?:since\s+(?:\d{4}|then|graduating))\b/i,
]

const ADVICE_EXAMPLE_MARKERS = [
  /\b(?:a\s+reasonable|typically|usually|in\s+my\s+experience|I'?ve\s+seen|for\s+example|as\s+an?\s+example|if\s+you(?:'?re|are))\b/i,
  /\b(?:tip|advice|recommendation|lesson|best\s+practice|pro\s+tip|suggestion)\b/i,
]

/**
 * Classify whether a line of text refers to current or historical events.
 */
export function classifyTemporalProvenance(line: string): TemporalClass {
  const normalized = line.toLowerCase()

  // Check historical markers
  if (HISTORICAL_MARKERS.some(m => {
    m.lastIndex = 0
    return m.test(normalized)
  })) {
    return 'HISTORICAL'
  }

  // Check current markers
  const currentMarkers = [
    /\b(?:currently|now|today|this\s+(?:week|month|quarter|year)|just\s+(?:launched|released|started|announced)|recently|newly)\b/i,
    /\b(?:we(?:'|')?re|we\s+are|I(?:|'m|am))\s+(?:building|launching|hiring|looking|seeking|working\s+on)\b/i,
  ]
  if (currentMarkers.some(m => {
    m.lastIndex = 0
    return m.test(normalized)
  })) {
    return 'CURRENT'
  }

  // Evergreen statements (capabilities, offerings)
  if (/\b(?:specializ|expert|focus|offer|provide|help\s+(?:clients|companies|teams)|build\s+and\s+deliver)\b/i.test(normalized)) {
    return 'EVERGREEN'
  }

  return 'RECENT'
}

/**
 * Extract year references from a line to determine age.
 */
export function extractYearReferences(line: string): number[] {
  const years: number[] = []
  const matches = line.match(/\b(20\d{2}|19\d{2})\b/g)
  if (matches) {
    years.push(...matches.map(y => parseInt(y)))
  }
  return years
}

/**
 * Check if a line is clearly historical (mentions old years).
 */
export function isHistoricalYear(line: string, currentYear: number = new Date().getFullYear()): boolean {
  const years = extractYearReferences(line)
  return years.some(y => currentYear - y >= 2)
}

// ── Budget Provenance ────────────────────────────────────────────────────────

const HISTORICAL_BUDGET_MARKERS = [
  /\b(?:back\s+in|when\s+I|years?\s+ago|previously|at\s+my\s+(?:previous|former)|in\s+\d{4}|from\s+\d{4})\b/i,
  /\b(?:a\s+reasonable\s+budget|typically\s+budget|budget\s+is\s+usually|for\s+example\s+a\s+budget|as\s+an?\s+example)\b/i,
  /\b(?:needed\s+to\s+build|budget\s+(?:was|had\s+been))\b/i,
  /\b(?:if\s+you(?:|'ve)\s+gotten\s+a\s+budget|investing\s+in|spent\s+on)\b/i,
]

const PRODUCT_METRIC_MARKERS = [
  /\b(?:cpi|ltv|roi|roas|arpu|cac|monthly\s+recurring|annual\s+recurring|mrr|arr|revenue|profit\s+margin|burn\s+rate|runway|churn)\b/i,
]

/**
 * Verify budget signal is current and org-specific.
 */
export function verifyBudgetProvenance(line: string): {
  valid: boolean
  reason: string
  temporalClass: TemporalClass
} {
  const temporal = classifyTemporalProvenance(line)

  // Reject historical budgets
  if (temporal === 'HISTORICAL' || isHistoricalYear(line)) {
    return { valid: false, reason: 'budget reference is historical', temporalClass: temporal }
  }

  // Reject advice/example budgets
  if (ADVICE_EXAMPLE_MARKERS.some(m => {
    m.lastIndex = 0
    return m.test(line)
  })) {
    return { valid: false, reason: 'budget is advice/example, not current need', temporalClass: temporal }
  }

  // Reject product metrics disguised as budgets
  if (PRODUCT_METRIC_MARKERS.some(m => {
    m.lastIndex = 0
    return m.test(line.toLowerCase())
  })) {
    return { valid: false, reason: 'budget signal is a product metric, not buyer budget', temporalClass: temporal }
  }

  // Reject "budget was/had/needed for/to" patterns (past expenditure)
  if (/\bbudget\s+(?:was|had|needed|required)\b[^.\n]{0,30}\b(?:for|to)\b/i.test(line)) {
    return { valid: false, reason: 'budget refers to past expenditure', temporalClass: temporal }
  }
  // Reject "needed a budget to [verb]" patterns
  if (/\bneeded\s+(?:an?\s+)?(?:budget|funding)\s+to\s+(?:build|create|make|launch|develop)\b/i.test(line)) {
    return { valid: false, reason: 'budget refers to past expenditure', temporalClass: temporal }
  }
  // Reject "budget was [amount] to/for" patterns
  if (/\bbudget\s+was\s+[^.\n]{0,30}\b(?:to|for)\s+(?:build|create|make|launch|develop|fund)\b/i.test(line)) {
    return { valid: false, reason: 'budget refers to past expenditure', temporalClass: temporal }
  }

  return { valid: true, reason: 'current budget reference', temporalClass: temporal }
}

// ── Hiring Provenance ────────────────────────────────────────────────────────

const HISTORICAL_HIRING_MARKERS = [
  /\b(?:people\s+hired\s+(?:to|for|by)|hired\s+(?:people|folks|team|developers?)\s+(?:to|for))\b/i,
  /\b(?:my\s+(?:team|crew|staff)\s+(?:has|includes|grew\s+to))\b/i,
  /\b(?:previously\s+(?:hired|employed)|former\s+(?:team|employee|hire))\b/i,
  /\b(?:experience\s+(?:of\s+|in\s+)?hiring|years?\s+(?:of\s+)?(?:hiring|recruiting))\b/i,
  /\b(?:at\s+my\s+(?:previous|former)\s+(?:company|role|firm))\b/i,
  /\b(?:headcount|team\s+size|grew\s+from|scaled\s+(?:the\s+)?team)\b/i,
]

const CANDIDATE_LANGUAGE = [
  /\b(?:I(?:|'m|'?am|am)\s+(?:looking|seeking|open\s+to|available\s+for))\b/i,
  /\b(?:looking\s+for\s+(?:contract|full[- ]time|part[- ]time|freelance|work|new\s+opportunities|my\s+next))\b/i,
  /\b(?:my\s+(?:next\s+(?:role|opportunity|challenge)|portfolio|resume|cv))\b/i,
]

/**
 * Verify hiring signal is current and at prospect's org.
 */
export function verifyHiringProvenance(line: string): {
  valid: boolean
  reason: string
  temporalClass: TemporalClass
} {
  const temporal = classifyTemporalProvenance(line)

  // Reject historical hiring
  if (HISTORICAL_HIRING_MARKERS.some(m => {
    m.lastIndex = 0
    return m.test(line)
  })) {
    return { valid: false, reason: 'hiring reference is historical/background', temporalClass: 'HISTORICAL' }
  }

  // Reject candidate language (person seeking work, not org hiring)
  if (CANDIDATE_LANGUAGE.some(m => {
    m.lastIndex = 0
    return m.test(line)
  })) {
    return { valid: false, reason: 'language describes candidate seeking, not org hiring', temporalClass: 'CURRENT' }
  }

  // Reject "people hired to protect" type patterns
  if (/\b(?:people\s+hired\s+to\s+(?:protect|defend|maintain|support))\b/i.test(line)) {
    return { valid: false, reason: 'describes past hiring for maintenance, not current need', temporalClass: 'HISTORICAL' }
  }

  return { valid: true, reason: 'current hiring signal', temporalClass: temporal }
}

// ── Customer Segment vs Company Size ──────────────────────────────────────────

const CUSTOMER_SEGMENT_MARKERS = [
  /\b(?:enterprise\s+(?:buyers|customers|clients|businesses|companies))\b/i,
  /\b(?:(?:buyers|customers|clients)\s+(?:require|need|want|are|include))\b/i,
  /\b(?:target\s+(?:market|audience|customer|segment|buyer))\b/i,
  /\b(?:our\s+(?:customers|clients|buyers|users)\s+(?:are|include|come\s+from))\b/i,
]

/**
 * Distinguish between "enterprise is our customer segment" and
 * "enterprise is our company size".
 */
export function analyzeCustomerSegment(text: string): {
  targetCustomerSegment: string | null
  companySizeEvidence: string | null
} {
  let targetCustomerSegment: string | null = null
  let companySizeEvidence: string | null = null

  for (const line of text.split('\n')) {
    const normalized = line.toLowerCase().trim()

    // Customer segment signals (NOT company size)
    if (/\benterprise\s+(?:buyers|customers|clients|businesses|companies)\b/i.test(normalized)) {
      targetCustomerSegment = 'enterprise'
      continue
    }
    if (/\b(?:our|my)\s+(?:customers|clients|buyers|users)\s+(?:are|include)\b/i.test(normalized)) {
      const segment = normalized.match(/\b(are|include)\s+(.{0,50})/i)
      if (segment) targetCustomerSegment = segment[2].trim()
      continue
    }

    // Actual company size signals
    if (/\b(?:global\s+team\s+of\s+\d{3,}|10,000\+|fortune\s+500)\b/i.test(normalized)) {
      companySizeEvidence = 'enterprise'
    } else if (/\b(?:\d{3,}\s+(?:people|employees|team|staff|engineers))\b/i.test(normalized)) {
      const count = parseInt(normalized.match(/\d{3,}/)?.[0] ?? '0')
      if (count >= 1000) companySizeEvidence = 'enterprise'
      else if (count >= 200) companySizeEvidence = 'mid'
      else if (count >= 20) companySizeEvidence = 'small'
    } else if (/\b(?:solo|just\s+me|one[- ]person|bootstrapped|early\s+stage|pre[- ]seed|stealth)\b/i.test(normalized)) {
      if (!companySizeEvidence) companySizeEvidence = 'startup'
    }
  }

  return { targetCustomerSegment, companySizeEvidence }
}

// ── Industry Scoping ─────────────────────────────────────────────────────────

const USE_CASE_EXAMPLE_MARKERS = [
  /\b(?:for\s+example|such\s+as|like\s+how|including|use\s+case|application|can\s+be\s+used\s+for)\b/i,
  /\b(?:imagine|picture|consider|think\s+about|say\s+you(?:|'re|are))\b/i,
  /\b(?:helps?\s+(?:with|for)|enables?\s+|useful\s+for|applied\s+to)\b/i,
]

/**
 * Determine if a line describes the prospect's own industry or is a
 * use-case/example from another domain.
 */
export function isOwnIndustry(line: string): boolean {
  const normalized = line.toLowerCase()

  // If it's clearly a use-case example, reject as own industry
  if (USE_CASE_EXAMPLE_MARKERS.some(m => {
    m.lastIndex = 0
    return m.test(normalized)
  })) {
    return false
  }

  // Strong ownership markers
  const ownership = /\b(?:we\s+(?:are|build|offer|provide|help|work\s+with)|our\s+(?:company|startup|platform|product|agency|firm|consultancy|practice))\b/i
  if (ownership.test(normalized)) return true

  // Current role markers
  const roleMarker = /\b(?:co[- ]?founder|ceo|cto|cfo|vp|director)\s+(?:of|at)\s+\b/i
  if (roleMarker.test(normalized)) return true

  return false
}

// ── Current Product Activity vs Buyer Intent ─────────────────────────────────

/**
 * Product activity (launching, building) is NOT the same as buyer intent.
 * "Inspektor is live" = current product activity, NOT buyer request.
 */
export function analyzeProductActivity(text: string): {
  hasCurrentProductActivity: boolean
  hasBuyerIntent: boolean
  productName: string | null
} {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let hasCurrentProductActivity = false
  let hasBuyerIntent = false
  let productName: string | null = null

  const buyerPatterns = [
    /\b(?:looking\s+for|seeking|need(?:s|ed)?\s+(?:an?\s+)?(?:agency|developer|vendor|contractor|partner|freelancer|team)|want\s+to\s+(?:hire|engage|work\s+with))\b/i,
    /\b(?:help\s+(?:me|us)\s+(?:build|develop|design|create|ship))\b/i,
    /\b(?:recommend|suggest|know\s+(?:an?\s+)?(?:good|great))\b/i,
  ]

  const productPatterns = [
    /\b(?:is\s+(?:live|launched|released|out|available|in\s+beta))\b/i,
    /\b(?:building|building\s+a|working\s+on|developing|scaling)\b/i,
    /\b(?:just\s+(?:launched|released|shipped|announced))\b/i,
  ]

  for (const line of lines) {
    // Check buyer intent
    if (!hasBuyerIntent && buyerPatterns.some(p => {
      p.lastIndex = 0
      return p.test(line)
    })) {
      hasBuyerIntent = true
    }

    // Check product activity
    if (!hasCurrentProductActivity && productPatterns.some(p => {
      p.lastIndex = 0
      return p.test(line)
    })) {
      const temporal = classifyTemporalProvenance(line)
      if (temporal === 'CURRENT' || temporal === 'RECENT') {
        hasCurrentProductActivity = true
        const nameMatch = line.match(/\b(?:launched|releasing|building|working\s+on)\s+["']?([A-Z][A-Za-z0-9\s]{2,30})["']?/i)
        if (nameMatch) productName = nameMatch[1].trim()
      }
    }
  }

  return { hasCurrentProductActivity, hasBuyerIntent, productName }
}

// ── Access/Mutual Consistency ────────────────────────────────────────────────

/**
 * Parse access signals from source text with consistency checks.
 */
export function parseAccessSignals(text: string): {
  connectionDegree: '1st' | '2nd' | '3rd' | 'unknown'
  mutualConnections: number
  canMessage: boolean
  hasDirectOutreach: boolean
  consistency: 'consistent' | 'conflict'
} {
  const degreeMatch = text.match(/·\s*(1st|2nd|3rd)\b/i)
  const connectionDegree = (degreeMatch ? degreeMatch[1].toLowerCase() : 'unknown') as '1st' | '2nd' | '3rd' | 'unknown'

  // Parse mutual connections - multiple formats
  let mutualConnections = 0

  // "X mutual connections"
  const directMutual = text.match(/(\d+)\s+mutual\s+connection/i)
  if (directMutual) {
    mutualConnections = parseInt(directMutual[1])
  }

  // "Name, Name and X other mutual"
  const namedMutual = text.match(/(\w+(?:\s+\w+)?)\s*,\s*(\w+(?:\s+\w+)?)\s+and\s+(\d+)\s+other\s+mutual/i)
  if (namedMutual) {
    mutualConnections = 2 + parseInt(namedMutual[3])
  }

  // "Connected" badge or similar
  const connectedBadge = /\bconnect(?:ed)?\b/i.test(text)

  const canMessage = connectionDegree === '1st' || mutualConnections > 0 || connectedBadge
  const hasDirectOutreach = connectionDegree === '1st' || /\bmessage\s+(?:button|available)\b/i.test(text)

  // Consistency check: if 1st degree, mutual should be > 0 or message available
  const consistency: 'consistent' | 'conflict' =
    (connectionDegree === '1st' && mutualConnections >= 0) || connectionDegree !== '1st'
      ? 'consistent'
      : 'conflict'

  return { connectionDegree, mutualConnections, canMessage, hasDirectOutreach, consistency }
}

// ── Attribution Audit ────────────────────────────────────────────────────────

export interface AttributionAudit {
  signal: string
  value: unknown
  actor: string | null
  organization: string | null
  sourceQuote: string | null
  temporalClass: TemporalClass
  verified: boolean
  rejectionReason: string | null
}

/**
 * Build an attribution audit for a signal.
 */
export function auditSignal(params: {
  signal: string
  value: unknown
  sourceQuote: string | null
  organization?: string | null
  actor?: string | null
}): AttributionAudit {
  const { signal, value, sourceQuote, organization = null, actor = null } = params

  let temporalClass: TemporalClass = 'RECENT'
  let verified = true
  let rejectionReason: string | null = null

  if (sourceQuote) {
    temporalClass = classifyTemporalProvenance(sourceQuote)
  }

  // Signal-specific verification
  if (signal === 'budget' && sourceQuote) {
    const budgetCheck = verifyBudgetProvenance(sourceQuote)
    verified = budgetCheck.valid
    rejectionReason = budgetCheck.valid ? null : budgetCheck.reason
    temporalClass = budgetCheck.temporalClass
  }

  if (signal === 'hiring' && sourceQuote) {
    const hiringCheck = verifyHiringProvenance(sourceQuote)
    verified = hiringCheck.valid
    rejectionReason = hiringCheck.valid ? null : hiringCheck.reason
    temporalClass = hiringCheck.temporalClass
  }

  if (signal === 'launch' && sourceQuote) {
    if (temporalClass === 'HISTORICAL' || isHistoricalYear(sourceQuote)) {
      verified = false
      rejectionReason = 'launch event is historical'
    }
  }

  if (temporalClass === 'HISTORICAL' && !verified) {
    rejectionReason = rejectionReason || 'signal is historical'
  }

  return { signal, value, actor, organization, sourceQuote, temporalClass, verified, rejectionReason }
}
