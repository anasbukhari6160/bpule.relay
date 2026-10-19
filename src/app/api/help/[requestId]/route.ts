/**
 * Help Request Transition API
 *
 * PATCH /api/help/[requestId] — transition help request status
 * Body: { status: 'HELP_ACCEPTED' | 'HELP_COMPLETED', resolution?: string }
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { canTransition, type HelpStatus } from '@/lib/relay/team-help-workflow'
import { getAuthContext } from '@/lib/auth/organization'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { status, resolution } = body as { status?: string; resolution?: string }

  if (!status || !['HELP_ACCEPTED', 'HELP_COMPLETED'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  // Load current request
  const { data: current, error: loadError } = await client
    .from('help_requests')
    .select('*')
    .eq('id', requestId)
    .eq('org_id', authCtx.orgId)
    .maybeSingle()

  if (loadError || !current) {
    return NextResponse.json({ error: 'Help request not found' }, { status: 404 })
  }

  // Only the recipient can accept/complete
  if (current.to_rep_id !== authCtx.repId) {
    return NextResponse.json({ error: 'Only the requested rep can update this request' }, { status: 403 })
  }

  // Validate state transition
  if (!canTransition(current.status as HelpStatus, status as HelpStatus)) {
    return NextResponse.json(
      { error: `Invalid transition from ${current.status} to ${status}` },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status,
    responded_at: now,
  }
  if (status === 'HELP_COMPLETED') {
    updates.completed_at = now
    updates.resolution = resolution ?? null
  }

  const { data, error } = await client
    .from('help_requests')
    .update(updates)
    .eq('id', requestId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  const { data, error } = await client
    .from('help_requests')
    .select('*')
    .eq('id', requestId)
    .eq('org_id', authCtx.orgId)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ request: data })
}
