/**
 * The sidebar workspace is one assigned revenue identity. Leads and
 * prospecting follow that choice: a lead belongs to the workspace when it
 * was saved under the identity, or when it was sent from the profile linked
 * to that identity.
 */

export const ACTIVE_IDENTITY_COOKIE = 'relay-active-identity'
export const ACTIVE_IDENTITY_STORAGE_KEY = 'relay-active-identity'

const IDENTITY_ID = /^[A-Za-z0-9_-]{1,80}$/

export interface WorkspaceIdentity {
  id: string
  identityName: string
  title: string | null
  channel: string
  profileId: string | null
}

export function isIdentityId(value: string | null | undefined): value is string {
  return typeof value === 'string' && IDENTITY_ID.test(value)
}

export function leadBelongsToWorkspace(
  lead: { revenueIdentityId?: string | null; senderProfileId?: string | null },
  identity: { id: string; profileId?: string | null },
): boolean {
  if (lead.revenueIdentityId && lead.revenueIdentityId === identity.id) return true
  if (identity.profileId && lead.senderProfileId && lead.senderProfileId === identity.profileId) return true
  return false
}

/**
 * Stamp the workspace identity onto a capture only while the sender is still
 * that identity's profile. Changing sender for one check leaves the lead
 * with the other profile, so it shows up under that profile's workspace.
 */
export function workspaceIdentityForSender(
  identity: { id: string; profileId?: string | null } | null | undefined,
  senderProfileId: string | null | undefined,
): string | null {
  if (!identity) return null
  if (!identity.profileId || !senderProfileId || senderProfileId === identity.profileId) return identity.id
  return null
}

export function writeActiveIdentityCookie(identityId: string) {
  document.cookie = `${ACTIVE_IDENTITY_COOKIE}=${encodeURIComponent(identityId)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function readActiveIdentityCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_IDENTITY_COOKIE}=([^;]*)`))
  if (!match) return null
  try {
    const value = decodeURIComponent(match[1])
    return isIdentityId(value) ? value : null
  } catch {
    return null
  }
}
