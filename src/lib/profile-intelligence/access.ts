import type { SupabaseClient } from '@supabase/supabase-js'
import { can, type AuthContext } from '@/lib/auth/organization'

/**
 * Role-based access for Profile Intelligence.
 *
 *   Owner / Admin / Manager (or MANAGE_REVENUE_IDENTITIES)
 *     → see every profile in the org; upload, import, edit, assign, archive.
 *   Owner / Admin
 *     → additionally merge duplicate profiles.
 *   Rep (member)
 *     → read-only; sees only profiles they own or are assigned to, and uses
 *       them for lead work. Cannot upload, edit or import.
 *
 * Enforced server-side on every route; the UI only mirrors it.
 */
export interface ProfileAccess {
  canManage: boolean
  canMerge: boolean
  scope: 'org' | 'assigned'
}

export function profileAccess(auth: AuthContext): ProfileAccess {
  const canManage = auth.isOwner || auth.isAdmin || auth.isManager || can(auth, 'MANAGE_REVENUE_IDENTITIES')
  return {
    canManage,
    canMerge: auth.isOwner || auth.isAdmin,
    scope: canManage ? 'org' : 'assigned',
  }
}

/**
 * Profile ids a rep may see: owned (profiles.rep_id) ∪ assigned (profile_assignments)
 * ∪ behind a sending identity assigned to them (identity_assignments →
 * revenue_identities.profile_id). Admins usually assign identities, not
 * profiles, so without the last leg a rep's Profiles page stays empty.
 */
export async function repVisibleProfileIds(client: SupabaseClient, auth: AuthContext): Promise<string[]> {
  const [owned, assigned, viaIdentity] = await Promise.all([
    client.from('profiles').select('id').eq('organization_id', auth.orgId).eq('rep_id', auth.repId),
    client.from('profile_assignments').select('profile_id').eq('rep_id', auth.repId),
    client
      .from('identity_assignments')
      .select('revenue_identities(profile_id, status)')
      .eq('organization_id', auth.orgId)
      .eq('rep_id', auth.repId),
  ])
  const ids = new Set<string>()
  for (const r of owned.data ?? []) ids.add(r.id as string)
  for (const r of assigned.data ?? []) if (r.profile_id) ids.add(r.profile_id as string)
  for (const r of (viaIdentity.data ?? []) as Array<{ revenue_identities: IdentityLink | IdentityLink[] | null }>) {
    const links = Array.isArray(r.revenue_identities) ? r.revenue_identities : [r.revenue_identities]
    for (const link of links) if (link?.profile_id && link.status !== 'archived') ids.add(link.profile_id)
  }
  return [...ids]
}

type IdentityLink = { profile_id: string | null; status: string | null }

/** null = no restriction (managers); otherwise the explicit allow-list. */
export async function visibleProfileIds(client: SupabaseClient, auth: AuthContext): Promise<string[] | null> {
  return profileAccess(auth).scope === 'org' ? null : repVisibleProfileIds(client, auth)
}

export async function canViewProfile(client: SupabaseClient, auth: AuthContext, profileId: string): Promise<boolean> {
  const ids = await visibleProfileIds(client, auth)
  return ids === null || ids.includes(profileId)
}
