/**
 * Human ground-truth labels (Phase 4).
 *
 * POST /api/admin/training-data/labels   { opportunityKey, leadId?, capturedProspectId?, decisionRunId?,
 *        relationshipRole?, buyerIntent?, commercialPotential?, fit?, authority?, timing?, access?,
 *        expectedRangeId? | expectedScoreMin+expectedScoreMax, expectedAction?, bestSenderProfileId?,
 *        labelerConfidence?, reason?, evidenceLines?, observed? }
 * GET  /api/admin/training-data/labels?opportunityKey=…
 *
 * Labels are append-only, versioned (label_v1), attributed to the labeler,
 * and never change a score.
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { LABEL_VERSION, validateLabel, validateQuickLabel } from '@/lib/admin/training-data'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }

  const mode = body.mode === 'quick' ? 'quick' : 'detailed'
  if (mode === 'quick') {
    const v = validateQuickLabel(body)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const l = v.label
    const client = createServiceSupabase()
    const { data, error } = await client
      .from('scoring_labels')
      .insert({
        organization_id: auth.orgId,
        opportunity_key: l.opportunityKey,
        lead_id: l.leadId ?? null,
        captured_prospect_id: l.capturedProspectId ?? null,
        platform: 'linkedin',
        decision_run_id: l.decisionRunId ?? null,
        labeler_rep_id: auth.repId,
        label_version: LABEL_VERSION,
        observed: l.observed ?? {},
        prospect_quality: l.prospectQuality ?? null,
        likely_opportunity: l.likelyOpportunity ?? null,
        quick_action: l.quickAction ?? null,
        best_sender_profile_id: l.bestSenderProfileId ?? null,
        decision_correct: l.decisionCorrect ?? null,
        reason: l.reason ?? null,
        evidence_lines: [],
      })
      .select('id, created_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id, createdAt: data.created_at, labelVersion: LABEL_VERSION, mode: 'quick' }, { status: 201 })
  }

  const v = validateLabel(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const l = v.label

  const client = createServiceSupabase()
  const { data, error } = await client
    .from('scoring_labels')
    .insert({
      organization_id: auth.orgId,
      opportunity_key: l.opportunityKey,
      lead_id: l.leadId ?? null,
      captured_prospect_id: l.capturedProspectId ?? null,
      platform: 'linkedin',
      decision_run_id: l.decisionRunId ?? null,
      labeler_rep_id: auth.repId,
      label_version: LABEL_VERSION,
      observed: l.observed ?? {},
      relationship_role: l.relationshipRole ?? null,
      buyer_intent: l.buyerIntent ?? null,
      commercial_potential: l.commercialPotential ?? null,
      fit: l.fit ?? null,
      authority: l.authority ?? null,
      timing: l.timing ?? null,
      access: l.access ?? null,
      expected_score_min: l.expectedScoreMin ?? null,
      expected_score_max: l.expectedScoreMax ?? null,
      expected_action: l.expectedAction ?? null,
      best_sender_profile_id: l.bestSenderProfileId ?? null,
      labeler_confidence: l.labelerConfidence ?? null,
      reason: l.reason ?? null,
      evidence_lines: l.evidenceLines ?? [],
    })
    .select('id, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, createdAt: data.created_at, labelVersion: LABEL_VERSION }, { status: 201 })
}

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(request.url)
  const key = url.searchParams.get('opportunityKey')
  const client = createServiceSupabase()
  let q = client.from('scoring_labels').select('*').eq('organization_id', auth.orgId).order('created_at', { ascending: false }).limit(200)
  if (key) q = q.eq('opportunity_key', key)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ labels: data ?? [] })
}
