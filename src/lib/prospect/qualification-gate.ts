import type { ExtractedLead } from '@/lib/domain/types'
import { detectCommercialRequest } from '@/lib/intelligence-v3/source-facts'

export type InputClassification =
  | 'PERSON_PROFILE'
  | 'COMPANY_PROFILE'
  | 'JOB_POST'
  | 'HIRING_POST'
  /** A request to buy from an external provider (agency, vendor, contractor, outsourced team). */
  | 'SERVICE_REQUEST'
  | 'CONVERSATION'
  | 'INBOUND_REQUEST'
  | 'BUSINESS_OPPORTUNITY'
  | 'IRRELEVANT'
  | 'INSUFFICIENT'

export interface ClassificationResult {
  classification: InputClassification
  confidence: number
  reasons: string[]
}

const UI_FRAGMENT_PATTERNS = [
  /\b(sign\s*in|log\s*in|login|sign\s*up|register|forgot\s*password|reset\s*password)\b/i,
  /\b(email|password|username)\s*[\/:]\s*(email|password|username|\*+)/i,
  /\b(submit|cancel|close|menu|navigation|breadcrumb|footer|header)\b/i,
  /\b(home\s*page|contact\s*us|about\s*us|privacy\s*policy|terms\s*of\s*service)\b/i,
  /\b(enter\s+your\s+password|password\s+reset|account\s+settings|log\s*out)\b/i,
  /\b(execution\s+os|dashboard\s+login|admin\s+portal|user\s+authentication)\b/i,
]

const PROSPECT_CONTENT_MARKERS = [
  /\b(founder|ceo|cto|coo|cfo|chief|president|vp|head\s+of|director|manager|lead|senior|principal|staff)\b/i,
  /\b(hiring|recruiting|looking\s+for|need\s+(?:a|an|someone|help)|seeking|want\s+to\s+hire)\b/i,
  /\b(developer|engineer|designer|architect|full[- ]?stack|backend|frontend|devops)\b/i,
  /\b(remote|hybrid|on[- ]?site|work\s+from\s+anywhere|distributed)\b/i,
  /\b(project|budget|timeline|deadline|launch|migration|rebuild|rewrite)\b/i,
  /\b(raised|funding|seed|series\s+[abc]|bootstrapped|revenue)\b/i,
  /\b(company|startup|agency|firm|studio|inc\.?|llc|ltd)\b/i,
]

// LinkedIn's own paste chrome: a connection-degree badge (· 1st/2nd/3rd), a
// section header for work history/education, or a connections count. These
// are structural signals that a paste is a real profile regardless of
// wording — a person who writes their "About" section in resume-style third
// person (no "I"/"my"/"he"/"she") is extremely common and must not be
// treated the same as an empty/garbage/login-screen paste just because it
// (real LinkedIn profile, third-person bio) was misclassified IRRELEVANT.
const LINKEDIN_STRUCTURE_PATTERNS = [
  /·\s*(1st|2nd|3rd)\b/i,
  /^\s*experience\s*$/im,
  /^\s*education\s*$/im,
  /\b\d+\+?\s*connections?\b/i,
  /\b(licenses?\s*&\s*certifications?)\b/i,
]

function hasLinkedInProfileStructure(text: string): boolean {
  return LINKEDIN_STRUCTURE_PATTERNS.filter((p) => p.test(text)).length >= 2
}

