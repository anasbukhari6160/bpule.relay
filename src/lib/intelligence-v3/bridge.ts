
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { runV3Decision, type V2BridgeInput } from '@/lib/intelligence-v3/orchestrator'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import { V3_CANONICAL } from '@/lib/intelligence-v3/config'
import { initializeV3 } from '@/lib/intelligence-v3/index'
import { extractEventsFromSource, type ExtractedEvent } from './event-extractor'
import { buildV3ReuseKey, ATTRIBUTION_VERSION } from './decision-reuse'
import { readSourceFacts } from './source-facts-model'
import { extractEventsDeterministically } from './deterministic-events'
import { isPacketCurrent, SCORING_VERSION } from './versions'
import { qualifyCanonicalScore, toStoredQualification } from '@/lib/scoring/qualification'
import type { V3DecisionProvider } from './decision/decision-provider'
import { cleanCompanyName } from '@/lib/leads/normalize'
import { extractHiringOrganization, extractStatedLocation, isPlausibleCompanyName, looksLikeJobAd, separateRoleFromEmployer } from '@/lib/intelligence-v2/extraction-pipeline'
import { deriveCommercialReading } from '@/lib/intelligence-v2/commercial-reading'
import { isLinkedInChromeLine, nameFromViewProfileLabel } from '@/lib/prospect/paste-normalize'
import { stripEmployerFromTitle } from '@/lib/leads/role-line'


export function buildV3BridgeInput(
  canonical: CanonicalProspectIntelligence,
  rawText: string,
  extractedEvents: Awaited<ReturnType<typeof extractEventsFromSource>>,
  referenceDate: Date = new Date(),
): V2BridgeInput {
  const intel = canonical.intelligence
  // Event timestamps are anchored to the SAME reference date the episode
  // builder measures age against. Anchoring to the wall clock made the age
  // (and therefore status/timing/score) flip across a day boundary mid-run.
  const refMs = referenceDate.getTime()
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
      occurredAt: e.ageDays ? new Date(refMs - e.ageDays * 86400000).toISOString() : null,
      ageDays: e.ageDays,
      evidenceType: e.confidence > 0.7 ? 'FACT' as const : e.confidence > 0.4 ? 'STRONG_INFERENCE' as const : 'WEAK_INFERENCE' as const,
    })),
  }
}


