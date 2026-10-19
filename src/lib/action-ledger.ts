/**
 * Action Ledger Service — append-only commercial execution history.
 *
 * Single source of truth for "what did the team actually do?"
 * Every meaningful action emits an immutable ActionEvent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
type ActionEventType =
  | 'LEAD_EXTRACTED'
  | 'CONNECTION_PREPARED'
  | 'CONNECTION_SENT'
  | 'DM_PREPARED'
  | 'DM_SENT'
  | 'FOLLOWUP_SENT'
  | 'REPLY_SENT'
  | 'REPLY_RECEIVED'
  | 'LEAD_REFERRED'
  | 'PROFILE_RECOMMENDED'
  | 'UPWORK_JOB_EXTRACTED'
  | 'UPWORK_PROPOSAL_PREPARED'
  | 'UPWORK_APPLIED'
  | 'OPPORTUNITY_CREATED'
  | 'CLIENT_WON'
  | 'LEAD_ARCHIVED'
  | 'RECOMMENDATION_SHOWN'
  | 'RECOMMENDATION_ACTED'

interface EmitActionParams {
  orgId: string
  actionType: ActionEventType
  actorType?: 'rep' | 'admin' | 'system' | 'integration'
  actorId?: string | null
  senderProfileId?: string | null
  leadId?: string | null
  jobId?: string | null
  executionStatus?: 'generated' | 'sent' | 'delivered' | 'failed'
  channel?: 'linkedin' | 'email' | 'dm' | 'upwork'
  referredToRepId?: string | null
  referredToProfileId?: string | null
  referralReason?: string | null
  messageId?: string | null
  metadata?: Record<string, unknown>
  /** Deterministic idempotency key. Same key = same event, no duplicates. */
  idempotencyKey?: string | null
}

interface DailySummary {
  date: string
  repId: string | null
  repName: string | null
  connectionsSent: number
  dmsSent: number
  followupsSent: number
  repliesSent: number
  repliesReceived: number
  leadsExtracted: number
  upworkProposals: number
  opportunities: number
  referrals: number
  totalActions: number
}

interface ActionLogEntry {
  id: string
  actionType: string
  executionStatus: string
  channel: string | null
  occurredAt: string
  actorName: string | null
  senderProfileName: string | null
  leadCompany: string | null
  leadName: string | null
  jobTitle: string | null
  metadata: Record<string, unknown>
}

let supabase: SupabaseClient | null = null

function getClient() {
  if (!supabase) {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const { createServiceSupabase } = require('@/lib/supabase/service')
    supabase = createServiceSupabase()
  }
  return supabase!
}

/**
 * Emit an action event. Append-only — never updates or deletes.
 *
 * Idempotency: if `idempotencyKey` is provided, uses ON CONFLICT DO NOTHING
 * so the same business action can be retried safely without creating duplicates.
 */
export async function emitAction(params: EmitActionParams): Promise<string | null> {
  const payload: Record<string, unknown> = {
    organization_id: params.orgId,
    action_type: params.actionType,
    actor_type: params.actorType || 'system',
    actor_id: params.actorId || null,
    sender_profile_id: params.senderProfileId || null,
    lead_id: params.leadId || null,
    job_id: params.jobId || null,
    execution_status: params.executionStatus || 'generated',
    channel: params.channel || null,
    referred_to_rep_id: params.referredToRepId || null,
    referred_to_profile_id: params.referredToProfileId || null,
    referral_reason: params.referralReason || null,
    message_id: params.messageId || null,
    metadata: params.metadata || {},
  }
  if (params.idempotencyKey) {
    payload.idempotency_key = params.idempotencyKey
  }

  // With idempotency key: use upsert with ignoreDuplicates for safe retries.
  // Falls back to plain insert when the idempotency_key column is not yet migrated.
  if (params.idempotencyKey) {
    const { error } = await getClient()
      .from('action_events')
      .upsert(payload, { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true })
    if (error) {
      // Column may not exist yet — retry without idempotency.
      if (error.message.includes('idempotency_key') || error.message.includes('schema cache')) {
        const { data, error: insertError } = await getClient()
          .from('action_events')
          .insert({ ...payload, idempotency_key: undefined })
          .select('id')
          .single()
        if (insertError) {
          console.error('[Action Ledger] Failed to emit:', insertError.message)
          return null
        }
        return data?.id ?? null
      }
      console.error('[Action Ledger] Failed to emit:', error.message)
      return null
    }
    return null // idempotency upsert does not return the row id
  }

  const { data, error } = await getClient()
    .from('action_events')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    console.error('[Action Ledger] Failed to emit:', error.message)
    return null
  }
  return data?.id || null
}

