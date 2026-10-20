
import type {
  TaskClass,
  TaskProfile,
  ProviderResult,
  JsonCallParams,
  TextCallParams,
  AiTrace,
} from './types'
import { isAvailable, recordFailure } from './health'
import { resolveModel as resolveGroqModel, callJson as groqJson, callText as groqText, hasGroq } from './providers/groq'
import { resolveModel as resolveOpenCodeModel, callJson as openCodeJson, callText as openCodeText, hasOpenCode } from './providers/opencode'
import { resolveModel as resolveOpenAiModel, resolveModelForTier, callJson as openAiJson, callText as openAiText, hasOpenAi } from './providers/openai'
import { resolveModel as resolveLongCatModel, callJson as longcatJson, callText as longcatText, hasLongCat } from './providers/longcat'
import { persistTrace } from './telemetry'
import { validateShape, type ShapeSchema, schemaAsPromptInstruction } from './schemas'
import {
  defaultTierForTask,
  resolveTier,
  shouldEscalateTier,
  getTierConfig,
  type IntelligenceTier,
} from './model-router'
import { ContentCache } from '@/lib/ai/cache'
import { isBudgetExceeded, recordCost } from '@/lib/ai/budget'


const TASK_PROFILES: Record<TaskClass, TaskProfile> = {
  FAST_STRUCTURED: {
    taskClass: 'FAST_STRUCTURED',
    outputMode: 'json_object',
    reasoningLevel: 'NONE',
    maxTokens: 1024,
    timeoutMs: 8_000,
    stream: false,
    allowDeterministicFallback: true,
  },
  INTERACTIVE_WRITING: {
    taskClass: 'INTERACTIVE_WRITING',
    outputMode: 'text',
    reasoningLevel: 'LOW',
    maxTokens: 2048,
    timeoutMs: 15_000,
    stream: true,
    allowDeterministicFallback: true,
  },
  DEEP_WRITING: {
    taskClass: 'DEEP_WRITING',
    outputMode: 'text',
    reasoningLevel: 'MEDIUM',
    maxTokens: 4096,
    timeoutMs: 30_000,
    stream: true,
    allowDeterministicFallback: false,
  },
  BACKGROUND_INTELLIGENCE: {
    taskClass: 'BACKGROUND_INTELLIGENCE',
    outputMode: 'json_object',
    reasoningLevel: 'HIGH',
    maxTokens: 4096,
    timeoutMs: 60_000,
    stream: false,
    allowDeterministicFallback: true,
  },
}

//
// OpenAI is the primary intelligence layer. When OPENAI_API_KEY is present it
// leads the chain so the tier model mapping (luna/terra/sol) takes effect.
// OpenCode, Groq, LongCat remain as fallbacks when their keys are configured.
//
// Legacy override: set SCOUT_AI_PREFERRED_PROVIDER=opencode|groq|longcat to
// restore old ordering for a specific deployment.

interface ChainEntry {
  provider: 'groq' | 'opencode' | 'openai' | 'longcat'
  modelResolver: (modelId?: string) => { model: string; baseUrl: string; provider: string }
  credentialId: string
}

type ProviderName = 'opencode' | 'groq' | 'openai' | 'longcat'

function preferredProvider(): ProviderName {
  const override = process.env.SCOUT_AI_PREFERRED_PROVIDER
  if (override === 'opencode' || override === 'groq' || override === 'longcat' || override === 'openai') {
    return override
  }
  return hasOpenAi() ? 'openai' : 'opencode'
}

function buildChain(primary: ProviderName, fallbacks: ProviderName[]): ChainEntry[] {
  const all: ProviderName[] = [primary, ...fallbacks]
  return all.map((p) => {
    switch (p) {
      case 'opencode': return { provider: 'opencode', modelResolver: resolveOpenCodeModel, credentialId: 'opencode-primary' }
      case 'groq': return { provider: 'groq', modelResolver: resolveGroqModel, credentialId: 'groq-primary' }
      case 'openai': return { provider: 'openai', modelResolver: resolveOpenAiModel, credentialId: 'openai-primary' }
      case 'longcat': return { provider: 'longcat', modelResolver: resolveLongCatModel, credentialId: 'longcat-primary' }
    }
  })
}

