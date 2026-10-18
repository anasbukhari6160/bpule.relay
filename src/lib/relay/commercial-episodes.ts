/**
 * Commercial-Potential Episode Builder
 *
 * Creates opportunity episodes from verified founder/product/company activity
 * even when there is NO explicit buyer request.
 *
 * This fixes the "No opportunity episodes found" bug for active founders
 * like Salih, Okan, Cemal, Abdulhakim.
 */

export interface RawProfileInput {
  headline: string | null
  about: string | null
  experience: Array<{
    title: string
    company: string
    duration: string | string[] | null
    description: string | null
    current: boolean
  }>
  company: string | null
  title: string | string | null
  companyKey: string | null
  sourceText: string | null
}

export interface CommercialEpisode {
  id: string
  organizationName: string
  organizationId: string | null
  title: string
  authority: 'FOUNDER' | 'EXECUTIVE' | 'SENIOR' | 'TECHNICAL' | 'OPERATIONS' | 'UNKNOWN'
  commercialPotential: 'HIGH' | 'MEDIUM' | 'LOW'
  buyerIntent: 'UNKNOWN'
  externalNeed: 'UNPROVEN'
  buildIntensity: 'HIGH' | 'MEDIUM' | 'LOW'
  recentActivity: boolean
  capabilityOverlap: string[]
  access: 'DIRECT' | 'CONNECTION' | 'INDIRECT' | 'NONE'
  evidence: string[]
  source: 'headline' | 'about' | 'experience' | 'company_page'
  verified: boolean
}

// Authority keywords (multilingual-aware via semantic V3, but structural fallback)
const AUTHORITY_KEYWORDS = {
  FOUNDER: ['founder', 'co-founder', 'co founder', 'founder &', 'founder and', 'kurucu', 'kurucusu', 'ortak kurucu'],
  EXECUTIVE: ['ceo', 'cto', 'cfo', 'coo', 'chief', 'chief executive', 'chief technology', 'chief operating', 'başkan', 'müdür', 'genel müdür'],
  SENIOR: ['vp', 'vice president', 'head of', 'director', 'senior director', 'başkan', 'direktör'],
  TECHNICAL: ['engineer', 'developer', 'architect', 'technical lead', 'tech lead', 'fullstack', 'full-stack', 'backend', 'frontend', 'yazılım', 'geliştirici', 'mühendis'],
  OPERATIONS: ['operations', 'ops', 'manager', 'coordinator', 'specialist', 'operations manager'],
}

// Product/build activity indicators (multilingual-aware)
const BUILD_INDICATORS = [
  'building', 'shipping', 'launched', 'launching', 'released', 'releasing',
  'product', 'platform', 'mvp', 'pilot', 'beta', 'roadmap', 'development',
  'building', 'oluşturuyoruz', 'geliştiriyoruz', 'yayınladık', 'başlattık',
  'yeni ürün', 'ürün lansmanı', 'yazılım', 'yapay zeka', 'ai',
]

// Legal suffixes that should NOT be treated as company names
const LEGAL_SUFFIXES = ['inc', 'inc.', 'ltd', 'ltd.', 'llc', 'gmbh', 'corp', 'corp.', 'a.ş.', 'pvt ltd', 'limited']

/**
 * Extract company name from headline, preserving legal suffixes.
 * "Co-Founder & COO @ Docyrus, Inc." → "Docyrus, Inc."
 */
export function extractCompanyFromHeadline(headline: string): string | null {
  // Match @ Company or "at Company" — include commas, parentheses, and uppercase words
  const atMatch = headline.match(/[@at]\s+([A-Za-z0-9._&\-\s,()]+?)(?:\s*[|·—]|$)/i)
  if (atMatch) {
    return cleanCompanyName(atMatch[1])
  }

  // Match "Title, Company" pattern
  const commaParts = headline.split(',').map(p => p.trim())
  if (commaParts.length >= 2) {
    const candidate = commaParts[1].split(/\s*[|·—]/)[0].trim()
    if (isValidCompanyName(candidate)) return cleanCompanyName(candidate)
  }

  return null
}

