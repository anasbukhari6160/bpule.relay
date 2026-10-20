/**
 * Admin Scoring QA Center API (Phases 29, 30, 43).
 *
 * GET /api/admin/scoring-qa?days=14&lowConfidence=1&seller=1&rep=<id>…
 *   → { rows, monitor, feedback }
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { applyQaFilters, buildScoringMonitor, loadRecentDecisions, type QaFilters } from '@/lib/admin/scoring-qa'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? '14') || 14))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const flag = (k: string) => url.searchParams.get(k) === '1' || url.searchParams.get(k) === 'true'
  const filters: QaFilters = {
    lowConfidence: flag('lowConfidence'),
    contradiction: flag('contradiction'),
    seller: flag('seller'),
    buyer: flag('buyer'),
    recruiter: flag('recruiter'),
    candidate: flag('candidate'),
    highScore: flag('highScore'),
    lowScore: flag('lowScore'),
    routingMismatch: flag('routingMismatch'),
    fallback: flag('fallback'),
    stale: flag('stale'),
    repId: url.searchParams.get('rep'),
    since: url.searchParams.get('since'),
  }

  const client = createServiceSupabase()
  const rows = await loadRecentDecisions(client, auth.orgId, { since })
  const { data: feedback } = await client
    .from('scoring_feedback')
    .select('feedback_type, lead_id, captured_prospect_id, decision_run_id, created_at')
    .eq('organization_id', auth.orgId)
    .gte('created_at', since)
    .limit(1000)

  const monitor = buildScoringMonitor(rows, (feedback ?? []) as Array<{ feedback_type: string }>, since)
  const filtered = applyQaFilters(rows, filters)

  return NextResponse.json({
    since,
    total: rows.length,
    rows: filtered.slice(0, 200).map((r) => ({ ...r, rejectedSignals: r.rejectedSignals.slice(0, 12) })),
    monitor,
    feedback: feedback ?? [],
  })
}
