import { describe, expect, it } from 'vitest'
import { summarizeAiUsage, taskLabel, type AiTraceRow } from '@/lib/admin/ai-usage'

function row(overrides: Partial<AiTraceRow> = {}): AiTraceRow {
  return {
    task_class: 'FAST_STRUCTURED',
    provider: 'openai',
    model: 'gpt-x',
    latency_ms: 1000,
    estimated_cost_usd: 0.01,
    input_tokens: 100,
    output_tokens: 50,
    fallback: false,
    error: null,
    schema_valid: true,
    created_at: '2026-10-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('summarizeAiUsage', () => {
  const now = new Date('2026-10-20T12:00:00.000Z')

  it('returns zeros and an empty daily series for no rows', () => {
    const s = summarizeAiUsage([], 7, now)
    expect(s.totals.calls).toBe(0)
    expect(s.totals.cost).toBe(0)
    expect(s.totals.errorRate).toBe(0)
    expect(s.daily).toHaveLength(7)
    expect(s.daily.every((d) => d.calls === 0)).toBe(true)
    expect(s.daily[6].date).toBe('2026-10-20')
  })

  it('totals spend, failures and tokens; numeric strings from Postgres count as cost', () => {
    const s = summarizeAiUsage([
      row(),
      row({ estimated_cost_usd: '0.02', error: 'timeout', latency_ms: 3000 }),
      row({ fallback: true, schema_valid: false, created_at: '2026-10-19T09:00:00.000Z' }),
    ], 7, now)
    expect(s.totals.calls).toBe(3)
    expect(s.totals.cost).toBeCloseTo(0.04)
    expect(s.totals.errors).toBe(1)
    expect(s.totals.fallbacks).toBe(1)
    expect(s.totals.invalidOutputs).toBe(1)
    expect(s.totals.inputTokens).toBe(300)
    expect(s.totals.errorRate).toBeCloseTo(1 / 3)
    expect(s.daily.find((d) => d.date === '2026-10-20')).toMatchObject({ calls: 2, errors: 1 })
    expect(s.daily.find((d) => d.date === '2026-10-19')).toMatchObject({ calls: 1 })
    expect(s.recentErrors).toHaveLength(1)
    expect(s.recentErrors[0].message).toBe('timeout')
  })

  it('groups by task and model, most expensive first', () => {
    const s = summarizeAiUsage([
      row({ task_class: 'DEEP_WRITING', estimated_cost_usd: 0.5, model: 'big' }),
      row({ task_class: 'FAST_STRUCTURED', estimated_cost_usd: 0.01 }),
      row({ task_class: 'FAST_STRUCTURED', estimated_cost_usd: 0.01 }),
    ], 7, now)
    expect(s.byTask[0].key).toBe('DEEP_WRITING')
    expect(s.byTask[1]).toMatchObject({ key: 'FAST_STRUCTURED', calls: 2 })
    expect(s.byModel[0].label).toBe('openai · big')
  })

  it('ignores rows outside the window in the daily series but keeps them in totals', () => {
    const s = summarizeAiUsage([row({ created_at: '2026-09-01T00:00:00.000Z' })], 7, now)
    expect(s.totals.calls).toBe(1)
    expect(s.daily.reduce((n, d) => n + d.calls, 0)).toBe(0)
  })
})

describe('taskLabel', () => {
  it('maps known task classes and humanizes unknown ones', () => {
    expect(taskLabel('DEEP_WRITING')).toBe('Long-form writing')
    expect(taskLabel('SOME_NEW_TASK')).toBe('Some new task')
    expect(taskLabel('')).toBe('Other')
  })
})
