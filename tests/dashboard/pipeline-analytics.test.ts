/** Dashboard analytics: every number matches the board, the lead page and the raw events. */
import { describe, expect, it } from 'vitest'
import {
  buildDashboardAnalytics,
  dayKey,
  dayRange,
  parseRange,
  scoreBandOf,
  type ActivityEvent,
} from '@/lib/analytics/pipeline-analytics'
import { derivePipelineStage, type LeadRow } from '@/components/leads/pipeline-utils'
import { getLeadDisplayScore } from '@/lib/scoring/display-score'

const NOW = new Date('2026-10-18T15:00:00Z')
const daysAgo = (n: number, hour = 10) => new Date(Date.UTC(2026, 9, 18 - n, hour)).toISOString()

let seq = 0
function lead(extra: Partial<LeadRow> = {}): LeadRow {
  seq += 1
  return {
    id: `lead-${seq}`,
    organizationId: 'org',
    ownerRepId: 'rep-a',
    company: `Fictional Co ${seq}`,
    companyKey: `fictional-co-${seq}`,
    contactName: null,
    contactTitle: null,
    titleRaw: null,
    locationRaw: null,
    url: null,
    score: null,
    status: 'new',
    createdAt: daysAgo(3),
    ...extra,
  } as LeadRow
}

const ev = (leadId: string, type: ActivityEvent['type'], direction: ActivityEvent['direction'], at: string): ActivityEvent => ({ leadId, type, direction, at })

