/**
 * GET /api/dataset/samples
 *
 * List intelligence samples with filters for the dataset page.
 * Query params: platform, qualification, outcome, label_status,
 *   needs_review, training_eligible, low_confidence, limit, offset
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { countSamples, querySamples } from '@/lib/dataset/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  // Samples carry raw pasted sources and message text: admin surface only.
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) {
    return NextResponse.json({ error: 'Admin or owner access required.' }, { status: 403 })
  }

  const url = new URL(request.url)
  const sp = url.searchParams

  const filter = {
    platform: sp.get('platform') as 'linkedin' | 'upwork' | undefined,
    qualification: sp.get('qualification') ?? undefined,
    outcome: sp.get('outcome') ?? undefined,
    labelStatus: (sp.get('label_status') as never) ?? undefined,
    needsReview: sp.get('needs_review') === 'true' || undefined,
    trainingEligible: sp.get('training_eligible') === 'true' || undefined,
    trainingApproved: sp.get('training_approved') === 'true' || undefined,
    lowConfidence: sp.get('low_confidence') === 'true' || undefined,
    limit: Math.min(Number(sp.get('limit') ?? 50), 200),
    offset: Number(sp.get('offset') ?? 0) || 0,
  }

  const client = createServiceSupabase()

  const [samples, total] = await Promise.all([
    querySamples(client, auth.orgId, filter),
    countSamples(client, auth.orgId, filter),
  ])

  return NextResponse.json({ samples, total, limit: filter.limit, offset: filter.offset })
}
