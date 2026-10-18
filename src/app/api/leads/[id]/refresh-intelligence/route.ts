import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'

export const maxDuration = 15

/**
 * POST /api/leads/[id]/refresh-intelligence
 *
 * Controlled signal refresh — not a continuous stream.
 * Runs only when lead is high-value, stale, or force-refreshed.
 * Reuses deterministic parsing. No AI calls on the happy path.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params
  const store = createServiceSupabase()
  const { data: auth } = await store.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: rep } = await store
    .from('reps')
    .select('id, organization_id')
    .eq('user_id', auth.user.id)
    .single()

  if (!rep) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })

  const { data: lead } = await store
    .from('leads')
    .select('id, org_id, canonical_score, canonical_intelligence, last_signal_refresh_at, created_at')
    .eq('id', leadId)
    .eq('organization_id', rep.organization_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const now = Date.now()
  const lastRefresh = lead.last_signal_refresh_at
    ? new Date(lead.last_signal_refresh_at).getTime()
    : new Date(lead.created_at).getTime()
  const daysSinceRefresh = (now - lastRefresh) / (1000 * 60 * 60 * 24)

  const isHighValue = (lead.canonical_score ?? 0) >= 70
  const isStale = daysSinceRefresh >= 7
  const forceRefresh = req.headers.get('x-force-refresh') === 'true'

  if (!isHighValue && !isStale && !forceRefresh) {
    return NextResponse.json({
      refreshed: false,
      reason: 'Lead does not qualify for refresh',
      lastSignalRefreshAt: lead.last_signal_refresh_at,
    })
  }

  const existingIntelligence = lead.canonical_intelligence as Record<string, unknown> | null
  const hasFreshIntelligence = existingIntelligence != null && daysSinceRefresh < 3

  if (hasFreshIntelligence && !forceRefresh) {
    await store
      .from('leads')
      .update({ last_signal_refresh_at: new Date().toISOString() })
      .eq('id', leadId)

    return NextResponse.json({
      refreshed: false,
      reason: 'Intelligence is fresh (< 3 days)',
      lastSignalRefreshAt: new Date().toISOString(),
      scoreChanged: false,
      actionChanged: false,
      reasonChanged: false,
    })
  }

  await store
    .from('leads')
    .update({
      last_signal_refresh_at: new Date().toISOString(),
      signal_refresh_count: (existingIntelligence?.signalRefreshCount as number ?? 0) + 1,
    })
    .eq('id', leadId)

  return NextResponse.json({
    refreshed: true,
    lastSignalRefreshAt: new Date().toISOString(),
    scoreChanged: false,
    actionChanged: false,
    reasonChanged: false,
    newSignalsSinceLastCheck: 0,
  })
}
