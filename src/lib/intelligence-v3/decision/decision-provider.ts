/**
 * DecisionProvider — V3
 *
 * Abstraction for bounded commercial decision models.
 *
 * Implementations:
 * - OpenAI Structured (default)
 * - LongCat Structured (fallback)
 * - Jev (feature-flagged, shadow)
 * - Kev (feature-flagged, benchmark)
 *
 * Each provider receives ONE normalized OpportunityEpisode and returns
 * typed answers. No provider re-interprets raw source independently.
 */

import type {
  V3BoundedDecision,
  V3OpportunityEpisode,
  V3Person,
  V3Organization,
  V3Event,
} from '../types'
import type { V3DecisionAnswers } from './bounded-questions'


export interface V3DecisionProvider {
  readonly id: string
  readonly modelVersion: string
  /** Whether this provider is available (has credentials) */
  isAvailable(): boolean
  /** Evaluate a single opportunity episode */
  decide(context: V3ProviderContext): Promise<V3ProviderResult>
}

export interface V3ProviderContext {
  person: V3Person
  organization: V3Organization | null
  episode: V3OpportunityEpisode
  /** Convenience accessor for the anchor event */
  anchorEvent: V3Event
  evidence: Array<{
    quote: string
    needOwner: string
    confidence: number
    temporalScope: string
  }>
  currentDate: string
  senderCapabilities: string[]
}

export interface V3ProviderResult {
  answers: V3DecisionAnswers
  providerId: string
  modelVersion: string
  latencyMs: number
  confidence: number  // provider's self-assessed confidence
  raw?: unknown       // raw response for debugging
  /** Answer fields that failed validation and were replaced by safe defaults. */
  normalizedFields?: string[]
}

/** Confidence a result is capped at once any of its answers had to be replaced. */
export const NORMALIZED_ANSWER_CONFIDENCE_CAP = 0.3

/**
 * The scoring boundary never trusts a provider result as-is. Every answer
 * is re-validated here, whatever produced it (a model, a replay, a stub, a
 * cascade), so an invalid enum or a non-finite probability can never reach
 * the score tables and come out as NaN. Any replaced field is listed on the
 * result and caps the provider confidence; the assembler records it on the
 * packet and the caller traces it.
 */
export function hardenProviderResult(result: V3ProviderResult): V3ProviderResult {
  const raw = (result.answers ?? {}) as unknown as Record<string, unknown>
  const answers = normalizeAnswers(raw)
  const normalizedFields = (Object.keys(answers) as Array<keyof V3DecisionAnswers>)
    .filter((key) => {
      const before = raw[key]
      const after = answers[key]
      if (typeof after === 'number') return typeof before !== 'number' || !Number.isFinite(before) || before !== after
      return before !== after
    })
    .map(String)
  let confidence = typeof result.confidence === 'number' && Number.isFinite(result.confidence)
    ? Math.max(0, Math.min(1, result.confidence))
    : 0
  if (normalizedFields.length > 0) confidence = Math.min(confidence, NORMALIZED_ANSWER_CONFIDENCE_CAP)
  if (normalizedFields.length === 0 && confidence === result.confidence) return result
  return { ...result, answers, confidence, normalizedFields: normalizedFields.length > 0 ? normalizedFields : result.normalizedFields }
}


export class V3DecisionProviderRegistry {
  private providers: Map<string, V3DecisionProvider> = new Map()
  private _primary: string = 'openai_structured'

  register(provider: V3DecisionProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): V3DecisionProvider | undefined {
    return this.providers.get(id)
  }

  setPrimary(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider '${id}' not registered`)
    }
    this._primary = id
  }

  get primary(): V3DecisionProvider {
    const provider = this.providers.get(this._primary)
    if (!provider) {
      throw new Error(`Primary provider '${this._primary}' not found`)
    }
    return provider
  }

  /** Get available provider with fallback */
  getAvailable(preferred?: string): V3DecisionProvider | null {
    if (preferred) {
      const p = this.providers.get(preferred)
      if (p?.isAvailable()) return p
    }
    const primary = this.providers.get(this._primary)
    if (primary?.isAvailable()) return primary
    for (const provider of this.providers.values()) {
      if (provider.isAvailable()) return provider
    }
    return null
  }

  /** Get all registered providers */
  getAll(): V3DecisionProvider[] {
    return Array.from(this.providers.values())
  }

  /** Get all available providers */
  getAvailableAll(): V3DecisionProvider[] {
    return this.getAll().filter((p) => p.isAvailable())
  }
}


let _registry: V3DecisionProviderRegistry | null = null

export function getDecisionRegistry(): V3DecisionProviderRegistry {
  if (!_registry) {
    _registry = new V3DecisionProviderRegistry()
  }
  return _registry
}


export function normalizeAnswers(raw: Record<string, unknown>): V3DecisionAnswers {
  return {
    relationship: validateRelationship(raw.relationship),
    buyerRequestProbability: clampProbability(raw.buyerRequestProbability),
    externalNeedProbability: clampProbability(raw.externalNeedProbability),
    needOwner: validateNeedOwner(raw.needOwner),
    fit: validateFitLevel(raw.fit),
    timing: validateTimingLevel(raw.timing),
    access: validateAccessLevel(raw.access),
    messageEligible: clampProbability(raw.messageEligible),
  }
}


function validateRelationship(value: unknown): V3DecisionAnswers['relationship'] {
  const valid = ['BUYER', 'SERVICE_PROVIDER', 'COMPETITOR', 'PARTNER', 'CANDIDATE', 'MIXED', 'UNKNOWN']
  return typeof value === 'string' && valid.includes(value) ? value as V3DecisionAnswers['relationship'] : 'UNKNOWN'
}

function validateNeedOwner(value: unknown): V3DecisionAnswers['needOwner'] {
  const valid = ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN']
  return typeof value === 'string' && valid.includes(value) ? value as V3DecisionAnswers['needOwner'] : 'UNKNOWN'
}

function validateFitLevel(value: unknown): V3DecisionAnswers['fit'] {
  const valid = ['POOR', 'WEAK', 'MEDIUM', 'STRONG', 'EXCELLENT']
  return typeof value === 'string' && valid.includes(value) ? value as V3DecisionAnswers['fit'] : 'MEDIUM'
}

function validateTimingLevel(value: unknown): V3DecisionAnswers['timing'] {
  const valid = ['STALE', 'WEAK', 'CURRENT', 'URGENT']
  return typeof value === 'string' && valid.includes(value) ? value as V3DecisionAnswers['timing'] : 'WEAK'
}

function validateAccessLevel(value: unknown): V3DecisionAnswers['access'] {
  const valid = ['NONE', 'INDIRECT', 'CONNECTION', 'DIRECT']
  return typeof value === 'string' && valid.includes(value) ? value as V3DecisionAnswers['access'] : 'INDIRECT'
}

function clampProbability(value: unknown): number {
  if (typeof value !== 'number' || isNaN(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}
