/**
 * Admin AI Usage Dashboard
 *
 * Shows provider health, latency, costs, and fallback rates.
 * Operational view of the AI runtime.
 */

import { requireProductAdmin } from '@/lib/auth/admin-page'
import { getAllHealth, getCooldownRemaining } from '@/lib/ai/runtime'

interface AiUsageData {
  summary: {
    totalRequests: number
    totalSuccesses: number
    totalErrors: number
    totalTimeouts: number
    totalRateLimits: number
    successRate: number
  }
  providers: Array<{
    provider: string
    model: string
    credentialId: string
    status: string
    requests: number
    successes: number
    errors: number
    timeouts: number
    rateLimits: number
    malformedResponses: number
    p50LatencyMs: number
    p95LatencyMs: number
    lastFailureAt: number | null
    consecutiveFailures: number
    cooldownRemainingMs: number
  }>
}

async function loadAiUsage(): Promise<AiUsageData> {
  const health = getAllHealth()
  const providers = health.map((row) => ({
    ...row,
    cooldownRemainingMs: getCooldownRemaining(row.provider, row.model, row.credentialId),
  }))
  const totalRequests = providers.reduce((sum, row) => sum + row.requests, 0)
  const totalSuccesses = providers.reduce((sum, row) => sum + row.successes, 0)
  const totalErrors = providers.reduce((sum, row) => sum + row.errors, 0)
  const totalTimeouts = providers.reduce((sum, row) => sum + row.timeouts, 0)
  const totalRateLimits = providers.reduce((sum, row) => sum + row.rateLimits, 0)
  return {
    summary: {
      totalRequests,
      totalSuccesses,
      totalErrors,
      totalTimeouts,
      totalRateLimits,
      successRate: totalRequests > 0 ? Math.round((totalSuccesses / totalRequests) * 100) : 100,
    },
    providers,
  }
}

export default async function AdminAiUsagePage() {
  await requireProductAdmin()
  const data = await loadAiUsage()

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">AI Runtime</h1>

      {!data ? (
        <p className="text-graphite">No AI usage data yet. Run some AI operations to populate this dashboard.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Requests" value={data.summary.totalRequests} />
            <StatCard label="Success Rate" value={`${data.summary.successRate}%`} color={data.summary.successRate >= 90 ? 'success' : data.summary.successRate >= 70 ? 'warning' : 'danger'} />
            <StatCard label="Errors" value={data.summary.totalErrors} color={data.summary.totalErrors > 0 ? 'danger' : 'success'} />
            <StatCard label="Timeouts" value={data.summary.totalTimeouts} color={data.summary.totalTimeouts > 0 ? 'warning' : 'success'} />
            <StatCard label="Rate Limits" value={data.summary.totalRateLimits} color={data.summary.totalRateLimits > 5 ? 'warning' : 'success'} />
          </div>

          {/* Provider Table */}
          <div className="srf-console overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-console-line bg-console-raised">
                  <th className="text-left p-3 text-console-mute">Provider</th>
                  <th className="text-left p-3 text-console-mute">Model</th>
                  <th className="text-left p-3 text-console-mute">Status</th>
                  <th className="text-right p-3 text-console-mute">Requests</th>
                  <th className="text-right p-3 text-console-mute">Success</th>
                  <th className="text-right p-3 text-console-mute">p50</th>
                  <th className="text-right p-3 text-console-mute">p95</th>
                  <th className="text-right p-3 text-console-mute">Rate Limits</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.length === 0 ? (
                  <tr><td colSpan={8} className="p-4 text-center text-console-mute">No provider activity</td></tr>
                ) : (
                  data.providers.map((p) => (
                    <tr key={`${p.provider}-${p.model}-${p.credentialId}`} className="border-b border-console-line/50">
                      <td className="p-3 font-mono text-console-text">{p.provider}</td>
                      <td className="p-3 font-mono text-xs text-console-mute">{p.model}</td>
                      <td className="p-3">
                        <StatusBadge status={p.status} cooldownMs={p.cooldownRemainingMs} />
                      </td>
                      <td className="p-3 text-right text-console-text">{p.requests}</td>
                      <td className="p-3 text-right text-console-text">{p.successes}</td>
                      <td className="p-3 text-right text-console-text">{p.p50LatencyMs}ms</td>
                      <td className="p-3 text-right text-console-text">{p.p95LatencyMs}ms</td>
                      <td className="p-3 text-right text-console-text">{p.rateLimits}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color = 'neutral' }: { label: string; value: string | number; color?: string }) {
  const colors: Record<string, string> = {
    neutral: 'srf-proof',
    success: 'srf-proof-cobalt',
    warning: 'border-status-warning/20 bg-status-warning/[0.06]',
    danger: 'border-status-danger/20 bg-status-danger/[0.06]',
  }
  return (
    <div className={`p-4 ${colors[color] || colors.neutral}`}>
      <div className="text-[22px] font-light text-ink">{value}</div>
      <div className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">{label}</div>
    </div>
  )
}

function StatusBadge({ status, cooldownMs }: { status: string; cooldownMs: number }) {
  const colors: Record<string, string> = {
    HEALTHY: 'bg-status-success/10 text-status-success',
    DEGRADED: 'bg-status-warning/10 text-status-warning',
    RATE_LIMITED: 'bg-orange/10 text-orange',
    UNHEALTHY: 'bg-status-danger/10 text-status-danger',
  }
  const label = cooldownMs > 0 ? `${status} (${Math.ceil(cooldownMs / 1000)}s)` : status
  return (
    <span className={`srf-chip ${colors[status] || 'bg-bone-raised text-stone'}`}>
      {label}
    </span>
  )
}