export function v3PacketToCanonical(
  packet: V3LeadDecisionPacket,
  v2Canonical: CanonicalProspectIntelligence,
): CanonicalProspectIntelligence {
  // One qualification policy, derived from the score so a stored packet can
  // never carry a band that disagrees with its own number.
  const v2Qualification: CanonicalProspectIntelligence['qualification'] = packet.qualification === 'INELIGIBLE'
    ? 'skip'
    : toStoredQualification(qualifyCanonicalScore(packet.score).qualification)

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

  // Last resort for the company: the organization the event extractor named
  // for the selected episode, only when that exact name is in the source.
  const selectedEpisode = packet.episodes.find((e) => e.id === packet.selectedEpisodeId)
  const episodeOrg = selectedEpisode?.organizationName?.trim()
  const rawInput = v2Canonical.rawSource?.rawInput ?? ''
  const companyFromEpisode = !v2Canonical.intelligence.company.name
    && episodeOrg && !/^unknown$/i.test(episodeOrg)
    && rawInput.toLowerCase().includes(episodeOrg.toLowerCase())
    ? episodeOrg
    : null
  const baseIntelligence = companyFromEpisode
    ? { ...v2Canonical.intelligence, company: { ...v2Canonical.intelligence.company, name: companyFromEpisode } }
    : v2Canonical.intelligence
  // Industry is the current organization's (packet.orgContext), never a past role's.
  const currentIndustry = packet.orgContext?.currentIndustry ?? null
  const intelligence = currentIndustry
    ? { ...baseIntelligence, company: { ...baseIntelligence.company, industry: currentIndustry } }
    : baseIntelligence

  const analyzedAt = packet.versions?.analyzedAt ?? new Date().toISOString()
  return {
    ...v2Canonical,
    intelligence,
    confidence: Math.round((packet.confidence ?? 0) * 100),
    evidenceLedger: evidenceLedger.length > 0 ? evidenceLedger : v2Canonical.evidenceLedger,
    intelligenceRunId: packet.decisionRunId,
    intelligenceVersion: SCORING_VERSION,
    attributionVersion: ATTRIBUTION_VERSION,
    computedAt: analyzedAt,
    canonicalScore: packet.score,
    scoreVersion: packet.scoreVersion,
    scoredAt: analyzedAt,
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
  /** @deprecated sender data never enters the opportunity decision. */
  senderCapabilities?: string[]
  onStatus?: (msg: string) => void
  /** @deprecated the opportunity decision is sender-independent; kept for callers. */
  profileId?: string | null
  /** @deprecated */
  profileIntelligenceVersion?: string | null
  /** Reuse callback — looks up cached DecisionPacket by reuse key */
  reuseIfUnchanged?: (reuseKey: string) => Promise<V3LeadDecisionPacket | null>
  /** Force reanalysis even if cache match exists */
  forceReanalyze?: boolean
  /** Pre-extracted events (tests, shadow runs). Skips the event-extraction model. */
  events?: ExtractedEvent[]
  /** Inject a decision provider (tests, shadow runs). */
  decisionProvider?: V3DecisionProvider | null
  /** Run with no model calls at all: deterministic events + deterministic decision. */
  deterministicOnly?: boolean
  /** Keep the decision model but never call the event-extraction model (replays, saves). */
  skipEventModel?: boolean
  /** Organization capability set for fit. */
  orgCapabilities?: string[]
  /** Reference date for staleness. */
  referenceDate?: Date
  /** Persisted with the model calls this run makes. */
  trace?: {
    organizationId?: string | null
    repId?: string | null
    leadId?: string | null
  }
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
    const atSymbolMatch = title.match(/@\s*([A-Z][A-Za-z0-9._&\-,]+?)(?:\s*[|·—]|$)/i)
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

  // Reject standalone legal suffixes
  const legalSuffixes = ['inc', 'inc.', 'ltd', 'ltd.', 'llc', 'gmbh', 'corp', 'corp.', 'co', 'co.', 'sa', 's.a.', 'bv', 'nv', 'plc', 'llp', 'lp']
  if (legalSuffixes.includes(lower)) return false

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

const NOT_A_PERSON = /\b(?:hiring|we(?:'|’)?re|we\s+are|join|apply|vacanc(?:y|ies)|openings?|jobs?|careers?|urgent(?:ly)?|now|looking\s+for|position|opportunity)\b/i

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
  // A job-ad banner ("We're Hiring!", "Join our team") is not a person.
  if (!candidate || /[!?:]/.test(candidate) || !/^[\p{Lu}]/u.test(candidate) || NOT_A_PERSON.test(candidate)) return null
  return !ROLE_WORDS.test(candidate) && candidate.split(/\s+/).length <= 5 ? candidate : null
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
  // Job ads name the hiring organization in the text; profile heuristics
  // (headline "Role at Company", experience block) are for profiles.
  const hiringOrg = extractHiringOrganization(rawText)
  const profileCompany = extractCompanyFromProfile(rawText, lines, title, identityLines)
  const plausibleProfileCompany = isPlausibleCompanyName(profileCompany) ? profileCompany : null
  // A headline "Role at Company" names the current employer; a hiring line
  // elsewhere in a profile must not replace it.
  const headlineEmployer = title && /\s(?:at|@)\s/i.test(title) ? plausibleProfileCompany : null
  const extractedCompany = labeledField(lines, 'company', 'organization', 'employer')
    ?? headlineEmployer
    ?? (looksLikeJobAd(rawText) ? hiringOrg?.name ?? null : null)
    // A registered name in the header ("Founder | Kestrel Digital (Pvt) Ltd")
    // is stated outright; the profile heuristics are a guess.
    ?? (hiringOrg?.method === 'legal_name' ? hiringOrg.name : null)
    ?? plausibleProfileCompany
    ?? hiringOrg?.name
    ?? null
  const identity = separateRoleFromEmployer(rawText, title, extractedCompany)
  const companyName = identity.company ?? extractedCompany
  const statedLocation = extractStatedLocation(rawText)
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
      person: { fullName: name || null, firstName: name?.split(' ')[0] || null, title: resolvedTitle, seniority: null, location: statedLocation?.value ?? null, linkedinUrl: null, otherUrls: [] },
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
    onStatus,
    reuseIfUnchanged,
    forceReanalyze = false,
    orgCapabilities,
  } = options

  // Step 1: Run V2 extraction (V3 mode uses it for normalization + fallback)
  onStatus?.('Analyzing prospect...')

  let v2Canonical: CanonicalProspectIntelligence

  if (!V3_CANONICAL && !options.deterministicOnly && !options.decisionProvider && !options.events) {
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
  v2Canonical = buildMinimalV2Canonical(rawText)
  const sourceFacts = readSourceFacts(rawText, {
    identity: {
      name: v2Canonical.intelligence.person.fullName,
      title: v2Canonical.intelligence.person.title,
      company: v2Canonical.intelligence.company.name,
      location: v2Canonical.intelligence.person.location,
    },
  })

  // Step 3: Check for a reusable DecisionPacket. The key is sender-independent;
  // a cached packet from an older scoring version is never served.
  const reuseKey = buildV3ReuseKey({ rawText, orgCapabilities })

  if (reuseIfUnchanged && !forceReanalyze) {
    onStatus?.('Checking for existing decision...')
    const cached = await reuseIfUnchanged(reuseKey)
    if (cached && isPacketCurrent(cached.versions)) {
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

  // Step 4: Events. The structured model extracts them when available; the
  // verified source facts are the fallback, so a failed API call never
  // loses an explicit request.
  onStatus?.('Running V3 opportunity analysis...')
  const runPipeline = async (deterministicOnly: boolean) => {
    if (!deterministicOnly) initializeV3()
    let events: ExtractedEvent[] = []
    let eventSource: 'model' | 'deterministic' | 'none' = 'none'
    if (options.events) {
      events = options.events
      eventSource = 'model'
    } else if (!deterministicOnly && !options.skipEventModel && process.env.OPENAI_API_KEY) {
      events = await extractEventsFromSource(rawText, v2Canonical, options.trace)
      eventSource = events.length > 0 ? 'model' : 'none'
    }
    if (events.length === 0) {
      events = extractEventsDeterministically(rawText, sourceFacts)
      eventSource = events.length > 0 ? 'deterministic' : 'none'
    }

    const referenceDate = options.referenceDate ?? new Date()
    const bridgeInput = buildV3BridgeInput(v2Canonical, rawText, events, referenceDate)
    const v3Result = await runV3Decision(bridgeInput, {
      onStatus: (msg) => emitV3Status(msg, onStatus),
      v2Canonical,
      sourceFacts,
      eventSource,
      orgCapabilities,
      decisionProvider: options.decisionProvider ?? undefined,
      deterministicOnly,
      referenceDate: options.referenceDate,
      trace: options.trace,
    })
    // The events and reference date travel with the packet so a later
    // replay (save, shadow run) scores the same inputs and lands on the
    // same number instead of re-extracting events deterministically.
    return { ...v3Result.packet, events, decidedAt: referenceDate.toISOString() }
  }

  try {
    const packet = await runPipeline(options.deterministicOnly === true)
    return {
      intelligence: v3PacketToCanonical(packet, v2Canonical),
      v3Packet: packet,
      v3Canonical: true,
      v2Fallback: false,
    }
  } catch (err) {
    // The model path failed. Never return an invented score: run the same
    // pipeline with no model calls, which keeps the verified facts, reports
    // LOW confidence and marks the packet as a fallback.
    console.warn('[V3 Bridge] V3 decision failed, using deterministic fallback:', err instanceof Error ? err.message : err)
    try {
      const packet = await runPipeline(true)
      return {
        intelligence: v3PacketToCanonical(packet, v2Canonical),
        v3Packet: packet,
        v3Canonical: true,
        v2Fallback: true,
      }
    } catch (inner) {
      console.error('[V3 Bridge] deterministic fallback failed:', inner instanceof Error ? inner.message : inner)
      throw inner
    }
  }
}

/**
 * Re-derive a packet from a stored one WITHOUT a model call: the stored
 * bounded decision is replayed through the current deterministic layers
 * (source facts, buyer intent, score, confidence, action). Used by save to
 * make the persisted score the server's own, and by shadow runs.
 */
export async function recomputePacketFromStored(
  rawText: string,
  stored: V3LeadDecisionPacket,
  opts: { orgCapabilities?: string[]; referenceDate?: Date } = {},
): Promise<V3LeadDecisionPacket> {
  const replay: V3DecisionProvider = {
    id: stored.decisionProvider || 'replay',
    modelVersion: stored.decisionModel || 'replay',
    isAvailable: () => true,
    decide: async () => ({
      answers: {
        relationship: stored.decision.relationship,
        buyerRequestProbability: stored.buyerIntent?.claims.modelBuyerProbability ?? stored.decision.buyerRequestProbability,
        externalNeedProbability: stored.buyerIntent?.claims.modelExternalNeedProbability ?? stored.decision.externalNeedProbability,
        needOwner: stored.decision.needOwnerType,
        fit: stored.decision.fit,
        timing: stored.decision.timing,
        access: stored.decision.access,
        messageEligible: stored.decision.messageEligible,
      },
      providerId: stored.decisionProvider || 'replay',
      modelVersion: stored.decisionModel || 'replay',
      latencyMs: 0,
      confidence: stored.decision.providerConfidence,
    }),
  }
  // Replay the events the shown decision was made from, at the date it was
  // made. Re-extracting events deterministically here produced a different
  // episode set than the model path, so the saved score drifted from the
  // Prospect score (54 -> 55 across a band boundary). Packets saved before
  // events were persisted still fall back to deterministic extraction.
  const storedEvents = Array.isArray(stored.events) && stored.events.length > 0 ? stored.events : undefined
  const storedDate = stored.decidedAt ? new Date(stored.decidedAt) : undefined
  const result = await produceV3Intelligence(rawText, {
    decisionProvider: replay,
    orgCapabilities: opts.orgCapabilities,
    referenceDate: opts.referenceDate ?? (storedDate && !Number.isNaN(storedDate.getTime()) ? storedDate : undefined),
    events: storedEvents,
    // Deterministic events only — never a second extraction call on save.
    skipEventModel: true,
  })
  if (!result.v3Packet) throw new Error('recomputePacketFromStored: no packet produced')
  return result.v3Packet
}

function emitV3Status(v2Msg: string, onStatus?: (msg: string) => void) {
  const mapped = v2Msg
    .replace('Extracting prospect intelligence', 'Analyzing opportunity')
    .replace('Scoring prospect', 'Scoring opportunity episode')
  onStatus?.(mapped)
}
