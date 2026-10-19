'use client'

import { useId } from 'react'
import Link from 'next/link'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react'
import { cn } from 'cn'
import { ContributionHeatmap } from '@/components/performance/contribution-heatmap'
import type { DailyActivity } from '@/lib/performance/activity-model'
import type {
  ActivityPoint,
  CountSlice,
  DashboardAnalytics,
  FocusLead,
  FunnelStep,
  HeatCell,
  Kpi,
  RangeDays,
  RepRow,
  StageSlice,
} from '@/lib/analytics/pipeline-analytics'

/* ─── palette: theme tokens, so dark mode follows the app ─── */
const C = {
  ink: 'var(--ink)',
  stone: 'var(--stone)',
  stoneLight: 'var(--stone-light)',
  line: 'var(--line)',
  orange: 'var(--orange)',
  orangeLight: 'var(--orange-light)',
  cobalt: 'var(--cobalt)',
  cobaltLight: 'var(--cobalt-light)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  danger: 'var(--status-danger)',
}

const SERIES: Array<{ key: keyof Omit<ActivityPoint, 'date' | 'inbound'>; label: string; color: string }> = [
  { key: 'connection', label: 'Connections', color: C.cobaltLight },
  { key: 'dm', label: 'First messages', color: C.cobalt },
  { key: 'followup', label: 'Follow-ups', color: C.orangeLight },
  { key: 'reply', label: 'Our replies', color: C.orange },
  { key: 'other', label: 'Email / Upwork', color: C.stoneLight },
]

const STAGE_COLOR: Record<string, string> = {
  to_contact: C.stone,
  waiting: C.cobalt,
  follow_up_due: C.orangeLight,
  needs_reply: C.orange,
  cold: C.warning,
  done: C.success,
}

const BAND_COLOR: Record<string, string> = {
  strong: C.success,
  worth_pursuing: C.cobalt,
  maybe: C.orangeLight,
  skip: C.danger,
  unscored: C.line,
}

const OUTCOME_COLOR: Record<string, string> = {
  open: C.cobalt,
  won: C.success,
  lost: C.danger,
  closed: C.stoneLight,
}

/* ─── formatting ─── */
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const hours = (v: number | null) => (v == null ? '—' : v < 1 ? `${Math.max(1, Math.round(v * 60))}m` : v < 48 ? `${Math.round(v)}h` : `${Math.round(v / 24)}d`)

