import type { SupabaseClient } from '@supabase/supabase-js'

// Canonical activity types — mapped from action_events
export type CanonicalAction =
  | 'LEAD_ANALYZED'
  | 'LEAD_SAVED'
  | 'CONNECTION_SENT'
  | 'FIRST_DM_SENT'
  | 'FOLLOWUP_SENT'
  | 'REPLY_SENT'
  | 'UPWORK_APPLIED'
  | 'MEETING_BOOKED'
  | 'LEAD_WON'
  | 'LEAD_REFERRED'
  | 'SIGNAL_REVIEWED'

// Map from raw action_event types to canonical
const ACTION_MAP: Record<string, CanonicalAction> = {
  'LEAD_EXTRACTED': 'LEAD_ANALYZED',
  'LEAD_SAVED': 'LEAD_SAVED',
  'CONNECTION_SENT': 'CONNECTION_SENT',
  'CONNECTION_PREPARED': 'CONNECTION_SENT',
  'DM_SENT': 'FIRST_DM_SENT',
  'DM_PREPARED': 'FIRST_DM_SENT',
  'FOLLOWUP_SENT': 'FOLLOWUP_SENT',
  'REPLY_SENT': 'REPLY_SENT',
  'UPWORK_APPLIED': 'UPWORK_APPLIED',
  'UPWORK_PROPOSAL_PREPARED': 'UPWORK_APPLIED',
  'MEETING_BOOKED': 'MEETING_BOOKED',
  'CLIENT_WON': 'LEAD_WON',
  'OPPORTUNITY_CREATED': 'LEAD_SAVED',
  'LEAD_REFERRED': 'LEAD_REFERRED',
}

export interface DailyActivity {
  date: string          // YYYY-MM-DD in local timezone
  totalActions: number
  weightedActivity: number
  active: boolean
  breakdown: {
    leadsAnalyzed: number
    leadsSaved: number
    connections: number
    firstDMs: number
    followups: number
    replies: number
    upworkApplications: number
    meetings: number
    wins: number
    referrals: number
  }
  events: Array<{
    id: string
    type: CanonicalAction
    occurredAt: string
    leadId: string | null
    leadCompany: string | null
    jobId: string | null
  }>
}

export interface ActivitySummary {
  activeDays: number
  totalDays: number
  currentStreak: number
  longestStreak: number
  totalActions: number
  averagePerActiveDay: number
  scheduledDaysRatio: number  // active scheduled days / scheduled days elapsed
  breakdown: DailyActivity['breakdown']
  streakHistory: Array<{ date: string; streak: number }>
}

export interface RepActivityResult {
  daily: DailyActivity[]
  summary: ActivitySummary
  rangeStart: string
  rangeEnd: string
  dataCoverageStart: string | null
}

/**
 * Get daily activity for a rep over a date range.
 * Uses organization timezone for day boundaries.
 * 0 AI calls — pure aggregation from action_events.
 */
