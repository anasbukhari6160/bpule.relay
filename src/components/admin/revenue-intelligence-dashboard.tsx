'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'

interface FunnelData { extracted: number; qualified: number; contacted: number; replied: number; qualifiedConversations: number; calls: number; proposals: number; won: number; lost: number }
interface AIStats { totalCalls: number; totalCost: number; avgExtractionTime: number; p50Latency: number; p95Latency: number; providers: Array<{ provider: string; total: number; fallback: number; errors: number; avgLatency: number; totalCost: number }> }
interface RepPerformance { repId: string; extracted: number; qualified: number; contacted: number; replies: number; qualifiedConversations: number; calls: number; proposals: number; wins: number; losses: number; targetProgress: number }
interface ActivityItem { id: string; timestamp: string; eventType: string; actorId: string | null; entityId: string | null; prospectName: string | null; company: string | null; revenueIdentityName: string | null; payload: Record<string, unknown> | null }
interface DashboardData {
  range: { start: string; end: string }
  funnel: FunnelData
  conversationStages: Record<string, number>
  extraction: { total: number; successful: number; failed: number; aiExtractions: number; fallbackExtractions: number; avgExtractionTime: number; failedExtractions: number }
  ai: AIStats
  messages: { total: number; generatedOnly: number; reviewed: number; unchanged: number; lightEdit: number; heavyEdit: number; rejected: number; dispositions: Record<string, number> }
  relayVsHuman: { relayActions: Record<string, number>; humanActions: Record<string, number> }
  reps: RepPerformance[]
  identities: Array<{ id: string; name: string; slug: string; title: string; channel: string; status: string }>
  sourcePerformance: Array<{ source: string; extracted: number; qualified: number; contacted: number; replies: number }>
  fitDistribution: Record<string, number>
  confidenceDistribution: { high: number; medium: number; low: number }
  qualificationDistribution: Record<string, number>
  activityFeed: ActivityItem[]
  targets: { total: number; totalTarget: number; totalCompleted: number }
  insights: Array<{ id: string; type: string; severity: string; title: string; explanation: string; sampleSize?: number; confidence: string; suggestedInvestigation?: string }>
  dataHealth: Record<string, { health: string; reason?: string }>
  costCoverage: number
  latencyHealth: { health: string; reason?: string }
  fallbackBreakdown: { demoMode: number; productionFailures: number; byReason: Record<string, number> }
}

const RANGE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
]

function fmt(n: number) { return n.toLocaleString() }

