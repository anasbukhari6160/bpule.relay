/**
 * AI Runtime V3 — Telemetry Persistence
 *
 * Persists AI operation metadata to Supabase for admin observability.
 * RLS/org-isolated: traces scoped to organization.
 */

import type { AiTrace } from './types'


async function getSupabase() {
  const { createServerSupabase } = await import('@/lib/supabase/server')
  return createServerSupabase()
}


export interface PersistedTrace {
  id: string
  organization_id: string
  task_class: string
  provider: string
  model: string
  credential_id: string
  attempt: number
  input_tokens: number
  output_tokens: number
  input_chars: number
  ttfb_ms: number | null
  latency_ms: number
  estimated_cost_usd: number
  schema_valid: boolean
  quality: string
  fallback: boolean
  fallback_reason: string | null
  error: string | null
  call_site: string
  feature: string
  model_tier: string | null
  prompt_version: string | null
  cache_hit: boolean
  lead_id: string | null
  job_id: string | null
  rep_id: string | null
  created_at: string
}

/**
 * Persist an AI trace to the database.
 * Non-blocking — failures are logged but don't affect the AI operation.
 */
export async function persistTrace(
  trace: AiTrace,
  organizationId: string,
): Promise<void> {
  try {
    const supabase = await getSupabase()

    const record: Omit<PersistedTrace, 'id'> = {
      organization_id: organizationId,
      task_class: trace.taskClass,
      provider: trace.provider,
      model: trace.model,
      credential_id: trace.credentialId,
      attempt: trace.attempt,
      input_tokens: trace.inputTokens,
      output_tokens: trace.outputTokens,
      input_chars: trace.inputChars,
      ttfb_ms: trace.ttfbMs,
      latency_ms: trace.latencyMs,
      estimated_cost_usd: trace.estimatedCostUsd,
      schema_valid: trace.schemaValid,
      quality: trace.quality,
      fallback: trace.fallback,
      fallback_reason: trace.fallbackReason,
      error: trace.error,
      call_site: trace.callSite,
      feature: trace.feature,
      model_tier: trace.modelTier ?? null,
      prompt_version: trace.promptVersion ?? null,
      cache_hit: trace.cacheHit ?? false,
      lead_id: trace.leadId ?? null,
      job_id: trace.jobId ?? null,
      rep_id: trace.repId ?? null,
      created_at: new Date(trace.timestamp).toISOString(),
    }

    const { error } = await supabase
      .from('ai_traces')
      .insert(record)

    if (error && /lead_id|job_id|rep_id/.test(error.message)) {
      const { lead_id: _lead, job_id: _job, rep_id: _rep, ...withoutScope } = record
      const retry = await supabase.from('ai_traces').insert(withoutScope)
      if (retry.error) console.warn('[ai/telemetry] Failed to persist trace:', retry.error.message)
      return
    }

    if (error) {
      console.warn('[ai/telemetry] Failed to persist trace:', error.message)
    }
  } catch (err) {
    console.warn('[ai/telemetry] Persistence error:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * One row per model call that does not go through generate().
 * Used by the V3 decision and event extraction, which call OpenAI directly.
 */
export async function recordScopedTrace(input: {
  feature: string
  callSite: string
  provider: string
  model: string
  latencyMs: number
  success: boolean
  error?: string | null
  attempt?: number
  fallback?: boolean
  estimatedCostUsd?: number
  organizationId?: string | null
  repId?: string | null
  leadId?: string | null
  jobId?: string | null
}): Promise<void> {
  let organizationId = input.organizationId ?? undefined
  let repId = input.repId ?? undefined
  if (!organizationId || !repId) {
    try {
      const { getAuthContext } = await import('@/lib/auth/organization')
      const auth = await getAuthContext()
      if (auth) {
        organizationId = organizationId ?? auth.orgId
        repId = repId ?? auth.repId
      }
    } catch {
      // No request scope. Skip the row rather than failing the decision.
    }
  }
  if (!organizationId) return
  const trace: AiTrace = {
    taskId: `direct-${Date.now()}`,
    taskClass: 'FAST_STRUCTURED',
    provider: input.provider,
    model: input.model,
    credentialId: 'direct',
    attempt: input.attempt ?? 1,
    inputTokens: 0,
    outputTokens: 0,
    inputChars: 0,
    ttfbMs: null,
    latencyMs: input.latencyMs,
    estimatedCostUsd: input.estimatedCostUsd ?? 0,
    schemaValid: input.success,
    quality: input.success ? 'GOOD' : 'BAD',
    fallback: input.fallback ?? false,
    fallbackReason: input.fallback ? (input.error ?? 'fallback') : null,
    error: input.error ?? null,
    callSite: input.callSite,
    feature: input.feature,
    timestamp: Date.now(),
    runtimeVersion: 'direct',
    leadId: input.leadId ?? null,
    jobId: input.jobId ?? null,
    repId: repId ?? null,
  }
  await persistTrace(trace, organizationId)
}

/**
 * Get aggregated AI usage statistics for an organization.
 * Safe outside request scope — returns zeroed shape on any failure.
 */
export async function getAiUsageStats(
  organizationId: string,
  days: number = 7,
): Promise<{
  totalRequests: number
  totalSuccesses: number
  totalErrors: number
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCostUsd: number
  fallbackRate: number
  providerBreakdown: Array<{ provider: string; count: number; p50: number }>
  taskBreakdown: Array<{ taskClass: string; count: number; p50: number }>
  featureBreakdown: Array<{ feature: string; count: number; costUsd: number }>
  tierBreakdown: Array<{ tier: string; count: number; costUsd: number }>
  cacheHitRate: number
}> {
  const ZEROS = {
    totalRequests: 0, totalSuccesses: 0, totalErrors: 0,
    avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0,
    totalInputTokens: 0, totalOutputTokens: 0, totalEstimatedCostUsd: 0,
    fallbackRate: 0, providerBreakdown: [] as Array<{ provider: string; count: number; p50: number }>,
    taskBreakdown: [] as Array<{ taskClass: string; count: number; p50: number }>,
    featureBreakdown: [] as Array<{ feature: string; count: number; costUsd: number }>,
    tierBreakdown: [] as Array<{ tier: string; count: number; costUsd: number }>,
    cacheHitRate: 0,
  }

  let data: any[] | null = null
  try {
    const supabase = await getSupabase()
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const { data: qdata, error } = await supabase
      .from('ai_traces')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
    if (error) return ZEROS
    data = qdata
  } catch {
    return ZEROS
  }

  if (!data || data.length === 0) {
    return ZEROS
  }

  const traces = data as PersistedTrace[]
  const successes = traces.filter((t) => !t.error)
  const errors = traces.filter((t) => t.error)
  const fallbacks = traces.filter((t) => t.fallback)
  const latencies = successes.map((t) => t.latency_ms).sort((a, b) => a - b)

  // Provider breakdown
  const byProvider = new Map<string, PersistedTrace[]>()
  for (const t of traces) {
    const existing = byProvider.get(t.provider) || []
    existing.push(t)
    byProvider.set(t.provider, existing)
  }
  const providerBreakdown = [...byProvider.entries()].map(([provider, items]) => {
    const lats = items.filter((i) => !i.error).map((i) => i.latency_ms).sort((a, b) => a - b)
    return {
      provider,
      count: items.length,
      p50: lats.length > 0 ? lats[Math.floor(lats.length / 2)] : 0,
    }
  })

  // Task breakdown
  const byTask = new Map<string, PersistedTrace[]>()
  for (const t of traces) {
    const existing = byTask.get(t.task_class) || []
    existing.push(t)
    byTask.set(t.task_class, existing)
  }
  const taskBreakdown = [...byTask.entries()].map(([taskClass, items]) => {
    const lats = items.filter((i) => !i.error).map((i) => i.latency_ms).sort((a, b) => a - b)
    return {
      taskClass,
      count: items.length,
      p50: lats.length > 0 ? lats[Math.floor(lats.length / 2)] : 0,
    }
  })

  // Feature breakdown (cost by feature)
  const byFeature = new Map<string, PersistedTrace[]>()
  for (const t of traces) {
    const key = t.feature || 'unknown'
    const existing = byFeature.get(key) || []
    existing.push(t)
    byFeature.set(key, existing)
  }
  const featureBreakdown = [...byFeature.entries()].map(([feature, items]) => ({
    feature,
    count: items.length,
    costUsd: Math.round(items.reduce((s, i) => s + Number(i.estimated_cost_usd), 0) * 10000) / 10000,
  }))

  // Tier breakdown (cost by intelligence tier)
  const byTier = new Map<string, PersistedTrace[]>()
  for (const t of traces) {
    const key = t.model_tier || 'unversioned'
    const existing = byTier.get(key) || []
    existing.push(t)
    byTier.set(key, existing)
  }
  const tierBreakdown = [...byTier.entries()].map(([tier, items]) => ({
    tier,
    count: items.length,
    costUsd: Math.round(items.reduce((s, i) => s + Number(i.estimated_cost_usd), 0) * 10000) / 10000,
  }))

  // Cache hit rate
  const cacheHits = traces.filter((t) => t.cache_hit).length
  const cacheHitRate = traces.length > 0 ? Math.round((cacheHits / traces.length) * 100) : 0

  return {
    totalRequests: traces.length,
    totalSuccesses: successes.length,
    totalErrors: errors.length,
    avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length) : 0,
    p50LatencyMs: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0,
    p95LatencyMs: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1] : 0,
    totalInputTokens: traces.reduce((s, t) => s + t.input_tokens, 0),
    totalOutputTokens: traces.reduce((s, t) => s + t.output_tokens, 0),
    totalEstimatedCostUsd: traces.reduce((s, t) => s + t.estimated_cost_usd, 0),
    fallbackRate: traces.length > 0 ? Math.round((fallbacks.length / traces.length) * 100) : 0,
    providerBreakdown,
    taskBreakdown,
    featureBreakdown,
    tierBreakdown,
    cacheHitRate,
  }
}

/**
 * Get recent traces for an organization (for detailed inspection).
 */
export async function getRecentTraces(
  organizationId: string,
  limit: number = 100,
): Promise<PersistedTrace[]> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('ai_traces')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    return []
  }

  return data as PersistedTrace[]
}
