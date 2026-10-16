
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { runV3Decision, type V2BridgeInput } from '@/lib/intelligence-v3/orchestrator'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import { V3_CANONICAL, V3_CONFIG_VERSION } from '@/lib/intelligence-v3/config'
import { initializeV3 } from '@/lib/intelligence-v3/index'
import { extractEventsFromSource } from './event-extractor'
import { buildV3ReuseKey, buildV3ReuseCacheKey } from './decision-reuse'
import { cleanCompanyName } from '@/lib/leads/normalize'
import { separateRoleFromEmployer } from '@/lib/intelligence-v2/extraction-pipeline'
import { deriveCommercialReading } from '@/lib/intelligence-v2/commercial-reading'
import { isLinkedInChromeLine, nameFromViewProfileLabel } from '@/lib/prospect/paste-normalize'
import { stripEmployerFromTitle } from '@/lib/leads/role-line'


export function buildV3BridgeInput(
  canonical: CanonicalProspectIntelligence,
  rawText: string,
  extractedEvents: Awaited<ReturnType<typeof extractEventsFromSource>>,
): V2BridgeInput {
  const intel = canonical.intelligence
  return {
    person: {
      fullName: intel.person.fullName,
      firstName: intel.person.firstName,
      title: intel.person.title,
      location: intel.person.location,
      linkedinUrl: intel.person.linkedinUrl,
      affiliations: intel.person.affiliations?.map((a) => ({
        organizationName: a.organizationName,
        role: a.role ?? undefined,
        relationship: a.relationship,
        isCurrent: a.isCurrent,
      })),
    },
    company: {
      name: intel.company.name,
      domain: intel.company.domain,
      industry: intel.company.industry,
      size: intel.company.size,
    },
    opportunity: {
      signals: intel.opportunity.signals as string[],
      description: intel.opportunity.description,
      organizationName: intel.opportunity.organizationName ?? intel.company.name ?? undefined,
      temporalScope: intel.opportunity.temporalScope as string | undefined,
      polarity: intel.opportunity.polarity as string | undefined,
    },
    job: intel.job ? {
      title: intel.job.title,
      skills: intel.job.skills,
      workplaceType: intel.job.workplaceType,
      employmentType: intel.job.employmentType,
    } : null,
    content: {
      recentPosts: intel.content.recentPosts.map((p) => ({
        paraphrase: p.paraphrase,
        verbatimQuote: p.verbatimQuote,
        signals: p.signals as string[],
      })),
      hiringSignals: intel.content.hiringSignals,
      technicalSignals: intel.content.technicalSignals,
    },
    businessModel: intel.businessModel as string,
    relationship: intel.relationship as string,
    commercialReading: canonical.intelligence.commercialReading ? {
      serviceBuyerIntent: (canonical.intelligence.commercialReading as { serviceBuyerIntent: string }).serviceBuyerIntent,
      externalEngineeringNeed: (canonical.intelligence.commercialReading as { externalEngineeringNeed: string }).externalEngineeringNeed,
      buyerEvidenceKinds: (canonical.intelligence.commercialReading as { buyerEvidenceKinds?: string[] }).buyerEvidenceKinds ?? [],
    } : undefined,
    evidenceLedger: canonical.evidenceLedger.map((e) => ({
      signal: e.signal,
      source: e.source,
      evidenceType: e.evidenceType,
      ownership: e.ownership as string,
      confidence: e.confidence,
      verbatimQuote: e.verbatimQuote,
      needOwnership: e.needOwnership ?? undefined,
      temporalScope: e.temporalScope ?? undefined,
      polarity: e.polarity ?? undefined,
      organizationName: e.organizationName ?? undefined,
    })),
    rawInput: rawText,
    sourceEvents: extractedEvents.map((e) => ({
      organizationName: e.organizationName,
      eventType: e.eventType,
      description: e.evidenceQuote,
      explicitRequest: e.explicitness === 'EXPLICIT',
      needOwner: e.needOwner,
      requestedCapabilities: e.requestedCapabilities,
      requestedAssets: e.requestedAssets,
      applicationChannels: e.applicationChannels,
      applyInstructions: e.applyInstructions,
      contactRoute: null,
      occurredAt: e.ageDays ? new Date(Date.now() - e.ageDays * 86400000).toISOString() : null,
      ageDays: e.ageDays,
      evidenceType: e.confidence > 0.7 ? 'FACT' as const : e.confidence > 0.4 ? 'STRONG_INFERENCE' as const : 'WEAK_INFERENCE' as const,
    })),
  }
}