function isValidCompanyName(candidate: string): boolean {
  if (!candidate || candidate.length < 2 || candidate.length > 80) return false

  // Reject standalone legal suffixes
  const lower = candidate.toLowerCase().trim()
  if (LEGAL_SUFFIXES.some(suffix => lower === suffix || lower === suffix + '.')) return false

  // Reject role-only strings
  const rolePatterns = /^(founder|ceo|cto|cfo|coo|chief|officer|president|vp|head|director|manager|lead|engineer|developer|consultant|intern|assistant|associate)$/i
  if (rolePatterns.test(lower)) return false

  return true
}

function cleanCompanyName(name: string): string {
  // Preserve legal suffixes: "Docyrus, Inc." stays as "Docyrus, Inc."
  let cleaned = name.trim()
  // Remove trailing separators
  cleaned = cleaned.replace(/\s*[|·—]\s*$/, '')
  // Remove trailing role fragments after company name
  cleaned = cleaned.replace(/\s+(full-time|part-time|contract|freelance|self-employed)\s*$/i, '')
  return cleaned.trim()
}

/**
 * Detect authority level from title text.
 */
function detectAuthority(title: string): CommercialEpisode['authority'] {
  const lower = title.toLowerCase()
  if (AUTHORITY_KEYWORDS.FOUNDER.some(kw => lower.includes(kw))) return 'FOUNDER'
  if (AUTHORITY_KEYWORDS.EXECUTIVE.some(kw => lower.includes(kw))) return 'EXECUTIVE'
  if (AUTHORITY_KEYWORDS.SENIOR.some(kw => lower.includes(kw))) return 'SENIOR'
  if (AUTHORITY_KEYWORDS.TECHNICAL.some(kw => lower.includes(kw))) return 'TECHNICAL'
  if (AUTHORITY_KEYWORDS.OPERATIONS.some(kw => lower.includes(kw))) return 'OPERATIONS'
  return 'UNKNOWN'
}

/**
 * Assess commercial potential from profile evidence.
 */
function assessCommercialPotential(params: {
  authority: CommercialEpisode['authority']
  buildIntensity: 'HIGH' | 'MEDIUM' | 'LOW'
  recentActivity: boolean
  companyCount: number
  capabilityOverlap: string[]
}): CommercialEpisode['commercialPotential'] {
  let score = 0

  // Authority
  if (params.authority === 'FOUNDER') score += 3
  else if (params.authority === 'EXECUTIVE') score += 2
  else if (params.authority === 'SENIOR' || params.authority === 'TECHNICAL') score += 1

  // Build intensity
  if (params.buildIntensity === 'HIGH') score += 3
  else if (params.buildIntensity === 'MEDIUM') score += 2
  else if (params.buildIntensity === 'LOW') score += 1

  // Recent activity
  if (params.recentActivity) score += 2

  // Multiple companies = scaling operator
  if (params.companyCount >= 3) score += 2
  else if (params.companyCount >= 2) score += 1

  // Capability overlap
  if (params.capabilityOverlap.length >= 3) score += 2
  else if (params.capabilityOverlap.length >= 1) score += 1

  if (score >= 7) return 'HIGH'
  if (score >= 4) return 'MEDIUM'
  return 'LOW'
}

/**
 * Detect build intensity from text (multilingual-aware via keyword presence).
 */
function detectBuildIntensity(text: string): CommercialEpisode['buildIntensity'] {
  const lower = text.toLowerCase()
  let count = 0
  for (const indicator of BUILD_INDICATORS) {
    if (lower.includes(indicator)) count++
  }
  if (count >= 4) return 'HIGH'
  if (count >= 2) return 'MEDIUM'
  return 'LOW'
}

/**
 * Extract capability overlap between profile and our offerings.
 */
