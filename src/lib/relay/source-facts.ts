/**
 * SourceFacts — Single normalized fact model for all scoring paths.
 *
 * Both the V3 opportunity model and the signal/composite scorer MUST consume
 * this same object. This prevents contradictions like:
 - Opportunity model: Access = NONE
 - Signal check: 1st degree + message available + 4 mutuals
 */

export interface SourceFacts {
  // Connection & access
  degree: '1st' | '2nd' | '3rd' | 'UNKNOWN'
  messageAvailable: boolean
  mutualConnections: number
  mutualConnectionNames: string[]
  connectVisible: boolean

  // Current role & organization
  currentCompany: string | null
  currentTitle: string | null
  currentCompanyKey: string | null
  companyIndustry: string | null
  companySize: string | null

  // Authority
  authorityLevel: 'FOUNDER' | 'C_LEVEL' | 'VP' | 'DIRECTOR' | 'SENIOR' | 'TECHNICAL' | 'OPERATIONS' | 'UNKNOWN'
  authorityEvidence: string[]

  // Activity & timing
  recentPostAgeDays: number | null
  hasRecentActivity: boolean
  postRecency: 'RECENT' | 'MODERATE' | 'STALE' | 'UNKNOWN'

  // Commercial context
  products: string[]
  activeTechnologies: string[]
  hiringActivity: boolean
  growthSignals: string[]

  // Raw evidence
  sourceSpans: string[]
}

/**
 * Extract SourceFacts from raw text + structured profile data.
 * Used by both V3 opportunity model and signal/composite scorer.
 */