export async function getRepDailyActivity(params: {
  repId: string
  orgId: string
  startDate: Date
  endDate: Date
  timezone?: string
  supabase: SupabaseClient
}): Promise<RepActivityResult> {
  const { repId, orgId, startDate, endDate, timezone = 'UTC', supabase } = params

  // Fetch all action_events for this rep in the date range
  const { data: events, error } = await supabase
    .from('action_events')
    .select('id, action_type, actor_id, lead_id, job_id, occurred_at, metadata')
    .eq('organization_id', orgId)
    .eq('actor_id', repId)
    .gte('occurred_at', startDate.toISOString())
    .lt('occurred_at', endDate.toISOString())
    .order('occurred_at', { ascending: true })

  if (error || !events) {
    return emptyResult(startDate, endDate)
  }

  // Fetch lead names for drill-down
  const leadIds = [...new Set(events.map(e => e.lead_id).filter(Boolean))]
  const leadNames = new Map<string, string>()
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, company')
      .in('id', leadIds)
    if (leads) {
      for (const l of leads) leadNames.set(l.id, l.company ?? 'Unknown')
    }
  }

  // Group events by local date
  const dailyMap = new Map<string, DailyActivity>()

  for (const event of events) {
    const canonical = ACTION_MAP[event.action_type]
    if (!canonical) continue // Skip non-canonical types

    // Convert to local date
    const localDate = toLocalDate(event.occurred_at, timezone)
    if (!localDate) continue

    let day = dailyMap.get(localDate)
    if (!day) {
      day = {
        date: localDate,
        totalActions: 0,
        weightedActivity: 0,
        active: true,
        breakdown: {
          leadsAnalyzed: 0,
          leadsSaved: 0,
          connections: 0,
          firstDMs: 0,
          followups: 0,
          replies: 0,
          upworkApplications: 0,
          meetings: 0,
          wins: 0,
          referrals: 0,
        },
        events: [],
      }
      dailyMap.set(localDate, day)
    }

    day.totalActions++
    day.breakdown = incrementBreakdown(day.breakdown, canonical)
    day.weightedActivity += getActionWeight(canonical)
    day.active = true

    day.events.push({
      id: event.id,
      type: canonical,
      occurredAt: event.occurred_at,
      leadId: event.lead_id ?? null,
      leadCompany: event.lead_id ? (leadNames.get(event.lead_id) ?? null) : null,
      jobId: event.job_id ?? null,
    })
  }

  // Build full date range (including empty days)
  const daily: DailyActivity[] = []
  const current = new Date(startDate)
  while (current <= endDate) {
    const dateStr = formatLocalDate(current, timezone)
    const existing = dailyMap.get(dateStr)
    if (existing) {
      daily.push(existing)
    } else {
      daily.push({
        date: dateStr,
        totalActions: 0,
        weightedActivity: 0,
        active: false,
        breakdown: {
          leadsAnalyzed: 0, leadsSaved: 0, connections: 0, firstDMs: 0,
          followups: 0, replies: 0, upworkApplications: 0, meetings: 0,
          wins: 0, referrals: 0,
        },
        events: [],
      })
    }
    current.setDate(current.getDate() + 1)
  }

  // Calculate summary
  const activeDays = daily.filter(d => d.active)
  const summary: ActivitySummary = {
    activeDays: activeDays.length,
    totalDays: daily.length,
    currentStreak: calculateCurrentStreak(daily, timezone),
    longestStreak: calculateLongestStreak(daily, timezone),
    totalActions: daily.reduce((sum, d) => sum + d.totalActions, 0),
    averagePerActiveDay: activeDays.length > 0
      ? Math.round(daily.reduce((sum, d) => sum + d.totalActions, 0) / activeDays.length)
      : 0,
    scheduledDaysRatio: 0, // Calculated separately from targets
    breakdown: {
      leadsAnalyzed: daily.reduce((s, d) => s + d.breakdown.leadsAnalyzed, 0),
      leadsSaved: daily.reduce((s, d) => s + d.breakdown.leadsSaved, 0),
      connections: daily.reduce((s, d) => s + d.breakdown.connections, 0),
      firstDMs: daily.reduce((s, d) => s + d.breakdown.firstDMs, 0),
      followups: daily.reduce((s, d) => s + d.breakdown.followups, 0),
      replies: daily.reduce((s, d) => s + d.breakdown.replies, 0),
      upworkApplications: daily.reduce((s, d) => s + d.breakdown.upworkApplications, 0),
      meetings: daily.reduce((s, d) => s + d.breakdown.meetings, 0),
      wins: daily.reduce((s, d) => s + d.breakdown.wins, 0),
      referrals: daily.reduce((s, d) => s + d.breakdown.referrals, 0),
    },
    streakHistory: [],
  }

  return {
    daily,
    summary,
    rangeStart: formatLocalDate(startDate, timezone),
    rangeEnd: formatLocalDate(endDate, timezone),
    dataCoverageStart: events.length > 0 ? events[0].occurred_at : null,
  }
}

