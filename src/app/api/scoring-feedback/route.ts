/**
 * Scoring feedback (Phase 31).
 *
 * POST /api/scoring-feedback
 *   { leadId? | capturedProspectId?, decisionRunId?, feedbackType, note?, observed?, expected? }
 * GET  /api/scoring-feedback?leadId=…      (own org; admins see everything)
 *
 * Feedback is stored with the versions in effect. It never changes a score.
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { currentVersions } from '@/lib/intelligence-v3/versions'
import { ROUTING_VERSION } from '@/lib/relay/sender-routing-engine'
import { captureFeedback } from '@/lib/dataset/service'

export const dynamic = 'force-dynamic'

const FEEDBACK_TYPES = new Set([
  'SCORE_TOO_HIGH', 'SCORE_TOO_LOW', 'WRONG_INTENT', 'WRONG_SENDER', 'WRONG_INDUSTRY', 'WRONG_ACTION', 'WRONG_COMPANY', 'WRONG_TIMING', 'CORRECT',
])

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const feedbackType = typeof body.feedbackType === 'string' ? body.feedbackType : ''
  if (!FEEDBACK_TYPES.has(feedbackType)) {
    return NextResponse.json({ error: `feedbackType must be one of ${[...FEEDBACK_TYPES].join(', ')}` }, { status: 400 })
  }
  const leadId = typeof body.leadId === 'string' ? body.leadId : null
  const capturedProspectId = typeof body.capturedProspectId === 'string' ? body.capturedProspectId : null
  const decisionRunId = typeof body.decisionRunId === 'string' ? body.decisionRunId : null
  if (!leadId && !capturedProspectId && !decisionRunId) {
    return NextResponse.json({ error: 'leadId, capturedProspectId or decisionRunId is required.' }, { status: 400 })
  }

  const client = createServiceSupabase()
  const observedVersions = (body.observed as { versions?: Record<string, unknown> } | undefined)?.versions
  const { data, error } = await client
    .from('scoring_feedback')
    .insert({
      organization_id: auth.orgId,
      rep_id: auth.repId,
      lead_id: leadId,
      captured_prospect_id: capturedProspectId,
      decision_run_id: decisionRunId,
      feedback_type: feedbackType,
      note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null,
      observed: body.observed && typeof body.observed === 'object' ? body.observed : {},
      expected: body.expected && typeof body.expected === 'object' ? body.expected : null,
      versions: observedVersions ?? currentVersions({ routingVersion: ROUTING_VERSION, modelVersion: 'n/a' }),
    })
    .select('id, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Dataset: attach feedback to the latest sample for this lead/job/run.
  try {
    const sampleId = await findLatestSample(client, auth.orgId, leadId, capturedProspectId, decisionRunId)
    if (sampleId) {
      await captureFeedback(client, sampleId, {
        feedbackType,
        note: typeof body.note === 'string' ? body.note : undefined,
        observed: (body.observed && typeof body.observed === 'object' ? body.observed : undefined) as Record<string, unknown> | undefined,
        expected: (body.expected && typeof body.expected === 'object' ? body.expected : undefined) as Record<string, unknown> | undefined,
        timestamp: data.created_at,
      }, auth.repId)
    }
  } catch { /* best-effort, never breaks feedback */ }

  return NextResponse.json({ ok: true, id: data.id, createdAt: data.created_at }, { status: 201 })
}

/** Find the most recent sample linked to this lead/prospect/run. */
async function findLatestSample(
  client: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  leadId: string | null,
  capturedProspectId: string | null,
  decisionRunId: string | null,
): Promise<string | null> {
  const query = client.from('intelligence_samples').select('id').eq('organization_id', orgId)
  if (leadId) query.eq('lead_id', leadId)
  else if (capturedProspectId) query.eq('lead_id', capturedProspectId)
  else if (decisionRunId) query.eq('decision_run_id', decisionRunId)
  else return null
  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data?.id ?? null
}

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const leadId = url.searchParams.get('leadId')
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? '50') || 50)

  const client = createServiceSupabase()
  let query = client
    .from('scoring_feedback')
    .select('id, lead_id, captured_prospect_id, decision_run_id, feedback_type, note, observed, expected, versions, created_at, rep_id')
    .eq('organization_id', auth.orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (leadId) query = query.eq('lead_id', leadId)
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) query = query.eq('rep_id', auth.repId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feedback: data ?? [] })
}
