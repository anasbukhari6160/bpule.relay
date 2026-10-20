
import type {
  V3LeadDecisionPacket,
  V3OpportunityEpisode,
} from './types'
import type { V3EvidenceGraph } from './graph/evidence-graph'
import { V3_CONFIG_VERSION, V3_SHADOW_CONFIG } from './config'
import {
  createEvidenceGraph,
  upsertPerson,
  upsertOrganization,
  addEvidence,
  addEvent,
  linkEvidenceToEvent,
  markOrganizationAsServiceProvider,
} from './graph/evidence-graph'
import { buildEpisodes, eventNeedOwner, episodeContentKey } from './graph/episode-builder'
import { buildCommercialEpisodesFromV2, convertCommercialEpisodeToV3 } from '@/lib/relay/commercial-episodes'
import {
  getDecisionRegistry,
  type V3DecisionProvider,
  type V3ProviderContext,
  type V3ProviderResult,
} from './decision/decision-provider'
import { assembleDecisionPacket } from './decision/decision-assembler'
import type { SourceFacts } from './source-facts-model'
import { recordScopedTrace } from '@/lib/ai/runtime/telemetry'


export interface V3OrchestratorOptions {
  /** Override decision provider by id */
  providerId?: string
  /** Inject a decision provider instance (tests, shadow runs). Bypasses the registry. */
  decisionProvider?: V3DecisionProvider | null
  /** Skip the model entirely and use the deterministic decision. */
  deterministicOnly?: boolean
  /** Pre-read SourceFacts for this source. */
  sourceFacts?: SourceFacts
  /** Where the source events came from, for the packet trace. */
  eventSource?: 'model' | 'deterministic' | 'none'
  /** Organization capability set for fit. */
  orgCapabilities?: string[]
  /** Sender capabilities for proof matching */
  senderCapabilities?: string[]
  /** Current production score for shadow comparison */
  productionScore?: number
  productionAction?: string
  /** Force reanalysis even if cache exists */
  forceReanalyze?: boolean
  /** Reference date for staleness (defaults to now) */
  referenceDate?: Date
  /** Callback for status updates */
  onStatus?: (msg: string) => void
  /** V2 canonical intelligence for latent opportunity assessment */
  v2Canonical?: import('@/lib/intelligence-v2/types').CanonicalProspectIntelligence
  /** Who this decision is for. A missing org still runs the decision; the trace is skipped. */
  trace?: {
    organizationId?: string | null
    repId?: string | null
    leadId?: string | null
  }
}

export interface V3OrchestratorResult {
  packet: V3LeadDecisionPacket
  graph: V3EvidenceGraph
  episodes: V3OpportunityEpisode[]
  /** Version of the V3 pipeline */
  version: string
  /** Whether this was a shadow run */
  shadowMode: boolean
  /** Timing */
  timing: {
    extractionMs: number
    episodeBuildMs: number
    decisionMs: number
    totalMs: number
  }
}

/**
 * Run the full V3 pipeline on a V2 intelligence result.
 * Bridges from existing V2 extraction to V3 event/episode model.
 */