function getChainForTask(taskClass: TaskClass): ChainEntry[] {
  const primary = preferredProvider()
  switch (taskClass) {
    case 'FAST_STRUCTURED':
      return buildChain(primary, ['opencode', 'groq', 'longcat'].filter((p) => p !== primary) as ProviderName[])
    case 'INTERACTIVE_WRITING':
      return buildChain(primary, ['opencode', 'groq', 'longcat'].filter((p) => p !== primary) as ProviderName[])
    case 'DEEP_WRITING':
      return buildChain(primary, ['opencode', 'groq', 'longcat'].filter((p) => p !== primary) as ProviderName[])
    case 'BACKGROUND_INTELLIGENCE':
      return buildChain(primary, ['opencode', 'groq', 'longcat'].filter((p) => p !== primary) as ProviderName[])
  }
}


export interface GenerateOptions {
  task: TaskClass
  system: string
  user: string
  schema?: Record<string, unknown>
  schemaName?: string
  maxTokens?: number
  /** Per-call timeout override (ms). Defaults to the task profile's timeout. */
  timeoutMs?: number
  temperature?: number
  stream?: boolean
  onChunk?: (delta: string) => void
  onStatus?: (msg: string) => void
  signal?: AbortSignal
  modelOverride?: string
  /** Intelligence tier: luna | terra | sol — defaults by task */
  tier?: IntelligenceTier
  /** Prompt version for cache key + trace (e.g. 'conversation-understand-v1') */
  promptVersion?: string
  /** Schema definition for output validation (ShapeSchema format) */
  outputSchema?: ShapeSchema
  /** Skip cache (force fresh generation) */
  skipCache?: boolean
  /** Organization ID for telemetry persistence. Filled from the signed-in rep when omitted. */
  organizationId?: string
  /** Rep who triggered the call. */
  repId?: string
  /** Lead this call is about, when there is one. */
  leadId?: string
  /** Upwork job this call is about, when there is one. */
  jobId?: string
  /** Where in the code this call originated (e.g. 'extraction-pipeline:runPassA') */
  callSite?: string
  /** Feature that initiated this call (e.g. 'prospect_analysis', 'connection_note') */
  feature?: string
  /**
   * Opt-in retry of the whole provider chain when every provider failed for a
   * transient reason (rate limit, timeout, overload, circuit-breaker cooldown).
   * Waits with exponential backoff and never sleeps past `deadline` (epoch ms).
   * Off by default, so existing callers behave exactly as before.
   */
  retry?: AiRetryOptions
}

export interface AiRetryOptions {
  /** Extra attempts after the first (0 = no retry). */
  attempts: number
  /** First wait; doubles each attempt (with jitter). Default 2s. */
  baseDelayMs?: number
  /** Longest single wait. Default 20s. */
  maxDelayMs?: number
  /** Give up instead of waiting past this time (epoch ms). */
  deadline?: number
}

// Rate limits, timeouts, overload and provider cooldowns clear with time;
// missing credentials, budget blocks and bad requests do not.
const RETRYABLE_AI_ERROR = /\b(?:429|rate[ _-]?limit|too many requests|quota|timeout|timed out|aborted|abort|overloaded|unavailable|503|502|500|504|econnreset|etimedout|socket hang up|fetch failed|network|skipped_unhealthy|empty_output|unable to normalize|malformed)\b/i
const NON_RETRYABLE_AI_ERROR = /\b(?:budget exceeded|missing_credentials|invalid api key|unauthorized|401|403)\b/i

export function isRetryableAiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (NON_RETRYABLE_AI_ERROR.test(msg)) return false
  // Every provider skipped for missing credentials: nothing will change by waiting.
  if (/All providers failed: $/.test(msg)) return false
  return RETRYABLE_AI_ERROR.test(msg)
}