function v3PacketToCanonical(
  packet: V3LeadDecisionPacket,
  v2Canonical: CanonicalProspectIntelligence,
): CanonicalProspectIntelligence {
  const v2Qualification: CanonicalProspectIntelligence['qualification'] = (() => {
    switch (packet.qualification) {
      case 'STRONG': return 'strong'
      case 'WORTH_PURSUING': return 'worth_pursuing'
      case 'MAYBE': return 'maybe'
      case 'SKIP': return 'skip'
      case 'INELIGIBLE': return 'skip'
      default: return 'maybe'
    }
  })()

  const scoreBreakdown = {
    dimensions: packet.dimensions ?? [],
    hardNegatives: [],
    missingInfo: [],
    total: packet.score,
    label: packet.label,
    reasons: packet.reasons,
    watchOut: packet.watchOut,
    calculation: packet.scoreCalculation ?? null,
    decisionAdjustments: packet.decisionAdjustments ?? [],
  }

  // The selected episode's verbatim evidence is the evidence ledger; an
  // empty ledger left every score row without a citable source.
  const evidenceLedger: CanonicalProspectIntelligence['evidenceLedger'] = (packet.evidenceQuotes ?? [])
    .filter((q) => q.verbatim)
    .map((q) => ({
      signal: q.quote,
      source: 'pasted_text' as const,
      evidenceType: 'FACT' as const,
      ownership: q.needOwner === 'HIRING_NEED' ? 'HIRING_INTENT' as const : 'BUYER_INTENT' as const,
      confidence: 'HIGH' as const,
      safeForOutreach: true,
      verbatimQuote: q.quote,
    }))

  return {
    ...v2Canonical,
    confidence: Math.round((packet.confidence ?? 0) * 100),
    evidenceLedger: evidenceLedger.length > 0 ? evidenceLedger : v2Canonical.evidenceLedger,
    intelligenceRunId: packet.decisionRunId,
    intelligenceVersion: V3_CONFIG_VERSION,
    computedAt: new Date().toISOString(),
    canonicalScore: packet.score,
    scoreVersion: packet.scoreVersion,
    scoredAt: new Date().toISOString(),
    qualification: v2Qualification,
    scoreBreakdown: scoreBreakdown as unknown as CanonicalProspectIntelligence['scoreBreakdown'],
    // Preserve V3 packet in the intelligence blob for downstream access
    v3DecisionPacket: packet as unknown as Record<string, unknown>,
    // Keep V2 data intact for rollback/comparison
    v2CanonicalScore: v2Canonical.canonicalScore,
    v2Qualification: v2Canonical.qualification,
  } as CanonicalProspectIntelligence
}


export interface V3BridgeResult {
  intelligence: CanonicalProspectIntelligence
  v3Packet: V3LeadDecisionPacket | null
  v3Canonical: boolean
  v2Fallback: boolean
}

export interface V3IntelligenceOptions {
  senderCapabilities?: string[]
  onStatus?: (msg: string) => void
  /** Selected profile ID for sender context */
  profileId?: string | null
  /** Profile intelligence version for cache key */
  profileIntelligenceVersion?: string | null
  /** Reuse callback — looks up cached DecisionPacket by reuse key */
  reuseIfUnchanged?: (reuseKey: string) => Promise<V3LeadDecisionPacket | null>
  /** Force reanalysis even if cache match exists */
  forceReanalyze?: boolean
}

