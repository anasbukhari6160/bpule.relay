/**
 * LongCat Structured Decision Provider — V3
 *
 * Fallback provider using LongCat API (OpenAI-compatible).
 */

import type { V3DecisionProvider, V3ProviderContext, V3ProviderResult } from './decision-provider'
import type { V3DecisionAnswers } from './bounded-questions'
import { V3_DECISION_SCHEMA, V3_DECISION_SYSTEM_PROMPT, buildDecisionUserPrompt } from './bounded-questions'

export class LongCatDecisionProvider implements V3DecisionProvider {
  readonly id = 'longcat_structured'
  readonly modelVersion: string

  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(options: {
    apiKey?: string
    model?: string
    baseUrl?: string
  } = {}) {
    this.apiKey = options.apiKey || process.env.LONGCAT_API_KEY || ''
    this.model = options.model || process.env.V3_LONGCAT_MODEL || 'LongCat-2.0'
    this.baseUrl = options.baseUrl || process.env.LONGCAT_BASE_URL || 'https://api.longcat.ai/v1'
    this.modelVersion = `longcat_${this.model}_v3`
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: V3_DECISION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'v3_decision',
            schema: V3_DECISION_SCHEMA,
            strict: true,
          },
        },
        temperature: 0.1,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`LongCat decision call failed: ${response.status} ${body}`)
    }

    const result = await response.json() as {
      choices: Array<{ message: { content: string } }>
      model: string
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    const content = result.choices[0]?.message?.content
    if (!content) {
      throw new Error('LongCat returned empty decision content')
    }

    const parsed = JSON.parse(content) as Record<string, unknown>
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
  // 1 near 0 or 1, 0 at 0.5. The old 1 - 2|p - 0.5| was inverted and
  // reported ~0.04 for a decisive 0.98.
  const buyerConf = 2 * Math.abs(answers.buyerRequestProbability - 0.5)
  const externalConf = 2 * Math.abs(answers.externalNeedProbability - 0.5)
  return Math.round(((buyerConf + externalConf) / 2) * 100) / 100
}