/** Backoff delay for a retry attempt (1-based), with up to 25% jitter. */
export function aiRetryDelay(attempt: number, opts: AiRetryOptions, random: () => number = Math.random): number {
  const base = opts.baseDelayMs ?? 2_000
  const max = opts.maxDelayMs ?? 20_000
  const raw = Math.min(max, base * 2 ** (attempt - 1))
  return Math.round(raw * (1 + random() * 0.25))
}

/**
 * Run `fn`, retrying transient AI failures with exponential backoff. Pure
 * apart from `sleep`/`now`, which tests replace.
 */
export async function withAiRetry<T>(
  fn: () => Promise<T>,
  opts: AiRetryOptions | undefined,
  deps: { sleep?: (ms: number) => Promise<void>; now?: () => number; random?: () => number } = {},
): Promise<T> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const attempts = Math.max(0, opts?.attempts ?? 0)
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!opts || attempt >= attempts || !isRetryableAiError(err)) throw err
      const wait = aiRetryDelay(attempt + 1, opts, deps.random)
      if (opts.deadline && now() + wait >= opts.deadline) throw err
      await sleep(wait)
    }
  }
}

export interface GenerateResult<T> {
  data: T
  trace: AiTrace
  cacheHit?: boolean
}


const resultCache = new ContentCache<unknown>({ maxSize: 500, ttlMs: 15 * 60 * 1000, version: 'ai-runtime-v3' })

function cacheKey(opts: Pick<GenerateOptions, 'task' | 'system' | 'user' | 'promptVersion' | 'schemaName'>): string {
  const parts = [opts.task, opts.promptVersion || 'unversioned', opts.schemaName || 'none', opts.system, opts.user]
  return parts.join('::')
}


async function resolveTraceScope(options: GenerateOptions): Promise<{ organizationId?: string; repId?: string }> {
  let organizationId = options.organizationId
  let repId = options.repId
  if (organizationId && repId) return { organizationId, repId }
  try {
    const { getAuthContext } = await import('@/lib/auth/organization')
    const auth = await getAuthContext()
    if (auth) {
      organizationId = organizationId ?? auth.orgId
      repId = repId ?? auth.repId
    }
  } catch {
    // Scripts and tests have no request. The call still runs; the trace is skipped.
  }
  return { organizationId, repId }
}

export async function generate<T = Record<string, unknown>>(
  options: GenerateOptions,
): Promise<GenerateResult<T>> {
  if (!options.retry || options.retry.attempts <= 0) return generateOnce<T>(options)
  return withAiRetry(() => generateOnce<T>(options), options.retry)
}