/**
 * Comprehensive company extraction from LinkedIn profile text.
 * Tries every possible location and format. Never returns null if
 * a company name exists anywhere in the profile.
 */
function extractCompanyFromProfile(
  rawText: string,
  lines: string[],
  title: string | null,
  identityLines: string[],
): string | null {
  if (title) {
    const atMatch = title.match(/\s+at\s+([A-Z][A-Za-z0-9._&\-\s,]+?)(?:\s*[|·—]|$)/i)
    if (atMatch) return cleanOrgName(atMatch[1])
  }

  if (title) {
    const commaParts = title.split(',').map(p => p.trim())
    if (commaParts.length >= 2) {
      const candidate = commaParts[1].split(/\s*[|·—]/)[0].trim()
      if (isLikelyCompanyName(candidate)) return cleanOrgName(candidate)
    }
  }

  if (title) {
    const atSymbolMatch = title.match(/@\s*([A-Z][A-Za-z0-9._&\-]+)/i)
    if (atSymbolMatch) return cleanOrgName(atSymbolMatch[1])
  }

  if (title) {
    const dashMatch = title.match(/[—–-]\s*([A-Z][A-Za-z0-9._&\-\s]+)$/i)
    if (dashMatch) {
      const candidate = dashMatch[1].trim()
      // Reject single-word role fragments like "Operations", "Manager",
      // "Engineering" — these are title qualifiers, not company names.
      const wordCount = candidate.split(/\s+/).length
      const isSingleRoleWord = wordCount === 1 && looksLikeRole(candidate)
      if (isLikelyCompanyName(candidate) && !isSingleRoleWord) return cleanOrgName(candidate)
    }
  }

  if (title) {
    const pipeParts = title.split(/\s*\|\s*/).map(p => p.trim())
    if (pipeParts.length >= 2) {
      for (const part of pipeParts) {
        if (isLikelyCompanyName(part) && !looksLikeRole(part)) {
          return cleanOrgName(part)
        }
      }
    }
  }

  const expIdx = lines.findIndex((l) => /^experience$/i.test(l))
  if (expIdx >= 0) {
    for (let i = expIdx + 1; i < Math.min(expIdx + 10, lines.length); i++) {
      const line = lines[i]
      if (/^(education|skills|licenses?|projects|recommendations|about|activity|show\s+all)$/i.test(line)) break

      // Pattern: "Company · Full-time" or "Company | Full-time"
      const sepMatch = line.match(/^([A-Z][A-Za-z0-9._&\-\s]+?)\s*[·|]\s*(Full-time|Part-time|Contract|Freelance|Self-employed)/i)
      if (sepMatch) return cleanOrgName(sepMatch[1])

      // Pattern: "Company, Location" (experience header)
      const commaMatch = line.match(/^([A-Z][A-Za-z0-9._&\-\s]+?)\s*,\s*[A-Z][a-z]+/)
      if (commaMatch && isLikelyCompanyName(commaMatch[1])) return cleanOrgName(commaMatch[1])

      // Pattern: "Company" standalone line (organization name only)
      const standaloneMatch = line.match(/^([A-Z][A-Za-z0-9._&\-\s]{2,40})$/)
      if (standaloneMatch && isLikelyCompanyName(standaloneMatch[1]) && !looksLikeRole(standaloneMatch[1])) {
        return cleanOrgName(standaloneMatch[1])
      }
    }
  }

  const aboutIdx = lines.findIndex((l) => /^about$/i.test(l))
  if (aboutIdx >= 0) {
    const aboutText = lines.slice(aboutIdx + 1, aboutIdx + 10).join(' ')
    const aboutPatterns = [
      /(?:founder|co-founder|ceo|cto|chief|president|vp|head|director|manager|lead|engineer|developer)\s+(?:of|at|@)\s+([A-Z][A-Za-z0-9._&\-\s,]+?)(?:\.|,|\s+and|\s+with|\s+serving|\s+based|\s+that|\s+which|\s+—)/i,
      /(?:started|built|launched|joined)\s+(?:@?\s*)?([A-Z][A-Za-z0-9._&\-]+)/i,
      /(?:my\s+(?:company|firm|agency|startup|business))\s+(?:is|called|named)?\s*([A-Z][A-Za-z0-9._&\-]+)/i,
    ]
    for (const pattern of aboutPatterns) {
      const match = aboutText.match(pattern)
      if (match && isLikelyCompanyName(match[1])) return cleanOrgName(match[1])
    }
  }

  for (const line of identityLines) {
    // Skip the name line and title line
    if (line === identityLines[0]) continue
    if (looksLikeRole(line)) continue

    // Look for company-like patterns in identity lines
    const cleanLine = line.replace(/·/g, '|').trim()
    const parts = cleanLine.split(/\s*[|]\s*/)
    for (const part of parts) {
      if (isLikelyCompanyName(part) && !looksLikeRole(part)) {
        return cleanOrgName(part)
      }
    }
  }

  const rawPatterns = [
    /(?:^|\n)\s*([A-Z][A-Za-z0-9._&\-]+(?:\s+[A-Z][a-z]+)*)\s*[·]\s*(?:Full-time|Part-time|Contract)/m,
    /(?:Company|Organization|Employer):\s*([A-Z][A-Za-z0-9._&\-\s]+)/i,
  ]
  for (const pattern of rawPatterns) {
    const match = rawText.match(pattern)
    if (match && isLikelyCompanyName(match[1])) return cleanOrgName(match[1])
  }

  return null
}

