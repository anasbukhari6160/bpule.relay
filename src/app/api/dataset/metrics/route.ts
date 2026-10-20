/**
 * GET /api/dataset/metrics
 *
 * Aggregated dataset stats for the admin dataset page.
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { computeDatasetMetrics } from '@/lib/dataset/metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) {
    return NextResponse.json({ error: 'Admin or owner access required.' }, { status: 403 })
  }

  const client = createServiceSupabase()
  const metrics = await computeDatasetMetrics(client, auth.orgId)

  return NextResponse.json(metrics)
}