function extractCapabilityOverlap(text: string): string[] {
  const overlap: string[] = []
  const capabilities = [
    'react', 'node', 'python', 'ai', 'machine learning', 'mobile', 'ios', 'android',
    'web', 'fullstack', 'typescript', 'nextjs', 'aws', 'cloud', 'devops',
    'product design', 'ui/ux', 'figma', 'data', 'api',
  ]
  const lower = text.toLowerCase()
  for (const cap of capabilities) {
    if (lower.includes(cap)) overlap.push(cap)
  }
  return [...new Set(overlap)]
}

/**
 * Main function: build commercial-potential episodes from profile structure.
 * This is the fallback when no buyer episodes exist.
 */
export function buildCommercialEpisodes(profile: RawProfileInput): CommercialEpisode[] {
  const episodes: CommercialEpisode[] = []
  const evidence: string[] = []

  // 1. Extract from headline
  const headlineCompany = profile.headline ? extractCompanyFromHeadline(profile.headline) : null
  const headlineTitle = profile.headline ? extractTitleFromHeadline(profile.headline) : null

  if (headlineCompany && headlineTitle) {
    evidence.push(`Headline: ${headlineTitle} @ ${headlineCompany}`)
  }

  // 2. Extract from About section
  if (profile.about) {
    const aboutEvidence = extractEvidenceFromAbout(profile.about)
    evidence.push(...aboutEvidence)
  }

  // 3. Extract from Experience section
  const currentRoles = (profile.experience ?? []).filter(e => e.current)
  const companySet = new Set<string>()
  const allTitles: string[] = []

  for (const role of currentRoles) {
    if (role.company && isValidCompanyName(role.company)) {
      companySet.add(cleanCompanyName(role.company))
    }
    if (role.title) {
      allTitles.push(role.title)
    }
    evidence.push(`Current: ${role.title} @ ${role.company}`)
  }

  // Also include headline company
  if (headlineCompany) companySet.add(headlineCompany)

  // 4. Detect overall authority (strongest current role)
  const strongestAuthority = allTitles.reduce<CommercialEpisode['authority']>((best, title) => {
    const auth = detectAuthority(title)
    const rank = { 'FOUNDER': 5, 'EXECUTIVE': 4, 'SENIOR': 3, 'TECHNICAL': 2, 'OPERATIONS': 1, 'UNKNOWN': 0 }
    return rank[auth] > rank[best] ? auth : best
  }, 'UNKNOWN')

  // 5. Detect build intensity from combined text
  const combinedText = [profile.about ?? '', ...(profile.experience?.map(e => e.description ?? '') ?? [])].join(' ')
  const buildIntensity = detectBuildIntensity(combinedText)

  // 6. Recent activity detection
  const recentActivity = detectRecentActivity(combinedText, profile.experience ?? [])

  // 7. Capability overlap
  const capabilityOverlap = extractCapabilityOverlap(combinedText)

  // 8. Build episodes per company
  for (const companyName of companySet) {
    const authority = detectAuthority(allTitles.join(' ') || headlineTitle || '')
    const commercialPotential = assessCommercialPotential({
      authority,
      buildIntensity,
      recentActivity,
      companyCount: companySet.size,
      capabilityOverlap,
    })

    episodes.push({
      id: `com_${companyName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${episodes.length}`,
      organizationName: companyName,
      organizationId: null,
      title: allTitles[0] || headlineTitle || '',
      authority,
      commercialPotential,
      buyerIntent: 'UNKNOWN',
      externalNeed: 'UNPROVEN',
      buildIntensity,
      recentActivity,
      capabilityOverlap,
      access: 'CONNECTION', // LinkedIn direct messaging available
      evidence: evidence.slice(0, 5),
      source: 'experience',
      verified: true,
    })
  }

  // 9. If no episodes from experience/headline, create one from company name
  if (episodes.length === 0 && profile.company) {
    episodes.push({
      id: `com_${profile.company.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      organizationName: profile.company,
      organizationId: null,
      title: profile.title || '',
      authority: 'UNKNOWN',
      commercialPotential: 'MEDIUM',
      buyerIntent: 'UNKNOWN',
      externalNeed: 'UNPROVEN',
      buildIntensity: detectBuildIntensity(profile.about ?? profile.sourceText ?? ''),
      recentActivity: false,
      capabilityOverlap: [],
      access: 'CONNECTION',
      evidence: [`Company: ${profile.company}`],
      source: 'company_page',
      verified: true,
    })
  }

  return episodes
}

function extractTitleFromHeadline(headline: string): string | null {
  // Remove @company and ,company suffixes
  const cleaned = headline.replace(/[@].*$/i, '').replace(/,\s*[A-Z][A-Za-z0-9._&\-\s,]+$/i, '').trim()
  return cleaned || null
}

function extractEvidenceFromAbout(about: string): string[] {
  const evidence: string[] = []
  const lines = about.split('\n').filter(l => l.trim())

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 10) continue
    // Skip LinkedIn UI noise
    if (/^(see more|show more|followers|connections|\d+\s*comments?)$/i.test(trimmed)) continue
    evidence.push(trimmed.slice(0, 100))
  }

  return evidence.slice(0, 5)
}

/**
 * Build commercial-potential episodes from V2 bridge input.
 * This is the fallback when no buyer episodes exist in the evidence graph.
 */
export function buildCommercialEpisodesFromV2(v2: {
  person: {
    fullName: string | null
    title: string | null
    affiliations?: Array<{
      organizationName: string
      role?: string
      relationship: string
      isCurrent: boolean
    }>
  }
  company: {
    name: string | null
    industry: string | null
    size: string | null
  }
  content: {
    recentPosts: Array<{
      paraphrase: string
      verbatimQuote: string | null
    }>
  }
  opportunity: {
    signals: string[]
    description: string | null
  }
}): CommercialEpisode[] {
  const episodes: CommercialEpisode[] = []
  const evidence: string[] = []

  // Current affiliations = active commercial roles
  const currentAffiliations = (v2.person.affiliations ?? []).filter(a => a.isCurrent)
  const companySet = new Set<string>()
  const allTitles: string[] = []

  for (const aff of currentAffiliations) {
    if (aff.organizationName && isValidCompanyName(aff.organizationName)) {
      companySet.add(cleanCompanyName(aff.organizationName))
    }
    if (aff.role) {
      allTitles.push(aff.role)
      evidence.push(`Current: ${aff.role} @ ${aff.organizationName}`)
    }
  }

  // Also include company from bridge
  if (v2.company.name && isValidCompanyName(v2.company.name)) {
    companySet.add(cleanCompanyName(v2.company.name))
    evidence.push(`Company: ${v2.company.name}`)
  }

  // Title from person
  if (v2.person.title && allTitles.length === 0) {
    allTitles.push(v2.person.title)
  }

  // Recent posts as evidence of activity
  for (const post of v2.content.recentPosts ?? []) {
    if (post.verbatimQuote || post.paraphrase) {
      evidence.push((post.verbatimQuote || post.paraphrase).slice(0, 80))
    }
  }

  // Signals from V2
  for (const signal of v2.opportunity.signals ?? []) {
    evidence.push(`Signal: ${signal}`)
  }

  // Detect authority
  const strongestAuthority = allTitles.reduce<CommercialEpisode['authority']>((best, title) => {
    const auth = detectAuthority(title)
    const rank = { 'FOUNDER': 5, 'EXECUTIVE': 4, 'SENIOR': 3, 'TECHNICAL': 2, 'OPERATIONS': 1, 'UNKNOWN': 0 }
    return rank[auth] > rank[best] ? auth : best
  }, 'UNKNOWN')

  // Build intensity from posts + signals
  const combinedText = [
    v2.opportunity.description ?? '',
    ...(v2.content.recentPosts?.map(p => p.paraphrase) ?? []),
  ].join(' ')
  const buildIntensity = detectBuildIntensity(combinedText)
  const recentActivity = detectRecentActivity(combinedText, [])
  const capabilityOverlap = extractCapabilityOverlap(combinedText)

  // Create episodes per company
  for (const companyName of companySet) {
    const authority = detectAuthority(allTitles.join(' ') || v2.person.title || '')
    const commercialPotential = assessCommercialPotential({
      authority,
      buildIntensity,
      recentActivity,
      companyCount: companySet.size,
      capabilityOverlap,
    })

    episodes.push({
      id: `com_${companyName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${episodes.length}`,
      organizationName: companyName,
      organizationId: null,
      title: allTitles[0] || v2.person.title || '',
      authority,
      commercialPotential,
      buyerIntent: 'UNKNOWN',
      externalNeed: 'UNPROVEN',
      buildIntensity,
      recentActivity,
      capabilityOverlap,
      access: 'CONNECTION',
      evidence: evidence.slice(0, 5),
      source: 'experience',
      verified: true,
    })
  }

  // If no episodes from affiliations, create from company name
  if (episodes.length === 0 && v2.company.name) {
    episodes.push({
      id: `com_${v2.company.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      organizationName: v2.company.name,
      organizationId: null,
      title: v2.person.title || '',
      authority: detectAuthority(v2.person.title || ''),
      commercialPotential: 'MEDIUM',
      buyerIntent: 'UNKNOWN',
      externalNeed: 'UNPROVEN',
      buildIntensity: detectBuildIntensity(combinedText),
      recentActivity: false,
      capabilityOverlap: [],
      access: 'CONNECTION',
      evidence: [`Company: ${v2.company.name}`],
      source: 'company_page',
      verified: true,
    })
  }

  return episodes
}

/**
 * Convert a CommercialEpisode to V3OpportunityEpisode for scoring.
 */
export function convertCommercialEpisodeToV3(
  ce: CommercialEpisode,
  graph: { persons: Map<string, unknown>; organizations: Map<string, unknown> },
): import('@/lib/intelligence-v3/types').V3OpportunityEpisode {
  const scoreMap = { HIGH: 75, MEDIUM: 50, LOW: 25 }
  const statusMap = { HIGH: 'CURRENT', MEDIUM: 'CURRENT', LOW: 'AGING' }

  return {
    id: ce.id,
    anchorEvent: {
      id: `evt_${ce.id}`,
      eventType: 'TECHNICAL_BUILD' as const,
      organizationName: ce.organizationName,
      organizationId: null,
      personId: null,
      channel: null,
      requestedCapability: ce.capabilityOverlap,
      targetAudience: 'PUBLIC' as const,
      explicitness: 'IMPLIED' as const,
      applyInstructions: [],
      evidenceRefs: [],
      polarity: 'ACTIVE' as const,
      occurredAt: null,
    },
    organizationId: null,
    organizationName: ce.organizationName,
    needOwnerPersonId: null,
    needOwnerType: 'UNKNOWN',
    explicitRequest: false,
    requestedCapabilities: ce.capabilityOverlap,
    applicationChannels: [],
    status: statusMap[ce.commercialPotential] as 'CURRENT' | 'AGING',
    detectedAt: new Date().toISOString(),
    lastActivityAt: ce.recentActivity ? new Date().toISOString() : null,
    ageDays: null,
    eventRefs: [],
    evidenceRefs: [],
  }
}

function detectRecentActivity(text: string, experience?: Array<{ current: boolean }>): boolean {
  const lower = text.toLowerCase()

  // Explicit recent indicators
  if (/recently|this week|last week|this month|last month|just launched|just shipped|just released|yeni|yakın zamanda/.test(lower)) {
    return true
  }

  // Current roles without end date
  const hasCurrentRole = experience?.some(e => e.current) ?? false
  if (hasCurrentRole) return true

  // Relative timestamps in posts (LinkedIn format)
  if (/\d+\s*(d|w|mo|h)\s*ago/.test(lower)) return true

  return false
}
