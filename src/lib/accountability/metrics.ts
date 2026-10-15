import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Accountability Metrics
 *
 * One action = one lead that progressed through a meaningful outreach step.
 * Connection sent, DM sent, follow-up sent, reply received, lead won.
 * Each counts as ONE action toward the rep's daily accountability.
 */

export interface DailyMetrics {
  date: string
  repId: string
  repName: string
  // Core actions
  connectionsSent: number
  dmsSent: number
  followupsSent: number
  repliesSent: number
  repliesReceived: number
  leadsWon: number
  // Computed
  totalActions: number
  outreachActions: number // connections + dms + followups + replies sent
  responseRate: number // replies_received / outreach_sent
}

export interface LeadJourney {
  leadId: string
  company: string
  contactName: string
  stage: string
  connectionSent: boolean
  dmSent: boolean
  hasReply: boolean
  isWon: boolean
  lastActivityAt: string | null
  score: number
}

export interface RepAccountability {
  repId: string
  repName: string
  today: DailyMetrics
  week: DailyMetrics
  month: DailyMetrics
  openLeads: LeadJourney[]
  activeLeads: number // leads touched today
}

export interface TeamDayView {
  date: string
  reps: DailyMetrics[]
  teamTotal: {
    connectionsSent: number
    dmsSent: number
    followupsSent: number
    repliesReceived: number
    leadsWon: number
    totalActions: number
  }
}

const EMPTY_METRICS: Omit<DailyMetrics, 'date' | 'repId' | 'repName'> = {
  connectionsSent: 0,
  dmsSent: 0,
  followupsSent: 0,
  repliesSent: 0,
  repliesReceived: 0,
  leadsWon: 0,
  totalActions: 0,
  outreachActions: 0,
  responseRate: 0,
}

function withComputed(m: Omit<DailyMetrics, 'date' | 'repId' | 'repName'>): Omit<DailyMetrics, 'date' | 'repId' | 'repName'> {
  const outreachActions = m.connectionsSent + m.dmsSent + m.followupsSent + m.repliesSent
  const totalActions = outreachActions + m.leadsWon
  const responseRate = outreachActions > 0 ? Math.round((m.repliesReceived / outreachActions) * 100) : 0
  return { ...m, outreachActions, totalActions, responseRate }
}

async function fetchMetricsForPeriod(
  client: SupabaseClient,
  repId: string,
  startDate: string,
  endDate: string,
): Promise<Omit<DailyMetrics, 'date' | 'repId' | 'repName'>> {
  const { data: messages } = await client
    .from('messages')
    .select('type, direction, sent_at')
    .eq('rep_id', repId)
    .gte('sent_at', startDate)
    .lte('sent_at', endDate)

  const { data: wonLeads } = await client
    .from('leads')
    .select('id')
    .eq('owner_rep_id', repId)
    .eq('status', 'won')
    .gte('updated_at', startDate)
    .lte('updated_at', endDate)

  let connectionsSent = 0
  let dmsSent = 0
  let followupsSent = 0
  let repliesSent = 0
  let repliesReceived = 0

  for (const m of messages ?? []) {
    const direction = m.direction as string
    const type = m.type as string
    if (direction === 'inbound') {
      repliesReceived++
      continue
    }
    switch (type) {
      case 'connection': connectionsSent++; break
      case 'dm': dmsSent++; break
      case 'followup': followupsSent++; break
      case 'reply': repliesSent++; break
    }
  }

  return withComputed({
    connectionsSent,
    dmsSent,
    followupsSent,
    repliesSent,
    repliesReceived,
    leadsWon: wonLeads?.length ?? 0,
    totalActions: 0,
    outreachActions: 0,
    responseRate: 0,
  })
}

export async function getRepMetrics(
  client: SupabaseClient,
  repId: string,
  repName: string,
  date: string,
): Promise<DailyMetrics> {
  const start = `${date}T00:00:00.000Z`
  const end = `${date}T23:59:59.999Z`
  const m = await fetchMetricsForPeriod(client, repId, start, end)
  return { date, repId, repName, ...m }
}

export async function getRepMetricsRange(
  client: SupabaseClient,
  repId: string,
  repName: string,
  startDate: string,
  endDate: string,
): Promise<DailyMetrics> {
  const start = `${startDate}T00:00:00.000Z`
  const end = `${endDate}T23:59:59.999Z`
  const m = await fetchMetricsForPeriod(client, repId, start, end)
  return { date: startDate, repId, repName, ...m }
}

