/**
 * Lead Help Workflow API
 *
 * POST /api/leads/[id]/help — create a help request
 * GET /api/leads/[id]/help   — list help requests for a lead
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { createHelpRequest } from '@/lib/relay/team-help-workflow'
import { getAuthContext } from '@/lib/auth/organization'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  const { data, error } = await client
    .from('help_requests')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { toRepId, helpType, reason } = body as {
    toRepId?: string
    helpType?: string
    reason?: string
  }

  if (!toRepId || !helpType || !reason) {
    return NextResponse.json({ error: 'toRepId, helpType, and reason are required' }, { status: 400 })
  }

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  // Verify the lead exists and belongs to this org
  const { data: lead } = await client
    .from('leads')
    .select('id, organization_id')
    .eq('id', leadId)
    .eq('organization_id', authCtx.orgId)
    .maybeSingle()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Check for existing active request to the same rep for the same lead
  const { data: existing } = await client
    .from('help_requests')
    .select('id')
    .eq('lead_id', leadId)
    .eq('to_rep_id', toRepId)
    .eq('status', 'HELP_REQUESTED')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'An active help request to this rep already exists', requestId: existing.id }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { data, error } = await client
    .from('help_requests')
    .insert({
      org_id: authCtx.orgId,
      lead_id: leadId,
      from_rep_id: authCtx.repId,
      to_rep_id: toRepId,
      help_type: helpType,
      status: 'HELP_REQUESTED',
      reason,
      context: body.context ?? {},
      created_at: now,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data }, { status: 201 })
}
