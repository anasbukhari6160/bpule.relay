/**
 * Signal Attribution Guard
 *
 * Post-processes scoring signals to ensure every claim is:
 * - Source-backed (verbatim or close paraphrase)
 * - Correctly scoped (current vs historical, organization-specific)
 * - Not inferred from unsupported patterns
 *
 * This prevents false signals like:
 * - "Budget stated" from CPI/LTV/revenue metrics
 * - "Launching" from historical achievements
 * - "Industry: edtech" from unrelated background terms
 * - "Access: NONE" when Connect/Mutual connections exist
 */

export interface SourceSignal {
  claim: string
  sourceLine: string
  signalType: 'budget' | 'launch' | 'industry' | 'access' | 'authority' | 'timing' | 'custom'
  current: boolean
  verified: boolean
}

export interface AttributionResult {
  validSignals: SourceSignal[]
  removedSignals: Array<{ claim: string; reason: string }>
}

// Patterns that do NOT constitute buyer budget
const NON_BUDGET_PATTERNS = [
  /\b(?:cpm|cpi|cpa|ltv|arpu|roas|roi)\b/i,
  /\b(?:revenue|profit|margin|run\s*rate|arr|mrr)\b/i,
  /\b(?:cost\s*per|price\s*per|unit\s*cost)\b/i,
  /\b(?:million|billion)\s*(?:users|downloads|players|installs)\b/i,
  /(?:users|players|downloads|installs)\s*(?:million|billion)/i,
  /\b(?:enterprise.grade|enterprise.level)\b/i,
  /\b(?:fortune\s*500|fortune\s*100)\b/i,
]

// Historical achievement patterns (not current)
const HISTORICAL_PATTERNS = [
  /\b(?:designed\s+and\s+launched|built\s+and\s+launched|shipped|previously|former|past)\b/i,
  /\b(?:was\s+(?:the|a)\s+(?:founder|ceo|cto|lead))\b/i,
  /\b(?:at\s+my\s+(?:previous|former|last))\b/i,
  /\b(?:published\s+by|acquired\s+by|backed\s+by)\b/i,
  /\b(?:worked\s+at|joined\s+as\s+a?)\b/i,
]

// Current activity patterns
const CURRENT_PATTERNS = [
  /\b(?:currently|now|today|just|recently|newly|freshly)\b/i,
  /\b(?:launching|building|hiring|growing|scaling|shipping|working\s+on)\b/i,
  /\b(?:we'?re|we\s+are|i'?m|i\s+am)\s+(?:building|launching|hiring|growing|shipping|working)\b/i,
]

/**
 * Validate and correct signal attribution from a scored lead.
 * Returns only verified, source-backed signals.
 */
export function validateSignalAttribution(params: {
  signals: string[]
  sourceText: string
  currentCompany: string
  currentTitle: string
}): AttributionResult {
  const { signals, sourceText, currentCompany, currentTitle } = params
  const lines = sourceText.split('\n').map(l => l.trim()).filter(Boolean)
  const valid: SourceSignal[] = []
  const removed: Array<{ claim: string; reason: string }> = []

  for (const signal of signals) {
    const result = validateSingleSignal(signal, lines, currentCompany, currentTitle)
    if (result) {
      valid.push(result)
    } else {
      removed.push({ claim: signal, reason: getRejectionReason(signal, lines) })
    }
  }

  return { validSignals: valid, removedSignals: removed }
}

function validateSingleSignal(
  signal: string,
  sourceLines: string[],
  currentCompany: string,
  currentTitle: string,
): SourceSignal | null {
  const lower = signal.toLowerCase()

  // Budget validation
  if (/budget|budgeted|funded|allocated/i.test(lower)) {
    return validateBudgetSignal(signal, sourceLines)
  }

  // Launch validation
  if (/launch|launching|released|shipped/i.test(lower)) {
    return validateLaunchSignal(signal, sourceLines)
  }

  // Industry validation
  if (/industry/i.test(lower)) {
    return validateIndustrySignal(signal, sourceLines, currentCompany)
  }

  // Access validation
  if (/access|mutual|connection/i.test(lower)) {
    return validateAccessSignal(signal, sourceLines)
  }

  // Authority validation
  if (/authority|founder|ceo|cto|coo|studio\s+lead|co-founder/i.test(lower)) {
    return validateAuthoritySignal(signal, sourceLines, currentTitle)
  }

  // Timing validation
  if (/timing|recent|current|stale|urgent/i.test(lower)) {
    return validateTimingSignal(signal, sourceLines)
  }

  // Custom/generic signal — verify it appears in source
  const foundInSource = sourceLines.some(line =>
    line.toLowerCase().includes(lower.slice(0, 40))
  )
  if (foundInSource) {
    return {
      claim: signal,
      sourceLine: sourceLines.find(l => l.toLowerCase().includes(lower.slice(0, 40))) ?? '',
      signalType: 'custom',
      current: true,
      verified: true,
    }
  }

  return null
}

function validateBudgetSignal(signal: string, sourceLines: string[]): SourceSignal | null {
  for (const line of sourceLines) {
    const lower = line.toLowerCase()

    // Must contain explicit budget keywords
    if (!/\b(?:budget|budgeted|funded|allocated|project\s+(?:value|budget)|fixed\s+price)\b/i.test(line)) {
      continue
    }

    // Must NOT be a non-budget financial metric
    if (NON_BUDGET_PATTERNS.some(p => p.test(lower))) {
      continue
    }

    // Must contain a money amount
    if (!/\$|\€|£|(?:usd|eur|gbp)/i.test(line) && !/\d{4,}/.test(line)) {
      continue
    }

    return {
      claim: signal,
      sourceLine: line,
      signalType: 'budget',
      current: !HISTORICAL_PATTERNS.some(p => p.test(lower)),
      verified: true,
    }
  }

  return null
}