function incrementBreakdown(b: DailyActivity['breakdown'], action: CanonicalAction): DailyActivity['breakdown'] {
  switch (action) {
    case 'LEAD_ANALYZED': return { ...b, leadsAnalyzed: b.leadsAnalyzed + 1 }
    case 'LEAD_SAVED': return { ...b, leadsSaved: b.leadsSaved + 1 }
    case 'CONNECTION_SENT': return { ...b, connections: b.connections + 1 }
    case 'FIRST_DM_SENT': return { ...b, firstDMs: b.firstDMs + 1 }
    case 'FOLLOWUP_SENT': return { ...b, followups: b.followups + 1 }
    case 'REPLY_SENT': return { ...b, replies: b.replies + 1 }
    case 'UPWORK_APPLIED': return { ...b, upworkApplications: b.upworkApplications + 1 }
    case 'MEETING_BOOKED': return { ...b, meetings: b.meetings + 1 }
    case 'LEAD_WON': return { ...b, wins: b.wins + 1 }
    case 'LEAD_REFERRED': return { ...b, referrals: b.referrals + 1 }
    default: return b
  }
}

function getActionWeight(action: CanonicalAction): number {
  // Visual weight for heatmap — NOT business value
  switch (action) {
    case 'LEAD_ANALYZED': return 1
    case 'LEAD_SAVED': return 1
    case 'CONNECTION_SENT': return 2
    case 'FIRST_DM_SENT': return 2
    case 'FOLLOWUP_SENT': return 1
    case 'REPLY_SENT': return 2
    case 'UPWORK_APPLIED': return 3
    case 'MEETING_BOOKED': return 4
    case 'LEAD_WON': return 5
    case 'LEAD_REFERRED': return 1
    default: return 1
  }
}

function calculateCurrentStreak(daily: DailyActivity[], timezone: string): number {
  let streak = 0
  const today = formatLocalDate(new Date(), timezone)

  // Find today or most recent day
  let i = daily.length - 1
  while (i >= 0) {
    const day = daily[i]
    const isWorkday = isExpectedWorkday(day.date, timezone)

    if (day.active) {
      streak++
    } else if (isWorkday) {
      // Missed a workday — streak broken
      break
    }
    // Non-workday with no activity doesn't break streak
    i--
  }

  return streak
}

function calculateLongestStreak(daily: DailyActivity[], timezone: string): number {
  let maxStreak = 0
  let currentStreak = 0

  for (const day of daily) {
    const isWorkday = isExpectedWorkday(day.date, timezone)
    if (day.active) {
      currentStreak++
      maxStreak = Math.max(maxStreak, currentStreak)
    } else if (isWorkday) {
      currentStreak = 0
    }
  }

  return maxStreak
}

function isExpectedWorkday(dateStr: string, timezone: string): boolean {
  const date = new Date(dateStr + 'T12:00:00' + getOffset(timezone))
  const day = date.getDay()
  return day >= 1 && day <= 5 // Mon-Fri
}

function toLocalDate(isoTimestamp: string, timezone: string): string | null {
  try {
    const date = new Date(isoTimestamp)
    // Use Intl to convert to local date parts
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)

    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value
    if (!year || !month || !day) return null
    return `${year}-${month}-${day}`
  } catch {
    return null
  }
}

function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value
  return `${year}-${month}-${day}`
}

function getOffset(timezone: string): string {
  // Simple offset calculation for date construction
  const now = new Date()
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = now.toLocaleString('en-US', { timeZone: timezone })
  const diff = (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / (1000 * 60 * 60)
  const sign = diff >= 0 ? '+' : '-'
  const hours = Math.floor(Math.abs(diff))
  return `${sign}${String(hours).padStart(2, '0')}:00`
}

function emptyResult(startDate: Date, endDate: Date): RepActivityResult {
  return {
    daily: [],
    summary: {
      activeDays: 0,
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      totalActions: 0,
      averagePerActiveDay: 0,
      scheduledDaysRatio: 0,
      breakdown: {
        leadsAnalyzed: 0, leadsSaved: 0, connections: 0, firstDMs: 0,
        followups: 0, replies: 0, upworkApplications: 0, meetings: 0,
        wins: 0, referrals: 0,
      },
      streakHistory: [],
    },
    rangeStart: startDate.toISOString().slice(0, 10),
    rangeEnd: endDate.toISOString().slice(0, 10),
    dataCoverageStart: null,
  }
}