export function extractSourceFacts(params: {
  rawText: string
  headline?: string | null
  experience?: Array<{
    title: string
    company: string
    current: boolean
    description: string | null
  }>
  person?: {
    affiliations?: Array<{
      organizationName: string
      role?: string
      relationship: string
      isCurrent: boolean
    }>
  }
  company?: {
    name: string | null
    industry: string | null
    size: string | null
  }
}): SourceFacts {
  const { rawText, headline, experience, person, company } = params
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  const lower = rawText.toLowerCase()

  // === CONNECTION & ACCESS ===
  let degree: SourceFacts['degree'] = 'UNKNOWN'
  let messageAvailable = false
  let mutualConnections = 0
  const mutualConnectionNames: string[] = []
  let connectVisible = false

  // Parse degree from text
  if (/1st.*degree|1\. degree|birinci derece/i.test(rawText)) degree = '1st'
  else if (/2nd.*degree|2\. degree|ikinci derece/i.test(rawText)) degree = '2nd'
  else if (/3rd.*degree|3\. degree|üçüncü derece/i.test(rawText)) degree = '3rd'

  // Parse message availability
  messageAvailable = /message|dm|send message|mesaj|yaz/i.test(rawText)

  // Parse mutual connections
  const mutualPatterns = [
    /(\d+)\s*(?:mutual|paylaşılan)\s*(?:connection|bağlantı)/i,
    /(\d+)\s*(?:ortak|paylaşılan)/i,
  ]
  for (const pattern of mutualPatterns) {
    const match = rawText.match(pattern)
    if (match) {
      mutualConnections = parseInt(match[1], 10)
      break
    }
  }
  // Named mutual connections
  const namedMutualPattern = /(.+?)\s+(?:is|bir)\s+(?:a\s+)?(?:mutual|paylaşılan)\s+(?:connection|bağlantı)/gi
  let namedMatch: RegExpExecArray | null
  while ((namedMatch = namedMutualPattern.exec(rawText)) !== null) {
    mutualConnectionNames.push(namedMatch[1].trim())
    mutualConnections = Math.max(mutualConnections, mutualConnectionNames.length)
  }

  // Connect button visible
  connectVisible = /connect|bağlan|arkadaş ekle|take action/i.test(rawText)

  // === CURRENT ROLE & ORGANIZATION ===
  const currentExperience = (experience ?? []).filter(e => e.current)
  const currentCompany = currentExperience[0]?.company ?? company?.name ?? null
  const currentTitle = currentExperience[0].title ?? headline ?? null
  const companyIndustry = company?.industry ?? null
  const companySize = company?.size ?? null

  // === AUTHORITY ===
  const titleLower = (currentTitle ?? '').toLowerCase()
  let authorityLevel: SourceFacts['authorityLevel'] = 'UNKNOWN'
  const authorityEvidence: string[] = []

  if (/founder|co-founder|kurucu|ortak kurucu/i.test(titleLower)) {
    authorityLevel = 'FOUNDER'
    authorityEvidence.push(currentTitle ?? '')
  } else if (/ceo|cto|cfo|coo|chief|başkan/i.test(titleLower)) {
    authorityLevel = 'C_LEVEL'
    authorityEvidence.push(currentTitle ?? '')
  } else if (/vp|vice president/i.test(titleLower)) {
    authorityLevel = 'VP'
  } else if (/director|direktör/i.test(titleLower)) {
    authorityLevel = 'DIRECTOR'
  } else if (/senior|lead|principal|staff/i.test(titleLower)) {
    authorityLevel = 'SENIOR'
  } else if (/engineer|developer|architect|mühendis|yazılım|geliştirici/i.test(titleLower)) {
    authorityLevel = 'TECHNICAL'
  } else if (/operations|manager|coordinator/i.test(titleLower)) {
    authorityLevel = 'OPERATIONS'
  }

  // Boost authority for multiple current affiliations
  if ((person?.affiliations?.filter(a => a.isCurrent).length ?? 0) >= 2) {
    if (authorityLevel === 'TECHNICAL' || authorityLevel === 'OPERATIONS') {
      authorityLevel = 'SENIOR'
    }
    authorityEvidence.push(`Multiple current roles: ${(person?.affiliations?.filter(a => a.isCurrent).length ?? 0)}`)
  }

  // === ACTIVITY & TIMING ===
  let recentPostAgeDays: number | null = null

  // LinkedIn relative age patterns
  const agePatterns = [
    { regex: /(\d+)\s*d\s*(?:ago)?/i, unit: 'days' },
    { regex: /(\d+)\s*w(?:eek)?s?\s*(?:ago)?/i, unit: 'weeks' },
    { regex: /(\d+)\s*m(?:o|onth)?s?\s*(?:ago)?/i, unit: 'months' },
    { regex: /(\d+)\s*h(?:our)?s?\s*(?:ago)?/i, unit: 'hours' },
  ]

  for (const line of lines) {
    for (const { regex, unit } of agePatterns) {
      const match = line.match(regex)
      if (match) {
        const value = parseInt(match[1], 10)
        const days = unit === 'hours' ? 0 : unit === 'days' ? value : unit === 'weeks' ? value * 7 : value * 30
        if (recentPostAgeDays === null || days < recentPostAgeDays) {
          recentPostAgeDays = days
        }
      }
    }
  }

  const hasRecentActivity = recentPostAgeDays !== null && recentPostAgeDays <= 30
  const postRecency: SourceFacts['postRecency'] =
    recentPostAgeDays === null ? 'UNKNOWN' :
    recentPostAgeDays <= 7 ? 'RECENT' :
    recentPostAgeDays <= 30 ? 'MODERATE' : 'STALE'

  // === COMMERCIAL CONTEXT ===
  const products: string[] = []
  const productPatterns = [
    /([A-Z][A-Za-z0-9]+(?:\s+AI)?)\s*(?:platform|product|app|tool|studio)/gi,
    /(?:launching|building|ship)\s+([A-Z][A-Za-z0-9]+)/gi,
  ]
  for (const pattern of productPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(rawText)) !== null) {
      const product = match[1]?.trim()
      if (product && product.length > 2 && product.length < 30) {
        products.push(product)
      }
    }
  }

  const hiringActivity = /hiring|join\s+(?:our|the\s+team)|we'?re?\s+(?:hiring|growing|looking\s+for)|ekibimizi\s+(?:büyütüyoruz|genişletiyoruz)/i.test(rawText)
  const growthSignals: string[] = []

  if (/scaling|growth|growing|expanding|büyütüyoruz|genişletiyoruz/i.test(rawText)) {
    growthSignals.push('Company growth/scaling')
  }
  if (/series\s+[a-d]|funded|raised|yatırım/i.test(rawText)) {
    growthSignals.push('Funding/growth stage')
  }
  if (/launched|shipped|yayınladık|lansman/i.test(rawText)) {
    growthSignals.push('Recent product launch')
  }

  return {
    degree,
    messageAvailable,
    mutualConnections,
    mutualConnectionNames,
    connectVisible,
    currentCompany,
    currentTitle,
    currentCompanyKey: currentCompany?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? null,
    companyIndustry,
    companySize,
    authorityLevel,
    authorityEvidence,
    recentPostAgeDays,
    hasRecentActivity,
    postRecency,
    products: [...new Set(products)],
    activeTechnologies: extractTechStack(rawText),
    hiringActivity,
    growthSignals,
    sourceSpans: lines.filter(l => l.length > 10).slice(0, 10),
  }
}

function extractTechStack(text: string): string[] {
  const techs: string[] = []
  const known = [
    'react', 'node', 'python', 'typescript', 'javascript', 'nextjs', 'aws', 'gcp',
    'docker', 'kubernetes', 'postgres', 'mongodb', 'redis', 'graphql', 'rest',
    'flutter', 'swift', 'kotlin', 'rust', 'go', 'terraform', 'ai', 'ml',
  ]
  const lower = text.toLowerCase()
  for (const tech of known) {
    if (lower.includes(tech)) techs.push(tech)
  }
  return [...new Set(techs)]
}