function validateLaunchSignal(signal: string, sourceLines: string[]): SourceSignal | null {
  for (const line of sourceLines) {
    const lower = line.toLowerCase()

    // Must contain launch-related keywords
    if (!/\b(?:launched|launching|released|shipped|new\s+product|new\s+platform|beta|mvps?|pilot)\b/i.test(line)) {
      continue
    }

    // Check if this is historical (past achievement)
    const isHistorical = HISTORICAL_PATTERNS.some(p => p.test(lower))

    // Check if this is current
    const isCurrent = CURRENT_PATTERNS.some(p => p.test(lower))

    // Historical launch should not be treated as current signal
    if (isHistorical && !isCurrent) {
      return null
    }

    return {
      claim: signal,
      sourceLine: line,
      signalType: 'launch',
      current: isCurrent,
      verified: true,
    }
  }

  return null
}

function validateIndustrySignal(signal: string, sourceLines: string[], currentCompany: string): SourceSignal | null {
  // Industry must be scoped to the current company, not inferred from unrelated history
  const industryMatch = signal.match(/industry:\s*([^.]+)/i)
  if (!industryMatch) return null

  const claimedIndustry = industryMatch[1].trim().toLowerCase()

  // Check if the industry appears in context of the current company
  const companyContext = sourceLines.find(line =>
    line.toLowerCase().includes(currentCompany.toLowerCase()) &&
    line.toLowerCase().includes(claimedIndustry)
  )

  if (companyContext) {
    return {
      claim: signal,
      sourceLine: companyContext,
      signalType: 'industry',
      current: true,
      verified: true,
    }
  }

  // Check if industry appears with a current keyword
  const currentContext = sourceLines.find(line =>
    CURRENT_PATTERNS.some(p => p.test(line.toLowerCase())) &&
    line.toLowerCase().includes(claimedIndustry)
  )

  if (currentContext) {
    return {
      claim: signal,
      sourceLine: currentContext,
      signalType: 'industry',
      current: true,
      verified: true,
    }
  }

  // Industry not source-backed for current company
  return null
}

function validateAccessSignal(signal: string, sourceLines: string[]): SourceSignal | null {
  for (const line of sourceLines) {
    const lower = line.toLowerCase()

    // Check for factual access indicators
    const hasConnect = /\b(?:connect|message|follow|dm)\b/i.test(lower)
    const hasMutual = /\b(?:mutual|connection|is\s+a\s+connection)\b/i.test(lower)
    const hasDegree = /\b(?:1st|2nd|3rd|degree)\b/i.test(lower)

    if (hasConnect || hasMutual || hasDegree) {
      return {
        claim: signal,
        sourceLine: line,
        signalType: 'access',
        current: true,
        verified: true,
      }
    }
  }

  return null
}

function validateAuthoritySignal(signal: string, sourceLines: string[], currentTitle: string): SourceSignal | null {
  // Authority must match actual current role from source
  const lowerTitle = currentTitle.toLowerCase()

  if (!lowerTitle) return null

  // Check if the authority claim matches the current title
  const founderMatch = /founder|co-founder/i.test(signal) && /founder|co-founder/i.test(lowerTitle)
  const cLevelMatch = /ceo|cto|cfo|coo|chief/i.test(signal) && /ceo|cto|cfo|coo|chief/i.test(lowerTitle)
  const studioLeadMatch = /studio\s+lead/i.test(signal) && /studio\s+lead/i.test(lowerTitle)

  if (founderMatch || cLevelMatch || studioLeadMatch) {
    return {
      claim: signal,
      sourceLine: currentTitle,
      signalType: 'authority',
      current: true,
      verified: true,
    }
  }

  return null
}

function validateTimingSignal(signal: string, sourceLines: string[]): SourceSignal | null {
  for (const line of sourceLines) {
    const lower = line.toLowerCase()

    // Check for explicit timing indicators
    if (/\d+\s*(?:d|w|mo|h)\s*ago/.test(lower)) {
      const isRecent = /\d+\s*(?:d|w)\s*ago/.test(lower) // days or weeks
      return {
        claim: signal,
        sourceLine: line,
        signalType: 'timing',
        current: isRecent,
        verified: true,
      }
    }

    if (/currently|just|recently|newly|now/.test(lower)) {
      return {
        claim: signal,
        sourceLine: line,
        signalType: 'timing',
        current: true,
        verified: true,
      }
    }
  }

  return null
}

function getRejectionReason(signal: string, sourceLines: string[]): string {
  const lower = signal.toLowerCase()

  if (/budget/i.test(lower)) {
    if (NON_BUDGET_PATTERNS.some(p => p.test(lower))) {
      return 'Budget inferred from non-budget metric (CPI/LTV/revenue)'
    }
    return 'No explicit budget statement found in source'
  }

  if (/launch/i.test(lower)) {
    if (HISTORICAL_PATTERNS.some(p => p.test(lower))) {
      return 'Historical launch, not current activity'
    }
    return 'Launch claim not found in source'
  }

  if (/industry/i.test(lower)) {
    return 'Industry not scoped to current organization'
  }

  if (/access/i.test(lower)) {
    return 'Access level not supported by source'
  }

  return 'Signal not found in source text'
}