async function generateOnce<T>(
  options: GenerateOptions,
): Promise<GenerateResult<T>> {
  const profile = TASK_PROFILES[options.task]
  const maxTokens = options.maxTokens || profile.maxTokens
  const temperature = options.temperature ?? defaultTemperature(options.task)
  const timeoutMs = options.timeoutMs ?? profile.timeoutMs
  const taskId = generateTaskId()
  const scope = await resolveTraceScope(options)
  const traceBase = {
    taskId,
    taskClass: options.task,
    inputChars: options.system.length + options.user.length,
    timestamp: Date.now(),
    leadId: options.leadId ?? null,
    jobId: options.jobId ?? null,
    repId: scope.repId ?? null,
  }

  const chain = getChainForTask(options.task)
  const errors: Array<{ provider: string; model: string; error: string }> = []
  const skippedProviders: Array<{ provider: string; model: string; reason: string }> = []
  const RUNTIME_VERSION = 'runtime-v3'
  const tier = resolveTier(options.tier, options.task)

  // Schema injection: append shape instruction to user prompt if schema provided
  let user = options.user
  if (options.outputSchema) {
    user = `${options.user}\n\n${schemaAsPromptInstruction(options.outputSchema)}\n\nRespond with a single JSON object only.`
  } else if (options.schema && !/\bjson\b/i.test(options.user)) {
    user = `${options.user}\n\nRespond with a single JSON object only.`
  }
  const useJson = Boolean(options.schema || options.outputSchema) && !options.onChunk && !options.stream

  if (!options.skipCache) {
    const key = cacheKey({ task: options.task, system: options.system, user: options.user, promptVersion: options.promptVersion, schemaName: options.schemaName })
    const cached = resultCache.get(key)
    if (cached !== null) {
      const trace: AiTrace = {
        ...traceBase,
        provider: 'cache',
        model: 'cache',
        credentialId: 'cache',
        costTier: 'cache',
        attempt: 0,
        inputTokens: 0,
        outputTokens: 0,
        ttfbMs: 0,
        latencyMs: 0,
        estimatedCostUsd: 0,
        schemaValid: true,
        quality: 'UNASSESSED',
        fallback: false,
        fallbackReason: null,
        error: null,
        runtimeVersion: RUNTIME_VERSION,
        callSite: options.callSite ?? 'unknown',
        feature: options.feature ?? 'unknown',
        modelTier: tier,
        promptVersion: options.promptVersion,
        cacheHit: true,
      }
      logTrace(trace)
      if (scope.organizationId) void persistTrace(trace, scope.organizationId)
      return { data: cached as T, trace, cacheHit: true }
    }
  }

  const tierConfig = getTierConfig(tier)
  if (tierConfig.budgetClass === 'expensive' && isBudgetExceeded()) {
    throw new Error('AI budget exceeded — expensive tier blocked')
  }

  let currentTier: IntelligenceTier = tier

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]

    const resolved = step.provider === 'openai'
      ? { ...resolveModelForTier(currentTier), model: resolveModelForTier(currentTier).model, baseUrl: resolveModelForTier(currentTier).baseUrl, provider: 'openai' }
      : step.modelResolver(options.modelOverride)

    if (!providerHasCredentials(step.provider)) {
      skippedProviders.push({ provider: resolved.provider, model: resolved.model, reason: 'missing_credentials' })
      continue
    }

    if (!isAvailable(resolved.provider, resolved.model, step.credentialId)) {
      const reason = 'skipped_unhealthy'
      errors.push({ provider: resolved.provider, model: resolved.model, error: reason })
      skippedProviders.push({ provider: resolved.provider, model: resolved.model, reason })
      continue
    }

    const providerModel = {
      provider: resolved.provider,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      supportsJsonSchema: true,
      maxContextTokens: 128_000,
    }

    try {
      let result: ProviderResult<unknown>

      if (useJson || (profile.outputMode === 'json_object' && !options.stream && !options.onChunk)) {
        const params: JsonCallParams = {
          system: options.system,
          user,
          schema: options.schema,
          schemaName: options.schemaName,
          maxTokens,
          temperature,
          onStatus: options.onStatus,
          signal: options.signal,
        }
        result = await callJsonByProvider(step.provider, providerModel, params, timeoutMs)
      } else {
        const params: TextCallParams = {
          system: options.system,
          user,
          maxTokens,
          temperature,
          onChunk: options.onChunk,
          onStatus: options.onStatus,
          signal: options.signal,
        }
        result = await callTextByProvider(step.provider, providerModel, params, timeoutMs)
      }

      let schemaValid = true
      let validationRetries = 0
      if (options.outputSchema && useJson && typeof result.data === 'object' && result.data !== null) {
        const validation = validateShape(result.data as Record<string, unknown>, options.outputSchema)
        if (!validation.valid && validationRetries < 1) {
          validationRetries++
          // Retry once with corrective instruction
          const correctiveUser = `${user}\n\nPREVIOUS OUTPUT INVALID. Missing: ${validation.missing.join(', ') || 'none'}. Type errors: ${validation.typeErrors.join(', ') || 'none'}. Fix and return valid JSON.`
          const retryParams: JsonCallParams = {
            system: options.system,
            user: correctiveUser,
            schema: options.schema,
            schemaName: options.schemaName,
            maxTokens,
            temperature,
            onStatus: options.onStatus,
            signal: options.signal,
          }
          const retryResult = await callJsonByProvider(step.provider, providerModel, retryParams, timeoutMs)
          const retryValidation = validateShape(retryResult.data as Record<string, unknown>, options.outputSchema)
          if (retryValidation.valid) {
            result = retryResult
            schemaValid = true
          } else {
            schemaValid = false
            recordFailure(resolved.provider, resolved.model, step.credentialId, 'malformed', result.latencyMs)
          }
        } else if (!validation.valid) {
          schemaValid = false
        }
      }

      // Model returned near-empty content (output_tokens=1 or empty string).
      // Treat as a transient failure and fall back to next provider.
      const isEmptyOutput = !result.data ||
        (typeof result.data === 'string' && result.data.trim().length < 5) ||
        (typeof result.data === 'object' && JSON.stringify(result.data) === '{}')

      if (isEmptyOutput && !options.stream) {
        errors.push({ provider: resolved.provider, model: resolved.model, error: 'empty_output' })
        recordFailure(resolved.provider, resolved.model, step.credentialId, 'malformed')
        continue
      }

      const costTier = step.provider === 'openai' ? 'tier4' : step.provider === 'longcat' ? 'tier1' : 'tier1'
      const trace: AiTrace = {
        ...traceBase,
        provider: result.provider,
        model: result.model,
        credentialId: result.credentialId,
        costTier,
        attempt: i + 1,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ttfbMs: result.ttfbMs,
        latencyMs: result.latencyMs,
        estimatedCostUsd: result.estimatedCostUsd,
        schemaValid,
        quality: 'UNASSESSED',
        fallback: i > 0,
        fallbackReason: i > 0 ? errors[errors.length - 1]?.error ?? null : null,
        error: null,
        runtimeVersion: RUNTIME_VERSION,
        callSite: options.callSite ?? 'unknown',
        skippedProviders: skippedProviders.length > 0 ? skippedProviders : undefined,
        feature: options.feature ?? 'unknown',
        modelTier: tier,
        promptVersion: options.promptVersion,
      }

      recordCost({
        feature: options.feature ?? 'unknown',
        operation: options.task,
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        cacheHit: false,
        retryCount: validationRetries,
        fallback: i > 0,
        estimatedCostUsd: result.estimatedCostUsd,
        costTier,
      })

      if (!options.skipCache && schemaValid) {
        const key = cacheKey({ task: options.task, system: options.system, user: options.user, promptVersion: options.promptVersion, schemaName: options.schemaName })
        resultCache.set(key, result.data)
      }

      logTrace(trace)
      if (scope.organizationId) void persistTrace(trace, scope.organizationId)
      return { data: result.data as T, trace }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push({ provider: resolved.provider, model: resolved.model, error: errorMsg })
      recordFailure(resolved.provider, resolved.model, step.credentialId, 'error')

      // Tier escalation check for OpenAI path
      if (step.provider === 'openai') {
        const esc = shouldEscalateTier({
          taskClass: options.task,
          primaryTier: currentTier,
          attemptCount: errors.length,
          malformedOutput: errorMsg.includes('malformed') || errorMsg.includes('INVALID'),
          isHighValue: options.feature === 'high_value_lead',
          qualityFailed: false,
        })
        if (esc.escalate && esc.toTier !== currentTier) {
          currentTier = esc.toTier
        }
      }

      continue
    }
  }

  // All providers failed
  const trace: AiTrace = {
    ...traceBase,
    provider: 'none',
    model: 'none',
    credentialId: 'none',
    attempt: errors.length,
    inputTokens: 0,
    outputTokens: 0,
    ttfbMs: null,
    latencyMs: 0,
    estimatedCostUsd: 0,
    schemaValid: false,
    quality: 'UNASSESSED',
    fallback: errors.length > 1,
    fallbackReason: null,
    error: errors.map((e) => `${e.provider}/${e.model}: ${e.error}`).join('; '),
    runtimeVersion: RUNTIME_VERSION,
    callSite: options.callSite ?? 'unknown',
    skippedProviders: skippedProviders.length > 0 ? skippedProviders : undefined,
    feature: options.feature ?? 'unknown',
    modelTier: tier,
    promptVersion: options.promptVersion,
  }
  logTrace(trace)
  if (scope.organizationId) void persistTrace(trace, scope.organizationId)
  throw new Error(`All providers failed: ${trace.error}`)
}


