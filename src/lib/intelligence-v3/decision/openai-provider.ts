/**
 * OpenAI Structured Decision Provider — V3
 *
 * Uses OpenAI's structured output (JSON schema) for bounded classification.
 * Default primary provider.
 */

import type { V3DecisionProvider, V3ProviderContext, V3ProviderResult } from './decision-provider'
import type { V3DecisionAnswers } from './bounded-questions'
import { V3_DECISION_SCHEMA, V3_DECISION_SYSTEM_PROMPT, buildDecisionUserPrompt } from './bounded-questions'
import { withRetry, fetchOpenAI } from '../retry-utils'

// Reuse the existing AI runtime if available, or make direct API calls
export class OpenAIDecisionProvider implements V3DecisionProvider {
  readonly id = 'openai_structured'
  readonly modelVersion: string

  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(options: {
    apiKey?: string
    model?: string
    baseUrl?: string
  } = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || ''
    this.model = options.model || process.env.V3_OPENAI_MODEL || 'gpt-4o-mini'
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    this.modelVersion = `openai_${this.model}_v3`
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0
  }

  async decide(context: V3ProviderContext): Promise<V3ProviderResult> {
    const startTime = Date.now()
    const userPrompt = buildDecisionUserPrompt({
      person: {
        fullName: context.person.fullName,
        affiliations: context.person.affiliations.map((a) => ({
          organizationName: a.organizationName,
          role: a.role,
          isCurrent: a.isCurrent,
        })),
        location: context.person.location,
      },
      organization: context.organization ? {
        name: context.organization.name,
        industry: context.organization.industry,
        size: context.organization.size,
      } : { name: null, industry: null, size: null },
      episode: {
        eventType: context.anchorEvent.eventType,
        explicitRequest: context.episode.explicitRequest,
        requestedCapabilities: context.episode.requestedCapabilities,
        applicationChannels: context.episode.applicationChannels,
        status: context.episode.status,
        ageDays: context.episode.ageDays,
        evidenceCount: context.episode.evidenceRefs.length,
        needOwner: context.episode.needOwnerType,
      },
      evidenceSummary: context.evidence,
      currentDate: context.currentDate,
      senderCapabilities: context.senderCapabilities,
    })

    const result = await withRetry(
      () => fetchOpenAI(
        this.apiKey,
        this.model,
        this.baseUrl,
        V3_DECISION_SYSTEM_PROMPT,
        userPrompt,
        V3_DECISION_SCHEMA,
        300,
      ),
      { maxRetries: 1, baseDelayMs: 1000 },
    )

    if (result.error || !result.data) {
      throw new Error(`OpenAI decision call failed: ${result.error}`)
    }

    const parsed = JSON.parse(result.data) as Record<string, unknown>
    const answers = normalizeAnswers(parsed)

    return {
      answers,
      providerId: this.id,
      modelVersion: this.modelVersion,
      latencyMs: Date.now() - startTime,
      confidence: computeConfidence(answers),
      raw: result,
    }
  }
}


// Inline to avoid circular import issues
function normalizeAnswers(raw: Record<string, unknown>): V3DecisionAnswers {
  const validRelationships = ['BUYER', 'SERVICE_PROVIDER', 'COMPETITOR', 'PARTNER', 'CANDIDATE', 'MIXED', 'UNKNOWN']
  const validNeedOwners = ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN']
  const validFits = ['POOR', 'WEAK', 'MEDIUM', 'STRONG', 'EXCELLENT']
  const validTimings = ['STALE', 'WEAK', 'CURRENT', 'URGENT']
  const validAccess = ['NONE', 'INDIRECT', 'CONNECTION', 'DIRECT']

  return {
    relationship: validRelationships.includes(raw.relationship as string) ? raw.relationship as V3DecisionAnswers['relationship'] : 'UNKNOWN',
    buyerRequestProbability: clamp(raw.buyerRequestProbability),
    externalNeedProbability: clamp(raw.externalNeedProbability),
    needOwner: validNeedOwners.includes(raw.needOwner as string) ? raw.needOwner as V3DecisionAnswers['needOwner'] : 'UNKNOWN',
    fit: validFits.includes(raw.fit as string) ? raw.fit as V3DecisionAnswers['fit'] : 'MEDIUM',
    timing: validTimings.includes(raw.timing as string) ? raw.timing as V3DecisionAnswers['timing'] : 'WEAK',
    access: validAccess.includes(raw.access as string) ? raw.access as V3DecisionAnswers['access'] : 'INDIRECT',
    messageEligible: clamp(raw.messageEligible),
  }
}

function clamp(value: unknown): number {
  if (typeof value !== 'number' || isNaN(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function computeConfidence(answers: V3DecisionAnswers): number {
  // Confidence is lower when probabilities are near 0.5 (uncertain)
  // 1 near 0 or 1, 0 at 0.5. The old 1 - 2|p - 0.5| was inverted and
  // reported ~0.04 for a decisive 0.98.
  const buyerConf = 2 * Math.abs(answers.buyerRequestProbability - 0.5)
  const externalConf = 2 * Math.abs(answers.externalNeedProbability - 0.5)
  return Math.round(((buyerConf + externalConf) / 2) * 100) / 100
}
