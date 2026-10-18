/**
 * Structured event extractor using OpenAI structured output.
 *
 * Takes segmented source and extracts commercial events using structured
 * LLM output with organization validation and deduplication.
 */

import { segmentLinkedInSource, type SourceSegment } from './source-segmenter'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'
import { withRetry, fetchOpenAI } from './retry-utils'


const EVENT_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eventType: { type: 'string', enum: ['HIRING', 'FREELANCE_REQUEST', 'PROJECT_REQUEST', 'AGENCY_REQUEST', 'VENDOR_EVALUATION', 'FUNDING', 'PRODUCT_LAUNCH', 'TECHNICAL_BUILD', 'SERVICE_OFFERING', 'PARTNERSHIP', 'CUSTOMER_PROBLEM', 'OTHER'] },
          organizationName: { type: 'string', description: 'Must be explicitly named in the text.' },
          organizationEvidence: { type: 'string', description: 'Exact text naming the organization.' },
          requestedCapabilities: { type: 'array', items: { type: 'string' } },
          requestedAssets: { type: 'array', items: { type: 'string' }, description: 'What to submit: resume, GitHub, portfolio, rate, availability.' },
          applicationChannels: { type: 'array', items: { type: 'string', enum: ['LINKEDIN', 'EMAIL', 'APPLICATION_LINK', 'CAREERS_PAGE', 'UPWORK', 'DM', 'PHONE'] } },
          applyInstructions: { type: 'array', items: { type: 'string' }, description: 'Verbatim apply instructions.' },
          explicitness: { type: 'string', enum: ['EXPLICIT', 'IMPLIED', 'INFERRED'] },
          needOwner: { type: 'string', enum: ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN'] },
          evidenceQuote: { type: 'string', description: 'Key evidence sentence from source.' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['eventType', 'organizationName', 'organizationEvidence', 'requestedCapabilities', 'requestedAssets', 'applicationChannels', 'applyInstructions', 'explicitness', 'needOwner', 'evidenceQuote', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
} as const

export interface ExtractedEvent {
  eventType: 'HIRING' | 'FREELANCE_REQUEST' | 'PROJECT_REQUEST' | 'AGENCY_REQUEST' | 'VENDOR_EVALUATION' | 'FUNDING' | 'PRODUCT_LAUNCH' | 'TECHNICAL_BUILD' | 'SERVICE_OFFERING' | 'PARTNERSHIP' | 'CUSTOMER_PROBLEM' | 'OTHER'
  organizationName: string
  organizationEvidence: string
  requestedCapabilities: string[]
  requestedAssets: string[]
  applicationChannels: string[]
  applyInstructions: string[]
  explicitness: 'EXPLICIT' | 'IMPLIED' | 'INFERRED'
  needOwner: 'SELF_NEED' | 'ORGANIZATION_NEED' | 'HIRING_NEED' | 'CUSTOMER_NEED' | 'MARKET_PROBLEM' | 'SERVICE_OFFERING' | 'PRODUCT_PROBLEM' | 'UNKNOWN'
  evidenceQuote: string
  confidence: number
  ageDays: number | null
}

/**
 * Extract events from raw LinkedIn source using structured LLM.
 */
export async function extractEventsFromSource(
  rawText: string,
  v2Canonical: CanonicalProspectIntelligence,
): Promise<ExtractedEvent[]> {
  const segments = segmentLinkedInSource(rawText)
  const knownOrgs = extractKnownOrganizations(v2Canonical)
  const posts = segments.filter(s => s.type === 'post')

  if (posts.length === 0) return []

  const systemPrompt = `You extract commercial events from LinkedIn profile segments.

Rules:
1. Each event must be about an organization EXPLICITLY NAMED in the text.
2. Do NOT invent organizations from random words like "We're", "AI-powered automation", "Agentforce Builder".
3. If the organization is not clearly named, use "UNKNOWN".
4. Extract ALL requested capabilities (tech stack), assets (resume, GitHub, etc.), and application channels.
5. Preserve verbatim apply instructions.
6. One LinkedIn post should produce ONE event, not multiple.
7. eventType should reflect the primary commercial signal.
8. explicitness=EXPLICIT only if there are direct apply instructions or explicit asks.
9. Use the hiring company name as organizationName, NOT the email domain.
10. Do not create separate events for email domains mentioned in apply instructions.`

  const userPrompt = `Known organizations from profile: ${knownOrgs.join(', ')}

LinkedIn posts/segments:
${posts.map((p, i) => `--- Post ${i + 1} (${p.relativeAge || 'unknown timing'}) ---
${p.text.slice(0, 2000)}
`).join('\n')}

Extract all commercial events from these posts. Each event must reference an organization explicitly named in the text.`

  try {
    const result = await withRetry(
      () => fetchOpenAI(
        process.env.OPENAI_API_KEY || '',
        'gpt-4o-mini',
        'https://api.openai.com/v1',
        systemPrompt,
        userPrompt,
        EVENT_EXTRACTION_SCHEMA,
        2000,
      ),
      { maxRetries: 1, baseDelayMs: 1000 },
    )

    if (result.error || !result.data) {
      console.warn('[V3 Event Extraction] API failed after retry:', result.error?.slice(0, 200))
      return []
    }

    const parsed = JSON.parse(result.data) as { events: ExtractedEvent[] }
    if (!parsed?.events?.length) {
      console.warn('[V3 Event Extraction] No events in parsed response')
      return []
    }

    const validated = parsed.events
      .map(evt => validateOrganization(evt, knownOrgs, rawText))
      .map((evt, i) => assignTiming(evt, posts, i))

    return deduplicateEvents(validated)
  } catch (err) {
    console.warn('[V3 Event Extraction] Failed:', err instanceof Error ? err.message : err)
    return []
  }
}

function extractKnownOrganizations(v2Canonical: CanonicalProspectIntelligence): string[] {
  const orgs: Set<string> = new Set()
  const intel = v2Canonical.intelligence

  if (intel.company.name) orgs.add(intel.company.name)
  for (const aff of intel.person.affiliations || []) {
    if (aff.organizationName) orgs.add(aff.organizationName)
  }
  return [...orgs].filter(o => o && o.length > 1 && o !== 'null')
}

function validateOrganization(
  event: ExtractedEvent,
  knownOrgs: string[],
  rawText: string,
): ExtractedEvent {
  const orgName = event.organizationName?.trim()
  if (!orgName || orgName === 'null' || orgName.length < 2) {
    return { ...event, organizationName: 'UNKNOWN' }
  }

  const isKnown = knownOrgs.some(o =>
    o.toLowerCase() === orgName.toLowerCase() ||
    (orgName.length > 3 && o.toLowerCase().includes(orgName.toLowerCase())) ||
    (orgName.length > 3 && orgName.toLowerCase().includes(o.toLowerCase()))
  )

  const isQuoted = event.organizationEvidence &&
    event.organizationEvidence.toLowerCase().includes(orgName.toLowerCase())

  // Organization must appear in the raw text (not hallucinated)
  const orgInRawText = rawText.toLowerCase().includes(orgName.toLowerCase())

  const isGarbage = ['we\'re', 'we are', 'the', 'this', 'that', 'about', 'building', 'looking', 'agentforce', 'ai-powered'].some(
    g => orgName.toLowerCase() === g
  )

  if (isGarbage) return { ...event, organizationName: 'UNKNOWN' }
  if (!orgInRawText) return { ...event, organizationName: 'UNKNOWN' }

  return event
}

function assignTiming(event: ExtractedEvent, posts: SourceSegment[], eventIndex: number): ExtractedEvent {
  const evidenceLower = event.evidenceQuote?.toLowerCase() || ''

  // Try precise matching first
  for (const post of posts) {
    const postLower = post.text.toLowerCase()
    if (evidenceLower && postLower.includes(evidenceLower.slice(0, 40))) {
      return { ...event, ageDays: post.ageDays }
    }
    if (event.organizationName && postLower.includes(event.organizationName.toLowerCase())) {
      return { ...event, ageDays: post.ageDays }
    }
  }

  // Fall back to index-based matching
  if (posts[eventIndex]) {
    return { ...event, ageDays: posts[eventIndex].ageDays }
  }

  // Last resort: assign the most recent post's age to avoid UNKNOWN status
  const datedPosts = posts.filter(p => p.ageDays != null).sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999))
  if (datedPosts.length > 0) {
    return { ...event, ageDays: datedPosts[0].ageDays }
  }

  return event
}

function deduplicateEvents(events: ExtractedEvent[]): ExtractedEvent[] {
  const seen = new Map<string, ExtractedEvent>()

  for (const event of events) {
    const keyOrg = event.organizationName?.toLowerCase() || 'unknown'
    const keyType = event.eventType
    const keyEvidence = (event.evidenceQuote || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 4)
      .join('_')

    const key = `${keyOrg}|${keyType}|${keyEvidence}`

    if (seen.has(key)) {
      const existing = seen.get(key)!
      if (event.requestedCapabilities.length > existing.requestedCapabilities.length) {
        seen.set(key, event)
      }
    } else {
      seen.set(key, event)
    }
  }

  return [...seen.values()]
}
