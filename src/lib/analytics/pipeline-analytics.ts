/**
 * Dashboard analytics, computed from the same rows the Leads pipeline shows.
 * Stage counts use derivePipelineStage and scores use getLeadDisplayScore,
 * so a number on the dashboard always matches the board and the lead page.
 * Pure: no I/O, so every figure is unit-testable.
 */
import {
  derivePipelineStage,
  PIPELINE_COLUMNS,
  TERMINAL_COLUMNS,
  type LeadRow,
  type PipelineStage,
} from '@/components/leads/pipeline-utils'
import { getLeadDisplayScore } from '@/lib/scoring/display-score'
import { toStoredQualification } from '@/lib/scoring/qualification'
import type { MarketRegion, MessageType } from '@/lib/domain/types'

/** One sent or received message, without its text. */
export interface ActivityEvent {
  leadId: string
  type: MessageType
  direction: 'inbound' | 'outbound'
  at: string
}

export type RangeDays = 7 | 30 | 90
export const RANGE_OPTIONS: RangeDays[] = [7, 30, 90]

export function parseRange(raw: string | string[] | undefined | null): RangeDays {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return n === 7 || n === 90 ? n : 30
}

export interface Kpi {
  value: number | null
  /** Same measure over the previous period of equal length; null when not comparable. */
  previous: number | null
  /** Daily values across the period, oldest first. */
  spark: number[]
}

export interface ActivityPoint {
  date: string
  connection: number
  dm: number
  followup: number
  reply: number
  other: number
  inbound: number
}

export interface CountSlice {
  key: string
  label: string
  value: number
}

export interface StageSlice extends CountSlice {
  key: PipelineStage
}

export interface FunnelStep {
  key: 'added' | 'contacted' | 'engaged' | 'replied' | 'won'
  label: string
  value: number
}

export interface HeatCell {
  date: string
  value: number
  /** 0 = Monday … 6 = Sunday */
  weekday: number
}

export interface RepRow {
  repId: string
  name: string
  leads: number
  sent: number
  replies: number
  replyRate: number | null
  won: number
}

export interface FocusLead {
  id: string
  company: string
  contactName: string | null
  stage: PipelineStage
  stageLabel: string
  score: string
  scoreValue: number | null
  lastActivityAt: string | null
}

export interface DashboardAnalytics {
  range: RangeDays
  timeZone: string
  totals: { leads: number; active: number; won: number; lost: number }
  kpis: {
    leadsAdded: Kpi
    outreachSent: Kpi
    repliesReceived: Kpi
    replyRate: Kpi
    medianReplyHours: Kpi
  }
  activity: ActivityPoint[]
  stages: StageSlice[]
  funnel: FunnelStep[]
  scoreBands: CountSlice[]
  averageScore: number | null
  regions: CountSlice[]
  sources: CountSlice[]
  outcomes: CountSlice[]
  heatmap: HeatCell[]
  reps: RepRow[]
  focus: FocusLead[]
}

const DAY_MS = 86_400_000
const OUTBOUND_KEY: Partial<Record<MessageType, keyof Omit<ActivityPoint, 'date' | 'inbound'>>> = {
  connection: 'connection',
  dm: 'dm',
  followup: 'followup',
  reply: 'reply',
}

const REGION_LABELS: Record<MarketRegion, string> = {
  US: 'United States',
  UK: 'United Kingdom',
  EU: 'Europe',
  CA: 'Canada',
  AU: 'Australia',
  UAE: 'UAE',
  SG: 'Singapore',
  outside_core: 'Other markets',
  unknown: 'Not stated',
}

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  upwork: 'Upwork',
  email: 'Email',
  referral: 'Referral',
  other: 'Other',
}

/** The canonical bands, in display order. Keys match the stored qualification. */
export const SCORE_BANDS = [
  { key: 'strong', label: 'Strong' },
  { key: 'worth_pursuing', label: 'Worth pursuing' },
  { key: 'maybe', label: 'Maybe' },
  { key: 'low', label: 'Low' },
  { key: 'skip', label: 'Skip' },
] as const