export function RevenueIntelligenceDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState('30d')
  const [activeTab, setActiveTab] = useState<'overview' | 'funnel' | 'team' | 'quality' | 'activity'>('overview')

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/admin/revenue-intelligence?range=${range}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [range])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="text-[13px] text-graphite py-12 text-center">Loading intelligence…</div>
  if (error) return <div className="text-[13px] text-status-danger py-12 text-center">{error}</div>
  if (!data) return <div className="text-[13px] text-graphite py-12 text-center">No data for this period.</div>

  const maxFunnel = Math.max(data.funnel.extracted, data.funnel.qualified, data.funnel.contacted, data.funnel.replied, 1)
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'funnel', label: 'Funnel' },
    { key: 'team', label: 'Team' },
    { key: 'quality', label: 'Quality' },
    { key: 'activity', label: 'Activity' },
  ] as const

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2">
        <span className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone mr-2">Period</span>
        {RANGE_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setRange(opt.value)}
            className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${range === opt.value ? 'bg-ink text-bone' : 'border border-line text-graphite hover:text-ink'}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-line">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`pb-2.5 text-[13px] font-medium transition-colors ${activeTab === tab.key ? 'text-ink border-b-2 border-orange' : 'text-stone hover:text-ink'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Insights */}
          {data.insights && data.insights.length > 0 && (
            <section className="rounded-lg border border-orange/20 bg-orange/5 p-5 space-y-3">
              <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Intelligence</p>
              {data.insights.map((insight) => (
                <div key={insight.id} className="flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${insight.severity === 'ACTION' ? 'bg-status-danger/10 text-status-danger' : insight.severity === 'WATCH' ? 'bg-status-warning/10 text-status-warning' : 'bg-cobalt/10 text-cobalt'}`}>
                    {insight.severity}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-ink">{insight.title}</p>
                    <p className="text-[12px] text-graphite">{insight.explanation}</p>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* KPI Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Extracted" value={fmt(data.funnel.extracted)} subtext="prospects" accent="neutral" />
            <KPICard label="Qualified" value={fmt(data.funnel.qualified)} subtext={`${data.funnel.extracted > 0 ? Math.round((data.funnel.qualified / data.funnel.extracted) * 100) : 0}% conversion`} accent="cobalt" />
            <KPICard label="Contacted" value={fmt(data.funnel.contacted)} subtext="reached out" accent="cobalt" />
            <KPICard label="Replies" value={fmt(data.funnel.replied)} subtext={`${data.funnel.contacted > 0 ? Math.round((data.funnel.replied / data.funnel.contacted) * 100) : 0}% reply rate`} accent="success" />
            <KPICard label="Qual Convos" value={fmt(data.funnel.qualifiedConversations)} subtext="meaningful" accent="success" />
            <KPICard label="Proposals" value={fmt(data.funnel.proposals)} subtext="sent" accent="orange" />
            <KPICard label="Wins" value={fmt(data.funnel.won)} subtext="closed" accent="success" />
            <KPICard label="AI Cost" value={`$${data.ai.totalCost.toFixed(2)}`} subtext={`P50: ${data.ai.p50Latency}ms`} accent="neutral" />
          </div>

          {/* Funnel visualization */}
          <div className="rounded-lg border border-line p-5 space-y-3">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Funnel</p>
            <FunnelBar label="Extracted" value={data.funnel.extracted} max={maxFunnel} color="bg-ink" />
            <FunnelBar label="Qualified" value={data.funnel.qualified} max={maxFunnel} color="bg-cobalt" />
            <FunnelBar label="Contacted" value={data.funnel.contacted} max={maxFunnel} color="bg-cobalt-light" />
            <FunnelBar label="Replied" value={data.funnel.replied} max={maxFunnel} color="bg-orange" />
            <FunnelBar label="Qual Convos" value={data.funnel.qualifiedConversations} max={maxFunnel} color="bg-orange-light" />
            <FunnelBar label="Wins" value={data.funnel.won} max={maxFunnel} color="bg-status-success" />
            <FunnelBar label="Lost" value={data.funnel.lost} max={maxFunnel} color="bg-status-danger" />
          </div>
        </div>
      )}

      {/* Funnel tab */}
      {activeTab === 'funnel' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-line p-5 space-y-3">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Pipeline</p>
            {['Extracted', 'Qualified', 'Contacted', 'Replied', 'Qual Convos', 'Calls', 'Proposals', 'Wins', 'Lost'].map((label) => {
              const key = label.toLowerCase().replace(' ', '') as keyof FunnelData
              const val = data.funnel[key] ?? 0
              return <FunnelBar key={label} label={label} value={val} max={maxFunnel} color={val > 0 ? 'bg-cobalt' : 'bg-line'} />
            })}
          </div>
          <div className="rounded-lg border border-line p-5 space-y-3">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Conversation Stages</p>
            {Object.keys(data.conversationStages).length === 0 ? (
              <p className="text-[13px] text-graphite">No conversation stages recorded.</p>
            ) : (
              Object.entries(data.conversationStages).map(([stage, count]) => (
                <FunnelBar key={stage} label={stage} value={count} max={Math.max(...Object.values(data.conversationStages), 1)} color="bg-cobalt" />
              ))
            )}
          </div>
        </div>
      )}

      {/* Team tab */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-ststone">Team Performance</p>
          {data.reps.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line py-12 text-center">
              <p className="text-[13px] text-graphite">No rep activity in this period.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-line overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line bg-bone-raised">
                    {['Rep', 'Extracted', 'Qualified', 'Contacted', 'Replies', 'Convos', 'Proposals', 'Wins', 'Target %'].map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-stone text-mono-medium text-[9px] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.reps.map((rep) => (
                    <tr key={rep.repId} className="border-b border-line/50 hover:bg-bone/50">
                      <td className="px-3 py-2 font-medium text-ink">{rep.repId.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-graphite">{rep.extracted}</td>
                      <td className="px-3 py-2 text-graphite">{rep.qualified}</td>
                      <td className="px-3 py-2 text-graphite">{rep.contacted}</td>
                      <td className="px-3 py-2 text-graphite">{rep.replies}</td>
                      <td className="px-3 py-2 text-graphite">{rep.qualifiedConversations}</td>
                      <td className="px-3 py-2 text-graphite">{rep.proposals}</td>
                      <td className="px-3 py-2 text-status-success font-medium">{rep.wins}</td>
                      <td className="px-3 py-2 text-graphite">{rep.targetProgress}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <KPICard label="Active Targets" value={fmt(data.targets.total)} accent="neutral" />
            <KPICard label="Total Target" value={fmt(data.targets.totalTarget)} accent="cobalt" />
            <KPICard label="Completed" value={fmt(data.targets.totalCompleted)} subtext={data.targets.totalTarget > 0 ? `${Math.round((data.targets.totalCompleted / data.targets.totalTarget) * 100)}%` : undefined} accent="success" />
          </div>
        </div>
      )}

      {/* Quality tab */}
      {activeTab === 'quality' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-line p-5 space-y-3">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-ststone">Fit Distribution</p>
            {Object.entries(data.fitDistribution).map(([fit, count]) => (
              <FunnelBar key={fit} label={fit} value={count} max={Math.max(...Object.values(data.fitDistribution), 1)} color="bg-cobalt" />
            ))}
          </div>
          <div className="rounded-lg border border-line p-5 space-y-3">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-ststone">AI Provider Health</p>
            {data.ai.providers.length === 0 ? (
              <p className="text-[13px] text-graphite">No AI traces in this period.</p>
            ) : (
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-line">{['Provider', 'Calls', 'Fallback', 'Errors', 'Cost'].map(h => (<th key={h} className="text-left px-2 py-1.5 text-stone text-mono-medium text-[9px] uppercase tracking-wider">{h}</th>))}</tr></thead>
                <tbody>
                  {data.ai.providers.map((p) => (
                    <tr key={p.provider} className="border-b border-line/50">
                      <td className="px-2 py-1.5 font-medium text-ink">{p.provider}</td>
                      <td className="px-2 py-1.5 text-graphite">{p.total}</td>
                      <td className="px-2 py-1.5 text-graphite">{p.fallback}</td>
                      <td className="px-2 py-1.5 text-graphite">{p.errors}</td>
                      <td className="px-2 py-1.5 text-graphite">${p.totalCost.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <KPICard label="P50 Latency" value={`${data.ai.p50Latency}ms`} accent="neutral" />
              <KPICard label="P95 Latency" value={`${data.ai.p95Latency}ms`} accent="neutral" />
            </div>
          </div>
        </div>
      )}

      {/* Activity tab */}
      {activeTab === 'activity' && (
        <div className="rounded-lg border border-line overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-ststone">Activity Feed</p>
          </div>
          {data.activityFeed.length === 0 ? (
            <p className="text-[13px] text-graphite py-12 text-center">No activity in this period.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {data.activityFeed.slice(0, 50).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
                  <span className="text-stone font-mono w-20 shrink-0">{new Date(item.timestamp).toLocaleDateString()}</span>
                  <span className="font-medium text-ink w-32 shrink-0 truncate">{item.eventType}</span>
                  <span className="text-graphite truncate">{item.prospectName ?? item.company ?? item.entityId?.slice(0, 8) ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function KPICard({ label, value, subtext, accent = 'neutral' }: { label: string; value: string; subtext?: string; accent?: 'orange' | 'cobalt' | 'success' | 'danger' | 'neutral' }) {
  const colors = {
    orange: 'border-orange/20 bg-orange/5',
    cobalt: 'border-cobalt/20 bg-cobalt/5',
    success: 'border-status-success/20 bg-status-success/5',
    danger: 'border-status-danger/20 bg-status-danger/5',
    neutral: 'border-line',
  }
  return (
    <div className={cn('rounded border px-4 py-3', colors[accent])}>
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">{label}</p>
      <p className="mt-1 text-[20px] font-medium text-ink">{value}</p>
      {subtext && <p className="mt-0.5 text-[11px] text-graphite">{subtext}</p>}
    </div>
  )
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="w-28 text-stone truncate">{label}</span>
      <div className="flex-1 h-3 bg-line/40 rounded overflow-hidden">
        <div className={`h-full rounded transition-all duration-500 ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-ink">{value}</span>
    </div>
  )
}

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
