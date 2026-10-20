/**
 * Production scoring monitor (Phase 43).
 *
 * GET /api/admin/scoring-monitor?days=7
 *   → distributions, UNKNOWN / contradiction / fallback / routing-mismatch
 *     rates, feedback counts and alert flags for the org, under the stored
 *     versions. No AI calls; nothing is rescored.
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { buildScoringMonitor, loadRecentDecisions } from '@/lib/admin/scoring-qa'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? '7') || 7))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const client = createServiceSupabase()
  const rows = await loadRecentDecisions(client, auth.orgId, { since, limit: 500 })
  const { data: feedback } = await client
    .from('scoring_feedback')
    .select('feedback_type')
    .eq('organization_id', auth.orgId)
    .gte('created_at', since)
    .limit(2000)

  const monitor = buildScoringMonitor(rows, (feedback ?? []) as Array<{ feedback_type: string }>, since)
  return NextResponse.json({ monitor, status: monitor.alerts.some((a) => a.level === 'critical') ? 'critical' : monitor.alerts.length ? 'warn' : 'ok' })
}
