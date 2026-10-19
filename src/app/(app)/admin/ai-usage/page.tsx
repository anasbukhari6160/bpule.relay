/**
 * Admin AI usage — spend, failures and speed from persisted ai_traces,
 * so it survives deploys and serverless cold starts.
 */

import { AlertTriangle, CircleDollarSign, Gauge, Cpu, ShieldAlert } from 'lucide-react'
import { requireProductAdmin } from '@/lib/auth/admin-page'
import { createServerSupabase } from '@/lib/supabase/server'
import { getAllHealth, getCooldownRemaining } from '@/lib/ai/runtime'
import { summarizeAiUsage, type AiTraceRow, type AiUsageBucket } from '@/lib/admin/ai-usage'
import { AiUsageChart } from '@/components/admin/ai-usage-chart'
import { DashHeader, EmptyNote, Panel, Pill, Segmented, StatTile } from '@/components/dashboard/kit'

export const dynamic = 'force-dynamic'

const RANGES = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
]

function money(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString()}`
}

function ms(n: number): string {
  if (!n) return '—'
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export default async function AdminAiUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { user, authCtx } = await requireProductAdmin()
  const requested = (await searchParams).range
  const days = requested === '7' ? 7 : requested === '90' ? 90 : 30
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const orgId = authCtx?.orgId ?? user.organization.id

  let rows: AiTraceRow[] = []
  let loadError = false
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('ai_traces')
      .select('task_class, provider, model, latency_ms, estimated_cost_usd, input_tokens, output_tokens, fallback, error, schema_valid, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20000)
    if (error) throw error
    rows = (data ?? []) as AiTraceRow[]
  } catch (err) {
    console.error('ai-usage load failed:', err instanceof Error ? err.message : 'unknown error')
    loadError = true
  }

  const s = summarizeAiUsage(rows, days)
  const live = getAllHealth().map((row) => ({ ...row, cooldownMs: getCooldownRemaining(row.provider, row.model, row.credentialId) }))
  const degraded = live.filter((p) => p.status !== 'HEALTHY' || p.cooldownMs > 0)

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow="Admin · AI usage"
        title={loadError ? 'AI usage' : `${money(s.totals.cost)} on AI`}
        subtitle={loadError ? 'What AI costs, what fails, and how fast it answers.' : `${s.totals.calls.toLocaleString()} model calls in the last ${days} days · what it costs, what fails, and how fast it answers.`}
        actions={<Segmented label="Time range" options={RANGES} value={String(days)} hrefFor={(v) => `/admin/ai-usage?range=${v}`} />}
      />

      {loadError && (
        <p role="alert" className="rounded-lg border border-status-warning/30 bg-status-warning/5 px-4 py-3 text-[12px] text-graphite">AI usage could not load. Refresh to try again.</p>
      )}

      {degraded.length > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-status-warning/30 bg-status-warning/5 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden="true" />
          <div className="text-[12px] text-graphite">
            <p className="font-medium text-ink">A provider is degraded right now</p>
            <p>{degraded.map((p) => `${p.provider} ${p.model}: ${p.status.toLowerCase().replace(/_/g, ' ')}${p.cooldownMs > 0 ? ` (retry in ${Math.ceil(p.cooldownMs / 1000)}s)` : ''}`).join(' · ')}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Spend" value={money(s.totals.cost)} tone="cobalt" icon={<CircleDollarSign className="size-3.5" />} sub={`${money(s.totals.costPerCall)} per call`} />
        <StatTile label="Calls" value={compact(s.totals.calls)} icon={<Cpu className="size-3.5" />} sub={`${compact(s.totals.inputTokens + s.totals.outputTokens)} tokens`} />
        <StatTile
          label="Failed"
          value={`${Math.round(s.totals.errorRate * 1000) / 10}%`}
          tone={s.totals.errorRate > 0.05 ? 'danger' : s.totals.errorRate > 0.01 ? 'warning' : 'success'}
          icon={<AlertTriangle className="size-3.5" />}
          sub={`${s.totals.errors} errors · ${s.totals.fallbacks} fallbacks`}
        />
        <StatTile label="Response time" value={ms(s.totals.p50LatencyMs)} icon={<Gauge className="size-3.5" />} sub={`p95 ${ms(s.totals.p95LatencyMs)}`} />
      </div>

      <Panel title="Daily spend" subtitle={`Last ${days} days · hover a bar for calls and failures`}>
        {s.totals.calls === 0 ? <EmptyNote>No AI calls recorded in this period.</EmptyNote> : <AiUsageChart data={s.daily} />}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BucketTable title="By kind of work" subtitle="Where the money goes" rows={s.byTask} />
        <BucketTable title="By model" subtitle="Provider and model" rows={s.byModel} mono />
      </div>

      <Panel title="Recent failures" subtitle="Latest errors, newest first" action={s.recentErrors.length > 0 ? <Pill tone="danger">{s.totals.errors}</Pill> : undefined} flush>
        {s.recentErrors.length === 0 ? (
          <EmptyNote>No failed calls in this period.</EmptyNote>
        ) : (
          <ul className="divide-y divide-line/70">
            {s.recentErrors.map((e, i) => (
              <li key={i} className="px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
                  <span className="font-medium text-ink">{e.task}</span>
                  <span className="text-stone">{e.model}</span>
                  <span className="ml-auto text-[11px] text-stone">{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-graphite">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function BucketTable({ title, subtitle, rows, mono }: { title: string; subtitle: string; rows: AiUsageBucket[]; mono?: boolean }) {
  const maxCost = Math.max(...rows.map((r) => r.cost), 0)
  return (
    <Panel title={title} subtitle={subtitle} flush>
      {rows.length === 0 ? (
        <EmptyNote>Nothing yet.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-right text-[10px] uppercase tracking-[0.1em] text-stone">
                <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">Name</th>
                <th scope="col" className="px-2 py-2 font-medium">Calls</th>
                <th scope="col" className="px-2 py-2 font-medium">Failed</th>
                <th scope="col" className="px-2 py-2 font-medium">p50</th>
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 text-right tabular-nums text-graphite">
              {rows.slice(0, 10).map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">
                    <span className={mono ? 'font-mono text-[11px] text-ink' : 'text-[13px] text-ink'}>{r.label}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
                      <span className="block h-full rounded-full bg-cobalt" style={{ width: `${maxCost > 0 ? (r.cost / maxCost) * 100 : 0}%` }} />
                    </span>
                  </th>
                  <td className="px-2 py-2">{r.calls.toLocaleString()}</td>
                  <td className={r.errors > 0 ? 'px-2 py-2 text-status-danger' : 'px-2 py-2'}>{r.errors}</td>
                  <td className="px-2 py-2">{ms(r.p50LatencyMs)}</td>
                  <td className="px-4 py-2 font-medium text-ink sm:px-5">{money(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
