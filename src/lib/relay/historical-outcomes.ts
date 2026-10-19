/**
 * Historical Outcomes Computation
 *
 * Aggregates real lead outcomes by sender/profile for routing evidence.
 * Deterministic from lead/message/outcome data — no AI.
 *
 * Used as a SMALL bonus in sender routing (skill/proof dominate).
 * Capped so historical data never overrides current fit assessment.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SenderHistoricalOutcomes {
  profileId: string
  leadsContacted: number
  leadsReplied: number
  leadsMeeting: number
  leadsWon: number
  leadsLost: number
  replyRate: number        // 0-1
  meetingRate: number      // 0-1
  winRate: number          // 0-1 of contacted
  lastContactedAt: string | null
}

/**
 * Compute historical outcomes for all profiles in an org.
 * One query — aggregates from leads + messages tables.
 */
export async function computeHistoricalOutcomes(
  client: SupabaseClient,
  orgId: string,
): Promise<Map<string, SenderHistoricalOutcomes>> {
  const { data: rows, error } = await client
    .from('leads')
    .select(`
      sender_profile_id,
      status,
      messages:id,lead_id,direction,type,sent_at
    `)
    .eq('organization_id', orgId)
    .not('sender_profile_id', 'is', null)

  if (error || !rows) return new Map()

  const outcomes = new Map<string, {
    contacted: number
    replied: boolean[]
    meeting: boolean[]
    won: boolean[]
    lost: boolean[]
    lastContacted: string | null
  }>()

  for (const lead of rows) {
    const profileId = lead.sender_profile_id as string
    if (!profileId) continue

    if (!outcomes.has(profileId)) {
      outcomes.set(profileId, {
        contacted: 0,
        replied: [],
        meeting: [],
        won: [],
        lost: [],
        lastContacted: null,
      })
    }
    const o = outcomes.get(profileId)!

    // Count as contacted if any outbound message exists
    const messages = (lead.messages as Array<{ direction: string; type: string; sentAt?: string }>) ?? []
    const hasOutbound = messages.some((m) => m.direction !== 'inbound')
    if (hasOutbound || ['contacted', 'followed_up', 'replied', 'won', 'lost'].includes(lead.status as string)) {
      o.contacted++
    }

    // Reply: inbound message exists
    const hasInbound = messages.some((m) => m.direction === 'inbound')
    o.replied.push(hasInbound)

    // Meeting: status = meeting_booked
    o.meeting.push(lead.status === 'meeting_booked')

    // Won/Lost
    o.won.push(lead.status === 'won')
    o.lost.push(lead.status === 'lost')

    // Last contacted
    const sentMessages = messages
      .filter((m) => m.direction !== 'inbound' && m.sentAt)
      .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
    if (sentMessages[0]?.sentAt) {
      const lastSent = sentMessages[0].sentAt
      if (!o.lastContacted || lastSent > o.lastContacted) {
        o.lastContacted = lastSent
      }
    }
  }

  const result = new Map<string, SenderHistoricalOutcomes>()
  for (const [profileId, o] of outcomes) {
    const contacted = Math.max(1, o.contacted) // avoid div by zero
    result.set(profileId, {
      profileId,
      leadsContacted: o.contacted,
      leadsReplied: o.replied.filter(Boolean).length,
      leadsMeeting: o.meeting.filter(Boolean).length,
      leadsWon: o.won.filter(Boolean).length,
      leadsLost: o.lost.filter(Boolean).length,
      replyRate: o.replied.filter(Boolean).length / contacted,
      meetingRate: o.meeting.filter(Boolean).length / contacted,
      winRate: o.won.filter(Boolean).length / contacted,
      lastContactedAt: o.lastContacted,
    })
  }

  return result
}

/**
 * Convert historical outcomes to the format expected by sender-routing-engine.
 * Returns undefined if insufficient data (< 5 contacted leads) — keeps routing
 * from being swayed by small samples.
 */
export function toRoutingFormat(
  outcomes: SenderHistoricalOutcomes | undefined,
): { leadsContacted: number; replies: number; meetings: number } | undefined {
  if (!outcomes || outcomes.leadsContacted < 5) return undefined
  return {
    leadsContacted: outcomes.leadsContacted,
    replies: outcomes.leadsReplied,
    meetings: outcomes.leadsMeeting,
  }
}