export async function runV3Decision(
  v2Intelligence: V2BridgeInput,
  options: V3OrchestratorOptions = {},
): Promise<V3OrchestratorResult> {
  const startTime = Date.now()
  const refDate = options.referenceDate ?? new Date()
  const shadowMode = V3_SHADOW_CONFIG.enabled

  options.onStatus?.('Building evidence graph...')

  // Phase 1: Build evidence graph from V2 intelligence
  const t1 = Date.now()
  const graph = buildV3GraphFromV2(v2Intelligence)
  const extractionMs = Date.now() - t1

  // Phase 2: Build opportunity episodes
  options.onStatus?.('Building opportunity episodes...')
  const t2 = Date.now()
  let episodes = buildEpisodes(graph, { referenceDate: refDate })

  // Fallback: if no buyer episodes exist, try commercial-potential from profile structure
  if (episodes.length === 0) {
    const commercialEpisodes = buildCommercialEpisodesFromV2(v2Intelligence)
    episodes = commercialEpisodes.map(ce => convertCommercialEpisodeToV3(ce, graph))
    if (episodes.length > 0) {
      options.onStatus?.(`Created ${episodes.length} commercial-potential episode(s) from profile`)
    }
  }

  const episodeBuildMs = Date.now() - t2

  // Phase 3: Select best episode for decision model. With no episodes the
  // assembler scores the organization itself (never an empty 0 packet).
  const bestEpisode = selectBestEpisodeForDecision(episodes)

  // Phase 4: Run decision provider
  options.onStatus?.('Running decision model...')
  const t3 = Date.now()
  const providerContext = buildProviderContext(graph, bestEpisode ?? emptyEpisode(), v2Intelligence, options)
  const registry = getDecisionRegistry()
  const provider = options.deterministicOnly
    ? null
    : options.decisionProvider ?? registry.getAvailable(options.providerId)

  let providerResult: V3ProviderResult | undefined
  if (provider && bestEpisode) {
    const decidedAt = Date.now()
    try {
      providerResult = await provider.decide(providerContext)
      void recordScopedTrace({
        feature: 'v3_decision',
        callSite: 'v3:decision',
        provider: provider.id,
        model: providerResult.modelVersion,
        latencyMs: providerResult.latencyMs || Date.now() - decidedAt,
        success: true,
        attempt: 1,
        organizationId: options.trace?.organizationId,
        repId: options.trace?.repId,
        leadId: options.trace?.leadId,
      })

      // Cascade: escalate to the stronger model when the primary is uncertain
      if (!options.decisionProvider && shouldCascadeEscalate(providerResult, bestEpisode)) {
        const escalationResult = await runEscalationDecision(providerContext, options)
        if (escalationResult) {
          providerResult = escalationResult
        }
      }
    } catch (err) {
      void recordScopedTrace({
        feature: 'v3_decision',
        callSite: 'v3:decision',
        provider: provider.id,
        model: provider.modelVersion,
        latencyMs: Date.now() - decidedAt,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        attempt: 2,
        organizationId: options.trace?.organizationId,
        repId: options.trace?.repId,
        leadId: options.trace?.leadId,
      })
      // Primary provider failed after retry — try LongCat fallback
      const longcat = options.decisionProvider ? null : registry.getAvailable('longcat_structured')
      if (longcat && longcat.id !== provider.id) {
        const fallbackAt = Date.now()
        try {
          providerResult = await longcat.decide(providerContext)
          void recordScopedTrace({
            feature: 'v3_decision',
            callSite: 'v3:decision:fallback',
            provider: longcat.id,
            model: providerResult.modelVersion,
            latencyMs: providerResult.latencyMs || Date.now() - fallbackAt,
            success: true,
            fallback: true,
            organizationId: options.trace?.organizationId,
            repId: options.trace?.repId,
            leadId: options.trace?.leadId,
          })
        } catch (fallbackErr) {
          void recordScopedTrace({
            feature: 'v3_decision',
            callSite: 'v3:decision:fallback',
            provider: longcat.id,
            model: longcat.modelVersion,
            latencyMs: Date.now() - fallbackAt,
            success: false,
            fallback: true,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            organizationId: options.trace?.organizationId,
            repId: options.trace?.repId,
            leadId: options.trace?.leadId,
          })
        }
      }
    }
  }

  // Final fallback: deterministic decision. It never invents buyer intent;
  // the verified source facts decide, confidence is LOW.
  if (!providerResult) {
    providerResult = deterministicDecision(providerContext)
  }
  const decisionMs = Date.now() - t3

  // Phase 5: Assemble decision packet
  const { packet } = await assembleDecisionPacket({
    graph,
    episodes,
    providerResult,
    productionScore: options.productionScore,
    productionAction: options.productionAction,
    v2Canonical: options.v2Canonical,
    rawText: v2Intelligence?.rawInput,
    sourceFacts: options.sourceFacts,
    orgCapabilities: options.orgCapabilities,
    decidedEpisodeId: bestEpisode?.id ?? null,
    eventSource: options.eventSource ?? (episodes.length > 0 ? 'model' : 'none'),
  })

  return {
    packet,
    graph,
    episodes,
    version: V3_CONFIG_VERSION,
    shadowMode,
    timing: {
      extractionMs,
      episodeBuildMs,
      decisionMs,
      totalMs: Date.now() - startTime,
    },
  }
}


const UNCERTAIN_MIN = 0.3
const UNCERTAIN_MAX = 0.7

/**
 * Determine if the primary model's decision is uncertain enough to escalate.
 * Escalate when:
 * - Relationship is UNKNOWN or MIXED
 * - Service provider / competitor identity with buyer signal
 * - Buyer probability in uncertain zone
 * - Low confidence
 * - Need owner is unknown
 */
