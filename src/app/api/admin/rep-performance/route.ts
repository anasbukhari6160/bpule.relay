/**
 * Rep Performance API — metrics, coaching insights, and daily brief.
 *
 * GET /api/admin/rep-performance?repId=...  → single rep metrics + coaching
 * GET /api/admin/daily-brief?date=...        → admin daily brief
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'
import {
  computeRepPerformance,
  generateCoachingInsights,
  generateDailyBrief,
} from '@/lib/relay/rep-performance'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  // Browser-triggered: resolve the signed-in rep from the request session, not
  // a service-role client (QA RQA-016).
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const store = createServiceSupabase()
  const url = new URL(req.url)
  const repId = url.searchParams.get('repId')
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  // Daily brief
  if (url.searchParams.has('brief')) {
    const [leads, messages, events, reps] = await Promise.all([
      store.from('leads').select('*').eq('organization_id', auth.orgId).eq('archived', false).limit(500),
      store.from('messages').select('*').eq('organization_id', auth.orgId).limit(1000),
      store.from('action_events').select('*').eq('organization_id', auth.orgId).gte('occurred_at', date + 'T00:00:00').limit(500),
      store.from('reps').select('*').eq('organization_id', auth.orgId),
    ])

    const brief = generateDailyBrief({
      date,
      leads: leads.data ?? [],
      messages: messages.data ?? [],
      actionEvents: events.data ?? [],
      reps: reps.data ?? [],
    })

    return NextResponse.json(brief)
  }

  // Single rep performance
  const targetRepId = repId ?? auth.repId
  const { data: targetRep } = await store
    .from('reps')
    .select('*')
    .eq('id', targetRepId)
    .eq('organization_id', auth.orgId)
    .single()

  if (!targetRep) return NextResponse.json({ error: 'Rep not found.' }, { status: 404 })

  const [leads, messages, events] = await Promise.all([
    store.from('leads').select('*').eq('organization_id', auth.orgId).eq('archived', false).limit(500),
    store.from('messages').select('*').eq('organization_id', auth.orgId).limit(1000),
    store.from('action_events').select('*').eq('organization_id', auth.orgId).limit(500),
  ])

  const metrics = computeRepPerformance(
    targetRep,
    leads.data ?? [],
    messages.data ?? [],
    events.data ?? [],
  )
  const coaching = generateCoachingInsights(metrics)

  return NextResponse.json({ metrics, coaching })
}