export async function getRepLeadJourney(
  client: SupabaseClient,
  repId: string,
): Promise<LeadJourney[]> {
  const { data: leads } = await client
    .from('leads')
    .select('id, company, contact_name, status, score, updated_at, created_at')
    .eq('owner_rep_id', repId)
    .neq('status', 'won')
    .neq('status', 'lost')
    .neq('status', 'dead')
    .neq('status', 'no')
    .order('updated_at', { ascending: false })
    .limit(50)

  if (!leads || leads.length === 0) return []

  const leadIds = leads.map((l) => l.id)
  const { data: messages } = await client
    .from('messages')
    .select('lead_id, type, direction')
    .in('lead_id', leadIds)

  const msgMap = new Map<string, { connection: boolean; dm: boolean; reply: boolean; inbound: boolean }>()
  for (const m of messages ?? []) {
    const entry = msgMap.get(m.lead_id as string) || { connection: false, dm: false, reply: false, inbound: false }
    if (m.direction === 'inbound') entry.inbound = true
    else if (m.type === 'connection') entry.connection = true
    else if (m.type === 'dm') entry.dm = true
    else if (m.type === 'reply') entry.reply = true
    msgMap.set(m.lead_id as string, entry)
  }

  return leads.map((l) => {
    const msgs = msgMap.get(l.id) || { connection: false, dm: false, reply: false, inbound: false }
    return {
      leadId: l.id,
      company: l.company,
      contactName: l.contact_name,
      stage: l.status,
      connectionSent: msgs.connection || msgs.dm,
      dmSent: msgs.dm,
      hasReply: msgs.inbound,
      isWon: l.status === 'won',
      lastActivityAt: l.updated_at as string,
      score: (l.score as number) ?? 0,
    }
  })
}

export async function getTeamDayView(
  client: SupabaseClient,
  repIds: string[],
  repNames: Map<string, string>,
  date: string,
): Promise<TeamDayView> {
  const promises = repIds.map(async (id) => {
    const name = repNames.get(id) ?? id.slice(0, 8)
    return getRepMetrics(client, id, name, date)
  })
  const reps = await Promise.all(promises)

  const teamTotal = reps.reduce(
    (acc, r) => ({
      connectionsSent: acc.connectionsSent + r.connectionsSent,
      dmsSent: acc.dmsSent + r.dmsSent,
      followupsSent: acc.followupsSent + r.followupsSent,
      repliesReceived: acc.repliesReceived + r.repliesReceived,
      leadsWon: acc.leadsWon + r.leadsWon,
      totalActions: acc.totalActions + r.totalActions,
    }),
    { connectionsSent: 0, dmsSent: 0, followupsSent: 0, repliesReceived: 0, leadsWon: 0, totalActions: 0 },
  )

  return { date, reps, teamTotal }
}

export async function getTeamCalendar(
  client: SupabaseClient,
  repIds: string[],
  repNames: Map<string, string>,
  startDate: string,
  endDate: string,
): Promise<TeamDayView[]> {
  const days: string[] = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }

  const promises = days.map((day) => getTeamDayView(client, repIds, repNames, day))
  return Promise.all(promises)
}

export async function getRepAccountability(
  client: SupabaseClient,
  repId: string,
  repName: string,
): Promise<RepAccountability> {
  const today = new Date().toISOString().slice(0, 10)
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const monthStart = new Date()
  monthStart.setDate(1)
  const monthStartStr = monthStart.toISOString().slice(0, 10)

  const [todayM, weekM, monthM, openLeads] = await Promise.all([
    fetchMetricsForPeriod(client, repId, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`).then(m => ({ date: today, repId, repName, ...m })),
    fetchMetricsForPeriod(client, repId, `${weekStartStr}T00:00:00.000Z`, `${today}T23:59:59.999Z`).then(m => ({ date: weekStartStr, repId, repName, ...m })),
    fetchMetricsForPeriod(client, repId, `${monthStartStr}T00:00:00.000Z`, `${today}T23:59:59.999Z`).then(m => ({ date: monthStartStr, repId, repName, ...m })),
    getRepLeadJourney(client, repId),
  ])

  return {
    repId,
    repName,
    today: todayM,
    week: weekM,
    month: monthM,
    openLeads,
    activeLeads: openLeads.filter((l) => l.lastActivityAt?.startsWith(today)).length,
  }
}
