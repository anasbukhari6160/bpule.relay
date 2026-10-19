import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { createServerSupabase } from '@/lib/supabase/server'
import { getAuthContext, can } from '@/lib/auth/organization'
import { safeErrorResponse } from '@/lib/errors'
import type { RevenueIdentity } from '@/lib/domain/types'

function mapIdentity(row: Record<string, unknown>): RevenueIdentity {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    slug: row.slug as string,
    identityName: row.identity_name as string,
    title: (row.title as string) ?? null,
    positioning: (row.positioning as string) ?? null,
    profileUrl: (row.profile_url as string) ?? null,
    skills: Array.isArray(row.skills) ? row.skills as string[] : [],
    expertise: Array.isArray(row.expertise) ? row.expertise as string[] : [],
    industries: Array.isArray(row.industries) ? row.industries as string[] : [],
    technologies: Array.isArray(row.technologies) ? row.technologies as string[] : [],
    allowedFirstPersonClaims: Array.isArray(row.allowed_first_person_claims) ? row.allowed_first_person_claims as string[] : [],
    forbiddenClaims: Array.isArray(row.forbidden_claims) ? row.forbidden_claims as string[] : [],
    channelRules: row.channel_rules && typeof row.channel_rules === 'object' ? row.channel_rules as Record<string, unknown> : {},
    voiceTone: row.voice_tone && typeof row.voice_tone === 'object' ? row.voice_tone as Record<string, unknown> : {},
    preferredOpportunityTypes: Array.isArray(row.preferred_opportunity_types) ? row.preferred_opportunity_types as string[] : [],
    proposalPositioning: (row.proposal_positioning as string) ?? null,
    profileId: (row.profile_id as string) ?? null,
    channel: row.channel as RevenueIdentity['channel'],
    status: row.status as RevenueIdentity['status'],
    sourceKind: (row.source_kind as string) ?? 'manual',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function GET() {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(authCtx, 'MANAGE_REVENUE_IDENTITIES')) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  try {
    const store = await createScoutStore()
    const identities = await store.listRevenueIdentitiesAdmin()
    return NextResponse.json({ identities })
  } catch (error) {
    return safeErrorResponse(error, 500, 'Failed to load identities.', 'admin/revenue-identities')
  }
}

export async function POST(request: Request) {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!can(authCtx, 'MANAGE_REVENUE_IDENTITIES')) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const identityName = typeof body.identityName === 'string' ? body.identityName.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!identityName || !slug) {
    return NextResponse.json({ error: 'identityName and slug are required.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  const channel = typeof body.channel === 'string' && ['linkedin', 'email', 'upwork', 'other'].includes(body.channel)
    ? body.channel
    : 'other'

  // Optional link to the Profile Intelligence record this identity sends as.
  let profileId: string | null = null
  if (typeof body.profileId === 'string' && body.profileId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', body.profileId)
      .eq('organization_id', authCtx.orgId)
      .maybeSingle()
    if (!profile) return NextResponse.json({ error: 'Linked profile not found.' }, { status: 400 })
    profileId = profile.id as string
  }

  const row: Record<string, unknown> = {
    organization_id: authCtx.orgId,
    profile_id: profileId,
    slug,
    identity_name: identityName,
    title: typeof body.title === 'string' ? body.title : null,
    positioning: typeof body.positioning === 'string' ? body.positioning : null,
    profile_url: typeof body.profileUrl === 'string' ? body.profileUrl : null,
    skills: Array.isArray(body.skills) ? body.skills : [],
    expertise: Array.isArray(body.expertise) ? body.expertise : [],
    industries: Array.isArray(body.industries) ? body.industries : [],
    technologies: Array.isArray(body.technologies) ? body.technologies : [],
    allowed_first_person_claims: Array.isArray(body.allowedFirstPersonClaims) ? body.allowedFirstPersonClaims : [],
    forbidden_claims: Array.isArray(body.forbiddenClaims) ? body.forbiddenClaims : [],
    channel_rules: body.channelRules && typeof body.channelRules === 'object' ? body.channelRules : {},
    voice_tone: body.voiceTone && typeof body.voiceTone === 'object' ? body.voiceTone : {},
    preferred_opportunity_types: Array.isArray(body.preferredOpportunityTypes) ? body.preferredOpportunityTypes : [],
    proposal_positioning: typeof body.proposalPositioning === 'string' ? body.proposalPositioning : null,
    channel,
    status: 'active',
    source_kind: 'manual',
  }

  const { data, error } = await supabase
    .from('revenue_identities')
    .insert(row)
    .select('*')
    .single()

  if (error) return safeErrorResponse(error, 500, 'Failed to create identity.', 'admin/revenue-identities')

  // Audit log
  await supabase.from('accountability_audit_log').insert({
    organization_id: authCtx.orgId,
    rep_id: authCtx.repId,
    revenue_identity_id: data.id,
    event_type: 'identity_created',
    detail: { identity_name: identityName, slug },
  })

  return NextResponse.json({ identity: data }, { status: 201 })
}
