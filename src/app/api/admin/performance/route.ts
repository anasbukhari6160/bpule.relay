/**
 * Weighted Action Performance API
 *
 * GET /api/admin/performance?repId=...&date=...&timezone=...
 * Returns execution health, funnel warnings, SLA, outcomes.
 *
 * Uses org-local timezone for "today" boundaries.
 * Eligibility falls back to action ledger if lifecycle column is missing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'
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

/**
 * Compute UTC start/end for a local date in a given timezone.
 * Uses Intl.DateTimeFormat for correct DST handling.
 */
function localDateToUtcRange(date: string, timezone: string): { start: string; end: string } {
  if (timezone === 'UTC' || !timezone) {
    return { start: `${date}T00:00:00.000Z`, end: `${date}T23:59:59.999Z` }
  }
  try {
    // Create a date at midnight local time, then convert to UTC
    const localMidnight = new Date(`${date}T00:00:00`)
    const utcMidnight = new Date(
      localMidnight.toLocaleString('en-US', { timeZone: timezone })
    )
    // Adjust: if local midnight in UTC is different, shift
    const offset = localMidnight.getTime() - utcMidnight.getTime()
    const startUtc = new Date(localMidnight.getTime() - offset)
    const endUtc = new Date(startUtc.getTime() + 86400000 - 1)
    return { start: startUtc.toISOString(), end: endUtc.toISOString() }
  } catch {
    return { start: `${date}T00:00:00.000Z`, end: `${date}T23:59:59.999Z` }
  }
}

export async function GET(req: NextRequest) {
  // Browser-triggered: resolve the signed-in rep from the request session, not
  // a service-role client (QA RQA-016).
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const store = createServiceSupabase()
  const url = new URL(req.url)
  const repId = url.searchParams.get('repId') ?? auth.repId
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  // 1. Get org timezone and performance config
  const [{ data: org }, { data: rulebook }] = await Promise.all([
    store.from('organizations').select('timezone').eq('id', auth.orgId).single(),
    store.from('organization_rulebooks').select('performance_weights, sla_config').eq('organization_id', auth.orgId).single(),
  ])

  const timezone = org?.timezone ?? 'UTC'

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

  // 3. Compute local-day UTC range
  const { start: dayStart, end: dayEnd } = localDateToUtcRange(date, timezone)

  // 4. Get action_events for the local day
  const { data: actionEvents } = await store
    .from('action_events')
    .select('action_type, lead_id, occurred_at, metadata')
    .eq('organization_id', auth.orgId)
    .eq('actor_id', repId)
    .gte('occurred_at', dayStart)
    .lt('occurred_at', dayEnd)

  // 5. Get daily targets
  const { data: dailyTargets } = await store
    .from('daily_targets')
    .select('activity_type, target_count')
    .eq('organization_id', auth.orgId)
    .eq('rep_id', repId)
    .eq('active', true)

  // 6. Count actuals from canonical action_events only
  const counts: Record<string, number> = {}
  for (const event of actionEvents ?? []) {
    const canonical = mapActionEventToCanonical(event.action_type)
    if (canonical) {
      counts[canonical] = (counts[canonical] ?? 0) + 1
    }
  }

  // 7. Build targets array
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

  // Add canonical actions with actuals but no configured targets
  for (const [key, count] of Object.entries(counts)) {
    if (!targets.find((t) => t.action === key)) {
      targets.push({ action: key as CanonicalAction, target: 0, actual: count, eligibleTarget: 0 })
    }
  }

  // 8. Compute eligible work — lifecycle + action ledger fallback
  const { data: leads } = await store
    .from('leads')
    .select('id, status, connection_accepted_at')
    .eq('organization_id', auth.orgId)
    .eq('owner_rep_id', repId)
    .eq('archived', false)

  // Fallback: if connection_accepted_at is null, check action_events for CONNECTION_SENT
  const acceptedLeadIds = new Set<string>()
  for (const lead of leads ?? []) {
    if (lead.connection_accepted_at) {
      acceptedLeadIds.add(lead.id)
    }
  }

  // For leads without connection_accepted_at, check if action ledger shows CONNECTION_SENT
  const leadsWithoutAccept = (leads ?? []).filter((l) => !l.connection_accepted_at).map((l) => l.id)
  if (leadsWithoutAccept.length > 0) {
    const { data: connectionActions } = await store
      .from('action_events')
      .select('lead_id, action_type')
      .eq('organization_id', auth.orgId)
      .eq('actor_id', repId)
      .in('lead_id', leadsWithoutAccept)
      .eq('action_type', 'CONNECTION_SENT')
      .limit(200)

    for (const event of connectionActions ?? []) {
      if (event.lead_id) {
        acceptedLeadIds.add(event.lead_id)
      }
    }
  }

  const now = Date.now()
  let connectionsWaitingForDm = 0
  let leadsReadyForFollowup = 0
  let inboundRepliesWaiting = 0

  for (const lead of leads ?? []) {
    const isAccepted = acceptedLeadIds.has(lead.id)
    if (isAccepted) {
      const acceptedAt = lead.connection_accepted_at
        ? new Date(lead.connection_accepted_at).getTime()
        : null
      const waitingMs = acceptedAt ? now - acceptedAt : 0
      if (!acceptedAt || waitingMs > (config.slaThresholdsMs.connectionDmWaiting / 2)) {
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
    connectionsAccepted: acceptedLeadIds.size,
    dmsSent: counts['FIRST_DM_SENT'] ?? 0,
    followupsSent: counts['FOLLOWUP_SENT'] ?? 0,
    repliesReceived: counts['REPLY_SENT'] ?? 0,
    meetingsBooked: 0,
    inboundRepliesWaiting,
    connectionsWaitingForDm,
    leadsReadyForFollowup,
  }

  // 9. SLA items
  const repliedLeadIds = (leads ?? []).filter((l) => l.status === 'replied').map((l) => l.id)
  const pending: SLAItem[] = []

  if (repliedLeadIds.length > 0) {
    const { data: pendingMessages } = await store
      .from('messages')
      .select('lead_id, created_at, direction')
      .eq('organization_id', auth.orgId)
      .in('lead_id', repliedLeadIds)
      .order('created_at', { ascending: false })
      .limit(200)

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

  // 10. Outcomes
  const outcomeData = {
    connectionsSent: counts['CONNECTION_SENT'] ?? 0,
    connectionsAccepted: acceptedLeadIds.size,
    dmsSent: counts['FIRST_DM_SENT'] ?? 0,
    dmReplies: inboundRepliesWaiting,
    followupsSent: counts['FOLLOWUP_SENT'] ?? 0,
    followupReplies: 0,
    meetingsBooked: 0,
    leadsContacted: leads?.filter((l) => l.status !== 'new').length ?? 0,
    wins: leads?.filter((l) => l.status === 'won').length ?? 0,
  }

  // 11. Compute result
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
