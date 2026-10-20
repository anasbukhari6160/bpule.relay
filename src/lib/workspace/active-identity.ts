/**
 * Four separate facts about a lead. None of them may be inferred from another.
 *
 * - Owner: the rep who holds the lead (`ownerRepId`). Changes only when
 *   someone explicitly refers or assigns it.
 * - Workspace: the sidebar identity the lead was captured under
 *   (`revenueIdentityId`). This is what the Leads view filters on.
 * - Sender: the profile the message goes out as (`senderProfileId`). A rep
 *   can send as a different profile without leaving their workspace.
 * - Best sender: a routing recommendation. It is not an assignment. Choosing
 *   it updates the sender only, and only when the rep does so on purpose.
 *
 * A recommendation or a sender switch must not move the lead out of the
 * workspace it was saved in, and must not change who owns it.
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
  // A stamped workspace is the only visibility key. The current sender does
  // not move the lead into another workspace or out of this one.
  if (lead.revenueIdentityId) return lead.revenueIdentityId === identity.id
  // Leads captured before workspace stamping still show on the profile that
  // sent them, until they have an identity of their own.
  if (identity.profileId && lead.senderProfileId && lead.senderProfileId === identity.profileId) return true
  return false
}

/**
 * The workspace a new lead is saved under. The sender argument is ignored:
 * sending as another profile does not change which workspace owns the row.
 */
export function workspaceIdentityForSender(
  identity: { id: string; profileId?: string | null } | null | undefined,
  _senderProfileId?: string | null,
): string | null {
  return identity?.id ?? null
}

export interface LeadVisibility {
  ownerRepId: string
  workspaceIdentityId: string | null
  senderProfileId: string | null
  /** Recommendation only. Never written as owner or workspace. */
  bestSenderProfileId: string | null
}

/** Choosing a sender, including the recommended one, leaves owner and workspace alone. */
export function chooseSender(lead: LeadVisibility, senderProfileId: string): LeadVisibility {
  return { ...lead, senderProfileId }
}

/** Explicit refer or assign. This is the only path that changes the owner. */
export function assignLead(lead: LeadVisibility, toRepId: string, toProfileId?: string | null): LeadVisibility {
  return {
    ...lead,
    ownerRepId: toRepId,
    senderProfileId: toProfileId ?? lead.senderProfileId,
  }
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
