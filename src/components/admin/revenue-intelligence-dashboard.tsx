'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Send, Reply, MessagesSquare, FileText, Trophy, Search, Lightbulb } from 'lucide-react'
import { cn } from 'cn'
import { DashHeader, EmptyNote, Initials, Meter, Panel, Pill, StatTile, type Tone } from '@/components/dashboard/kit'

interface FunnelData { extracted: number; qualified: number; contacted: number; replied: number; qualifiedConversations: number; calls: number; proposals: number; won: number; lost: number }
interface RepPerformance { repId: string; repName: string; extracted: number; qualified: number; contacted: number; replies: number; qualifiedConversations: number; calls: number; proposals: number; wins: number; losses: number; targetProgress: number }
interface ActivityItem { id: string; timestamp: string; eventType: string; actorName: string | null; entityId: string | null; prospectName: string | null; company: string | null; revenueIdentityName: string | null }
interface DashboardData {
  range: { start: string; end: string }
  funnel: FunnelData
  conversationStages: Record<string, number>
  reps: RepPerformance[]
  identityPerformance?: Array<{ id: string; name: string; channel: string; leads: number; contacted: number; replies: number; wins: number }>
  daily?: Array<{ date: string; outreach: number; replies: number; wins: number }>
  sourcePerformance: Array<{ source: string; extracted: number; qualified: number; contacted: number; replies: number }>
  fitDistribution: Record<string, number>
  activityFeed: ActivityItem[]
  targets: { total: number; totalTarget: number; totalCompleted: number }
  insights: Array<{ id: string; type: string; severity: string; title: string; explanation: string }>
}

const RANGE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
]

const EVENT_LABEL: Record<string, string> = {
  PROSPECT_ANALYZED: 'Analyzed a prospect',
  PROSPECT_CAPTURED: 'Captured a prospect',
  LEAD_QUALIFIED: 'Qualified a lead',
  OUTREACH_RECORDED: 'Sent outreach',
  FOLLOWUP_RECORDED: 'Sent a follow-up',
  CLIENT_REPLIED: 'Client replied',
  INTENT_DETECTED: 'Buying intent detected',
  CONVERSATION_ADVANCED: 'Conversation advanced',
  OUTCOME_RECORDED: 'Outcome recorded',
}

const FIT_ORDER = ['Strong', 'Maybe', 'Weak', 'Not a fit']
const FIT_COLOR: Record<string, string> = { Strong: 'bg-status-success', Maybe: 'bg-cobalt', Weak: 'bg-orange-light', 'Not a fit': 'bg-stone-light' }

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null)
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

