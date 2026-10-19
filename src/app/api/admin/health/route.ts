import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { can } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'

export const maxDuration = 30

/**
 * GET /api/admin/health
 * Production health overview.
 * No AI calls — pure DB aggregation.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(ctx, 'VIEW_TEAM_ANALYTICS')) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const supabase = createServiceSupabase()
  const orgId = ctx.orgId

  // AI traces health (last 24h)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: aiTraces } = await supabase
    .from('ai_traces')
    .select('status, feature')
    .eq('organization_id', orgId)
    .gte('created_at', since24h)

  const aiHealth = {
    total: aiTraces?.length ?? 0,
    succeeded: aiTraces?.filter(t => t.status === 'SUCCESS').length ?? 0,
    failed: aiTraces?.filter(t => t.status === 'FAILED').length ?? 0,
    fallback: aiTraces?.filter(t => t.status === 'FALLBACK').length ?? 0,
  }

  // Action Ledger health
  const { data: actionEvents } = await supabase
    .from('action_events')
    .select('action_type')
    .eq('organization_id', orgId)
    .gte('occurred_at', since24h)

  const actionHealth = {
    total: actionEvents?.length ?? 0,
    byType: {} as Record<string, number>,
  }
  for (const e of actionEvents ?? []) {
    const type = e.action_type as string
    actionHealth.byType[type] = (actionHealth.byType[type] ?? 0) + 1
  }

  // Lead state health
  const { data: leads } = await supabase
    .from('leads')
    .select('status')
    .eq('organization_id', orgId)

  const leadHealth = {
    total: leads?.length ?? 0,
    byStatus: {} as Record<string, number>,
    withScore: leads?.filter(l => (l as any).canonical_score != null).length ?? 0,
  }
  for (const l of leads ?? []) {
    const status = l.status as string
    leadHealth.byStatus[status] = (leadHealth.byStatus[status] ?? 0) + 1
  }

  // Rep activity
  const { data: reps } = await supabase
    .from('reps')
    .select('id, name, role')
    .eq('organization_id', orgId)

  const repHealth = {
    total: reps?.length ?? 0,
    activeToday: 0,
  }
  if (reps) {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const { data: activeReps } = await supabase
      .from('action_events')
      .select('actor_id')
      .eq('organization_id', orgId)
      .gte('occurred_at', startOfDay.toISOString())
    const activeIds = new Set((activeReps ?? []).map(e => e.actor_id))
    repHealth.activeToday = [...activeIds].filter(id =>
      reps.some(r => r.id === id)
    ).length
  }

  // Missing migrations check
  const missingMigrations: string[] = []
  // Check for tables referenced in code but potentially missing
  const requiredTables = ['action_events', 'ai_traces', 'leads', 'reps', 'signal_events']
  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select('id').limit(1)
    if (error && error.code === '42P01') missingMigrations.push(table)
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    aiHealth,
    actionHealth,
    leadHealth,
    repHealth,
    missingMigrations,
    healthy: missingMigrations.length === 0 && aiHealth.failed < aiHealth.total * 0.1,
  })
}
