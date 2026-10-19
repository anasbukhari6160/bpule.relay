import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { can } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'

export const maxDuration = 30

/**
 * GET /api/admin/integrity/action-ledger
 * Audit Action Ledger integrity.
 * Returns duplicates, orphans, invalid references, and distribution.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(ctx, 'VIEW_TEAM_ANALYTICS')) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const supabase = createServiceSupabase()

  // 1. Duplicate events (same idempotency key)
  const { data } = await supabase
    .from('action_events')
    .select('idempotency_key')
    .eq('organization_id', ctx.orgId)
    .not('idempotency_key', 'is', null)

  const duplicateEvents: Array<{ idempotency_key: string; count: number }> = []
  if (data) {
    const counts = new Map<string, number>()
    for (const row of data) {
      const key = row.idempotency_key as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    duplicateEvents.push(...[...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ idempotency_key: key, count })))
  }

  // 2. Invalid lead references
  const { data: orphanedEvents } = await supabase
    .from('action_events')
    .select('id, lead_id, action_type')
    .eq('organization_id', ctx.orgId)
    .not('lead_id', 'is', null)
    .filter('lead_id', 'not.in', `(select id from leads where organization_id = '${ctx.orgId}')`)
    .limit(50)

  // 3. Invalid rep references
  const { data: invalidRepRefs } = await supabase
    .from('action_events')
    .select('id, actor_id, action_type')
    .eq('organization_id', ctx.orgId)
    .filter('actor_id', 'not.in', `(select id from reps where organization_id = '${ctx.orgId}')`)
    .limit(50)

  // 4. Event type distribution
  const { data: typeDistribution } = await supabase
    .from('action_events')
    .select('action_type')
    .eq('organization_id', ctx.orgId)

  const distribution: Record<string, number> = {}
  if (typeDistribution) {
    for (const event of typeDistribution) {
      const type = event.action_type as string
      distribution[type] = (distribution[type] ?? 0) + 1
    }
  }

  // 5. Events without canonical action type (potential gaps)
  const canonicalTypes = [
    'LEAD_EXTRACTED', 'CONNECTION_PREPARED', 'CONNECTION_SENT', 'DM_PREPARED',
    'DM_SENT', 'FOLLOWUP_SENT', 'REPLY_RECEIVED', 'REPLY_SENT', 'LEAD_REFERRED',
    'PROFILE_RECOMMENDED', 'UPWORK_JOB_EXTRACTED', 'UPWORK_PROPOSAL_PREPARED',
    'UPWORK_APPLIED', 'OPPORTUNITY_CREATED', 'CLIENT_WON', 'LEAD_ARCHIVED',
    'RECOMMENDATION_SHOWN', 'RECOMMENDATION_ACTED',
  ]
  const nonCanonical = Object.keys(distribution).filter(t => !canonicalTypes.includes(t))

  return NextResponse.json({
    duplicateEvents,
    orphanedEvents: orphanedEvents ?? [],
    invalidRepRefs: invalidRepRefs ?? [],
    eventTypeDistribution: distribution,
    nonCanonicalTypes: nonCanonical,
    totalEvents: typeDistribution?.length ?? 0,
  })
}
