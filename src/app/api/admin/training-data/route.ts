/**
 * Admin training-data API (Phases 4, 23, 34).
 *
 * GET  /api/admin/training-data?days=90&limit=400&unlabelled=1&disagree=1&outcome=1
 *   → { rows, summary, ranges, enums, engines }
 *
 * One row per unique opportunity with production vs candidate decisions,
 * evidence, messages, outcomes, feedback, labels and the review priority.
 * Admin, owner or manager only. Nothing here changes a score.
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { loadTrainingQueue, LABEL_ENUMS, LABEL_SCORE_RANGES } from '@/lib/admin/training-data'
import { ENGINE_IDS, productionEngineId, shadowEngineIds } from '@/lib/scoring-v4/engines/registry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? '90') || 90))
  const limit = Math.min(1000, Math.max(20, Number(url.searchParams.get('limit') ?? '400') || 400))
  const flag = (k: string) => url.searchParams.get(k) === '1' || url.searchParams.get(k) === 'true'
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const client = createServiceSupabase()
  const { rows, summary } = await loadTrainingQueue(client, auth.orgId, { since, limit })
  let filtered = rows
  if (flag('unlabelled')) filtered = filtered.filter((r) => r.labels.length === 0)
  if (flag('labelled')) filtered = filtered.filter((r) => r.labels.length > 0)
  if (flag('disagree')) filtered = filtered.filter((r) => r.priority.reasons.includes('engines disagree'))
  if (flag('outcome')) filtered = filtered.filter((r) => r.outcome.replied || r.outcome.meeting || r.outcome.won || r.outcome.lost)
  if (flag('feedback')) filtered = filtered.filter((r) => r.feedback.length > 0)
  if (flag('lowConfidence')) filtered = filtered.filter((r) => r.production.confidence === 'LOW')
  if (flag('highValue')) filtered = filtered.filter((r) => r.production.qualification === 'STRONG' || r.production.qualification === 'WORTH_PURSUING')
  const rep = url.searchParams.get('rep')
  if (rep) filtered = filtered.filter((r) => r.repId === rep)

  return NextResponse.json({
    since,
    summary,
    rows: filtered.slice(0, 150),
    ranges: LABEL_SCORE_RANGES,
    enums: LABEL_ENUMS,
    engines: { all: ENGINE_IDS, production: productionEngineId(), shadow: shadowEngineIds() },
  })
}
