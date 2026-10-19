import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'
import { referLead, getReferralRecommendations } from '@/lib/lead-referral'

export const maxDuration = 30

/** Reps who can send as a profile: owner, direct assignees, and assignees of identities built from it. */
async function profileHolders(
  db: ReturnType<typeof createServiceSupabase>,
  orgId: string,
  profileId: string,
): Promise<string[] | null> {
  const [{ data: profile }, { data: direct }, { data: viaIdentity }] = await Promise.all([
    db.from('profiles').select('id, rep_id').eq('id', profileId).eq('organization_id', orgId).maybeSingle(),
    db.from('profile_assignments').select('rep_id').eq('profile_id', profileId),
    db
      .from('identity_assignments')
      .select('rep_id, revenue_identities!inner(profile_id, status)')
      .eq('organization_id', orgId)
      .eq('revenue_identities.profile_id', profileId),
  ])
  if (!profile) return null
  const holders = new Set<string>()
  if (profile.rep_id) holders.add(profile.rep_id as string)
  for (const r of direct ?? []) if (r.rep_id) holders.add(r.rep_id as string)
  for (const r of (viaIdentity ?? []) as Array<{ rep_id: string; revenue_identities: { status: string | null } | Array<{ status: string | null }> }>) {
    const identity = Array.isArray(r.revenue_identities) ? r.revenue_identities[0] : r.revenue_identities
    if (r.rep_id && identity?.status !== 'archived') holders.add(r.rep_id)
  }
  return [...holders]
}

/**
 * POST /api/leads/[id]/refer — move a lead to a better sender profile.
 * Body: { toProfileId, toRepId?, reason? }
 *  - If the caller can already send as that profile, only the sender changes.
 *  - Otherwise the lead goes to a rep who holds that profile (or toRepId).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  let body: { toRepId?: unknown; toProfileId?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const toProfileId = typeof body.toProfileId === 'string' && body.toProfileId ? body.toProfileId : null
  const requestedRepId = typeof body.toRepId === 'string' && body.toRepId ? body.toRepId : null
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null
  if (!toProfileId && !requestedRepId) {
    return NextResponse.json({ error: 'Choose a profile or a person to refer to.' }, { status: 400 })
  }

  const db = createServiceSupabase()
  const { data: lead } = await db
    .from('leads')
    .select('id, owner_rep_id')
    .eq('id', leadId)
    .eq('organization_id', authCtx.orgId)
    .maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const isAdmin = authCtx.isOwner || authCtx.isAdmin || authCtx.isManager
  if (!isAdmin && lead.owner_rep_id && lead.owner_rep_id !== authCtx.repId) {
    return NextResponse.json({ error: 'Only the lead owner can refer this lead.' }, { status: 403 })
  }

  let toRepId = requestedRepId
  if (toProfileId) {
    const holders = await profileHolders(db, authCtx.orgId, toProfileId)
    if (!holders) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })

    // Caller can already send as this profile: switch the sender, keep the lead.
    if (!requestedRepId && holders.includes(authCtx.repId) && lead.owner_rep_id === authCtx.repId) {
      const { error } = await db
        .from('leads')
        .update({ sender_profile_id: toProfileId })
        .eq('id', leadId)
        .eq('organization_id', authCtx.orgId)
      if (error) return NextResponse.json({ error: 'Could not switch the sender.' }, { status: 500 })
      return NextResponse.json({ success: true, switchedSender: true, toRepId: authCtx.repId })
    }

    if (!toRepId) {
      toRepId = holders.find((id) => id !== authCtx.repId) ?? holders[0] ?? null
    }
    if (!toRepId) {
      return NextResponse.json({ error: 'Nobody can send as this profile yet. Assign it to a rep first.' }, { status: 409 })
    }
  }

  const { data: target } = await db.from('reps').select('id').eq('id', toRepId!).eq('organization_id', authCtx.orgId).maybeSingle()
  if (!target) return NextResponse.json({ error: 'That person is not in your workspace.' }, { status: 400 })

  const result = await referLead({
    orgId: authCtx.orgId,
    leadId,
    fromRepId: authCtx.repId,
    toRepId: toRepId!,
    toProfileId: toProfileId ?? undefined,
    reason: reason ?? undefined,
  })
  if (!result.success) {
    return NextResponse.json({ error: 'Referral failed. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, switchedSender: false, toRepId, actionEventId: result.actionEventId })
}

/**
 * GET /api/leads/[id]/refer — recommended profiles for the referral picker.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const url = new URL(req.url)
  const currentProfileId = url.searchParams.get('currentProfileId') || undefined
  const recommendations = await getReferralRecommendations(authCtx.orgId, leadId, currentProfileId)
  return NextResponse.json({ recommendations })
}
