/**
 * Weighted Action Performance API
 *
 * GET /api/admin/performance?repId=...&date=...
 * Returns execution health, funnel warnings, SLA, outcomes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import {
  computeExecutionResult,
  mapActionEventToCanonical,
  DEFAULT_CONFIG,
  type CanonicalAction,
  type ActionTarget,
  type EligibleWork,
  type SLAItem,
} from '@/lib/performance/execution-score'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const store = createServiceSupabase()
  const { data: auth } = await store.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: rep } = await store
    .from('reps')
    .select('id, organization_id, role')
    .eq('user_id', auth.user.id)
    .single()

  if (!rep) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })

  const url = new URL(req.url)
  const repId = url.searchParams.get('repId') ?? rep.id
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const timezone = url.searchParams.get('timezone') ?? 'UTC'

  // 1. Get org performance config
  const { data: rulebook } = await store
    .from('organization_rulebooks')
    .select('performance_weights, sla_config')
    .eq('organization_id', rep.organization_id)
    .single()

  const config = {
    weights: (rulebook?.performance_weights as Record<string, number>) ?? DEFAULT_CONFIG.weights,
    capRatio: (rulebook?.sla_config as any)?.capRatio ?? DEFAULT_CONFIG.capRatio,
    funnelBalanceThreshold: (rulebook?.sla_config as any)?.funnelBalanceThreshold ?? DEFAULT_CONFIG.funnelBalanceThreshold,
    slaThresholdsMs: {
      replyUrgent: (rulebook?.sla_config as any)?.replyUrgentMs ?? DEFAULT_CONFIG.slaThresholdsMs.replyUrgent,
      replyOverdue: (rulebook?.sla_config as any)?.replyOverdueMs ?? DEFAULT_CONFIG.slaThresholdsMs.replyOverdue,
      followupOverdue: (rulebook?.sla_config as any)?.followupOverdueMs ?? DEFAULT_CONFIG.slaThresholdsMs.followupOverdue,
      connectionDmWaiting: (rulebook?.sla_config as any)?.connectionDmWaitingMs ?? DEFAULT_CONFIG.slaThresholdsMs.connectionDmWaiting,
    },
  }

  // 2. Get rep name
  const { data: targetRep } = await store
    .from('reps')
    .select('id, name')
    .eq('id', repId)
    .single()

  if (!targetRep) return NextResponse.json({ error: 'Rep not found.' }, { status: 404 })

  // 3. Get action_events for today
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`

  const { data: actionEvents } = await store
    .from('action_events')
    .select('action_type, lead_id, occurred_at, metadata')
    .eq('organization_id', rep.organization_id)
    .eq('actor_id', repId)
    .gte('occurred_at', dayStart)
    .lt('occurred_at', dayEnd)

  // 4. Get daily targets
  const { data: dailyTargets } = await store
    .from('daily_targets')
    .select('activity_type, target_count')
    .eq('organization_id', rep.organization_id)
    .eq('rep_id', repId)
    .eq('active', true)

  // 5. Count actuals from action_events
  const counts: Record<string, number> = {}
  for (const event of actionEvents ?? []) {
    const canonical = mapActionEventToCanonical(event.action_type)
    if (canonical) {
      counts[canonical] = (counts[canonical] ?? 0) + 1
    }
  }

  // 6. Build targets array
  const canonicalMap: Record<string, CanonicalAction> = {
    connection_request: 'CONNECTION_SENT',
    dm: 'FIRST_DM_SENT',
    followup: 'FOLLOWUP_SENT',
    email: 'FIRST_DM_SENT',
    application: 'UPWORK_APPLIED',
  }

  const targets: ActionTarget[] = (dailyTargets ?? []).map((t) => {
    const canonical = canonicalMap[t.activity_type] ?? null
    if (!canonical) return null
    return {
      action: canonical,
      target: t.target_count,
      actual: counts[canonical] ?? 0,
      eligibleTarget: t.target_count,
    }
  }).filter((t): t is ActionTarget => t !== null)

  // Add any canonical actions that have actuals but no targets
  for (const [key, count] of Object.entries(counts)) {
    if (!targets.find((t) => t.action === key)) {
      targets.push({ action: key as CanonicalAction, target: 0, actual: count, eligibleTarget: 0 })
    }
  }

  // 7. Compute eligible work from leads
  const { data: leads } = await store
    .from('leads')
    .select('id, status, connection_accepted_at, created_at')
    .eq('organization_id', rep.organization_id)
    .eq('owner_rep_id', repId)
    .eq('archived', false)

  const now = Date.now()
  let connectionsWaitingForDm = 0
  let leadsReadyForFollowup = 0
  let connectionsAccepted = 0
  let inboundRepliesWaiting = 0

  for (const lead of leads ?? []) {
    if (lead.connection_accepted_at) {
      connectionsAccepted++
      const acceptedMs = now - new Date(lead.connection_accepted_at).getTime()
      if (acceptedMs > (config.slaThresholdsMs.connectionDmWaiting / 2)) {
        connectionsWaitingForDm++
      }
    }
    if (lead.status === 'contacted' || lead.status === 'followed_up') {
      leadsReadyForFollowup++
    }
    if (lead.status === 'replied') {
      inboundRepliesWaiting++
    }
  }

  const eligible: EligibleWork = {
    connectionsAccepted,
    dmsSent: counts['FIRST_DM_SENT'] ?? 0,
    followupsSent: counts['FOLLOWUP_SENT'] ?? 0,
    repliesReceived: counts['REPLY_SENT'] ?? 0,
    meetingsBooked: 0,
    inboundRepliesWaiting,
    connectionsWaitingForDm,
    leadsReadyForFollowup,
  }

  // 8. Compute SLA items — single query for pending replies
  const repliedLeadIds = (leads ?? []).filter((l) => l.status === 'replied').map((l) => l.id)
  const pending: SLAItem[] = []

  if (repliedLeadIds.length > 0) {
    const { data: pendingMessages } = await store
      .from('messages')
      .select('lead_id, created_at, direction')
      .eq('organization_id', rep.organization_id)
      .in('lead_id', repliedLeadIds)
      .order('created_at', { ascending: false })
      .limit(200)

    // Get most recent inbound per lead
    const lastInboundByLead = new Map<string, string>()
    for (const msg of pendingMessages ?? []) {
      if (msg.direction === 'inbound' && !lastInboundByLead.has(msg.lead_id)) {
        lastInboundByLead.set(msg.lead_id, msg.created_at)
      }
    }
    for (const [, createdAt] of lastInboundByLead) {
      pending.push({ replyWaitMs: now - new Date(createdAt).getTime() })
    }
  }

  // 9. Outcome data (simplified — would need more queries for full accuracy)
  const outcomeData = {
    connectionsSent: counts['CONNECTION_SENT'] ?? 0,
    connectionsAccepted,
    dmsSent: counts['FIRST_DM_SENT'] ?? 0,
    dmReplies: inboundRepliesWaiting,
    followupsSent: counts['FOLLOWUP_SENT'] ?? 0,
    followupReplies: 0,
    meetingsBooked: 0,
    leadsContacted: leads?.filter((l) => l.status !== 'new').length ?? 0,
    wins: leads?.filter((l) => l.status === 'won').length ?? 0,
  }

  // 10. Compute result
  const result = computeExecutionResult({
    repId,
    repName: targetRep.name,
    date,
    targets,
    eligible,
    pending,
    outcomeData,
    config: {
      weights: config.weights as any,
      capRatio: config.capRatio,
      funnelBalanceThreshold: config.funnelBalanceThreshold,
      slaThresholdsMs: config.slaThresholdsMs as any,
    },
  })

  return NextResponse.json(result)
}
