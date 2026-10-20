/**
 * AI usage rollup over persisted ai_traces rows. Pure — the page loads rows,
 * this turns them into what an admin needs: spend, failures, speed, and where.
 */

export interface AiTraceRow {
  task_class: string | null
  provider: string | null
  model: string | null
  latency_ms: number | null
  estimated_cost_usd: number | string | null
  input_tokens: number | null
  output_tokens: number | null
  fallback: boolean | null
  error: string | null
  schema_valid: boolean | null
  feature?: string | null
  call_site?: string | null
  created_at: string
}

export interface AiUsageBucket {
  key: string
  label: string
  calls: number
  cost: number
  errors: number
  fallbacks: number
  p50LatencyMs: number
}

export interface AiUsageSummary {
  days: number
  totals: {
    calls: number
    cost: number
    errors: number
    fallbacks: number
    invalidOutputs: number
    inputTokens: number
    outputTokens: number
    p50LatencyMs: number
    p95LatencyMs: number
    errorRate: number
    costPerCall: number
  }
  daily: Array<{ date: string; calls: number; cost: number; errors: number }>
  byTask: AiUsageBucket[]
  byFeature: AiUsageBucket[]
  byModel: AiUsageBucket[]
  recentErrors: Array<{ at: string; task: string; model: string; message: string }>
}

const TASK_LABELS: Record<string, string> = {
  FAST_STRUCTURED: 'Fast extraction & scoring',
  INTERACTIVE_WRITING: 'Drafts while you wait',
  DEEP_WRITING: 'Long-form writing',
  BACKGROUND_INTELLIGENCE: 'Background research',
}

const FEATURE_LABELS: Record<string, string> = {
  prospect_extraction: 'Prospect extraction',
  v3_decision: 'V3 decision',
  connection_note: 'Connection note',
  dm: 'DM',
  follow_up: 'Follow-up',
  reply: 'Reply',
  upwork_extraction: 'Upwork extraction',
  upwork_proposal: 'Upwork proposal',
  'upwork_proposal+screening_answers': 'Upwork proposal + screening answers',
  screening_answers: 'Screening answers',
}

function featureKey(row: AiTraceRow): string {
  if ((row.call_site ?? '').includes('screening_answers')) return 'upwork_proposal+screening_answers'
  return row.feature || row.call_site || 'unscoped'
}

export function taskLabel(task: string): string {
  if (TASK_LABELS[task]) return TASK_LABELS[task]
  const words = task.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Other'
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function toCost(v: number | string | null): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v ?? 0
  return Number.isFinite(n) ? n : 0
}

function bucketize(rows: AiTraceRow[], keyOf: (r: AiTraceRow) => string, labelOf: (key: string) => string): AiUsageBucket[] {
  const groups = new Map<string, AiTraceRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const list = groups.get(k)
    if (list) list.push(r)
    else groups.set(k, [r])
  }
  return [...groups.entries()].map(([key, list]) => {
    const lat = list.map((r) => r.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b)
    return {
      key,
      label: labelOf(key),
      calls: list.length,
      cost: list.reduce((s, r) => s + toCost(r.estimated_cost_usd), 0),
      errors: list.filter((r) => Boolean(r.error)).length,
      fallbacks: list.filter((r) => Boolean(r.fallback)).length,
      p50LatencyMs: percentile(lat, 0.5),
    }
  }).sort((a, b) => b.cost - a.cost || b.calls - a.calls)
}

export function summarizeAiUsage(rows: AiTraceRow[], days: number, now: Date = new Date()): AiUsageSummary {
  const latencies = rows.map((r) => r.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b)
  const calls = rows.length
  const cost = rows.reduce((s, r) => s + toCost(r.estimated_cost_usd), 0)
  const errors = rows.filter((r) => Boolean(r.error)).length

  const dailyMap = new Map<string, { calls: number; cost: number; errors: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    dailyMap.set(d.toISOString().slice(0, 10), { calls: 0, cost: 0, errors: 0 })
  }
  for (const r of rows) {
    const day = dailyMap.get(r.created_at.slice(0, 10))
    if (!day) continue
    day.calls++
    day.cost += toCost(r.estimated_cost_usd)
    if (r.error) day.errors++
  }

  const recentErrors = rows
    .filter((r) => Boolean(r.error))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8)
    .map((r) => ({
      at: r.created_at,
      task: taskLabel(r.task_class ?? ''),
      model: r.model ?? 'unknown',
      message: (r.error ?? '').replace(/\s+/g, ' ').slice(0, 160),
    }))

  return {
    days,
    totals: {
      calls,
      cost,
      errors,
      fallbacks: rows.filter((r) => Boolean(r.fallback)).length,
      invalidOutputs: rows.filter((r) => r.schema_valid === false).length,
      inputTokens: rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0),
      outputTokens: rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0),
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      errorRate: calls > 0 ? errors / calls : 0,
      costPerCall: calls > 0 ? cost / calls : 0,
    },
    daily: [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })),
    byTask: bucketize(rows, (r) => r.task_class || 'other', taskLabel),
    byFeature: bucketize(rows, featureKey, (key) => FEATURE_LABELS[key] ?? taskLabel(key)),
    byModel: bucketize(rows, (r) => `${r.provider ?? 'unknown'} · ${r.model ?? 'unknown'}`, (k) => k),
    recentErrors,
  }
}
