/**
 * The rows behind the Leads pipeline, built once on the server. The board
 * and the dashboard both read these, so a lead sits in the same stage and
 * shows the same score everywhere.
 */
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { isProductAdmin } from '@/lib/auth/admin-page'
import { createServerSupabase } from '@/lib/supabase/server'
import { computeLifecycleState } from '@/lib/leads/lifecycle-policy'
import type { LeadRow } from '@/components/leads/pipeline-utils'
import type { MessageType } from '@/lib/domain/types'
import type { ActivityEvent } from '@/lib/analytics/pipeline-analytics'

export type { ActivityEvent }

export interface BoardData {
  leads: LeadRow[]
  orgView: boolean
  events: ActivityEvent[]
  reps: Array<{ id: string; name: string }>
}

export async function loadBoardData(): Promise<BoardData> {
  const user = await getCurrentUser()
  const authCtx = await getAuthContext()
  const store = await createScoutStore()
  const orgView = isProductAdmin(user, authCtx)
  const ownedLeads = orgView ? await store.fetchLeadsAll() : await store.listOwnedLeads()
  const leadIds = ownedLeads.map((l) => l.id)

  const [repsRes, messagesRes, followupCountsRes] = await Promise.all([
    orgView ? store.listAllReps() : Promise.resolve([]),
    (async () => {
      if (!authCtx || leadIds.length === 0) return []
      try {
        const client = await createServerSupabase()
        const { data: outbound } = await client
          .from('messages')
          .select('lead_id, sent_at, created_at, sent_text, direction, type')
          .eq('organization_id', authCtx.orgId)
          .in('lead_id', leadIds)
          .neq('direction', 'inbound')
          .order('sent_at', { ascending: false })
        const { data: inbound } = await client
          .from('messages')
          .select('lead_id, sent_at, created_at, sent_text, direction, type')
          .eq('organization_id', authCtx.orgId)
          .in('lead_id', leadIds)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false })
        return [...(outbound ?? []), ...(inbound ?? [])]
      } catch {
        return []
      }
    })(),
    (async () => {
      if (!authCtx || leadIds.length === 0) return []
      try {
        const client = await createServerSupabase()
        const { data } = await client
          .from('conversation_states')
          .select('lead_id, followup_count')
          .eq('organization_id', authCtx.orgId)
          .in('lead_id', leadIds)
        return data ?? []
      } catch {
        return []
      }
    })(),
  ])

  const reps = (Array.isArray(repsRes) ? repsRes : []).map((rep) => ({ id: rep.id, name: rep.name }))
  const ownerByRepId = Object.fromEntries(reps.map((rep) => [rep.id, rep.name]))

  const messages = Array.isArray(messagesRes) ? messagesRes : []

  const lastActivityByLead = new Map<string, string>()
  const lastOutboundByLead = new Map<string, { text: string; at: string }>()
  const lastInboundByLead = new Map<string, { text: string; at: string }>()
  const hasDmSentByLead = new Map<string, boolean>()
  const events: ActivityEvent[] = []

  for (const m of messages) {
    const leadId = m.lead_id as string
    const ts = (m.sent_at ?? m.created_at) as string
    if (ts && !lastActivityByLead.has(leadId)) lastActivityByLead.set(leadId, ts)

    const direction = m.direction as string
    const type = m.type as string
    const text = m.sent_text as string
    const at = (m.sent_at ?? m.created_at) as string

    if (direction !== 'inbound' && text && !lastOutboundByLead.has(leadId)) {
      lastOutboundByLead.set(leadId, { text, at })
    }
    if (direction === 'inbound' && text && !lastInboundByLead.has(leadId)) {
      lastInboundByLead.set(leadId, { text, at })
    }
    // Pipeline/detail parity: track whether a DM was sent so connection-
    // accepted leads land in to_contact (action required), not waiting.
    if (type === 'dm' && direction !== 'inbound' && text) {
      hasDmSentByLead.set(leadId, true)
    }
    // Only sent messages are activity; a saved draft has no sent_at. A
    // connection request without a note still counts as sent.
    if (m.sent_at) {
      events.push({
        leadId,
        type: type as MessageType,
        direction: direction === 'inbound' ? 'inbound' : 'outbound',
        at: m.sent_at as string,
      })
    }
  }

  const followupCountByLead = new Map<string, number>()
  const followupCounts = Array.isArray(followupCountsRes) ? followupCountsRes : []
  for (const fc of followupCounts) {
    followupCountByLead.set(fc.lead_id as string, (fc.followup_count as number) ?? 0)
  }

  const senderProfileIds = [...new Set(ownedLeads.map((l) => l.senderProfileId).filter(Boolean) as string[])]
  const profileById = new Map<string, string>()
  if (senderProfileIds.length > 0 && authCtx) {
    try {
      const client = await createServerSupabase()
      const { data: profiles } = await client
        .from('profiles')
        .select('id, display_name, full_name')
        .eq('organization_id', authCtx.orgId)
        .in('id', senderProfileIds)
      if (profiles) {
        for (const p of profiles) {
          profileById.set(p.id as string, (p.display_name ?? p.full_name ?? 'Profile') as string)
        }
      }
    } catch { }
  }

  const leads: LeadRow[] = ownedLeads.map((lead) => {
    const outbound = lastOutboundByLead.get(lead.id)
    const inbound = lastInboundByLead.get(lead.id)
    const lifecycle = computeLifecycleState({
      status: lead.status,
      createdAt: lead.createdAt,
      connectionAcceptedAt: lead.connectionAcceptedAt,
      lockedReason: lead.lockedReason,
      lockedUntil: lead.lockedUntil,
      lastOutboundAt: outbound?.at ?? null,
      lastInboundAt: inbound?.at ?? null,
      followupCount: followupCountByLead.get(lead.id) ?? 0,
      archived: lead.archived,
    })
    return {
      ...lead,
      ownerName: orgView && lead.ownerRepId ? ownerByRepId[lead.ownerRepId] : undefined,
      lastActivityAt: lastActivityByLead.get(lead.id) ?? null,
      senderProfileName: lead.senderProfileId ? profileById.get(lead.senderProfileId) ?? undefined : undefined,
      lastOutboundText: outbound?.text ?? null,
      lastOutboundAt: outbound?.at ?? null,
      lastInboundText: inbound?.text ?? null,
      lastInboundAt: inbound?.at ?? null,
      followupCount: followupCountByLead.get(lead.id) ?? 0,
      hasDmSent: hasDmSentByLead.get(lead.id) ?? false,
      lifecycle,
    }
  })

  return { leads, orgView, events, reps }
}
