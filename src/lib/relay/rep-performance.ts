import type { Rep, Lead, Message } from '@/lib/domain/types'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

/** High value = the canonical STRONG or WORTH_PURSUING band. One definition for every rep metric. */
function isHighValueLead(l: { canonicalScore?: number | null }): boolean {
  return l.canonicalScore != null && ['STRONG', 'WORTH_PURSUING'].includes(qualifyCanonicalScore(l.canonicalScore).qualification)
}

type RepActionEvent = { actionType: string; occurredAt: string; actorId?: string | null; metadata?: Record<string, unknown> }

export interface RepPerformanceMetrics {
  repId: string
  repName: string
  period: string
  // Activity
  leadsContacted: number
  messagesSent: number
  followupsSent: number
  repliesReceived: number
  // Rates
  replyRate: number        // replies / contacted
  conversionRate: number   // won / contacted
  followupConversionRate: number  // replies after follow-up / total follow-ups
  acceptanceRate: number   // connections accepted / connections sent
  // Quality
  avgLeadScore: number
  highValueLeads: number
  wins: number
  // Momentum
  actionsLast7Days: number
  actionsPrev7Days: number
  momentum: 'improving' | 'stable' | 'declining'
}

export interface CoachingInsight {
  type: 'strength' | 'opportunity' | 'warning'
  title: string
  detail: string
  metric?: number
}

export interface DailyBrief {
  date: string
  newHighValueLeads: number
  repliesNeedingAction: number
  stalledDeals: number
  repsBehind: number
  winsToday: number
  notableEvents: string[]
}

/**
 * Compute rep performance metrics from leads + messages.
 * Pure function — reads data, computes ratios. No I/O.
 */
export function computeRepPerformance(
  rep: Rep,
  leads: Lead[],
  messages: Message[],
  actionEvents: RepActionEvent[],
  now: number = Date.now(),
): RepPerformanceMetrics {
  const repLeads = leads.filter(l => l.ownerRepId === rep.id)
  const repMessages = messages.filter(m => repLeads.some(l => l.id === m.leadId))

  const contacted = repLeads.filter(l => l.status !== 'new')
  const contactedIds = new Set(contacted.map(l => l.id))

  const replies = repMessages.filter(m => m.direction === 'inbound' && m.sentText && contactedIds.has(m.leadId))
  const sent = repMessages.filter(m => m.direction !== 'inbound' && m.sentText && contactedIds.has(m.leadId))
  const followups = repMessages.filter(m => m.type === 'followup' && m.sentText && contactedIds.has(m.leadId))

  const wins = repLeads.filter(l => l.status === 'won')
  const highValue = repLeads.filter(isHighValueLead)

  // Momentum: compare last 7 days vs prior 7 days
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const actionsLast7 = actionEvents.filter(e => {
    const t = new Date(e.occurredAt).getTime()
    return t >= now - weekMs
  }).length
  const actionsPrev7 = actionEvents.filter(e => {
    const t = new Date(e.occurredAt).getTime()
    return t >= now - 2 * weekMs && t < now - weekMs
  }).length

  const momentum: RepPerformanceMetrics['momentum'] =
    actionsLast7 > actionsPrev7 * 1.2 ? 'improving' :
    actionsLast7 < actionsPrev7 * 0.8 ? 'declining' : 'stable'

  const avgScore = repLeads.length > 0
    ? repLeads.reduce((sum, l) => sum + (l.canonicalScore ?? 0), 0) / repLeads.length
    : 0

  return {
    repId: rep.id,
    repName: rep.name,
    period: 'last_30d',
    leadsContacted: contacted.length,
    messagesSent: sent.length,
    followupsSent: followups.length,
    repliesReceived: replies.length,
    replyRate: contacted.length > 0 ? replies.length / contacted.length : 0,
    conversionRate: contacted.length > 0 ? wins.length / contacted.length : 0,
    followupConversionRate: followups.length > 0 ? replies.length / followups.length : 0,
    acceptanceRate: 0, // computed separately from connection data
    avgLeadScore: Math.round(avgScore),
    highValueLeads: highValue.length,
    wins: wins.length,
    actionsLast7Days: actionsLast7,
    actionsPrev7Days: actionsPrev7,
    momentum,
  }
}

/**
 * Generate coaching insights from performance metrics.
 */
