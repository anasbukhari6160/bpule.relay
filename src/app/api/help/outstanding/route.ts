/**
 * Outstanding Help Requests API
 *
 * GET /api/help/outstanding — list pending help requests for the current rep
 * Query: ?repId=xxx (admin override) — defaults to current rep
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { getAuthContext } from '@/lib/auth/organization'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const repId = searchParams.get('repId') ?? authCtx.repId

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  const { data, error } = await client
    .from('help_requests')
    .select('*')
    .eq('org_id', authCtx.orgId)
    .eq('to_rep_id', repId)
    .eq('status', 'HELP_REQUESTED')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}