function shouldCascadeEscalate(
  result: V3ProviderResult,
  episode: V3OpportunityEpisode,
): boolean {
  const prob = result.answers.buyerRequestProbability
  const rel = result.answers.relationship
  const conf = result.confidence

  // Service provider with buyer event — needs careful verification
  if (['SERVICE_PROVIDER', 'COMPETITOR'].includes(rel) && prob >= 0.3) return true

  // Unknown or mixed relationship with medium buyer signal
  if ((rel === 'UNKNOWN' || rel === 'MIXED') && prob >= 0.2 && prob < 0.7) return true

  // Buyer probability near decision boundary
  if (prob >= 0.35 && prob < 0.55 && !episode.explicitRequest) return true

  // Low confidence
  if (conf < 0.3) return true

  return false
}

/**
 * Run escalation decision using gpt-4.1 via direct API call.
 * Falls back to primary result if escalation fails.
 */
async function runEscalationDecision(
  context: V3ProviderContext,
  options: V3OrchestratorOptions,
): Promise<V3ProviderResult | null> {
  const started = Date.now()
  const scope = {
    feature: 'v3_decision',
    callSite: 'v3:escalation',
    provider: 'openai',
    model: 'gpt-4.1',
    fallback: true,
    organizationId: options.trace?.organizationId,
    repId: options.trace?.repId,
    leadId: options.trace?.leadId,
  }
  try {
    const systemPrompt = `You are a senior commercial decision reviewer for a software development agency.
You review an OPPORTUNITY EPISODE that the primary classifier found uncertain.
Your job: provide a definitive bounded classification.
Rules:
1. Score the EPISODE, not the person's identity
2. A SERVICE_PROVIDER relationship does NOT disqualify an explicit BUYER_REQUEST episode
3. An agency CAN hire another agency — verify this distinction carefully
4. Explicit requests to an external provider (agency, vendor, contractor, freelancer, outsourced team) are strong buyer evidence
5. Recruiting EMPLOYEES (full-time/part-time roles, "submit your CV", "join our team") is NOT buying services: needOwner=HIRING_NEED, buyerRequestProbability <= 0.2, relationship is not BUYER
6. If evidence is genuinely weak, probabilities should be low`

    const userPrompt = `Review this uncertain opportunity episode and provide a definitive classification:\n\n${context.person ? `Person: ${context.person.fullName || 'Unknown'}\n` : ''}${context.organization ? `Organization: ${context.organization.name || 'Unknown'}\n` : ''}\n## Evidence:\n${context.evidence.map((e) => `  [${e.needOwner}] ${e.quote}`).join('\n')}\n\nRemember: A person can be a service provider AND have a separate buyer event. Score the episode, not the person.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'v3_escalation',
            schema: {
              type: 'object',
              properties: {
                relationship: { type: 'string', enum: ['BUYER', 'SERVICE_PROVIDER', 'COMPETITOR', 'PARTNER', 'CANDIDATE', 'MIXED', 'UNKNOWN'] },
                buyerRequestProbability: { type: 'number', minimum: 0, maximum: 1 },
                needOwner: { type: 'string', enum: ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN'] },
                timing: { type: 'string', enum: ['CURRENT', 'AGING', 'STALE', 'UNKNOWN'] },
                fit: { type: 'string', enum: ['POOR', 'WEAK', 'MEDIUM', 'STRONG', 'EXCELLENT'] },
                access: { type: 'string', enum: ['NONE', 'INDIRECT', 'CONNECTION', 'DIRECT'] },
                messageEligible: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['relationship', 'buyerRequestProbability', 'needOwner', 'timing', 'fit', 'access', 'messageEligible'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
        temperature: 0,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      void recordScopedTrace({ ...scope, latencyMs: Date.now() - started, success: false, error: `HTTP ${response.status}` })
      return null
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices[0]?.message?.content
    if (!content) {
      void recordScopedTrace({ ...scope, latencyMs: Date.now() - started, success: false, error: 'empty escalation response' })
      return null
    }

    const parsed = JSON.parse(content) as Record<string, unknown>
    const latencyMs = Date.now() - started
    void recordScopedTrace({ ...scope, latencyMs, success: true })

    return {
      answers: {
        relationship: validateEscalRel(parsed.relationship),
        buyerRequestProbability: clampEscalProb(parsed.buyerRequestProbability),
        externalNeedProbability: clampEscalProb(parsed.externalNeedProbability ?? parsed.buyerRequestProbability),
        needOwner: validateEscalOwner(parsed.needOwner),
        fit: validateEscalFit(parsed.fit),
        timing: validateEscalTiming(parsed.timing),
        access: validateEscalAccess(parsed.access),
        messageEligible: clampEscalProb(parsed.messageEligible),
      },
      providerId: 'openai_gpt-4.1',
      modelVersion: 'openai_gpt-4.1_v3',
      latencyMs,
      // Decisiveness: 1 when the probability is near 0 or 1, 0 at 0.5.
      confidence: Math.round(2 * Math.abs(clampEscalProb(parsed.buyerRequestProbability) - 0.5) * 100) / 100,
    }
  } catch (err) {
    void recordScopedTrace({
      ...scope,
      latencyMs: Date.now() - started,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function clampEscalProb(v: unknown): number {
  if (typeof v !== 'number' || isNaN(v)) return 0.5
  return Math.max(0, Math.min(1, v))
}

function validateEscalRel(v: unknown): import('./types').V3Relationship {
  const valid = ['BUYER', 'SERVICE_PROVIDER', 'COMPETITOR', 'PARTNER', 'CANDIDATE', 'MIXED', 'UNKNOWN']
  return typeof v === 'string' && valid.includes(v) ? v as import('./types').V3Relationship : 'UNKNOWN'
}

function validateEscalOwner(v: unknown): import('./types').V3NeedOwner {
  const valid = ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN']
  return typeof v === 'string' && valid.includes(v) ? v as import('./types').V3NeedOwner : 'UNKNOWN'
}

function validateEscalTiming(v: unknown): import('./types').V3TimingLevel {
  return typeof v === 'string' && ['CURRENT', 'AGING', 'STALE', 'UNKNOWN'].includes(v) ? v as import('./types').V3TimingLevel : 'UNKNOWN'
}

function validateEscalFit(v: unknown): import('./types').V3FitLevel {
  return typeof v === 'string' && ['POOR', 'WEAK', 'MEDIUM', 'STRONG', 'EXCELLENT'].includes(v) ? v as import('./types').V3FitLevel : 'MEDIUM'
}

function validateEscalAccess(v: unknown): import('./types').V3AccessLevel {
  return typeof v === 'string' && ['NONE', 'INDIRECT', 'CONNECTION', 'DIRECT'].includes(v) ? v as import('./types').V3AccessLevel : 'INDIRECT'
}


export interface V2BridgeInput {
  person: {
    fullName: string | null
    firstName: string | null
    title: string | null
    location: string | null
    linkedinUrl: string | null
    affiliations?: Array<{
      organizationName: string
      role?: string
      relationship: string
      isCurrent: boolean
    }>
  }
  company: {
    name: string | null
    domain: string | null
    industry: string | null
    size: string | null
  }
  opportunity: {
    signals: string[]
    description: string | null
    organizationName?: string
    temporalScope?: string
    polarity?: string
  }
  job: {
    title: string | null
    skills: string[]
    workplaceType: string
    employmentType: string
  } | null
  content: {
    recentPosts: Array<{
      paraphrase: string
      verbatimQuote: string | null
      signals: string[]
    }>
    hiringSignals: string[]
    technicalSignals: string[]
  }
  businessModel: string
  relationship: string
  commercialReading?: {
    serviceBuyerIntent: string
    externalEngineeringNeed: string
    buyerEvidenceKinds: string[]
  }
  evidenceLedger: Array<{
    signal: string
    source: string
    evidenceType: string
    ownership: string
    confidence: string
    verbatimQuote?: string
    needOwnership?: string
    temporalScope?: string
    polarity?: string
    organizationName?: string
  }>
  rawInput: string
  /** Source-level events parsed directly from raw text (bypasses V2 evidence ledger degradation) */
  sourceEvents?: Array<{
    organizationName: string
    eventType: string
    description: string
    explicitRequest: boolean
    /** Need owner the extractor assigned to this event, when it gave one */
    needOwner?: string
    requestedCapabilities: string[]
    requestedAssets: string[]
    applicationChannels: string[]
    applyInstructions: string[]
    contactRoute: string | null
    occurredAt: string | null
    ageDays: number | null
    evidenceType: string
  }>
}

function emptyEpisode(): V3OpportunityEpisode {
  const anchorEvent = { id: 'empty', eventType: 'OTHER' as const, personId: null, organizationId: null, organizationName: null, occurredAt: null, channel: null, requestedCapability: [], targetAudience: 'PUBLIC' as const, explicitness: 'INFERRED' as const, applyInstructions: [], evidenceRefs: [], polarity: 'UNKNOWN' as const }
  return { id: 'empty', anchorEvent, organizationId: null, organizationName: null, needOwnerPersonId: null, needOwnerType: 'UNKNOWN', explicitRequest: false, requestedCapabilities: [], applicationChannels: [], evidenceRefs: [], eventRefs: [], status: 'UNKNOWN', detectedAt: new Date().toISOString(), lastActivityAt: null, ageDays: null }
}

export function buildV3GraphFromV2(v2: V2BridgeInput): V3EvidenceGraph {
  const graph = createEvidenceGraph()

  const person = upsertPerson(graph, v2.person.fullName, v2.person.linkedinUrl, v2.person.location)

  if (v2.person.affiliations) {
    for (const aff of v2.person.affiliations) {
      const org = upsertOrganization(graph, aff.organizationName, null, null)
      const personRef = graph.persons.get(person.id)!
      const existingAff = personRef.affiliations.find((a) => a.organizationId === org.id)
      if (!existingAff) {
        personRef.affiliations.push({
          organizationId: org.id,
          organizationName: aff.organizationName,
          role: aff.role ?? null,
          relationship: mapRelationship(aff.relationship),
          isCurrent: aff.isCurrent,
          startedAt: null,
          endedAt: null,
        })
      }
    }
  }

  const primaryOrg = upsertOrganization(
    graph,
    v2.company.name || v2.person.affiliations?.[0]?.organizationName || null,
    v2.company.domain,
    null,
    v2.company.industry,
    v2.company.size,
  )

  // Mark service provider if V2 classified it
  if (v2.businessModel === 'SERVICE_PROVIDER') {
    markOrganizationAsServiceProvider(graph, primaryOrg.id)
  }

  for (const entry of v2.evidenceLedger) {
    // Use the entry's organizationName if available, else fall back to primary
    const entryOrgName = entry.organizationName || primaryOrg.name
    const entryOrg = entryOrgName !== primaryOrg.name
      ? upsertOrganization(graph, entryOrgName, null, null)
      : primaryOrg

    addEvidence(graph, {
      sourceType: mapSourceType(entry.source),
      quote: entry.signal,
      subjectPersonId: person.id,
      subjectOrganizationId: entryOrg.id,
      subjectOrganizationName: entryOrg.name,
      confidence: mapConfidence(entry.confidence),
      evidenceType: mapEvidenceType(entry.evidenceType),
      needOwner: mapNeedOwner(entry.needOwnership),
      polarity: mapPolarity(entry.polarity),
      temporalScope: mapTemporalScope(entry.temporalScope),
    })
  }

  // These preserve organization scoping, temporal data, and apply instructions
  if (v2.sourceEvents && v2.sourceEvents.length > 0) {
    for (const srcEvent of v2.sourceEvents) {
      const eventOrg = upsertOrganization(graph, srcEvent.organizationName, null, null)
      const eventType = mapSourceEventType(srcEvent.eventType)
      // The event's own need owner. Hard-coding HIRING_NEED here turned every
      // agency/project request into hiring evidence and spawned a synthetic
      // hiring episode next to it.
      const eventNeed = sourceEventNeedOwner(srcEvent.needOwner, eventType)

      const event = addEvent(graph, {
        eventType,
        personId: person.id,
        organizationId: eventOrg.id,
        organizationName: srcEvent.organizationName,
        requestedCapability: srcEvent.requestedCapabilities,
        targetAudience: 'PUBLIC',
        explicitness: srcEvent.explicitRequest ? 'EXPLICIT' : 'IMPLIED',
        applyInstructions: srcEvent.applyInstructions,
        occurredAt: srcEvent.occurredAt,
        polarity: 'ACTIVE',
      })

      const evidence = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: srcEvent.description,
        subjectPersonId: person.id,
        subjectOrganizationId: eventOrg.id,
        subjectOrganizationName: srcEvent.organizationName,
        confidence: 0.9,
        evidenceType: srcEvent.evidenceType as 'FACT' | 'STRONG_INFERENCE' | 'WEAK_INFERENCE',
        needOwner: eventNeed,
        polarity: 'ACTIVE',
        temporalScope: srcEvent.ageDays === null ? 'UNKNOWN' : srcEvent.ageDays <= 14 ? 'CURRENT' : srcEvent.ageDays <= 45 ? 'RECENT' : 'HISTORICAL',
        occurredAt: srcEvent.occurredAt,
      })

      linkEvidenceToEvent(graph, event.id, evidence.id)

      // Requested assets belong to the event that asked for them; left
      // unlinked they formed a separate evidence-only episode.
      for (const asset of srcEvent.requestedAssets) {
        const assetEvidence = addEvidence(graph, {
          sourceType: 'linkedin_post',
          quote: `Requested: ${asset}`,
          subjectPersonId: person.id,
          subjectOrganizationId: eventOrg.id,
          subjectOrganizationName: srcEvent.organizationName,
          confidence: 0.95,
          evidenceType: 'FACT',
          needOwner: eventNeed,
          polarity: 'ACTIVE',
        })
        linkEvidenceToEvent(graph, event.id, assetEvidence.id)
      }
    }
  }

  if (v2.opportunity.signals.length > 0) {
    const opportunityOrgName = v2.opportunity.organizationName || primaryOrg.name
    const opportunityOrg = opportunityOrgName !== primaryOrg.name
      ? upsertOrganization(graph, opportunityOrgName, null, null)
      : primaryOrg

    const event = addEvent(graph, {
      eventType: mapOpportunitySignals(v2.opportunity.signals),
      personId: person.id,
      organizationId: opportunityOrg.id,
      organizationName: opportunityOrg.name,
      requestedCapability: v2.job?.skills || [],
      explicitness: v2.commercialReading?.buyerEvidenceKinds.length ? 'EXPLICIT' : 'IMPLIED',
      polarity: mapPolarity(v2.opportunity.polarity),
    })

    // Link evidence to event only if same organization
    for (const ev of Array.from(graph.evidence.values())) {
      if (ev.subjectOrganizationId === opportunityOrg.id) {
        linkEvidenceToEvent(graph, event.id, ev.id)
      }
    }
  }

  for (const post of v2.content.recentPosts) {
    if (post.signals.length > 0) {
      const postOrgName = detectPostOrganization(post.paraphrase, v2.person.affiliations)
      const postOrg = postOrgName !== primaryOrg.name
        ? upsertOrganization(graph, postOrgName, null, null)
        : primaryOrg

      const postEvent = addEvent(graph, {
        eventType: mapOpportunitySignals(post.signals),
        personId: person.id,
        organizationId: postOrg.id,
        organizationName: postOrg.name,
        targetAudience: 'PUBLIC',
        explicitness: 'IMPLIED',
      })

      const postEvidence = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: post.paraphrase,
        subjectPersonId: person.id,
        subjectOrganizationId: postOrg.id,
        subjectOrganizationName: postOrg.name,
        evidenceType: 'STRONG_INFERENCE',
        needOwner: 'UNKNOWN',
      })

      linkEvidenceToEvent(graph, postEvent.id, postEvidence.id)
    }
  }

  return graph
}

export function selectBestEpisodeForDecision(episodes: V3OpportunityEpisode[]): V3OpportunityEpisode | null {
  if (episodes.length === 0) return null
  if (episodes.length === 1) return episodes[0]

  // Score each episode by commercial strength
  const scored = episodes.map(ep => ({
    episode: ep,
    score: scoreEpisodeCommercialStrength(ep),
  }))

  // Ties break on content, never on build order or generated ids.
  scored.sort((a, b) => b.score - a.score || episodeContentKey(a.episode).localeCompare(episodeContentKey(b.episode)))
  return scored[0].episode
}

/**
 * Score an episode's commercial strength for selection.
 * Higher = more commercially valuable = should be the selected episode.
 */
function scoreEpisodeCommercialStrength(ep: V3OpportunityEpisode): number {
  let score = 0

  // Explicit request is strongest signal
  if (ep.explicitRequest) score += 40

  score += Math.min(20, ep.requestedCapabilities.length * 4)

  score += Math.min(15, ep.applicationChannels.length * 5)

  // Timing: current > aging > stale > unknown
  if (ep.ageDays !== null) {
    if (ep.ageDays <= 14) score += 15
    else if (ep.ageDays <= 45) score += 10
    else if (ep.ageDays <= 90) score += 5
    else score += 2
  } else {
    score += 3 // unknown timing
  }

  // Status bonus
  if (ep.status === 'CURRENT') score += 10
  else if (ep.status === 'AGING') score += 7
  else if (ep.status === 'STALE') score += 3

  // Need owner: HIRING_NEED and ORGANIZATION_NEED are most buyer-directional
  if (ep.needOwnerType === 'HIRING_NEED') score += 10
  else if (ep.needOwnerType === 'ORGANIZATION_NEED') score += 8
  else if (ep.needOwnerType === 'SELF_NEED') score += 6

  // A direct request to an external provider is the commercial opportunity
  // itself and outranks an employee-hiring reading of the same post.
  if (ep.explicitRequest && EXTERNAL_SERVICE_EVENTS.has(ep.anchorEvent.eventType)) score += 12

  // Episodes synthesized from loose evidence are inferences, never the
  // primary opportunity when an event-backed episode exists.
  if (ep.anchorEvent.id.startsWith('evt_synthetic_')) score -= 15

  // Service offering is NOT a buyer signal (penalty)
  if (ep.needOwnerType === 'SERVICE_OFFERING') score -= 20

  return score
}

const EXTERNAL_SERVICE_EVENTS: ReadonlySet<string> = new Set([
  'AGENCY_REQUEST', 'FREELANCE_REQUEST', 'PROJECT_REQUEST', 'VENDOR_EVALUATION',
])

function sourceEventNeedOwner(given: string | undefined, eventType: import('./types').V3EventType): import('./types').V3NeedOwner {
  const fromType = eventNeedOwner(eventType)
  // An external-service event is an organization need whatever label the
  // extractor attached; for other types trust a valid extractor label.
  if (EXTERNAL_SERVICE_EVENTS.has(eventType)) return 'ORGANIZATION_NEED'
  const mapped = mapNeedOwner(given)
  return mapped !== 'UNKNOWN' ? mapped : fromType
}

function buildProviderContext(
  graph: V3EvidenceGraph,
  episode: V3OpportunityEpisode,
  v2: V2BridgeInput,
  options: V3OrchestratorOptions,
): V3ProviderContext {
  const person = Array.from(graph.persons.values())[0] ?? { id: 'unknown', fullName: v2.person.fullName, firstName: v2.person.firstName, linkedinUrl: v2.person.linkedinUrl, location: v2.person.location, affiliations: [] }
  const org = episode.organizationId ? graph.organizations.get(episode.organizationId) ?? null : null

  const evidence = episode.evidenceRefs
    .map((id) => graph.evidence.get(id))
    .filter(Boolean)
    .map((ev) => ({
      quote: ev!.quote,
      needOwner: ev!.needOwner,
      confidence: ev!.confidence,
      temporalScope: ev!.temporalScope,
    }))

  return {
    person,
    organization: org,
    episode,
    anchorEvent: episode.anchorEvent,
    evidence,
    currentDate: (options.referenceDate ?? new Date()).toISOString(),
    senderCapabilities: options.senderCapabilities ?? [],
  }
}

/**
 * Deterministic decision when no model is available. It states nothing the
 * episode does not: an explicit (verified) request is a buyer signal, employee
 * hiring is not, relationship stays UNKNOWN, access/timing/fit are left for
 * the source-facts resolvers to decide. Confidence is LOW so the action
 * policy says "research more" rather than pitching.
 */
export function deterministicDecision(context: V3ProviderContext): V3ProviderResult {
  const ep = context.episode
  const isExplicit = ep.explicitRequest
  const isCurrent = ep.status === 'CURRENT' || ep.status === 'AGING'

  return {
    answers: {
      relationship: 'UNKNOWN',
      buyerRequestProbability: isExplicit ? 0.7 : 0.15,
      externalNeedProbability: isExplicit ? 0.6 : 0.2,
      needOwner: ep.needOwnerType,
      fit: 'MEDIUM',
      timing: isExplicit && isCurrent ? 'CURRENT' : 'WEAK',
      access: 'INDIRECT',
      messageEligible: isExplicit && isCurrent ? 0.6 : 0.2,
    },
    providerId: 'deterministic_fallback',
    modelVersion: 'v3_fallback',
    latencyMs: 0,
    confidence: 0.3,
  }
}


/**
 * Detect which organization a LinkedIn post is about by looking for company
 * names mentioned in the post text. Falls back to the primary org.
 */
function detectPostOrganization(postText: string, affiliations?: Array<{ organizationName: string }>): string {
  if (!postText || !affiliations) return affiliations?.[0]?.organizationName || 'Unknown'

  const lower = postText.toLowerCase()
  for (const aff of affiliations) {
    if (aff.organizationName && lower.includes(aff.organizationName.toLowerCase())) {
      return aff.organizationName
    }
  }
  return affiliations[0]?.organizationName || 'Unknown'
}


function mapSourceEventType(type: string): import('./types').V3EventType {
  const valid: import('./types').V3EventType[] = [
    'HIRING', 'FREELANCE_REQUEST', 'AGENCY_REQUEST', 'PROJECT_REQUEST',
    'VENDOR_EVALUATION', 'PRODUCT_LAUNCH', 'FUNDING', 'TECHNICAL_BUILD',
    'SERVICE_OFFERING', 'JOB_SEEKING', 'PARTNERSHIP', 'CUSTOMER_PROBLEM',
    'MARKET_COMMENTARY', 'OTHER',
  ]
  return valid.includes(type as import('./types').V3EventType) ? type as import('./types').V3EventType : 'OTHER'
}

function mapRelationship(rel: string): import('./types').V3Affiliation['relationship'] {
  switch (rel.toLowerCase()) {
    case 'founded_company':
    case 'founded': return 'FOUNDED'
    case 'current_employer':
    case 'employed': return 'EMPLOYED'
    case 'advisory': return 'ADVISORY'
    case 'client': return 'CONTRACTOR'
    default: return 'UNKNOWN'
  }
}

function mapSourceType(source: string): import('./types').V3EvidenceSourceType {
  switch (source) {
    case 'linkedin_profile': return 'linkedin_profile'
    case 'linkedin_post': return 'linkedin_post'
    case 'job_posting': return 'job_posting'
    case 'company_website': return 'company_website'
    case 'user_provided': return 'user_provided'
    case 'inferred': return 'inferred'
    default: return 'pasted_text'
  }
}

function mapConfidence(conf: string): number {
  switch (conf) {
    case 'HIGH': return 0.9
    case 'MEDIUM': return 0.6
    case 'LOW': return 0.3
    default: return 0.5
  }
}

function mapEvidenceType(type: string): import('./types').V3EvidenceType {
  switch (type) {
    case 'FACT': return 'FACT'
    case 'STRONG_INFERENCE': return 'STRONG_INFERENCE'
    case 'WEAK_INFERENCE': return 'WEAK_INFERENCE'
    default: return 'WEAK_INFERENCE'
  }
}

function mapNeedOwner(owner?: string): import('./types').V3NeedOwner {
  if (!owner) return 'UNKNOWN'
  const valid = ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN']
  return valid.includes(owner) ? owner as import('./types').V3NeedOwner : 'UNKNOWN'
}

function mapPolarity(pol?: string): import('./types').V3Evidence['polarity'] {
  switch (pol) {
    case 'ACTIVE': return 'ACTIVE'
    case 'NEGATED': return 'NEGATED'
    case 'CLOSED': return 'CLOSED'
    case 'FUTURE': return 'FUTURE'
    default: return 'ACTIVE'
  }
}

function mapTemporalScope(scope?: string): import('./types').V3Evidence['temporalScope'] {
  switch (scope) {
    case 'CURRENT': return 'CURRENT'
    case 'RECENT': return 'RECENT'
    case 'HISTORICAL': return 'HISTORICAL'
    case 'FUTURE': return 'FUTURE'
    default: return 'UNKNOWN'
  }
}

function mapOpportunitySignals(signals: string[]): import('./types').V3EventType {
  for (const s of signals) {
    switch (s) {
      case 'hiring': return 'HIRING'
      case 'freelance_project_need': return 'FREELANCE_REQUEST'
      case 'explicit_ask': return 'PROJECT_REQUEST'
      case 'technical_problem': return 'TECHNICAL_BUILD'
      case 'growth_signal': return 'FUNDING'
      case 'funding': return 'FUNDING'
      case 'launch': return 'PRODUCT_LAUNCH'
      case 'migration': return 'TECHNICAL_BUILD'
      case 'rebuild': return 'TECHNICAL_BUILD'
      case 'hiring_pressure': return 'HIRING'
    }
  }
  return 'OTHER'
}