/** YYYY-MM-DD of an instant in a time zone. */
export function dayKey(at: string | number | Date, timeZone: string): string {
  const d = at instanceof Date ? at : new Date(at)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** The last `days` calendar days ending today, oldest first. */
export function dayRange(now: Date, days: number, timeZone: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  // Step back in 12h increments so a DST shift never skips or repeats a day.
  for (let t = now.getTime(); keys.length < days && t > now.getTime() - (days + 2) * DAY_MS; t -= DAY_MS / 2) {
    const k = dayKey(t, timeZone)
    if (!seen.has(k)) { seen.add(k); keys.push(k) }
  }
  return keys.reverse()
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Score band of a lead from the one qualification policy. Legacy 0-12 leads map by share of scale. */
export function scoreBandOf(lead: LeadRow): (typeof SCORE_BANDS)[number]['key'] | 'unscored' {
  const s = getLeadDisplayScore(lead)
  if (s.value == null) return 'unscored'
  if (s.qualification) return toStoredQualification(s.qualification)
  const ratio = s.value / s.max
  return ratio >= 0.8 ? 'strong' : ratio >= 0.6 ? 'worth_pursuing' : ratio >= 0.4 ? 'maybe' : ratio >= 0.2 ? 'low' : 'skip'
}

const STAGE_LABEL: Record<PipelineStage, string> = Object.fromEntries(
  [...PIPELINE_COLUMNS, ...TERMINAL_COLUMNS].map((c) => [c.id, c.label]),
) as Record<PipelineStage, string>

export function buildDashboardAnalytics(input: {
  leads: LeadRow[]
  events: ActivityEvent[]
  reps?: Array<{ id: string; name: string }>
  range: RangeDays
  now?: Date
  timeZone?: string
}): DashboardAnalytics {
  const now = input.now ?? new Date()
  const timeZone = input.timeZone || 'UTC'
  const { leads, range } = input
  const leadIds = new Set(leads.map((l) => l.id))
  const events = input.events
    .filter((e) => leadIds.has(e.leadId) && Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => a.at.localeCompare(b.at))

  const days = dayRange(now, range, timeZone)
  // Day keys decide membership, so the window edges follow the rep's calendar.
  const inDays = new Set(days)
  const prevDays = new Set(dayRange(new Date(Date.parse(`${days[0]}T12:00:00Z`) - DAY_MS), range, timeZone))
  const inCurrent = (at: string) => inDays.has(dayKey(at, timeZone))
  const inPrevious = (at: string) => prevDays.has(dayKey(at, timeZone))

  // ── Activity series ────────────────────────────────────────────────────
  const byDay = new Map<string, ActivityPoint>(days.map((d) => [d, { date: d, connection: 0, dm: 0, followup: 0, reply: 0, other: 0, inbound: 0 }]))
  for (const e of events) {
    const point = byDay.get(dayKey(e.at, timeZone))
    if (!point) continue
    if (e.direction === 'inbound') point.inbound += 1
    else point[OUTBOUND_KEY[e.type] ?? 'other'] += 1
  }
  const activity = days.map((d) => byDay.get(d)!)
  const outboundSpark = activity.map((p) => p.connection + p.dm + p.followup + p.reply + p.other)
  const inboundSpark = activity.map((p) => p.inbound)

  const outbound = events.filter((e) => e.direction === 'outbound')
  const inbound = events.filter((e) => e.direction === 'inbound')

  // ── Leads added ────────────────────────────────────────────────────────
  const addedByDay = new Map<string, number>()
  for (const l of leads) {
    const k = dayKey(l.createdAt, timeZone)
    addedByDay.set(k, (addedByDay.get(k) ?? 0) + 1)
  }
  const leadsAdded: Kpi = {
    value: leads.filter((l) => inCurrent(l.createdAt)).length,
    previous: leads.filter((l) => inPrevious(l.createdAt)).length,
    spark: days.map((d) => addedByDay.get(d) ?? 0),
  }

  // ── Reply rate: of the leads first contacted in the window, how many replied ──
  const firstOutbound = new Map<string, string>()
  for (const e of outbound) if (!firstOutbound.has(e.leadId)) firstOutbound.set(e.leadId, e.at)
  const repliedAfter = (leadId: string, from: string) => inbound.some((e) => e.leadId === leadId && e.at >= from)
  const cohortRate = (inWindow: (at: string) => boolean): number | null => {
    const cohort = [...firstOutbound.entries()].filter(([, at]) => inWindow(at))
    if (cohort.length === 0) return null
    return cohort.filter(([id, at]) => repliedAfter(id, at)).length / cohort.length
  }
  const replyRateSpark = days.map((d) => {
    const cohort = [...firstOutbound.entries()].filter(([, at]) => dayKey(at, timeZone) <= d && inCurrent(at))
    return cohort.length ? cohort.filter(([id, at]) => repliedAfter(id, at)).length / cohort.length : 0
  })

  // ── Time to answer a client: their message → our next message ─────────
  const responseHours = (inWindow: (at: string) => boolean) => {
    const hours: number[] = []
    for (const msg of inbound) {
      if (!inWindow(msg.at)) continue
      const next = outbound.find((o) => o.leadId === msg.leadId && o.at > msg.at)
      if (next) hours.push((Date.parse(next.at) - Date.parse(msg.at)) / 3_600_000)
    }
    return hours
  }
  const currentHours = responseHours(inCurrent)
  const roundHours = (h: number | null) => (h == null ? null : Math.round(h * 10) / 10)

  // ── Stages: the board's own rule ───────────────────────────────────────
  const stageOf = new Map(leads.map((l) => [l.id, derivePipelineStage(l)]))
  const stageOrder: PipelineStage[] = ['to_contact', 'waiting', 'follow_up_due', 'needs_reply', 'cold', 'done']
  const stages: StageSlice[] = stageOrder.map((key) => ({
    key,
    label: STAGE_LABEL[key],
    value: leads.filter((l) => stageOf.get(l.id) === key).length,
  }))

  // ── Funnel (all time) ──────────────────────────────────────────────────
  const leadsWithOutbound = new Set(outbound.map((e) => e.leadId))
  const leadsWithInbound = new Set(inbound.map((e) => e.leadId))
  const leadsWithDm = new Set(outbound.filter((e) => e.type === 'dm' || e.type === 'followup' || e.type === 'reply' || e.type === 'email' || e.type === 'upwork').map((e) => e.leadId))
  const contacted = leads.filter((l) => leadsWithOutbound.has(l.id) || l.status !== 'new')
  const engaged = contacted.filter((l) => l.connectionAcceptedAt || leadsWithDm.has(l.id) || leadsWithInbound.has(l.id) || l.direction === 'inbound')
  const replied = engaged.filter((l) => leadsWithInbound.has(l.id) || l.status === 'replied' || l.status === 'won')
  const won = leads.filter((l) => l.status === 'won')
  const funnel: FunnelStep[] = [
    { key: 'added', label: 'Leads added', value: leads.length },
    { key: 'contacted', label: 'Contacted', value: contacted.length },
    { key: 'engaged', label: 'Connected or messaged', value: engaged.length },
    { key: 'replied', label: 'Replied', value: replied.length },
    { key: 'won', label: 'Won', value: won.length },
  ]

  // ── Score mix ──────────────────────────────────────────────────────────
  const bandCounts = new Map<string, number>()
  const ratios: number[] = []
  for (const l of leads) {
    const band = scoreBandOf(l)
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1)
    const s = getLeadDisplayScore(l)
    if (s.value != null) ratios.push(s.value / s.max)
  }
  const scoreBands: CountSlice[] = [
    ...SCORE_BANDS.map((b) => ({ key: b.key, label: b.label, value: bandCounts.get(b.key) ?? 0 })),
    { key: 'unscored', label: 'Not scored', value: bandCounts.get('unscored') ?? 0 },
  ]
  const averageScore = ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 10 : null

  // ── Mix by region / source ─────────────────────────────────────────────
  const tally = <K extends string>(keyOf: (l: LeadRow) => K, labels: Record<string, string>): CountSlice[] => {
    const m = new Map<K, number>()
    for (const l of leads) m.set(keyOf(l), (m.get(keyOf(l)) ?? 0) + 1)
    return [...m.entries()]
      .map(([key, value]) => ({ key, label: labels[key] ?? key, value }))
      .sort((a, b) => b.value - a.value)
  }
  const regions = tally((l) => (l.marketRegion ?? 'unknown') as MarketRegion, REGION_LABELS)
  const sources = tally((l) => (l.source ?? (l.direction === 'inbound' ? 'inbound' : 'other')) as string, { ...SOURCE_LABELS, inbound: 'Inbound' })

  const lost = leads.filter((l) => l.status === 'lost').length
  const closed = leads.filter((l) => l.status === 'no' || l.status === 'dead').length
  const open = leads.length - won.length - lost - closed
  const outcomes: CountSlice[] = [
    { key: 'open', label: 'Open', value: open },
    { key: 'won', label: 'Won', value: won.length },
    { key: 'lost', label: 'Lost', value: lost },
    { key: 'closed', label: 'Closed', value: closed },
  ]

  // ── Twelve-week send heatmap ───────────────────────────────────────────
  const heatDays = dayRange(now, 84, timeZone)
  const heatCount = new Map<string, number>()
  for (const e of outbound) {
    const k = dayKey(e.at, timeZone)
    heatCount.set(k, (heatCount.get(k) ?? 0) + 1)
  }
  const heatmap: HeatCell[] = heatDays.map((date) => ({
    date,
    value: heatCount.get(date) ?? 0,
    weekday: (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7,
  }))

  // ── Per rep (org view) ─────────────────────────────────────────────────
  const reps: RepRow[] = (input.reps ?? []).map((rep) => {
    const owned = leads.filter((l) => l.ownerRepId === rep.id)
    const ids = new Set(owned.map((l) => l.id))
    const sent = outbound.filter((e) => ids.has(e.leadId) && inCurrent(e.at)).length
    const replies = inbound.filter((e) => ids.has(e.leadId) && inCurrent(e.at)).length
    const cohort = [...firstOutbound.entries()].filter(([id, at]) => ids.has(id) && inCurrent(at))
    return {
      repId: rep.id,
      name: rep.name,
      leads: owned.length,
      sent,
      replies,
      replyRate: cohort.length ? cohort.filter(([id, at]) => repliedAfter(id, at)).length / cohort.length : null,
      won: owned.filter((l) => l.status === 'won').length,
    }
  }).filter((r) => r.leads > 0 || r.sent > 0).sort((a, b) => b.sent - a.sent || b.leads - a.leads)

  // ── Leads to act on: waiting on us, best score first ───────────────────
  const urgency: Partial<Record<PipelineStage, number>> = { needs_reply: 0, follow_up_due: 1, to_contact: 2 }
  const focus: FocusLead[] = leads
    .filter((l) => urgency[stageOf.get(l.id)!] !== undefined)
    .map((l) => {
      const s = getLeadDisplayScore(l)
      const stage = stageOf.get(l.id)!
      return {
        id: l.id,
        company: l.company,
        contactName: l.contactName ?? null,
        stage,
        stageLabel: STAGE_LABEL[stage],
        score: s.text,
        scoreValue: s.value == null ? null : s.value / s.max,
        lastActivityAt: l.lastActivityAt ?? null,
      }
    })
    .sort((a, b) => urgency[a.stage]! - urgency[b.stage]! || (b.scoreValue ?? -1) - (a.scoreValue ?? -1))
    .slice(0, 6)

  return {
    range,
    timeZone,
    totals: {
      leads: leads.length,
      active: stages.filter((s) => s.key !== 'done' && s.key !== 'cold').reduce((n, s) => n + s.value, 0),
      won: won.length,
      lost,
    },
    kpis: {
      leadsAdded,
      outreachSent: {
        value: outbound.filter((e) => inCurrent(e.at)).length,
        previous: outbound.filter((e) => inPrevious(e.at)).length,
        spark: outboundSpark,
      },
      repliesReceived: {
        value: inbound.filter((e) => inCurrent(e.at)).length,
        previous: inbound.filter((e) => inPrevious(e.at)).length,
        spark: inboundSpark,
      },
      replyRate: { value: cohortRate(inCurrent), previous: cohortRate(inPrevious), spark: replyRateSpark },
      medianReplyHours: {
        value: roundHours(median(currentHours)),
        previous: roundHours(median(responseHours(inPrevious))),
        spark: [],
      },
    },
    activity,
    stages,
    funnel,
    scoreBands,
    averageScore,
    regions,
    sources,
    outcomes,
    heatmap,
    reps,
    focus,
  }
}