export function generateCoachingInsights(metrics: RepPerformanceMetrics): CoachingInsight[] {
  const insights: CoachingInsight[] = []

  // Strengths
  if (metrics.replyRate > 0.3) {
    insights.push({
      type: 'strength',
      title: 'High reply rate',
      detail: `${Math.round(metrics.replyRate * 100)}% reply rate — your messaging resonates`,
      metric: metrics.replyRate,
    })
  }
  if (metrics.highValueLeads >= 5) {
    insights.push({
      type: 'strength',
      title: 'Strong pipeline',
      detail: `${metrics.highValueLeads} high-value leads in your queue`,
      metric: metrics.highValueLeads,
    })
  }

  // Opportunities
  if (metrics.followupsSent > 5 && metrics.followupConversionRate < 0.1) {
    insights.push({
      type: 'opportunity',
      title: 'Follow-ups not converting',
      detail: `${metrics.followupsSent} follow-ups sent but only ${Math.round(metrics.followupConversionRate * 100)}% got replies. Try varying your approach or timing.`,
      metric: metrics.followupConversionRate,
    })
  }
  if (metrics.avgLeadScore < 50 && metrics.leadsContacted > 10) {
    insights.push({
      type: 'opportunity',
      title: 'Low-quality leads',
      detail: `Average lead score is ${metrics.avgLeadScore}/100. Focus on higher-quality prospects.`,
      metric: metrics.avgLeadScore,
    })
  }

  // Warnings
  if (metrics.momentum === 'declining') {
    insights.push({
      type: 'warning',
      title: 'Activity declining',
      detail: 'Your activity has dropped compared to last week. Consider a push.',
    })
  }
  if (metrics.leadsContacted > 10 && metrics.replyRate < 0.1) {
    insights.push({
      type: 'warning',
      title: 'Very low reply rate',
      detail: `Only ${Math.round(metrics.replyRate * 100)}% reply rate. Review your messaging strategy.`,
      metric: metrics.replyRate,
    })
  }

  return insights
}

/**
 * Generate admin daily brief from aggregated data.
 */
export function generateDailyBrief(params: {
  date: string
  leads: Lead[]
  messages: Message[]
  actionEvents: Array<{ actionType: string; occurredAt: string; actorId?: string | null; metadata?: Record<string, unknown> }>
  reps: Rep[]
}): DailyBrief {
  const now = new Date()
  const todayStart = new Date(params.date + 'T00:00:00').getTime()
  const todayEnd = todayStart + 86400000

  // New high-value leads today
  const newHighValue = params.leads.filter(l => {
    const created = new Date(l.createdAt).getTime()
    return created >= todayStart && created < todayEnd && isHighValueLead(l)
  })

  // Replies needing action (inbound without outbound reply today)
  const todayInbound = params.messages.filter(m => {
    const t = new Date(m.createdAt).getTime()
    return m.direction === 'inbound' && m.sentText && t >= todayStart && t < todayEnd
  })
  const todayOutboundReply = new Set(
    params.messages.filter(m => {
      const t = new Date(m.createdAt).getTime()
      return m.type === 'reply' && m.sentText && t >= todayStart && t < todayEnd
    }).map(m => m.leadId)
  )
  const repliesNeedingAction = todayInbound.filter(m => !todayOutboundReply.has(m.leadId))

  // Stalled deals (contacted 14+ days ago, no reply)
  const stalled = params.leads.filter(l => {
    if (l.status !== 'contacted' && l.status !== 'followed_up') return false
    const age = now.getTime() - new Date(l.createdAt).getTime()
    return age > 14 * 86400000
  })

  // Reps behind (no action today, has leads)
  const activeRepIds = new Set(
    params.actionEvents
      .filter(e => {
        const t = new Date(e.occurredAt).getTime()
        return t >= todayStart && t < todayEnd && e.actorId
      })
      .map(e => e.actorId)
      .filter(Boolean)
  )
  const repsBehind = params.reps.filter(r => {
    if (r.role === 'sourcer') return false
    const hasLeads = params.leads.some(l => l.ownerRepId === r.id && l.status !== 'won' && l.status !== 'lost')
    return hasLeads && !activeRepIds.has(r.id)
  })

  // Notable wins/losses today
  const notableEvents: string[] = []
  const winsToday = params.leads.filter(l => {
    // Won today: status changed to won today (approximated by updated_at)
    const updated = new Date((l as any).updatedAt ?? l.createdAt).getTime()
    return l.status === 'won' && updated >= todayStart && updated < todayEnd
  })

  for (const lead of winsToday) {
    notableEvents.push(`🏆 ${lead.company} converted`)
  }

  // Signal events today
  const signalEvents = params.actionEvents.filter(e => {
    const t = new Date(e.occurredAt).getTime()
    return t >= todayStart && t < todayEnd && e.actionType === 'OPPORTUNITY_CREATED'
  })
  for (const event of signalEvents.slice(0, 3)) {
    const title = (event.metadata as any)?.signalTitle
    if (title) notableEvents.push(`📡 ${title}`)
  }

  return {
    date: params.date,
    newHighValueLeads: newHighValue.length,
    repliesNeedingAction: repliesNeedingAction.length,
    stalledDeals: stalled.length,
    repsBehind: repsBehind.length,
    winsToday: winsToday.length,
    notableEvents,
  }
}
