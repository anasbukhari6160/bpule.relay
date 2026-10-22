/**
 * Pairwise ranking labels (Phase F).
 *
 * POST /api/admin/training-data/pairwise  { opportunityKeyA, opportunityKeyB, winner: 'A'|'B'|'TIE', reason? }
 *
 * A reviewer looks at two opportunities and says which BD should work first.
 * Pairwise preferences are far easier for a human than an exact score and are
 * the supervision a learning-to-rank model trains on directly. Append-only,
 * versioned, attributed, never read by production scoring.
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { LABEL_VERSION, validatePairwiseLabel } from '@/lib/admin/training-data'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  const v = validatePairwiseLabel(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const l = v.label

  const client = createServiceSupabase()
  const { data, error } = await client
    .from('scoring_pairwise_labels')
    .insert({
      organization_id: auth.orgId,
      opportunity_key_a: l.opportunityKeyA,
      opportunity_key_b: l.opportunityKeyB,
      winner: l.winner,
      labeler_rep_id: auth.repId,
      label_version: LABEL_VERSION,
      reason: l.reason ?? null,
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
  const client = createServiceSupabase()
  const { data, error } = await client.from('scoring_pairwise_labels').select('*').eq('organization_id', auth.orgId).order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ labels: data ?? [] })
}
