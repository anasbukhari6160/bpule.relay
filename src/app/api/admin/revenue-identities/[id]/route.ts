import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getAuthContext, can } from '@/lib/auth/organization'
import { safeErrorResponse } from '@/lib/errors'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(authCtx, 'MANAGE_REVENUE_IDENTITIES')) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('revenue_identities')
    .select('*')
    .eq('id', id)
    .eq('organization_id', authCtx.orgId)
    .maybeSingle()

  if (error) return safeErrorResponse(error, 500, 'Failed to load identity.', 'admin/revenue-identities/[id]')
  if (!data) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json({ identity: data })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(authCtx, 'MANAGE_REVENUE_IDENTITIES')) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  const { data: existing } = await supabase
    .from('revenue_identities')
    .select('id')
    .eq('id', id)
    .eq('organization_id', authCtx.orgId)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const fields = [
    'identityName', 'title', 'positioning', 'profileUrl', 'skills', 'expertise',
    'industries', 'technologies', 'allowedFirstPersonClaims', 'forbiddenClaims',
    'channelRules', 'voiceTone', 'preferredOpportunityTypes', 'proposalPositioning',
    'status', 'slug',
  ] as const
  const dbFields: Record<string, string> = {
    identityName: 'identity_name',
    profileUrl: 'profile_url',
    allowedFirstPersonClaims: 'allowed_first_person_claims',
    forbiddenClaims: 'forbidden_claims',
    channelRules: 'channel_rules',
    voiceTone: 'voice_tone',
    preferredOpportunityTypes: 'preferred_opportunity_types',
    proposalPositioning: 'proposal_positioning',
  }

  for (const field of fields) {
    if (body[field] !== undefined) {
      const dbField = dbFields[field] ?? field
      update[dbField] = body[field]
    }
  }

  if (typeof body.channel === 'string') {
    if (!['linkedin', 'email', 'upwork', 'other'].includes(body.channel)) {
      return NextResponse.json({ error: 'Unknown channel.' }, { status: 400 })
    }
    update.channel = body.channel
  }

  if (body.profileId !== undefined) {
    if (body.profileId === null || body.profileId === '') {
      update.profile_id = null
    } else if (typeof body.profileId === 'string') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', body.profileId)
        .eq('organization_id', authCtx.orgId)
        .maybeSingle()
      if (!profile) return NextResponse.json({ error: 'Linked profile not found.' }, { status: 400 })
      update.profile_id = profile.id
    }
  }

  const { data, error } = await supabase
    .from('revenue_identities')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return safeErrorResponse(error, 500, 'Failed to update identity.', 'admin/revenue-identities/[id]')

  await supabase.from('accountability_audit_log').insert({
    organization_id: authCtx.orgId,
    rep_id: authCtx.repId,
    revenue_identity_id: id,
    event_type: 'identity_edited',
    detail: { fields: Object.keys(update) },
  })

  return NextResponse.json({ identity: data })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(authCtx, 'MANAGE_REVENUE_IDENTITIES')) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const supabase = await createServerSupabase()

  const { error } = await supabase
    .from('revenue_identities')
    .delete()
    .eq('id', id)
    .eq('organization_id', authCtx.orgId)

  if (error) return safeErrorResponse(error, 500, 'Failed to delete identity.', 'admin/revenue-identities/[id]')

  await supabase.from('accountability_audit_log').insert({
    organization_id: authCtx.orgId,
    rep_id: authCtx.repId,
    revenue_identity_id: id,
    event_type: 'identity_deleted',
    detail: {},
  })

  return NextResponse.json({ ok: true })
}