function humanize(s: string): string {
  const t = s.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Unknown'
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function shortDate(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function RevenueIntelligenceDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState('30d')

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/admin/revenue-intelligence?range=${range}`, { credentials: 'include' })
      if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to revenue data.' : 'Revenue data could not load. Refresh to try again.')
      setData(await res.json())
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [range])

  useEffect(() => { void fetchData() }, [fetchData])

  const rangeLabel = range === 'today' ? 'today' : `last ${range.replace('d', '')} days`

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow="Admin · Revenue"
        title="Pipeline and revenue"
        subtitle={`From first touch to closed deal, ${rangeLabel}. Leads count once per stage they reached.`}
        actions={
          <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-line bg-bone p-0.5">
            {RANGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRange(o.value)}
                aria-pressed={range === o.value}
                className={cn('rounded-md px-3 py-1 text-[12px] font-medium transition-colors', range === o.value ? 'bg-bone-raised text-ink shadow-sm' : 'text-stone hover:text-ink')}
              >
                {o.label}
              </button>
            ))}
          </div>
        }
      />

      {loading && !data ? (
        <RevenueSkeleton />
      ) : error ? (
        <EmptyNote className="rounded-xl border border-dashed border-line">{error}</EmptyNote>
      ) : data ? (
        <div className={cn('space-y-6 transition-opacity', loading && 'opacity-60')}>
          <Body data={data} rangeLabel={rangeLabel} />
        </div>
      ) : null}
    </div>
  )
}

function Body({ data, rangeLabel }: { data: DashboardData; rangeLabel: string }) {
  const f = data.funnel
  const replyRate = rate(f.replied, f.contacted)
  const winRate = rate(f.won, f.won + f.lost)

  return (
    <>
      {data.insights.length > 0 && (
        <Panel title="What stands out" flush>
          <ul className="divide-y divide-line/70">
            {data.insights.slice(0, 4).map((insight) => (
              <li key={insight.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <Lightbulb className={cn('mt-0.5 size-4 shrink-0', insight.severity === 'ACTION' ? 'text-status-danger' : insight.severity === 'WATCH' ? 'text-status-warning' : 'text-cobalt')} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{insight.title}</p>
                  <p className="text-[12px] text-graphite">{insight.explanation}</p>
                </div>
                <Pill tone={insight.severity === 'ACTION' ? 'danger' : insight.severity === 'WATCH' ? 'warning' : 'cobalt'} className="ml-auto shrink-0">{humanize(insight.severity)}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Analyzed" value={f.extracted} icon={<Search className="size-3.5" />} sub={`${f.qualified} qualified`} />
        <StatTile label="Contacted" value={f.contacted} icon={<Send className="size-3.5" />} tone="cobalt" />
        <StatTile label="Reply rate" value={pct(replyRate)} icon={<Reply className="size-3.5" />} tone="cobalt" sub={`${f.replied} replied`} />
        <StatTile label="Conversations" value={f.qualifiedConversations} icon={<MessagesSquare className="size-3.5" />} sub={`${f.calls} calls booked`} />
        <StatTile label="Proposals" value={f.proposals} icon={<FileText className="size-3.5" />} tone="orange" />
        <StatTile label="Won" value={f.won} icon={<Trophy className="size-3.5" />} tone={f.won > 0 ? 'success' : 'neutral'} sub={`${pct(winRate)} win rate · ${f.lost} lost`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-2" title="Funnel" subtitle="Step-to-step conversion on the right">
          <Funnel funnel={f} />
        </Panel>
        <Panel className="lg:col-span-3" title="Outreach and replies" subtitle={`Per day, ${rangeLabel}`}>
          <TrendChart daily={data.daily ?? []} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Team leaderboard" subtitle="Leads each person owns, by the furthest stage reached" flush>
          <Leaderboard reps={data.reps} />
        </Panel>
        <Panel className="lg:col-span-2" title="By sending identity" subtitle="Which identity gets answers" flush>
          <IdentityTable rows={data.identityPerformance ?? []} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Sources" subtitle="Reply rate by where leads came from" flush>
          <SourceTable rows={data.sourcePerformance} />
        </Panel>
        <Panel title="Lead quality" subtitle="Score bands of new leads">
          <FitBars fit={data.fitDistribution} />
        </Panel>
        <Panel title="Live conversations" subtitle="Where every open thread stands now">
          <StageBars stages={data.conversationStages} />
        </Panel>
      </div>

      <Panel title="Recent activity" subtitle="Latest pipeline events" flush>
        <ActivityFeed items={data.activityFeed} />
      </Panel>
    </>
  )
}

function Funnel({ funnel }: { funnel: FunnelData }) {
  const steps = [
    { label: 'Analyzed', value: funnel.extracted },
    { label: 'Qualified', value: funnel.qualified },
    { label: 'Contacted', value: funnel.contacted },
    { label: 'Replied', value: funnel.replied },
    { label: 'Conversation', value: funnel.qualifiedConversations },
    { label: 'Proposal', value: funnel.proposals },
    { label: 'Won', value: funnel.won },
  ]
  const top = Math.max(...steps.map((s) => s.value), 1)
  if (steps.every((s) => s.value === 0)) return <EmptyNote>No pipeline events in this period.</EmptyNote>
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null
        const conv = prev ? s.value / prev : null
        return (
          <li key={s.label} className="grid grid-cols-[92px_1fr_40px_44px] items-center gap-2 text-[12px]">
            <span className="truncate text-graphite">{s.label}</span>
            <div className="h-5 overflow-hidden rounded bg-line/40">
              <div className={cn('h-full rounded transition-[width] duration-700', i === steps.length - 1 ? 'bg-status-success' : 'bg-cobalt')} style={{ width: `${Math.max(s.value > 0 ? 3 : 0, (s.value / top) * 100)}%`, opacity: i === steps.length - 1 ? 1 : 1 - i * 0.1 }} />
            </div>
            <span className="text-right font-medium tabular-nums text-ink">{s.value}</span>
            <span className="text-right tabular-nums text-stone">{conv == null ? '' : pct(conv)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function TrendChart({ daily }: { daily: NonNullable<DashboardData['daily']> }) {
  const total = daily.reduce((n, d) => n + d.outreach + d.replies, 0)
  if (total === 0) return <EmptyNote>No outreach recorded in this period.</EmptyNote>
  return (
    <>
      <div className="h-[230px]" role="img" aria-label="Outreach sent and client replies per day">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: 'var(--stone)' }} tickLine={false} axisLine={false} minTickGap={20} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--stone)' }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: 'var(--line)', opacity: 0.35 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as { outreach: number; replies: number; wins: number }
                return (
                  <div className="rounded-lg border border-line bg-bone-raised px-3 py-2 text-[11px] shadow-md">
                    <p className="mb-1 font-medium text-ink">{shortDate(String(label))}</p>
                    <p className="text-graphite">Outreach <span className="font-medium text-ink">{p.outreach}</span></p>
                    <p className="text-graphite">Client replies <span className="font-medium text-ink">{p.replies}</span></p>
                    {p.wins > 0 && <p className="text-status-success">{p.wins} won</p>}
                  </div>
                )
              }}
            />
            <Bar dataKey="outreach" name="Outreach" fill="var(--cobalt-light)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Line type="monotone" dataKey="replies" name="Client replies" stroke="var(--status-success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex gap-4 text-[11px] text-graphite">
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-cobalt-light" aria-hidden="true" />Outreach</li>
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-status-success" aria-hidden="true" />Client replies</li>
      </ul>
    </>
  )
}

function Leaderboard({ reps }: { reps: RepPerformance[] }) {
  if (reps.length === 0) return <EmptyNote>No owned leads moved in this period.</EmptyNote>
  const sorted = [...reps].sort((a, b) => b.wins - a.wins || b.replies - a.replies || b.contacted - a.contacted)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-right text-[10px] uppercase tracking-[0.1em] text-stone">
            <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">Person</th>
            <th scope="col" className="px-2 py-2 font-medium">Contacted</th>
            <th scope="col" className="px-2 py-2 font-medium">Replies</th>
            <th scope="col" className="px-2 py-2 font-medium">Reply rate</th>
            <th scope="col" className="px-2 py-2 font-medium">Convos</th>
            <th scope="col" className="px-2 py-2 font-medium">Won</th>
            <th scope="col" className="w-[110px] px-4 py-2 font-medium sm:px-5">Targets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60 text-right tabular-nums text-graphite">
          {sorted.map((rep) => (
            <tr key={rep.repId} className="hover:bg-bone/60">
              <th scope="row" className="px-4 py-2.5 text-left font-normal sm:px-5">
                <Link href={`/team/${rep.repId}`} className="flex items-center gap-2 hover:underline">
                  <Initials name={rep.repName} size="sm" />
                  <span className="truncate text-[13px] text-ink">{rep.repName}</span>
                </Link>
              </th>
              <td className="px-2 py-2.5">{rep.contacted}</td>
              <td className="px-2 py-2.5">{rep.replies}</td>
              <td className="px-2 py-2.5 font-medium text-ink">{pct(rate(rep.replies, rep.contacted))}</td>
              <td className="px-2 py-2.5">{rep.qualifiedConversations}</td>
              <td className={cn('px-2 py-2.5', rep.wins > 0 && 'font-medium text-status-success')}>{rep.wins}</td>
              <td className="px-4 py-2.5 sm:px-5">
                <div className="flex items-center gap-2">
                  <Meter value={rep.targetProgress} max={100} className="flex-1" />
                  <span className="w-9 text-[11px]">{rep.targetProgress}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IdentityTable({ rows }: { rows: NonNullable<DashboardData['identityPerformance']> }) {
  if (rows.length === 0) return <EmptyNote>No leads were sent from an identity in this period.</EmptyNote>
  return (
    <ul className="divide-y divide-line/70">
      {rows.slice(0, 8).map((r) => {
        const rr = rate(r.replies, r.contacted)
        return (
          <li key={r.id} className="px-4 py-2.5 sm:px-5">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 truncate font-medium text-ink">{r.name} <span className="font-normal text-stone">· {r.channel}</span></span>
              <span className="shrink-0 tabular-nums text-graphite"><span className="font-medium text-ink">{pct(rr)}</span> reply · {r.wins} won</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Meter value={r.replies} max={Math.max(r.contacted, 1)} tone="success" className="flex-1" />
              <span className="w-24 text-right text-[11px] tabular-nums text-stone">{r.replies}/{r.contacted} contacted</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function SourceTable({ rows }: { rows: DashboardData['sourcePerformance'] }) {
  const sorted = [...rows].filter((r) => r.extracted + r.contacted > 0).sort((a, b) => b.contacted - a.contacted || b.extracted - a.extracted)
  if (sorted.length === 0) return <EmptyNote>No sources recorded.</EmptyNote>
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-line text-right text-[10px] uppercase tracking-[0.1em] text-stone">
          <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">Source</th>
          <th scope="col" className="px-2 py-2 font-medium">Leads</th>
          <th scope="col" className="px-2 py-2 font-medium">Sent</th>
          <th scope="col" className="px-4 py-2 font-medium sm:px-5">Reply</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/60 text-right tabular-nums text-graphite">
        {sorted.slice(0, 8).map((r) => (
          <tr key={r.source}>
            <th scope="row" className="truncate px-4 py-2 text-left font-normal text-ink sm:px-5">{humanize(r.source)}</th>
            <td className="px-2 py-2">{r.extracted}</td>
            <td className="px-2 py-2">{r.contacted}</td>
            <td className="px-4 py-2 font-medium text-ink sm:px-5">{pct(rate(r.replies, r.contacted))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FitBars({ fit }: { fit: Record<string, number> }) {
  const total = Object.values(fit).reduce((n, v) => n + v, 0)
  if (total === 0) return <EmptyNote>No new leads in this period.</EmptyNote>
  return (
    <div className="space-y-4">
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
        {FIT_ORDER.filter((k) => (fit[k] ?? 0) > 0).map((k) => (
          <div key={k} className={cn('h-full border-r-2 border-bone-raised last:border-r-0', FIT_COLOR[k])} style={{ width: `${((fit[k] ?? 0) / total) * 100}%` }} />
        ))}
      </div>
      <ul className="space-y-2">
        {FIT_ORDER.map((k) => (
          <li key={k} className="flex items-center gap-2 text-[12px]">
            <span className={cn('size-2 rounded-full', FIT_COLOR[k])} aria-hidden="true" />
            <span className="flex-1 text-graphite">{k}</span>
            <span className="font-medium tabular-nums text-ink">{fit[k] ?? 0}</span>
            <span className="w-10 text-right tabular-nums text-stone">{Math.round(((fit[k] ?? 0) / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StageBars({ stages }: { stages: Record<string, number> }) {
  const entries = Object.entries(stages).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <EmptyNote>No conversations yet.</EmptyNote>
  const max = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <ul className="space-y-2.5">
      {entries.slice(0, 7).map(([stage, count]) => {
        const tone: Tone = stage === 'won' ? 'success' : stage === 'lost' ? 'neutral' : 'cobalt'
        return (
          <li key={stage}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-graphite">{humanize(stage)}</span>
              <span className="font-medium tabular-nums text-ink">{count}</span>
            </div>
            <Meter value={count} max={max} tone={tone} />
          </li>
        )
      })}
    </ul>
  )
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <EmptyNote>No activity in this period.</EmptyNote>
  return (
    <ul className="divide-y divide-line/70">
      {items.slice(0, 15).map((item) => {
        const subject = item.prospectName ?? item.company
        const body = (
          <>
            <span className="w-16 shrink-0 text-[11px] tabular-nums text-stone">{relative(item.timestamp)}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-graphite">
              <span className="font-medium text-ink">{EVENT_LABEL[item.eventType] ?? humanize(item.eventType)}</span>
              {subject && <> · {subject}</>}
              {item.revenueIdentityName && <span className="text-stone"> · as {item.revenueIdentityName}</span>}
            </span>
            {item.actorName && <span className="hidden shrink-0 text-[11px] text-stone sm:inline">{item.actorName}</span>}
          </>
        )
        return (
          <li key={item.id}>
            {item.entityId && subject ? (
              <Link href={`/leads/${item.entityId}`} className="flex items-center gap-3 px-4 py-2 hover:bg-bone sm:px-5">{body}</Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2 sm:px-5">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function RevenueSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading revenue">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-xl border border-line bg-bone-raised" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-[280px] animate-pulse rounded-xl border border-line bg-bone-raised lg:col-span-2" />
        <div className="h-[280px] animate-pulse rounded-xl border border-line bg-bone-raised lg:col-span-3" />
      </div>
    </div>
  )
}