/** Clean up extracted organization name — delegates to canonical cleaner */
function cleanOrgName(name: string): string {
  return cleanCompanyName(name.trim()) ?? ''
}

/** Check if a string looks like a company name (not a role or noise) */
function isLikelyCompanyName(candidate: string): boolean {
  if (!candidate || candidate.length < 2 || candidate.length > 60) return false
  const lower = candidate.toLowerCase().trim()

  if (looksLikeRole(candidate)) return false

  const rejectPatterns = [
    /^(the|a|an|this|that|my|our|their|his|her|its)$/i,
    /^(open|close|view|show|more|less|edit|delete|add|create)$/i,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    /^(present|current|former|previous)$/i,
    /^(remote|hybrid|on-site|onsite)$/i,
    /^\d+$/,
  ]
  for (const p of rejectPatterns) {
    if (p.test(lower)) return false
  }

  if (!/^[A-Z]/.test(candidate) && !/^[A-Z]{2,}$/.test(candidate)) return false

  return true
}

/** Check if a string looks like a job role (not a company) */
function looksLikeRole(text: string): boolean {
  const roleKeywords = [
    'founder', 'co-founder', 'ceo', 'cto', 'cfo', 'cio', 'coo', 'chief',
    'officer', 'president', 'vp', 'vice', 'head', 'director', 'manager',
    'lead', 'senior', 'junior', 'principal', 'staff', 'engineer', 'developer',
    'architect', 'designer', 'analyst', 'consultant', 'recruiter', 'rekruter', 'rekruterka', 'headhunter', 'sourcer', 'specialist',
    'coordinator', 'administrator', 'assistant', 'associate', 'intern',
    'talent', 'acquisition', 'hiring', 'human', 'resources', 'marketing',
    'sales', 'operations', 'product', 'project', 'program', 'account',
    'business', 'customer', 'success', 'support', 'quality', 'assurance',
    'full-stack', 'front-end', 'back-end', 'fullstack', 'frontend', 'backend',
    'software', 'hardware', 'systems', 'network', 'security', 'data', 'science',
    'machine', 'learning', 'artificial', 'intelligence', 'devops', 'sre',
    'infrastructure', 'platform', 'cloud', 'site', 'reliability',
  ]
  const lower = text.toLowerCase()
  return roleKeywords.some(kw => lower.includes(kw))
}

/**
 * Build a minimal V2 canonical structure WITHOUT AI calls.
 * Used only when V3 is canonical — V3's event extractor works from raw text,
 * so we only need basic normalization (not full AI extraction).
 * Saves 2-3 AI calls per extraction.
 */
