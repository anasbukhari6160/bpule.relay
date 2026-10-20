import type { SignalEvent } from './signal-watch'
import type { Lead, Message } from '@/lib/domain/types'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

export interface TodaysIntelligence {
  newHighValueSignals: number
  repliesNeedingAction: number
  opportunitiesStronger: number
  leadsWentStale: number
  leadsToReassign: number
  intelligenceFallbacks: number
  // Drillable IDs — every count links to exact underlying records
  newHighValueSignalLeadIds: string[]
  repliesNeedingActionLeadIds: string[]
  opportunitiesStrongerLeadIds: string[]
  staleLeadIds: string[]
  reassignCandidateLeadIds: string[]
  notableEvents: Array<{
    type: 'signal' | 'reply' | 'stale' | 'fallback'
    title: string
    detail: string
    leadId: string | null
  }>
}

/**
 * Generate "Today's Intelligence" brief for Command Center.
 * Pure function — reads stored data, no AI.
 */
export function generateTodaysIntelligence(params: {
  date: string
  leads: Lead[]
  messages: Message[]
  signalEvents: SignalEvent[]
  actionEvents: Array<{ action_type: string; actor_id: string | null; occurred_at: string; metadata?: Record<string, unknown> }>
}): TodaysIntelligence {
  const todayStart = new Date(params.date + 'T00:00:00').getTime()
  const todayEnd = todayStart + 86400000
  const now = Date.now()

  const notableEvents: TodaysIntelligence['notableEvents'] = []

  // 1. New high-value signals today
  const todaySignals = params.signalEvents.filter(s => {
    const t = new Date(s.createdAt).getTime()
    return t >= todayStart && t < todayEnd && s.severity !== 'info'
  })

  for (const signal of todaySignals.slice(0, 3)) {
    notableEvents.push({
      type: 'signal',
      title: signal.title,
      detail: signal.detail,
      leadId: signal.leadId,
    })
  }

  // 2. Replies needing action today
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
  const repliesNeeding = todayInbound.filter(m => !todayOutboundReply.has(m.leadId))

  // 3. Opportunities that became stronger today
  const strongerToday = params.actionEvents.filter(e => {
    const t = new Date(e.occurred_at).getTime()
    return t >= todayStart && t < todayEnd &&
      e.action_type === 'OPPORTUNITY_CREATED' &&
      ((e.metadata as any)?.signalType === 'SCORE_INCREASED' || (e.metadata as any)?.signalType === 'BUYER_REQUEST')
  })

  // 4. High-value leads that went stale (no action in 14+ days)
  const isHighValue = (l: { canonicalScore?: number | null }) => l.canonicalScore != null && ['STRONG', 'WORTH_PURSUING'].includes(qualifyCanonicalScore(l.canonicalScore).qualification)
  const staleHighValue = params.leads.filter(l => {
    if (!isHighValue(l)) return false
    if (['won', 'lost', 'dead'].includes(l.status)) return false
    const lastAction = (l as any).updatedAt ? new Date((l as any).updatedAt).getTime() : new Date(l.createdAt).getTime()
    return (now - lastAction) > 14 * 86400000
  })

  for (const lead of staleHighValue.slice(0, 2)) {
    notableEvents.push({
      type: 'stale',
      title: `${lead.contactName ?? lead.company} went stale`,
      detail: `Score ${lead.canonicalScore}/100, no action in 14+ days`,
      leadId: lead.id,
    })
  }

  // 5. Leads that should be reassigned (low sender match)
  const reassignCandidates = params.leads.filter(l => {
    if (['won', 'lost', 'dead', 'new'].includes(l.status)) return false
    return l.status === 'contacted' && isHighValue(l)
  }).slice(0, 3)

  // 6. Intelligence fallbacks today
  const fallbacks = params.actionEvents.filter(e => {
    const t = new Date(e.occurred_at).getTime()
    return t >= todayStart && t < todayEnd && e.action_type === 'RECOMMENDATION_SHOWN'
  })

  return {
    newHighValueSignals: todaySignals.length,
    repliesNeedingAction: repliesNeeding.length,
    opportunitiesStronger: strongerToday.length,
    leadsWentStale: staleHighValue.length,
    leadsToReassign: reassignCandidates.length,
    intelligenceFallbacks: fallbacks.length,
    // Drillable IDs — every count links to exact underlying records
    newHighValueSignalLeadIds: todaySignals.map(s => s.leadId),
    repliesNeedingActionLeadIds: repliesNeeding.map(m => m.leadId),
    opportunitiesStrongerLeadIds: strongerToday.map(e => (e.metadata as any)?.leadId).filter(Boolean) as string[],
    staleLeadIds: staleHighValue.map(l => l.id),
    reassignCandidateLeadIds: reassignCandidates.map(l => l.id),
    notableEvents: notableEvents.slice(0, 5),
  }
}
