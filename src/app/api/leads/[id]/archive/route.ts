import { NextRequest, NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { getAuthContext } from '@/lib/auth/organization'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leads/[id]/archive
 *
 * Manual soft-archive / restore (QA RQA-019). Distinct from the automatic
 * stale-lead sweep and from the Won/Lost conversation archive: this toggles the
 * lead's own archived flag and keeps every field intact.
 *
 * Body: { action: 'archive' | 'restore' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params

  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = body.action === 'restore' ? 'restore' : body.action === 'archive' ? 'archive' : null
  if (!action) {
    return NextResponse.json({ error: "action must be 'archive' or 'restore'." }, { status: 400 })
  }

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  const { data: lead } = await client
    .from('leads')
    .select('id, archived, owner_rep_id')
    .eq('id', leadId)
    .eq('organization_id', auth.orgId)
    .maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  // A non-admin may only archive/restore their own lead.
  if (!auth.isAdmin && lead.owner_rep_id && lead.owner_rep_id !== auth.repId) {
    return NextResponse.json({ error: 'Only the lead owner can archive this lead.' }, { status: 403 })
  }

  const now = new Date().toISOString()
  const { error } = await client
    .from('leads')
    .update(action === 'archive' ? { archived: true, archived_at: now } : { archived: false, archived_at: null })
    .eq('id', leadId)
    .eq('organization_id', auth.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, archived: action === 'archive' })
}
