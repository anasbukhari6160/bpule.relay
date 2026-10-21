/**
 * Performance Config API — GET/POST weights and SLA thresholds.
 *
 * GET  → returns current org config
 * POST → updates org config
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'
import { validatePerformanceConfig } from '@/lib/performance/execution-score'

export const maxDuration = 15

export async function GET() {
  // Browser-triggered: resolve the signed-in rep from the request session, not
  // a service-role client (QA RQA-016).
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  }

  const store = createServiceSupabase()
  const { data: rulebook } = await store
    .from('organization_rulebooks')
    .select('performance_weights, sla_config')
    .eq('organization_id', auth.orgId)
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
  // Browser-triggered: resolve the signed-in rep from the request session, not
  // a service-role client (QA RQA-016).
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  }

  const store = createServiceSupabase()
  const body = await req.json().catch(() => ({}))
  const sla = body.sla ?? {}

  // Validate weights — reject invalid, fall back to defaults
  const validation = validatePerformanceConfig({
    weights: body.weights,
    capRatio: sla.capRatio,
  })

  if (!validation.valid && validation.errors.length > 0) {
    return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 })
  }

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
      performance_weights: validation.sanitized,
      sla_config: slaConfig,
    })
    .eq('organization_id', auth.orgId)

  if (error) return NextResponse.json({ error: 'Save failed.' }, { status: 500 })
  return NextResponse.json({ ok: true, warnings: validation.errors })
}
