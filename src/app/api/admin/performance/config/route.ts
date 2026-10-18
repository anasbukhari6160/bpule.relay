/**
 * Performance Config API — GET/POST weights and SLA thresholds.
 *
 * GET  → returns current org config
 * POST → updates org config
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'

export const maxDuration = 15

export async function GET() {
  const store = createServiceSupabase()
  const { data: auth } = await store.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: rep } = await store
    .from('reps')
    .select('organization_id, role')
    .eq('user_id', auth.user.id)
    .single()

  if (!rep || !['owner', 'admin'].includes(rep.role)) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  }

  const { data: rulebook } = await store
    .from('organization_rulebooks')
    .select('performance_weights, sla_config')
    .eq('organization_id', rep.organization_id)
    .single()

  const sla = (rulebook?.sla_config as any) ?? {}
  const weights = rulebook?.performance_weights ?? {}

  return NextResponse.json({
    weights,
    replyUrgentHours: Math.round((sla.replyUrgentMs ?? 7200000) / 3600000),
    followupOverdueHours: Math.round((sla.followupOverdueMs ?? 86400000) / 3600000),
    capRatio: sla.capRatio ?? 1.25,
  })
}

export async function POST(req: NextRequest) {
  const store = createServiceSupabase()
  const { data: auth } = await store.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: rep } = await store
    .from('reps')
    .select('organization_id, role')
    .eq('user_id', auth.user.id)
    .single()

  if (!rep || !['owner', 'admin'].includes(rep.role)) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const weights = body.weights ?? {}
  const sla = body.sla ?? {}

  const slaConfig = {
    replyUrgentMs: (sla.replyUrgentHours ?? 2) * 3600000,
    replyOverdueMs: ((sla.replyUrgentHours ?? 2) * 2) * 3600000,
    followupOverdueMs: (sla.followupOverdueHours ?? 24) * 3600000,
    connectionDmWaitingMs: 43200000,
    capRatio: sla.capRatio ?? 1.25,
    funnelBalanceThreshold: 0.4,
  }

  const { error } = await store
    .from('organization_rulebooks')
    .update({
      performance_weights: weights,
      sla_config: slaConfig,
    })
    .eq('organization_id', rep.organization_id)

  if (error) return NextResponse.json({ error: 'Save failed.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
