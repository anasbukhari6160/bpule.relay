/**
 * Source-level event parser for V3.
 *
 * V2's evidence ledger degrades all events to "Hiring activity detected" and
 * attaches them to the headline company. This parser extracts rich event
 * data directly from the raw source text, preserving:
 * - Per-event organization scoping
 * - Temporal information (relative dates)
 * - Requested capabilities and assets
 * - Application channels and apply instructions
 * - Direct contact routes
 */

import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'

export interface SourceEvent {
  organizationName: string
  eventType: 'HIRING' | 'FREELANCE_REQUEST' | 'PROJECT_REQUEST' | 'AGENCY_REQUEST' | 'FUNDING' | 'PRODUCT_LAUNCH' | 'TECHNICAL_BUILD' | 'SERVICE_OFFERING' | 'OTHER'
  description: string
  explicitRequest: boolean
  requestedCapabilities: string[]
  requestedAssets: string[]
  applicationChannels: string[]
  applyInstructions: string[]
  contactRoute: string | null
  occurredAt: string | null
  ageDays: number | null
  evidenceType: 'FACT' | 'STRONG_INFERENCE' | 'WEAK_INFERENCE'
}

// Known tech stack keywords
const TECH_KEYWORDS = [
  'react', 'next.js', 'nextjs', 'node', 'node.js', 'nodejs', 'typescript', 'javascript',
  'python', 'django', 'flask', 'fastapi', 'ruby', 'rails', 'go', 'golang', 'rust',
  'java', 'kotlin', 'swift', 'flutter', 'react native', 'vue', 'angular', 'svelte',
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'postgresql', 'postgres',
  'mongodb', 'mysql', 'redis', 'graphql', 'rest api', 'grpc', 'ci/cd', 'devops',
  'machine learning', 'ml', 'ai', 'llm', 'openai', 'langchain', 'blockchain',
  'web3', 'solidity', 'figma', 'ui/ux', 'product design', 'data science',
  'fullstack', 'full-stack', 'backend', 'frontend', 'mobile', 'ios', 'android',
]

// Asset keywords that indicate explicit apply requirements
const ASSET_KEYWORDS = [
  'resume', 'cv', 'cv/cover', 'cv / cover',
  'github', 'git hub', 'portfolio', 'live project', 'sample work',
  'rate', 'hourly rate', 'project rate', 'budget',
  'availability', 'weekly notice', 'start date',
  'cover letter', 'linkedin profile', 'linkedin',
]

// Channel keywords
const CHANNEL_KEYWORDS: Record<string, string> = {
  'email': 'EMAIL',
  'dm': 'DM',
  'direct message': 'DM',
  'linkedin': 'LINKEDIN',
  'apply here': 'APPLICATION_LINK',
  'application link': 'APPLICATION_LINK',
  'careers page': 'CAREERS_PAGE',
  'upwork': 'UPWORK',
}

/**
 * Parse raw source text into structured events with organization scoping.
 */
export function parseEventsFromSource(
  rawText: string,
  v2Canonical: CanonicalProspectIntelligence,
): SourceEvent[] {
  const events: SourceEvent[] = []
  const lines = rawText.split('\n')

  const organizations = extractOrganizations(rawText, v2Canonical)

  let currentOrg = v2Canonical.intelligence.company.name || organizations[0] || null
  let currentSection = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      currentSection = ''
      continue
    }

    // Detect organization mentions that change the scope
    const orgInLine = detectOrganizationInLine(line, organizations)
    if (orgInLine) {
      currentOrg = orgInLine
    }

    // Detect temporal markers (relative dates)
    const ageDays = parseRelativeAge(line)

    // Detect hiring/event signals
    const event = parseEventLine(line, currentOrg, ageDays, v2Canonical)
    if (event) {
      events.push(event)
    }
  }

  const fullTextEvents = parseFullTextEvents(rawText, organizations, v2Canonical)
  for (const event of fullTextEvents) {
    // Avoid duplicates
    if (!events.some(e => e.description === event.description && e.organizationName === event.organizationName)) {
      events.push(event)
    }
  }

  return events.length > 0 ? events : []
}