async function callJsonByProvider(
  provider: string,
  model: { provider: string; model: string; baseUrl: string; costPerInputToken: number; costPerOutputToken: number; supportsStreaming: boolean; supportsJsonSchema: boolean; maxContextTokens: number },
  params: JsonCallParams,
  timeoutMs: number,
): Promise<ProviderResult<unknown>> {
  switch (provider) {
    case 'groq': return groqJson(model as any, params, timeoutMs)
    case 'opencode': return openCodeJson(model as any, params, timeoutMs)
    case 'openai': return openAiJson(model as any, params, timeoutMs)
    case 'longcat': return longcatJson(model as any, params, timeoutMs)
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}

async function callTextByProvider(
  provider: string,
  model: { provider: string; model: string; baseUrl: string; costPerInputToken: number; costPerOutputToken: number; supportsStreaming: boolean; supportsJsonSchema: boolean; maxContextTokens: number },
  params: TextCallParams,
  timeoutMs: number,
): Promise<ProviderResult<string>> {
  switch (provider) {
    case 'groq': return groqText(model as any, params, timeoutMs)
    case 'opencode': return openCodeText(model as any, params, timeoutMs)
    case 'openai': return openAiText(model as any, params, timeoutMs)
    case 'longcat': return longcatText(model as any, params, timeoutMs)
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}


function providerHasCredentials(provider: string): boolean {
  switch (provider) {
    case 'opencode': return hasOpenCode()
    case 'groq': return hasGroq()
    case 'openai': return hasOpenAi()
    case 'longcat': return hasLongCat()
    default: return false
  }
}

function defaultTemperature(task: TaskClass): number {
  switch (task) {
    case 'FAST_STRUCTURED': return 0.1
    case 'INTERACTIVE_WRITING': return 0.7
    case 'DEEP_WRITING': return 0.6
    case 'BACKGROUND_INTELLIGENCE': return 0.3
  }
}

function generateTaskId(): string {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function logTrace(trace: AiTrace): void {
  const fallback = trace.fallback ? ` (fallback: ${trace.fallbackReason})` : ''
  const error = trace.error ? ` ERROR: ${trace.error}` : ''
  const skipped = trace.skippedProviders?.length
    ? ` skipped=[${trace.skippedProviders.map((s) => `${s.provider}:${s.reason}`).join(',')}]`
    : ''
  const schema = trace.schemaValid === false ? ' schema=INVALID' : ''
  const cache = trace.cacheHit ? ' cache=hit' : ''
  const mTier = trace.modelTier ? ` tier=${trace.modelTier}` : ''
  const pVer = trace.promptVersion ? ` prompt=${trace.promptVersion}` : ''
  console.info(
    `[relay-ai] task=${trace.taskClass} provider=${trace.provider} model=${trace.model} ` +
    `attempt=${trace.attempt} input_tokens=${trace.inputTokens} output_tokens=${trace.outputTokens} ` +
    `ttfb=${trace.ttfbMs}ms latency=${trace.latencyMs}ms cost=$${trace.estimatedCostUsd.toFixed(6)} ` +
    `runtime=${trace.runtimeVersion} site=${trace.callSite} feature=${trace.feature}` +
    `${mTier}${pVer}${cache}${fallback}${skipped}${schema}${error}`,
  )
}


export { TASK_PROFILES }
export type { TaskProfile } from './types'
export { isAvailable, getAllHealth, getHealth, getCooldownRemaining, resetHealth } from './health'
export { hasGroq } from './providers/groq'
export { hasOpenCode } from './providers/opencode'
export { hasOpenAi } from './providers/openai'
export { hasLongCat } from './providers/longcat'
export { defaultTierForTask, resolveTier, shouldEscalateTier, getTierConfig, TIER_REGISTRY } from './model-router'
export { validateShape, type ShapeSchema, type FieldSpec } from './schemas'
export function clearResultCache(): void { resultCache.clear() }
export function getResultCacheSize(): number { return resultCache.size }