/**
 * Log a recommendation shown to a rep. Used for observability:
 * track whether recommendations lead to action.
 */
export async function logRecommendation(params: {
  orgId: string
  repId: string
  leadId: string | null
  action: string
  priority: number
  reason: string
  acted?: boolean
}): Promise<void> {
  await emitAction({
    orgId: params.orgId,
    actionType: params.acted ? 'RECOMMENDATION_ACTED' : 'RECOMMENDATION_SHOWN',
    actorType: 'rep',
    actorId: params.repId,
    leadId: params.leadId,
    metadata: {
      action: params.action,
      priority: params.priority,
      reason: params.reason,
    },
    idempotencyKey: params.acted
      ? `rec-acted-${params.leadId}-${params.action}-${Date.now()}`
      : `rec-shown-${params.leadId}-${params.action}`,
  })
}

/**
 * Get daily summary for admin operating view.
 */
export async function getDailySummary(orgId: string, date: string, timezone: string = 'UTC'): Promise<DailySummary[]> {
  const { start: startOfDay, end: endOfDay } = tzDateRange(date, timezone)

  const { data, error } = await getClient()
    .from('action_events')
    .select(`
      actor_id,
      action_type,
      reps:actor_id (id, name)
    `)
    .eq('organization_id', orgId)
    .gte('occurred_at', startOfDay)
    .lt('occurred_at', endOfDay)
    .order('occurred_at', { ascending: false })

  if (error || !data) return []

  // Aggregate by rep
  const byRep = new Map<string, DailySummary>()

  for (const event of data) {
    const repId = event.actor_id || 'system'
    const repName = (event.reps as unknown as { name: string } | null)?.name || 'System'

    if (!byRep.has(repId)) {
      byRep.set(repId, {
        date,
        repId: repId === 'system' ? null : repId,
        repName,
        connectionsSent: 0,
        dmsSent: 0,
        followupsSent: 0,
        repliesSent: 0,
        repliesReceived: 0,
        leadsExtracted: 0,
        upworkProposals: 0,
        opportunities: 0,
        referrals: 0,
        totalActions: 0,
      })
    }

    const summary = byRep.get(repId)!
    summary.totalActions++

    switch (event.action_type) {
      case 'CONNECTION_SENT':
        summary.connectionsSent++
        break
      case 'DM_SENT':
        summary.dmsSent++
        break
      case 'FOLLOWUP_SENT':
        summary.followupsSent++
        break
      case 'REPLY_SENT':
        summary.repliesSent++
        break
      case 'REPLY_RECEIVED':
        summary.repliesReceived++
        break
      case 'LEAD_EXTRACTED':
        summary.leadsExtracted++
        break
      case 'UPWORK_APPLIED':
      case 'UPWORK_PROPOSAL_PREPARED':
        summary.upworkProposals++
        break
      case 'UPWORK_JOB_EXTRACTED':
        summary.leadsExtracted++
        break
      case 'OPPORTUNITY_CREATED':
      case 'CLIENT_WON':
        summary.opportunities++
        break
      case 'LEAD_REFERRED':
        summary.referrals++
        break
      case 'LEAD_ARCHIVED':
        break
    }
  }

  return [...byRep.values()].sort((a, b) => b.totalActions - a.totalActions)
}

/**
 * Get action log for a specific rep on a specific day.
 */