function extractOrganizations(rawText: string, v2Canonical: CanonicalProspectIntelligence): string[] {
  const orgs: Set<string> = new Set()

  if (v2Canonical.intelligence.company.name) {
    orgs.add(v2Canonical.intelligence.company.name)
  }

  for (const aff of v2Canonical.intelligence.person.affiliations || []) {
    if (aff.organizationName) orgs.add(aff.organizationName)
  }

  // "at Company", "Company is hiring", "Company raised", etc.
  const patterns = [
    /(?:at|@|with|from|for|of)\s+([A-Z][\w\s&.'-]{1,40}?)(?:\s*[,\.|]|$)/gm,
    /([A-Z][\w\s&.'-]{1,30}?)\s+(?:is hiring|is looking|raised|announced|launched|hiring|seeking)/gm,
    /(?:Co-founder|Founder|CEO|CTO)\s+(?:at|@)\s+([A-Z][\w\s&.'-]{1,40}?)(?:\s*[|\n,]|$)/gm,
    /([A-Z][\w\s&.'-]{1,30}?)\s+(?:→|->)/gm,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(rawText)) !== null) {
      const name = match[1]?.trim()
      if (name && name.length > 2 && name.length < 50 && !['About', 'Posts', 'Experience', 'LinkedIn'].includes(name)) {
        orgs.add(name)
      }
    }
  }

  return [...orgs]
}

function detectOrganizationInLine(line: string, organizations: string[]): string | null {
  for (const org of organizations) {
    if (line.toLowerCase().includes(org.toLowerCase())) {
      return org
    }
  }
  return null
}

function parseRelativeAge(line: string): number | null {
  const patterns = [
    /(\d+)\s*(?:months?|mo)\s+ago/i,
    /(\d+)\s*(?:weeks?|w)\s+ago/i,
    /(\d+)\s*(?:days?|d)\s+ago/i,
    /(\d+)\s*(?:years?|y)\s+ago/i,
    /(\d+)(?:mo|w|d)\b/i,  // compact: 3mo, 2w, 5d
  ]

  for (const pattern of patterns) {
    const match = line.match(pattern)
    if (match) {
      const value = parseInt(match[1])
      if (pattern.source.includes('month') || pattern.source.includes('mo')) return value * 30
      if (pattern.source.includes('week') || pattern.source.includes('w')) return value * 7
      if (pattern.source.includes('year') || pattern.source.includes('y')) return value * 365
      if (pattern.source.includes('day') || pattern.source.includes('d')) return value
    }
  }

  return null
}

function parseEventLine(
  line: string,
  currentOrg: string | null,
  ageDays: number | null,
  v2Canonical: CanonicalProspectIntelligence,
): SourceEvent | null {
  const lower = line.toLowerCase()

  // Service offering / candidate / customer discovery lines are not hiring events
  if (/\b(?:if\s+you(?:'|')?re\s+(?:hiring|looking|seeking|need)|hiring\?|looking\?|need\?)\b/i.test(line) &&
      /\b(?:let(?:|')s\s+(?:connect|talk|chat)|dm\s+(?:me|us)|reach\s+(?:out|me)|contact\s+(?:me|us)|know\s+(?:great|good|awesome)|message\s+(?:me|us))\b/i.test(line)) {
    return null
  }
  if (/\b(?:(?:i(?:|')?m|i\s+am)\s+(?:open\s+to|looking\s+for|seeking|available\s+for)|open\s+to\s+(?:new\s+)?(?:work|opportunities|roles|contract|freelance)|available\s+for\s+(?:hire|work|contract|freelance|projects))\b/i.test(line)) {
    return null
  }
  if (/\b(?:feedback\s+(?:on\s+)?(?:my|our|this|the)\s+(?:product|app|platform|feature|idea|mvp|prototype|saas)|talking\s+(?:to|with)\s+(?:founders|users|customers)|customer\s+discovery|would\s+love\s+(?:your\s+)?feedback|i(?:|')d\s+love\s+(?:your\s+)?feedback)\b/i.test(line)) {
    return null
  }

  // Hiring signals
  const hiringSignals = [
    'hiring', 'looking for', 'seeking', 'need a ', 'want to hire',
    'join our team', 'we are hiring', 'open role', 'open position',
    'opportunity at', 'job:', 'role:', 'position:',
  ]

  const isHiring = hiringSignals.some(s => lower.includes(s))

  if (!isHiring) return null

  const capabilities = TECH_KEYWORDS.filter(t => lower.includes(t))

  const assets = ASSET_KEYWORDS.filter(t => lower.includes(t))

  const channels: string[] = []
  for (const [keyword, channel] of Object.entries(CHANNEL_KEYWORDS)) {
    if (lower.includes(keyword) && !channels.includes(channel)) {
      channels.push(channel)
    }
  }

  const applyInstructions: string[] = []
  if (lower.includes('send') || lower.includes('apply') || lower.includes('reach out') || lower.includes('dm me') || lower.includes('email')) {
    const applyMatch = line.match(/(?:send|apply|reach out|contact|dm|email)\s+([^.\n]+)/i)
    if (applyMatch) {
      applyInstructions.push(applyMatch[1].trim())
    }
  }

  // Detect explicit request
  const explicitRequest = lower.includes('send') || lower.includes('apply') ||
    lower.includes('dm me') || lower.includes('email') || lower.includes('reach out') ||
    lower.includes('contact') || lower.includes('github') || lower.includes('portfolio') ||
    lower.includes('resume')

  // Contact route
  const emailMatch = line.match(/[\w.+-]+@[\w-]+\.\w+/)
  const contactRoute = emailMatch ? emailMatch[0] : null

  let eventType: SourceEvent['eventType'] = 'HIRING'
  if (lower.includes('outsourc') || lower.includes('agency') || lower.includes('vendor')) {
    eventType = 'AGENCY_REQUEST'
  } else if (lower.includes('freelance') || lower.includes('contractor') || lower.includes('contract')) {
    eventType = 'FREELANCE_REQUEST'
  } else if (/\b(?:looking\s+for|seeking|need(?:s|ed)?)\s+(?:a\s+)?(?:developer|dev|engineer|programmer)\b/i.test(line) &&
             /\b(?:help|build|scale|create|develop|design)\b/.test(line)) {
    eventType = 'FREELANCE_REQUEST'
  } else if (lower.includes('partner') || lower.includes('partnership') || lower.includes('collaborate')) {
    eventType = 'PROJECT_REQUEST'
  } else if (lower.includes('funding') || lower.includes('raised') || lower.includes('series') || lower.includes('seed')) {
    eventType = 'FUNDING'
  } else if (lower.includes('launch') || lower.includes('releasing') || lower.includes('beta') || lower.includes('early access')) {
    eventType = 'PRODUCT_LAUNCH'
  }

  return {
    organizationName: currentOrg || v2Canonical.intelligence.company.name || 'Unknown',
    eventType,
    description: line,
    explicitRequest,
    requestedCapabilities: capabilities,
    requestedAssets: assets,
    applicationChannels: channels,
    applyInstructions,
    contactRoute,
    occurredAt: ageDays ? new Date(Date.now() - ageDays * 86400000).toISOString() : null,
    ageDays,
    evidenceType: explicitRequest ? 'FACT' : 'STRONG_INFERENCE',
  }
}

function parseFullTextEvents(
  rawText: string,
  organizations: string[],
  v2Canonical: CanonicalProspectIntelligence,
): SourceEvent[] {
  const events: SourceEvent[] = []
  const lower = rawText.toLowerCase()

  // Detect hiring posts that mention a different org than the headline
  for (const org of organizations) {
    if (org === v2Canonical.intelligence.company.name) continue

    const orgPattern = new RegExp(`[^.\\n]*${escapeRegex(org)}[^.\\n]*`, 'gi')
    let match
    while ((match = orgPattern.exec(rawText)) !== null) {
      const sentence = match[0]
      const sentenceLower = sentence.toLowerCase()

      const isHiring = ['hiring', 'looking', 'seeking', 'need ', 'want ', 'join', 'open role'].some(s => sentenceLower.includes(s))
      if (!isHiring) continue

      const capabilities = TECH_KEYWORDS.filter(t => sentenceLower.includes(t))
      const assets = ASSET_KEYWORDS.filter(t => sentenceLower.includes(t))
      const channels: string[] = []
      for (const [keyword, channel] of Object.entries(CHANNEL_KEYWORDS)) {
        if (sentenceLower.includes(keyword) && !channels.includes(channel)) {
          channels.push(channel)
        }
      }

      const explicitRequest = assets.length > 0 || channels.length > 0 ||
        sentenceLower.includes('send') || sentenceLower.includes('apply') || sentenceLower.includes('dm')

      const ageDays = parseRelativeAge(sentence)

      events.push({
        organizationName: org,
        eventType: 'HIRING',
        description: sentence.trim(),
        explicitRequest,
        requestedCapabilities: capabilities,
        requestedAssets: assets,
        applicationChannels: channels,
        applyInstructions: [],
        contactRoute: (sentence.match(/[\w.+-]+@[\w-]+\.\w+/)?.[0]) || null,
        occurredAt: ageDays ? new Date(Date.now() - ageDays * 86400000).toISOString() : null,
        ageDays,
        evidenceType: explicitRequest ? 'FACT' : 'STRONG_INFERENCE',
      })
    }
  }

  return events
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