const SECTION_HEADER = /^(about|activity|experience|posts?|comments?|education|skills|highlights|contact\s*info|show\s*all|linkedin\s+post:?|post:?)$/i
const ROLE_WORDS = /\b(founder|ceo|cto|cfo|chief|officer|vp|head|director|manager|lead|engineer|developer|architect|recruiter|rekruter(?:ka)?|headhunter|sourcer|consultant|president|owner|partner)\b/i
const LABELED_FIELD = /^(name|company|organization|employer|role|title|position|location|headline)\s*:\s*(.*)$/i

function labeledField(lines: string[], ...labels: string[]): string | null {
  for (const line of lines) {
    const m = line.match(LABELED_FIELD)
    if (m && labels.includes(m[1].toLowerCase()) && m[2].trim()) return m[2].trim()
  }
  return null
}

/** A line that reads as a person's name: 2-4 capitalized words, no role words or punctuation. */
function looksLikePersonName(line: string): boolean {
  const t = line.trim()
  if (!/^[\p{L}][\p{L} .'’-]{2,60}$/u.test(t)) return false
  if (ROLE_WORDS.test(t) || isLinkedInChromeLine(t)) return false
  const words = t.split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  return words.every((w) => /^[\p{Lu}]/u.test(w) || /^(de|da|van|von|bin|al|del|la|le)$/i.test(w))
}

/**
 * Identity lines are the short header lines before the content starts —
 * a section header, a labeled post, or the first full sentence. Without a
 * section header the old slice(0, -1) treated the whole post as header.
 */
export function splitIdentityAndBody(lines: string[]): { identity: string[]; body: string[] } {
  let end = lines.findIndex((l, i) =>
    SECTION_HEADER.test(l)
    || (i > 0 && !LABELED_FIELD.test(l) && (l.length > 90 || /[.!?]["”']?$/.test(l) && l.split(/\s+/).length > 6)),
  )
  if (end === -1) end = Math.min(lines.length, 4)
  const identity = lines.slice(0, end)
  const body = lines.slice(end).filter((l) => !SECTION_HEADER.test(l) && !LABELED_FIELD.test(l) && !isLinkedInChromeLine(l))
  return { identity, body }
}

function pickPersonName(identityLines: string[], allLines: string[]): string | null {
  const labeled = labeledField(allLines, 'name')
  if (labeled) return labeled
  for (const line of identityLines) {
    const fromLabel = nameFromViewProfileLabel(line)
    if (fromLabel && looksLikePersonName(fromLabel)) return fromLabel
  }
  const named = identityLines.find(looksLikePersonName)
  if (named) return named
  const first = identityLines.find((l) => !isLinkedInChromeLine(l))
  const candidate = first?.split(/\s+·\s+/)[0]?.split(/\s+at\s+/)[0]?.trim() ?? ''
  return candidate && !ROLE_WORDS.test(candidate) && candidate.split(/\s+/).length <= 5 ? candidate : null
}

export function buildMinimalV2Canonical(rawText: string): CanonicalProspectIntelligence {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l && !isLinkedInChromeLine(l))
  const { identity: identityLines, body: bodyLines } = splitIdentityAndBody(lines)

  const name = pickPersonName(identityLines, lines)

  // Title: a labeled role, else the identity line with role keywords.
  const titleLine = labeledField(lines, 'role', 'title', 'position', 'headline')
    ?? identityLines.find((line) => ROLE_WORDS.test(line))
  const title = titleLine
    ? titleLine.split(/\s*\|\s*/)[0].replace(/·/g, '').trim().slice(0, 120) || null
    : null

  // Company: multi-strategy extraction, then reject a role line saved as the employer.
  const extractedCompany = labeledField(lines, 'company', 'organization', 'employer')
    ?? extractCompanyFromProfile(rawText, lines, title, identityLines)
  const identity = separateRoleFromEmployer(rawText, title, extractedCompany)
  const companyName = identity.company
  const resolvedTitle = stripEmployerFromTitle(identity.title ?? title, companyName)

  // The opportunity text is the body, not the first 200 characters of the
  // paste — budget and timing usually sit at the end of a brief.
  const opportunityText = bodyLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200) || null
  const completenessChecks: Array<[string, boolean]> = [
    ['name', Boolean(name)],
    ['title', Boolean(resolvedTitle)],
    ['company', Boolean(companyName)],
    ['opportunity_text', Boolean(opportunityText && opportunityText.length >= 40)],
  ]
  const presentFields = completenessChecks.filter(([, ok]) => ok).map(([f]) => f)
  const missingFields = completenessChecks.filter(([, ok]) => !ok).map(([f]) => f)
  const completenessScore = Math.round((presentFields.length / completenessChecks.length) * 100)

  return {
    version: 'relay_qualification_v2',
    intelligenceRunId: `v3light_${Date.now().toString(36)}`,
    intelligenceInputHash: rawText.slice(0, 100),
    intelligenceVersion: 'relay_decision_v3_light',
    computedAt: new Date().toISOString(),
    canonicalScore: 50,
    scoreVersion: 'relay_decision_v3_light',
    scoredAt: new Date().toISOString(),
    scoreBreakdown: { dimensions: [], hardNegatives: [], missingInfo: [], total: 50, label: 'Unknown — V3 will assess', reasons: [], watchOut: [] },
    confidence: 50,
    qualification: 'maybe',
    intelligence: {
      person: { fullName: name || null, firstName: name?.split(' ')[0] || null, title: resolvedTitle, seniority: null, location: null, linkedinUrl: null, otherUrls: [] },
      company: { name: companyName, domain: null, linkedinUrl: null, industry: null, size: null, sizeEvidence: null, product: null, stage: null, stageEvidence: null },
      opportunity: { signals: [], primarySignal: null, description: opportunityText, urgency: 'unknown' },
      job: { title: null, employmentType: 'unknown', workplaceType: 'UNKNOWN', allowedGeography: null, timezone: null, compensation: null, skills: [], seniority: 'unknown', source: null, postedDate: null },
      content: { recentPosts: [], topics: [], explicitProblems: [], initiatives: [], launches: [], technicalSignals: [], hiringSignals: [] },
      probableNeed: null,
      opportunityTrigger: null,
      timingSignal: null,
      risks: [],
      unknowns: [],
      resolvedContradictions: [],
      businessModel: 'PRODUCT',
      relationship: 'UNKNOWN',
      commercialReading: deriveCommercialReading(rawText),
      remoteEligibility: { workplaceType: 'REMOTE', remoteScope: 'UNKNOWN', eligibility: 'ELIGIBLE', reason: 'No restrictions stated', evidence: [] },
      needOwnershipSummary: { dominant: 'UNKNOWN', counts: { SELF_NEED: 0, CUSTOMER_NEED: 0, MARKET_PROBLEM: 0, SERVICE_OFFERING: 0, PRODUCT_PROBLEM: 0, EMPLOYER_NEED: 0, UNKNOWN: 0 } },
    },
    rawSource: { rawInput: rawText, sourceType: 'mixed' as const, sourceUrl: null, profileUrl: null, companyUrl: null, jobUrl: null, postUrls: [], rawPosts: [], rawJobDescription: null, rawProfileText: rawText.slice(0, 500), rawCompanyText: null, capturedAt: new Date().toISOString() },
    evidenceLedger: [],
    remoteEligibility: { workplaceType: 'REMOTE', remoteScope: 'UNKNOWN', eligibility: 'ELIGIBLE', reason: 'No restrictions stated', evidence: [] },
    extractionCompleteness: { score: completenessScore, presentFields, missingFields, weakFields: [], repairAttempted: false, repairImproved: false, sourceUrlsFound: [], urlsPreserved: [] },
    rescoreEvents: [],
    recommendedIdentityId: null,
    recommendedProofIds: [],
    personalizationAngle: null,
    outreachContext: { whyNow: null, probableNeed: null, bestProof: null, personalizationAnchor: null, messageGoal: null, cta: null, thingsNotToClaim: [] },
    extractionCallLog: [],
    extractionTrace: [{ stage: 'v3_light_extraction', ms: 0, provider: 'deterministic' }],
  }
}

/**
 * Produce intelligence using V3 as canonical when enabled.
 * Falls back to V2 if V3 fails or is disabled.
 * Reuses cached DecisionPacket when inputs + versions are unchanged.
 */
export async function produceV3Intelligence(
  rawText: string,
  options: V3IntelligenceOptions = {},
): Promise<V3BridgeResult> {
  const {
    senderCapabilities = [],
    onStatus,
    profileId = null,
    profileIntelligenceVersion = null,
    reuseIfUnchanged,
    forceReanalyze = false,
  } = options

  // Step 1: Run V2 extraction (V3 mode uses it for normalization + fallback)
  onStatus?.('Analyzing prospect...')

  let v2Canonical: CanonicalProspectIntelligence

  if (!V3_CANONICAL) {
    const v2Result = await produceCanonicalIntelligence(rawText, {
      onStatus: (msg) => emitV3Status(msg, onStatus),
    })
    v2Canonical = v2Result.intelligence
    return {
      intelligence: v2Canonical,
      v3Packet: null,
      v3Canonical: false,
      v2Fallback: false,
    }
  }

  // V3 canonical mode: Build minimal V2 structure deterministically (no AI calls).
  // V3's extractEventsFromSource re-extracts events from raw text independently,
  // so we only need the basic normalization here — not a full AI extraction.
  v2Canonical = buildMinimalV2Canonical(rawText)

  // Step 3: Check for reusable DecisionPacket
  const reuseKey = buildV3ReuseKey({
    rawText,
    profileId,
    profileIntelligenceVersion,
    senderCapabilities,
  })

  if (reuseIfUnchanged && !forceReanalyze) {
    onStatus?.('Checking for existing decision...')
    const cached = await reuseIfUnchanged(reuseKey)
    if (cached) {
      onStatus?.('Reusing existing decision — inputs unchanged.')
      const canonical = v3PacketToCanonical(cached, v2Canonical)
      return {
        intelligence: canonical,
        v3Packet: cached,
        v3Canonical: true,
        v2Fallback: false,
      }
    }
  }

  // Step 4: Run V3 decision on top of V2 extraction
  onStatus?.('Running V3 opportunity analysis...')

  try {
    // Initialize providers (registers OpenAI, LongCat, etc.)
    initializeV3()

    const extractedEvents = await extractEventsFromSource(rawText, v2Canonical)

    const bridgeInput = buildV3BridgeInput(v2Canonical, rawText, extractedEvents)

    const v3Result = await runV3Decision(bridgeInput, {
      senderCapabilities,
      productionScore: v2Canonical.canonicalScore ?? undefined,
      productionAction: v2Canonical.qualification,
      onStatus: (msg) => emitV3Status(msg, onStatus),
      v2Canonical,
    })

    const packet = v3Result.packet

    // Step 5: Map V3 packet to canonical output
    const canonical = v3PacketToCanonical(packet, v2Canonical)

    return {
      intelligence: canonical,
      v3Packet: packet,
      v3Canonical: true,
      v2Fallback: false,
    }
  } catch (err) {
    // V3 failed — fall back to V2
    console.warn('[V3 Bridge] V3 decision failed, falling back to V2:', err instanceof Error ? err.message : err)
    return {
      intelligence: v2Canonical,
      v3Packet: null,
      v3Canonical: false,
      v2Fallback: true,
    }
  }
}

function emitV3Status(v2Msg: string, onStatus?: (msg: string) => void) {
  const mapped = v2Msg
    .replace('Extracting prospect intelligence', 'Analyzing opportunity')
    .replace('Scoring prospect', 'Scoring opportunity episode')
  onStatus?.(mapped)
}