function shortDate(key: string): string {
  const d = new Date(`${key}T12:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function relative(iso: string | null): string {
  if (!iso) return 'No activity yet'
  const diff = Date.now() - Date.parse(iso)
  const d = Math.floor(diff / 86_400_000)
  if (d > 0) return `${d}d ago`
  const h = Math.floor(diff / 3_600_000)
  return h > 0 ? `${h}h ago` : 'just now'
}

/* ─── building blocks ─── */
function Panel({ title, subtitle, action, children, className }: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-line bg-bone-raised p-4 sm:p-5', className)} aria-label={title}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-stone">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full min-h-[120px] items-center justify-center text-center text-[12px] text-stone">{children}</p>
}

function ChartTooltip({ active, payload, label, formatLabel }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string | number }>
  label?: string | number
  formatLabel?: (l: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-bone-raised px-3 py-2 text-[11px] shadow-md">
      {label != null && <p className="mb-1 font-medium text-ink">{formatLabel ? formatLabel(String(label)) : label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-graphite">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-ink">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const id = useId().replace(/:/g, '')
  if (data.length < 2 || data.every((v) => v === 0)) return <div className="h-9" />
  return (
    <div className="h-9" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.map((value, i) => ({ i, value }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function Delta({ kpi, lowerIsBetter = false, format }: { kpi: Kpi; lowerIsBetter?: boolean; format: 'count' | 'rate' | 'hours' }) {
  if (kpi.value == null || kpi.previous == null) return <span className="text-[11px] text-stone">no prior data</span>
  const diff = kpi.value - kpi.previous
  if (Math.abs(diff) < 1e-9) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] text-stone"><Minus className="size-3" aria-hidden="true" />same as before</span>
  }
  const good = lowerIsBetter ? diff < 0 : diff > 0
  const text = format === 'rate'
    ? `${diff > 0 ? '+' : ''}${Math.round(diff * 100)} pts`
    : format === 'hours'
      ? `${diff > 0 ? '+' : '−'}${hours(Math.abs(diff))}`
      : kpi.previous === 0
        ? `+${kpi.value}`
        : `${diff > 0 ? '+' : ''}${Math.round((diff / kpi.previous) * 100)}%`
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', good ? 'text-status-success' : 'text-status-danger')}>
      <Icon className="size-3" aria-hidden="true" />{text}
    </span>
  )
}

function KpiCard({ label, value, kpi, color, format, lowerIsBetter, hint }: {
  label: string
  value: string
  kpi: Kpi
  color: string
  format: 'count' | 'rate' | 'hours'
  lowerIsBetter?: boolean
  hint: string
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-bone-raised p-4" title={hint}>
      <p className="text-mono-medium truncate text-[10px] uppercase tracking-[0.12em] text-stone">{label}</p>
      <p className="mt-1.5 text-[26px] font-light leading-none tracking-[-0.02em] text-ink tabular-nums">{value}</p>
      <div className="mt-1.5"><Delta kpi={kpi} format={format} lowerIsBetter={lowerIsBetter} /></div>
      <div className="mt-auto pt-2"><MiniSpark data={kpi.spark} color={color} /></div>
    </div>
  )
}

/* ─── charts ─── */
function ActivityChart({ data, range }: { data: ActivityPoint[]; range: RangeDays }) {
  const total = data.reduce((n, p) => n + p.connection + p.dm + p.followup + p.reply + p.other + p.inbound, 0)
  if (total === 0) return <Empty>No messages sent or received in the last {range} days.</Empty>
  return (
    <div className="h-[260px]" role="img" aria-label={`Daily outreach and replies over the last ${range} days`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: C.stone }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: C.stone }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip formatLabel={shortDate} />} cursor={{ fill: 'var(--line)', opacity: 0.35 }} />
          {SERIES.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="out" fill={s.color} radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={22} />
          ))}
          <Line type="monotone" dataKey="inbound" name="Client replies" stroke={C.success} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string; value?: string | number }> }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[11px] text-graphite">
          <span className="inline-block size-2 rounded-full" style={{ background: i.color }} aria-hidden="true" />
          {i.label}{i.value != null && <span className="font-medium text-ink tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  )
}

function StageBars({ stages }: { stages: StageSlice[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value))
  const total = stages.reduce((n, s) => n + s.value, 0)
  if (total === 0) return <Empty>No leads on the board yet.</Empty>
  return (
    <ul className="space-y-2.5">
      {stages.map((s) => (
        <li key={s.key} data-stage={s.key} data-value={s.value}>
          <Link href="/leads" className="group block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-cobalt">
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-graphite group-hover:text-ink">{s.label}</span>
              <span className="font-medium text-ink tabular-nums">{s.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line/50">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(s.value / max) * 100}%`, background: STAGE_COLOR[s.key] }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.value ?? 0
  if (top === 0) return <Empty>Add leads to see how they convert.</Empty>
  return (
    <ol className="space-y-2" aria-label="Conversion from lead to won">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null
        const conv = prev ? s.value / prev : null
        return (
          <li key={s.key}>
            <div className="flex items-center gap-3">
              <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-line/30">
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-700"
                  style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: i === steps.length - 1 ? C.success : C.cobalt, opacity: 1 - i * 0.12 }}
                />
                <span className="relative z-10 flex h-full items-center px-2.5 text-[12px] font-medium text-ink mix-blend-normal">
                  <span className="rounded bg-bone-raised/80 px-1">{s.label}</span>
                </span>
              </div>
              <span className="w-10 text-right text-[13px] font-medium text-ink tabular-nums">{s.value}</span>
              <span className="w-12 text-right text-[11px] text-stone tabular-nums">{conv == null ? '' : pct(conv)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Donut({ slices, colors, centerValue, centerLabel, ariaLabel }: {
  slices: CountSlice[]
  colors: Record<string, string>
  centerValue: string
  centerLabel: string
  ariaLabel: string
}) {
  const total = slices.reduce((n, s) => n + s.value, 0)
  if (total === 0) return <Empty>Nothing to show yet.</Empty>
  const data = slices.filter((s) => s.value > 0)
  return (
    <div>
      <div className="relative mx-auto h-[170px] max-w-[220px]" role="img" aria-label={`${ariaLabel}: ${data.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="92%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((s) => <Cell key={s.key} fill={colors[s.key] ?? C.stone} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-light text-ink tabular-nums">{centerValue}</span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-stone">{centerLabel}</span>
        </div>
      </div>
      <Legend items={slices.map((s) => ({ label: s.label, color: colors[s.key] ?? C.stone, value: s.value }))} />
    </div>
  )
}

function BarList({ items, color, empty }: { items: CountSlice[]; color: string; empty: string }) {
  const total = items.reduce((n, s) => n + s.value, 0)
  if (total === 0) return <Empty>{empty}</Empty>
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="space-y-2">
      {items.slice(0, 7).map((i) => (
        <li key={i.key} className="relative">
          <div className="absolute inset-y-0 left-0 rounded-md opacity-[0.14]" style={{ width: `${(i.value / max) * 100}%`, background: color }} aria-hidden="true" />
          <div className="relative flex items-center justify-between px-2.5 py-1.5 text-[12px]">
            <span className="truncate text-graphite">{i.label}</span>
            <span className="ml-3 shrink-0 font-medium text-ink tabular-nums">{i.value} <span className="font-normal text-stone">· {Math.round((i.value / total) * 100)}%</span></span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function mapHeatCellsToDailyActivity(cells: HeatCell[]): DailyActivity[] {
  return cells.map(cell => ({
    date: cell.date,
    totalActions: cell.value,
    weightedActivity: cell.value,
    active: cell.value > 0,
    breakdown: {
      leadsAnalyzed: 0,
      leadsSaved: 0,
      connections: cell.value,
      firstDMs: 0,
      followups: 0,
      replies: 0,
      upworkApplications: 0,
      meetings: 0,
      wins: 0,
      referrals: 0,
    },
    events: [],
  }))
}

function FocusList({ leads }: { leads: FocusLead[] }) {
  if (leads.length === 0) return <Empty>Nothing is waiting on you. Nice work.</Empty>
  return (
    <ul className="-mx-2 divide-y divide-line/60">
      {leads.map((l) => (
        <li key={l.id}>
          <Link href={`/leads/${l.id}`} className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-bone">
            <span className="size-2 shrink-0 rounded-full" style={{ background: STAGE_COLOR[l.stage] }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-ink">{l.contactName ? `${l.contactName} · ${l.company}` : l.company}</p>
              <p className="truncate text-[11px] text-stone">{l.stageLabel} · {relative(l.lastActivityAt)}</p>
            </div>
            <span className="shrink-0 rounded-md bg-bone px-1.5 py-0.5 text-[11px] font-medium text-ink tabular-nums" aria-label={`Score ${l.score}`}>{l.score}</span>
            <ChevronRight className="size-4 shrink-0 text-stone group-hover:text-ink" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function RepLeaderboard({ reps, range }: { reps: RepRow[]; range: RangeDays }) {
  if (reps.length === 0) return <Empty>No rep activity in the last {range} days.</Empty>
  const chart = reps.slice(0, 8).map((r) => ({ name: r.name.split(' ')[0], Sent: r.sent, Replies: r.replies }))
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="h-[220px] lg:col-span-2" role="img" aria-label="Messages sent and replies received by rep">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: C.stone }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: C.ink }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--line)', opacity: 0.35 }} />
            <Bar dataKey="Sent" fill={C.cobalt} radius={[0, 3, 3, 0]} maxBarSize={12} />
            <Bar dataKey="Replies" fill={C.success} radius={[0, 3, 3, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto lg:col-span-3">
        <table className="w-full min-w-[420px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.1em] text-stone">
              <th scope="col" className="py-2 pr-3 font-medium">Rep</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Leads</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Sent</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Replies</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Reply rate</th>
              <th scope="col" className="py-2 text-right font-medium">Won</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {reps.map((r) => (
              <tr key={r.repId}>
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">{r.name}</th>
                <td className="py-2 pr-3 text-right tabular-nums text-graphite">{r.leads}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-graphite">{r.sent}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-graphite">{r.replies}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink">{pct(r.replyRate)}</td>
                <td className="py-2 text-right tabular-nums text-graphite">{r.won}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RangeTabs({ range, basePath }: { range: RangeDays; basePath: string }) {
  return (
    <nav aria-label="Time range" className="inline-flex rounded-lg border border-line bg-bone p-0.5">
      {([7, 30, 90] as RangeDays[]).map((r) => (
        <Link
          key={r}
          href={`${basePath}?range=${r}`}
          scroll={false}
          aria-current={r === range ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
            r === range ? 'bg-bone-raised text-ink shadow-sm' : 'text-stone hover:text-ink',
          )}
        >
          {r}d
        </Link>
      ))}
    </nav>
  )
}

/* ─── the dashboard ─── */
export function PipelineAnalyticsView({ data, scope, basePath = '/dashboard' }: {
  data: DashboardAnalytics
  /** "mine" for a rep's own book, "team" for an org or team view. */
  scope: 'mine' | 'team'
  basePath?: string
}) {
  const { kpis, range } = data
  const outboundTotal = data.activity.reduce((n, p) => n + p.connection + p.dm + p.followup + p.reply + p.other, 0)
  const inboundTotal = data.activity.reduce((n, p) => n + p.inbound, 0)
  const scored = data.scoreBands.filter((b) => b.key !== 'unscored').reduce((n, b) => n + b.value, 0)
  const period = `last ${range} days vs the ${range} before`

  if (data.totals.leads === 0) {
    return (
      <section className="rounded-xl border border-dashed border-line bg-bone-raised p-8 text-center">
        <h2 className="text-[16px] font-medium text-ink">Your performance dashboard fills in as you work</h2>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-graphite">Add your first lead and Relay will chart your outreach, replies, pipeline and conversion here.</p>
        <Link href="/leads/new" className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-orange px-3 py-2 text-[13px] font-medium text-on-accent hover:bg-orange-dark">
          Add a lead <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </section>
    )
  }

  return (
    <div className="space-y-4 border-t border-line pt-8" data-testid="pipeline-analytics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.2em] text-stone">{scope === 'team' ? 'Team performance' : 'Your performance'}</p>
          <h2 className="mt-1 text-[20px] font-light tracking-[-0.01em] text-ink" data-testid="analytics-totals" data-total={data.totals.leads}>
            {data.totals.active} active of {data.totals.leads} leads
            <span className="text-stone"> · {data.totals.won} won</span>
          </h2>
        </div>
        <RangeTabs range={range} basePath={basePath} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Leads added" value={String(kpis.leadsAdded.value ?? 0)} kpi={kpis.leadsAdded} color={C.ink} format="count" hint={`New leads, ${period}`} />
        <KpiCard label="Outreach sent" value={String(kpis.outreachSent.value ?? 0)} kpi={kpis.outreachSent} color={C.cobalt} format="count" hint={`Connections, messages, follow-ups and replies you sent, ${period}`} />
        <KpiCard label="Client replies" value={String(kpis.repliesReceived.value ?? 0)} kpi={kpis.repliesReceived} color={C.success} format="count" hint={`Messages from clients, ${period}`} />
        <KpiCard label="Reply rate" value={pct(kpis.replyRate.value)} kpi={kpis.replyRate} color={C.orange} format="rate" hint="Of the leads first contacted in this period, the share that replied" />
        <KpiCard label="Time to answer" value={hours(kpis.medianReplyHours.value)} kpi={kpis.medianReplyHours} color={C.stone} format="hours" lowerIsBetter hint="Median time from a client's message to your next message" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Outreach and replies"
          subtitle={`${outboundTotal} sent · ${inboundTotal} client replies · last ${range} days`}
        >
          <ActivityChart data={data.activity} range={range} />
          <Legend items={[...SERIES.map((s) => ({ label: s.label, color: s.color })), { label: 'Client replies', color: C.success }]} />
        </Panel>
        <Panel title="Pipeline now" subtitle="Same stages as the Leads board" action={<Link href="/leads" className="text-[11px] font-medium text-cobalt hover:underline">Open board</Link>}>
          <StageBars stages={data.stages} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Conversion funnel" subtitle="All leads · step-to-step conversion on the right">
          <Funnel steps={data.funnel} />
        </Panel>
        <Panel title="Lead quality" subtitle={`${scored} scored · same scale as each lead's score ring`}>
          <Donut
            slices={data.scoreBands}
            colors={BAND_COLOR}
            centerValue={data.averageScore == null ? '—' : `${data.averageScore}`}
            centerLabel="avg /10"
            ariaLabel="Leads by score band"
          />
        </Panel>
        <Panel title="Outcomes" subtitle="All leads by result">
          <Donut
            slices={data.outcomes}
            colors={OUTCOME_COLOR}
            centerValue={pct(data.totals.won + data.totals.lost > 0 ? data.totals.won / (data.totals.won + data.totals.lost) : null)}
            centerLabel="win rate"
            ariaLabel="Leads by outcome"
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Sending consistency" subtitle="Messages sent per day, last 12 weeks">
          <ContributionHeatmap daily={mapHeatCellsToDailyActivity(data.heatmap)} unit="messages" maxCell={26} />
        </Panel>
        <Panel title={scope === 'team' ? 'Leads waiting on the team' : 'Leads waiting on you'} subtitle="Replies first, then follow-ups, then new leads — best score first">
          <FocusList leads={data.focus} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Markets" subtitle="Where your leads are based">
          <BarList items={data.regions} color={C.cobalt} empty="No locations recorded yet." />
        </Panel>
        <Panel title="Sources" subtitle="Where your leads came from">
          <BarList items={data.sources} color={C.orange} empty="No sources recorded yet." />
        </Panel>
      </div>

      {scope === 'team' && (
        <Panel title="Team leaderboard" subtitle={`Last ${range} days · reply rate is per lead first contacted in the period`}>
          <RepLeaderboard reps={data.reps} range={range} />
        </Panel>
      )}
    </div>
  )
}