export function classifyInput(rawText: string): ClassificationResult {
  const text = rawText.trim()
  const reasons: string[] = []

  // profile markers, it's a valid prospect regardless of any UI fragments
  // that might also be present (browser chrome, navigation, etc.)
  const hasStructure = hasLinkedInProfileStructure(text)

  let markerHits = 0
  for (const pattern of PROSPECT_CONTENT_MARKERS) {
    if (pattern.test(text)) markerHits++
  }

  if (hasStructure && markerHits >= 1) {
    return { classification: 'PERSON_PROFILE', confidence: 65, reasons: ['LinkedIn profile structure and prospect content detected.'] }
  }

  // Only check for UI fragments if LinkedIn structure is NOT detected
  let uiFragmentHits = 0
  for (const pattern of UI_FRAGMENT_PATTERNS) {
    if (pattern.test(text)) uiFragmentHits++
  }

  // Login form detection: email + password fields with sign-in language
  const hasLoginForm = /(?:email|password|username)\b[\s\S]{0,200}?(?:password|email|username)\b/i.test(text) &&
    /\bsign\s*in\b|\blog\s*in\b|\blogin\b/i.test(text)

  // Additional heuristic: if text is short (< 25 words) and has login-like patterns, it's UI garbage
  const wordCount = (text.match(/[a-z][a-z0-9+.#-]*/gi) ?? []).length
  const hasPasswordField = /\bpassword\b/i.test(text) && /\bsign\s*in\b|\blog\s*in\b/i.test(text)
  const isLikelyUIFragment = (hasPasswordField && wordCount < 30) || uiFragmentHits >= 2

  if (hasLoginForm || isLikelyUIFragment) {
    reasons.push(hasLoginForm
      ? 'Input appears to be a login form or authentication UI fragment.'
      : 'Input contains multiple UI/navigation fragments rather than prospect content.')
    return {
      classification: 'IRRELEVANT',
      confidence: 90,
      reasons,
    }
  }

  const hasPersonMarkers = /\b(he|she|they|his|her|their|i|my|me)\b/i.test(text) ||
    /\b\d+\+?\s*years?\s*(of\s*)?experience\b/i.test(text) ||
    hasStructure
  const hasJobMarkers = /\b(job\s*description|responsibilities|requirements|qualifications|apply\s*now|salary|compensation)\b/i.test(text)
  const hasCompanyMarkers = /\b(company|startup|agency|firm|studio)\b/i.test(text) && markerHits >= 2
  const hasHiringIntent = /\b(hiring|recruiting|looking\s+(?:for|to)|need\s+(?:a|an|someone))\b/i.test(text)
  const hasProjectNeed = /\b(need\s+(?:help|support|a\s+developer|an\s+engineer)|looking\s+for\s+(?:a\s+developer|an\s+engineer|freelance|contract))\b/i.test(text)

  // An explicit request to an external provider outranks generic "hire" /
  // "requirements" wording: "outsourced team, not full-time employees" is a
  // vendor procurement, not a job post.
  const commercial = detectCommercialRequest(text)
  if (commercial.externalServiceRequest) {
    return {
      classification: 'SERVICE_REQUEST',
      confidence: 80,
      reasons: [
        `External service request detected: "${commercial.externalServiceRequest.line.slice(0, 140)}"`,
        ...(commercial.employmentHiring ? ['Hiring wording is also present; the external-provider request drives the classification.'] : []),
      ],
    }
  }

  if (hasJobMarkers && markerHits >= 2) {
    return { classification: hasHiringIntent ? 'HIRING_POST' : 'JOB_POST', confidence: 75, reasons: ['Job description language detected.'] }
  }

  if (commercial.employmentHiring && markerHits >= 2) {
    return { classification: 'HIRING_POST', confidence: 70, reasons: [`Employee hiring detected: "${commercial.employmentHiring.line.slice(0, 140)}"`] }
  }

  if (hasProjectNeed || hasHiringIntent) {
    return { classification: 'BUSINESS_OPPORTUNITY', confidence: 70, reasons: ['Active hiring or project need detected.'] }
  }

  if (hasPersonMarkers && markerHits >= 2) {
    return { classification: 'PERSON_PROFILE', confidence: 65, reasons: ['Personal profile or professional bio detected.'] }
  }

  if (hasCompanyMarkers) {
    return { classification: 'COMPANY_PROFILE', confidence: 60, reasons: ['Company description detected.'] }
  }

  if (markerHits === 1 || hasStructure) {
    return { classification: 'INSUFFICIENT', confidence: 50, reasons: ['Minimal prospect signal detected; paste more context for reliable qualification.'] }
  }

  reasons.push('No identifiable prospect content found. This does not appear to be a person, company, job, or business opportunity.')
  return { classification: 'IRRELEVANT', confidence: 80, reasons }
}

export type ProspectQualificationStatus = 'eligible' | 'insufficient_context'

export interface ProspectQualificationAssessment {
  status: ProspectQualificationStatus
  qualificationEligibility: boolean
  inputHardFail: boolean
  inputClassification: ClassificationResult
  inputQuality: number
  extractability: number
  evidenceCoverage: number
  reasons: string[]
  missingCritical: string[]
  suggestions: string[]
}

const PLACEHOLDER_WORDS = new Set([
  'asdf',
  'hello',
  'lorem',
  'placeholder',
  'qwerty',
  'random',
  'sample',
  'test',
  'testing',
  'xyz',
])

const TITLE_STOPWORDS = new Set([
  'bio',
  'link',
  'none',
  'null',
  'n/a',
  'na',
  'profile',
  'unknown',
])

const MIN_EVIDENCE_WORDS = 5

const GENERIC_MARKETING_TERMS = new Set([
  'best',
  'class',
  'cloud',
  'cutting',
  'deliver',
  'delivering',
  'digital',
  'global',
  'globally',
  'innovation',
  'innovative',
  'leading',
  'modern',
  'outcomes',
  'solutions',
  'transform',
  'world',
])

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z0-9+.#-]*/g) ?? []
}

function informativeText(value: string | null | undefined, minWords = MIN_EVIDENCE_WORDS): boolean {
  const text = (value ?? '').trim()
  if (text.length < 24) return false
  const list = words(text)
  if (list.length < minWords) return false
  const unique = new Set(list).size
  if (unique < Math.min(4, Math.ceil(list.length / 2))) return false
  return /[aeiou]/i.test(text)
}

function isGenericMarketingText(value: string | null | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase()
  if (!text) return false
  const tokenList = words(text)
  if (tokenList.length < 8) return false
  const termHits = tokenList.filter((token) => GENERIC_MARKETING_TERMS.has(token)).length
  const hasConcreteMarker =
    /\b\d+(?:[.,]\d+)?(?:\s*(?:%|x|k|m|b|days?|weeks?|months?|years?|hrs?|hours?))?\b/i.test(text) ||
    /\b(hiring|recruiting|looking\s+for|open\s+role|opening|job\s+post|backlog|incident|outage|latency|migration|rewrite|rebuild|deadline|p\d{2})\b/i.test(text)
  return termHits >= 4 && !hasConcreteMarker
}

function hasSpecificSignalEvidence(value: string | null | undefined): boolean {
  const text = (value ?? '').trim()
  if (!informativeText(text, MIN_EVIDENCE_WORDS)) return false
  const hasMetricCue =
    /\b\d+(?:[.,]\d+)?(?:\s*(?:%|x|k|m|b|days?|weeks?|months?|years?|hrs?|hours?))?\b/i.test(text) ||
    /\bp\d{2}\b/i.test(text)
  const hasOpportunityCue =
    /\b(hiring|recruiting|looking\s+for|open\s+role|opening|job\s+post|need|needs|seeking|backlog|incident|outage|latency|migration|rewrite|rebuild|deadline|launch|ship|shipping)\b/i.test(text)
  const hasTechCue =
    /\b(rails|ruby|react|node|python|go|java|kotlin|swift|postgres|mysql|api|backend|frontend|mobile|ios|android|devops|sre|kubernetes|aws|gcp|azure)\b/i.test(text)
  // A real quotation, not an apostrophe: "Gummadi's" used to count as a
  // quote and flipped lead eligibility on the same profile.
  const hasQuotedCue = /"[^"\n]{3,}"|“[^”\n]{3,}”/.test(text)
  const concreteCueCount = [hasMetricCue, hasOpportunityCue, hasTechCue, hasQuotedCue].filter(Boolean).length
  if (concreteCueCount === 0) return false
  if (isGenericMarketingText(text) && concreteCueCount < 2) return false
  return true
}

function normalizedContactKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function hasLikelyName(value: string | null | undefined): boolean {
  const t = (value ?? '').trim()
  if (!/^[A-Za-z][A-Za-z .'-]{2,80}$/.test(t)) return false
  const parts = t.split(/\s+/).filter(Boolean)
  return parts.length >= 2 && parts.length <= 4
}

function hasLikelyTitle(value: string | null | undefined): boolean {
  const t = (value ?? '').trim()
  if (!t || t.length < 3) return false
  const lower = t.toLowerCase()
  if (TITLE_STOPWORDS.has(lower)) return false
  if (normalizedContactKey(t) === normalizedContactKey('unknown title')) return false
  return /[a-z]/i.test(t)
}

function hasKnownCompany(value: string | null | undefined): boolean {
  const t = (value ?? '').trim()
  if (!t) return false
  const lower = t.toLowerCase()
  if (lower === 'unknown company' || lower === 'unknown') return false
  if (PLACEHOLDER_WORDS.has(lower)) return false
  return /[a-z]/i.test(t)
}

function hasValidUrl(raw: string | null | undefined): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    return Boolean(url.hostname)
  } catch {
    return false
  }
}

function scoreRawInput(rawText: string | null | undefined): {
  score: number
  hardFail: boolean
  reasons: string[]
  classification: ClassificationResult
} {
  const input = (rawText ?? '').trim()
  if (!input) {
    return {
      score: 0,
      hardFail: true,
      reasons: ['Raw input is required to verify this prospect.'],
      classification: { classification: 'IRRELEVANT', confidence: 100, reasons: ['No input provided.'] },
    }
  }

  const tokenList = words(input)
  const uniqueCount = new Set(tokenList).size
  const counts = new Map<string, number>()
  let maxTokenRepeat = 0
  for (const token of tokenList) {
    const next = (counts.get(token) ?? 0) + 1
    counts.set(token, next)
    if (next > maxTokenRepeat) maxTokenRepeat = next
  }
  const repeatRatio = tokenList.length > 0 ? maxTokenRepeat / tokenList.length : 1
  const placeholderHits = tokenList.filter((token) => PLACEHOLDER_WORDS.has(token)).length
  const placeholderRatio = tokenList.length > 0 ? placeholderHits / tokenList.length : 0
  const vowelPoorWords = tokenList.filter((token) => token.length >= 4 && !/[aeiou]/.test(token)).length
  const vowelPoorRatio = tokenList.length > 0 ? vowelPoorWords / tokenList.length : 0
  const alphaChars = (input.match(/[A-Za-z]/g) ?? []).length
  const urlOnly = /^https?:\/\/\S+\s*$/i.test(input)
  const genericMarketing = isGenericMarketingText(input)

  let score = 100
  const reasons: string[] = []

  if (urlOnly) {
    score -= 70
    reasons.push('Input is only a URL with no extractable context.')
  }
  if (tokenList.length < 6) {
    score -= 45
    reasons.push('Input is too short to identify a real prospect.')
  } else if (tokenList.length < 10) {
    score -= 20
  }
  if (uniqueCount < 5) {
    score -= 25
    reasons.push('Input has too little semantic variety to trust qualification.')
  }
  if (repeatRatio >= 0.55) {
    score -= 30
    reasons.push('Input is heavily repetitive and likely meaningless.')
  }
  if (placeholderRatio >= 0.35) {
    score -= 35
    reasons.push('Input is dominated by placeholder/testing words.')
  }
  if (vowelPoorRatio >= 0.5) {
    score -= 20
    reasons.push('Input appears garbled or tokenized noise.')
  }
  if (alphaChars < 30) {
    score -= 20
  }
  if (genericMarketing) {
    score -= 30
    reasons.push('Input reads like generic marketing copy, not a concrete prospect signal.')
  }

  const classification = classifyInput(input)
  const isIrrelevant = classification.classification === 'IRRELEVANT'

  const hardFail =
    isIrrelevant ||
    urlOnly ||
    tokenList.length < 4 ||
    placeholderRatio >= 0.75 ||
    (repeatRatio >= 0.72 && uniqueCount <= 3) ||
    (genericMarketing && alphaChars < 120)

  if (isIrrelevant) {
    reasons.push(...classification.reasons)
  }

  return { score: clamp(score), hardFail, reasons, classification }
}

function scoreExtractability(extracted: ExtractedLead): {
  score: number
  hasCompany: boolean
  hasPerson: boolean
  hasRole: boolean
  hasSignalEvidence: boolean
  hasContext: boolean
} {
  const hasCompany = hasKnownCompany(extracted.company)
  const hasPerson = hasLikelyName(extracted.name)
  const hasRole = hasLikelyTitle(extracted.titleRaw ?? extracted.title)
  const hasSignalEvidence = hasSpecificSignalEvidence(extracted.signalEvidence)
  const contextLength = `${extracted.aboutSummary ?? ''} ${extracted.experienceSummary ?? ''}`.trim().length
  const hasContext = contextLength >= 70 || (extracted.recentPosts?.length ?? 0) > 0
  const hasTagCoverage = (extracted.tags?.length ?? 0) >= 2
  const confidence = clamp(extracted.extractionConfidence ?? 0)

  let score = 0
  if (hasCompany) score += 20
  if (hasPerson) score += 15
  if (hasRole) score += 15
  if (hasSignalEvidence) score += 20
  if (hasContext) score += 15
  if (hasTagCoverage) score += 10
  if (hasValidUrl(extracted.url)) score += 5
  if (confidence >= 70) score += 10
  else if (confidence >= 55) score += 5

  return {
    score: clamp(score),
    hasCompany,
    hasPerson,
    hasRole,
    hasSignalEvidence,
    hasContext,
  }
}

function scoreEvidenceCoverage(extracted: ExtractedLead, extractability: ReturnType<typeof scoreExtractability>): number {
  const dimensions = [
    extractability.hasCompany,
    extractability.hasPerson || extractability.hasRole,
    extractability.hasSignalEvidence,
    extractability.hasContext || (extracted.tags?.length ?? 0) > 0,
    (extracted.extractionConfidence ?? 0) >= 60 || hasValidUrl(extracted.url),
  ]

  const covered = dimensions.filter(Boolean).length
  return clamp((covered / dimensions.length) * 100)
}

export function evaluateProspectQualification(params: {
  extracted: ExtractedLead
  rawText?: string | null
  /**
   * The canonical intelligence result for this exact input, when one exists.
   *
   * TEAM-002/004/005/89-score-regression: qualificationEligibility used to be
   * computed ONLY from this legacy heuristic (raw-text pattern scoring +
   * extraction-completeness point totals against extracted.signalEvidence /
   * extracted.aboutSummary — Pass A's narrow fields, not the canonical
   * pipeline's own evidence ledger). That meant a prospect the canonical
   * pipeline scored 89 ("Strong opportunity") could still be silently
   * blocked from Save/Draft because this SEPARATE, disconnected gate's own
   * word-count/regex thresholds didn't clear — two independent sources of
   * truth for "is this prospect good enough," able to disagree, with the
   * legacy one winning by simply running last and blocking outright.
   *
   * Fix: once a canonical result exists and the canonical pipeline itself
   * did not already say 'skip' (that path short-circuits earlier and never
   * reaches here), canonical eligibility is authoritative. The legacy
   * extractability/evidence/missingCritical checks still run and are always
   * returned (never hidden) for display/explanation, but they no longer
   * independently veto an otherwise-eligible canonical result. The one
   * exception is inputHardFail (garbage/UI-fragment/login-form input) —
   * that's an input-sanity veto, not an extraction-completeness opinion, and
   * a canonical score computed over garbage input isn't trustworthy either,
   * so it still blocks regardless of canonical.
   */
  canonicalQualification?: 'strong' | 'worth_pursuing' | 'maybe' | 'low' | 'skip' | null
}): ProspectQualificationAssessment {
  const raw = scoreRawInput(params.rawText)
  const extractability = scoreExtractability(params.extracted)
  const evidenceCoverage = scoreEvidenceCoverage(params.extracted, extractability)

  const missingCritical: string[] = []
  if (!extractability.hasCompany) missingCritical.push('company context')
  if (!(extractability.hasPerson || extractability.hasRole)) missingCritical.push('person or role context')
  if (!extractability.hasSignalEvidence) missingCritical.push('specific opportunity signal')

  const reasons = [...raw.reasons]
  if (extractability.score < 45) {
    reasons.push('Extracted fields are too sparse for reliable qualification.')
  }
  if (evidenceCoverage < 40) {
    reasons.push('Evidence coverage is too thin to justify a fit score.')
  }
  if ((params.extracted.extractionConfidence ?? 0) < 40) {
    reasons.push('Extraction confidence is too low to trust scoring.')
  }
  if (params.extracted.signalEvidence && !hasSpecificSignalEvidence(params.extracted.signalEvidence)) {
    reasons.push('Signal evidence is too generic; add concrete opportunity details.')
  }

  const legacyEligibility =
    raw.score >= 45 &&
    extractability.score >= 45 &&
    evidenceCoverage >= 40 &&
    missingCritical.length === 0

  // Canonical is authoritative for a prospect it has already scored (any
  // qualification other than 'skip' — the canonical pipeline's own verdict
  // that this is NOT a fit, which the legacy gate should not override
  // either, but that path already short-circuits before extraction/save in
  const canonicalVouches =
    params.canonicalQualification != null && params.canonicalQualification !== 'skip'
  const qualificationEligibility = !raw.hardFail && (canonicalVouches || legacyEligibility)

  if (canonicalVouches && !legacyEligibility) {
    reasons.push(
      'Canonical intelligence already scored this prospect with sufficient evidence; legacy extraction-completeness checks below are shown for context only and do not block saving.',
    )
  }

  return {
    status: qualificationEligibility ? 'eligible' : 'insufficient_context',
    qualificationEligibility,
    inputHardFail: raw.hardFail,
    inputClassification: raw.classification,
    inputQuality: raw.score,
    extractability: extractability.score,
    evidenceCoverage,
    reasons,
    missingCritical,
    suggestions: qualificationEligibility
      ? []
      : [
          'LinkedIn/profile details',
          'company information',
          'role/title',
          'job or opportunity context',
          'website with extractable data',
          'real inbound conversation context',
        ],
  }
}