export async function getRepDailyLog(
  orgId: string,
  repId: string,
  date: string,
  limit: number = 100,
  timezone: string = 'UTC',
): Promise<ActionLogEntry[]> {
  const { start: startOfDay, end: endOfDay } = tzDateRange(date, timezone)

  const { data, error } = await getClient()
    .from('action_events')
    .select(`
      id,
      action_type,
      execution_status,
      channel,
      occurred_at,
      metadata,
      reps:actor_id (id, name),
      sender_profiles:sender_profile_id (identity_name),
      leads:lead_id (company, contact_name),
      upwork_jobs:job_id (title)
    `)
    .eq('organization_id', orgId)
    .eq('actor_id', repId)
    .gte('occurred_at', startOfDay)
    .lt('occurred_at', endOfDay)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []

  return data.map(event => ({
    id: event.id,
    actionType: event.action_type,
    executionStatus: event.execution_status,
    channel: event.channel,
    occurredAt: event.occurred_at,
    actorName: (event.reps as unknown as { name: string } | null)?.name || null,
    senderProfileName: (event.sender_profiles as unknown as { identity_name: string } | null)?.identity_name || null,
    leadCompany: (event.leads as unknown as { company: string } | null)?.company || null,
    leadName: (event.leads as unknown as { contact_name: string } | null)?.contact_name || null,
    jobTitle: (event.upwork_jobs as unknown as { title: string } | null)?.title || null,
    metadata: (event.metadata as Record<string, unknown>) || {},
  }))
}

/**
 * Get today's action counts for dashboard header.
 */
export async function getTodayCounts(orgId: string): Promise<Record<string, number>> {
  const today = new Date().toISOString().split('T')[0]
  const summary = await getDailySummary(orgId, today)

  const totals: Record<string, number> = {
    connectionsSent: 0,
    dmsSent: 0,
    followupsSent: 0,
    repliesSent: 0,
    repliesReceived: 0,
    leadsExtracted: 0,
    upworkProposals: 0,
    opportunities: 0,
  }

  for (const rep of summary) {
    totals.connectionsSent += rep.connectionsSent
    totals.dmsSent += rep.dmsSent
    totals.followupsSent += rep.followupsSent
    totals.repliesSent += rep.repliesSent
    totals.repliesReceived += rep.repliesReceived
    totals.leadsExtracted += rep.leadsExtracted
    totals.upworkProposals += rep.upworkProposals
    totals.opportunities += rep.opportunities
  }

  return totals
}

/**
 * Get pending actions for a rep (leads assigned but no outbound sent today).
 */
export async function getPendingForRep(orgId: string, repId: string): Promise<number> {
  const { count, error } = await getClient()
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('owner_rep_id', repId)
    .in('status', ['new', 'contacted', 'followed_up'])

  if (error) return 0
  return count || 0
}

/**
 * Compute UTC timestamps for a local-date boundary in a given timezone.
 * Ensures "2026-10-08" means the business's full day, not UTC's day.
 */
function tzDateRange(date: string, timezone: string): { start: string; end: string } {
  if (timezone === 'UTC') {
    return { start: `${date}T00:00:00.000Z`, end: `${date}T23:59:59.999Z` }
  }
  try {
    const startLocal = new Date(`${date}T00:00:00`)
    const endLocal = new Date(`${date}T23:59:59.999`)

    const startUtc = new Date(startLocal.toLocaleString('en-US', { timeZone: timezone })).toISOString()
    const endUtc = new Date(endLocal.toLocaleString('en-US', { timeZone: timezone })).toISOString()

    if (startUtc.split('T')[0] !== date) {
      const offsetMs = new Date(endUtc.split('T')[0]).getTime() - new Date(date).getTime()
      return {
        start: new Date(startLocal.getTime() - offsetMs).toISOString(),
        end: new Date(endLocal.getTime() - offsetMs).toISOString(),
      }
    }
    return { start: startUtc, end: endUtc }
  } catch {
    return { start: `${date}T00:00:00.000Z`, end: `${date}T23:59:59.999Z` }
  }
}