describe('dashboard analytics', () => {
  it('range parsing defaults to 30 and only accepts 7/30/90', () => {
    expect(parseRange(undefined)).toBe(30)
    expect(parseRange('7')).toBe(7)
    expect(parseRange(['90'])).toBe(90)
    expect(parseRange('365')).toBe(30)
  })

  it('day buckets follow the rep time zone', () => {
    // 23:30 UTC on the 17th is already the 18th in Karachi (UTC+5).
    expect(dayKey('2026-10-17T23:30:00Z', 'Asia/Karachi')).toBe('2026-10-18')
    expect(dayKey('2026-10-17T23:30:00Z', 'UTC')).toBe('2026-10-17')
    const days = dayRange(NOW, 7, 'UTC')
    expect(days).toHaveLength(7)
    expect(days.at(-1)).toBe('2026-10-18')
    expect(days[0]).toBe('2026-10-12')
  })

  it('stage counts are exactly the board stages', () => {
    const leads = [
      lead({ status: 'new' }),
      lead({ status: 'contacted', lastOutboundAt: daysAgo(1) }),
      lead({ status: 'replied', lastInboundAt: daysAgo(0) }),
      lead({ status: 'won' }),
      lead({ status: 'lost' }),
    ]
    const a = buildDashboardAnalytics({ leads, events: [], range: 30, now: NOW })
    for (const s of a.stages) {
      expect(s.value).toBe(leads.filter((l) => derivePipelineStage(l) === s.key).length)
    }
    expect(a.stages.reduce((n, s) => n + s.value, 0)).toBe(leads.length)
    expect(a.totals).toMatchObject({ leads: 5, won: 1, lost: 1 })
  })

  it('score bands come from the same display score as the ring (no second formula)', () => {
    const strong = lead({ canonicalScore: 82, displayQualification: 'strong', displayIntelligenceVersion: 'relay_decision_v3' })
    const maybe = lead({ canonicalScore: 42, displayQualification: 'maybe', displayIntelligenceVersion: 'relay_decision_v3' })
    const legacy = lead({ score: 12 })
    const unscored = lead()
    expect(getLeadDisplayScore(maybe).text).toBe('5/10')
    expect(scoreBandOf(strong)).toBe('strong')
    expect(scoreBandOf(maybe)).toBe('maybe')
    expect(scoreBandOf(legacy)).toBe('strong')
    expect(scoreBandOf(unscored)).toBe('unscored')
    const a = buildDashboardAnalytics({ leads: [strong, maybe, legacy, unscored], events: [], range: 30, now: NOW })
    expect(Object.fromEntries(a.scoreBands.map((b) => [b.key, b.value]))).toEqual({ strong: 2, worth_pursuing: 0, maybe: 1, skip: 0, unscored: 1 })
    // (9/10 + 5/10 + 12/12) / 3 → 8.0 on a /10 scale
    expect(a.averageScore).toBe(8)
  })

  it('KPIs count the current and previous windows separately', () => {
    const l1 = lead({ createdAt: daysAgo(2) })
    const l2 = lead({ createdAt: daysAgo(10) })
    const events = [
      ev(l1.id, 'connection', 'outbound', daysAgo(2)),
      ev(l1.id, 'dm', 'outbound', daysAgo(1)),
      ev(l1.id, 'reply', 'inbound', daysAgo(1, 14)),
      ev(l2.id, 'connection', 'outbound', daysAgo(9)),
      ev(l2.id, 'followup', 'outbound', daysAgo(8)),
    ]
    const a = buildDashboardAnalytics({ leads: [l1, l2], events, range: 7, now: NOW })
    expect(a.kpis.leadsAdded).toMatchObject({ value: 1, previous: 1 })
    expect(a.kpis.outreachSent).toMatchObject({ value: 2, previous: 2 })
    expect(a.kpis.repliesReceived).toMatchObject({ value: 1, previous: 0 })
    // l1 first contacted this week and replied; l2 first contacted last week, no reply.
    expect(a.kpis.replyRate).toMatchObject({ value: 1, previous: 0 })
    // Spark series cover the window, one point a day.
    expect(a.kpis.outreachSent.spark).toHaveLength(7)
    expect(a.kpis.outreachSent.spark.reduce((n, v) => n + v, 0)).toBe(2)
    // Activity series split by message type.
    const total = a.activity.reduce((n, p) => ({ c: n.c + p.connection, d: n.d + p.dm, i: n.i + p.inbound }), { c: 0, d: 0, i: 0 })
    expect(total).toEqual({ c: 1, d: 1, i: 1 })
  })

  it('time to answer is client message → our next message, median', () => {
    const l = lead()
    const events = [
      ev(l.id, 'dm', 'outbound', '2026-10-15T09:00:00Z'),
      ev(l.id, 'reply', 'inbound', '2026-10-15T10:00:00Z'),
      ev(l.id, 'reply', 'outbound', '2026-10-15T12:00:00Z'), // 2h
      ev(l.id, 'reply', 'inbound', '2026-10-16T10:00:00Z'),
      ev(l.id, 'reply', 'outbound', '2026-10-16T16:00:00Z'), // 6h
      ev(l.id, 'reply', 'inbound', '2026-10-17T10:00:00Z'),
      ev(l.id, 'reply', 'outbound', '2026-10-17T14:00:00Z'), // 4h
    ]
    const a = buildDashboardAnalytics({ leads: [l], events, range: 7, now: NOW })
    expect(a.kpis.medianReplyHours.value).toBe(4)
  })

  it('funnel is monotonic and never counts a lead twice', () => {
    const leads = [lead(), lead({ status: 'contacted' }), lead({ status: 'replied' }), lead({ status: 'won' })]
    const events = [
      ev(leads[1].id, 'connection', 'outbound', daysAgo(5)),
      ev(leads[2].id, 'dm', 'outbound', daysAgo(5)),
      ev(leads[2].id, 'reply', 'inbound', daysAgo(4)),
      ev(leads[3].id, 'dm', 'outbound', daysAgo(5)),
      ev(leads[3].id, 'reply', 'inbound', daysAgo(4)),
    ]
    const a = buildDashboardAnalytics({ leads, events, range: 30, now: NOW })
    const values = a.funnel.map((s) => s.value)
    expect(values).toEqual([4, 3, 2, 2, 1])
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1])
  })

  it('events for leads outside the view are ignored', () => {
    const l = lead()
    const a = buildDashboardAnalytics({ leads: [l], events: [ev('someone-else', 'dm', 'outbound', daysAgo(1))], range: 7, now: NOW })
    expect(a.kpis.outreachSent.value).toBe(0)
  })

  it('per-rep rows attribute activity by lead owner', () => {
    const a1 = lead({ ownerRepId: 'rep-a' })
    const b1 = lead({ ownerRepId: 'rep-b' })
    const events = [ev(a1.id, 'dm', 'outbound', daysAgo(1)), ev(a1.id, 'reply', 'inbound', daysAgo(0)), ev(b1.id, 'dm', 'outbound', daysAgo(1))]
    const a = buildDashboardAnalytics({ leads: [a1, b1], events, range: 7, now: NOW, reps: [{ id: 'rep-a', name: 'Alex Rivera' }, { id: 'rep-b', name: 'Blair Chen' }, { id: 'rep-c', name: 'Idle Rep' }] })
    expect(a.reps.map((r) => [r.name, r.sent, r.replies, r.replyRate])).toEqual([
      ['Alex Rivera', 1, 1, 1],
      ['Blair Chen', 1, 0, 0],
    ])
  })

  it('heatmap covers 12 weeks with Monday-based weekdays', () => {
    const l = lead()
    const a = buildDashboardAnalytics({ leads: [l], events: [ev(l.id, 'dm', 'outbound', '2026-10-12T10:00:00Z')], range: 7, now: NOW })
    expect(a.heatmap).toHaveLength(84)
    const cell = a.heatmap.find((c) => c.date === '2026-10-12')!
    expect(cell.value).toBe(1)
    expect(cell.weekday).toBe(0) // 12 Oct 2026 is a Monday
  })

  it('focus list puts replies first, then follow-ups, best score first', () => {
    const replied = lead({ status: 'replied', lastInboundAt: daysAgo(0), score: 3 })
    const fresh = lead({ status: 'new', score: 12 })
    const a = buildDashboardAnalytics({ leads: [fresh, replied], events: [], range: 7, now: NOW })
    expect(a.focus.map((f) => f.id)).toEqual([replied.id, fresh.id])
    expect(a.focus[1].score).toBe('12/12')
  })

  it('empty input is safe', () => {
    const a = buildDashboardAnalytics({ leads: [], events: [], range: 30, now: NOW })
    expect(a.totals.leads).toBe(0)
    expect(a.kpis.replyRate.value).toBeNull()
    expect(a.kpis.medianReplyHours.value).toBeNull()
    expect(a.averageScore).toBeNull()
    expect(a.activity).toHaveLength(30)
  })
})
