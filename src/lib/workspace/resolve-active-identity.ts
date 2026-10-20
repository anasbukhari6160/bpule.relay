import { cookies } from 'next/headers'
import { getAuthContext } from '@/lib/auth/organization'
import { createScoutStore } from '@/lib/store'
import {
  ACTIVE_IDENTITY_COOKIE,
  isIdentityId,
  type WorkspaceIdentity,
} from '@/lib/workspace/active-identity'

export async function readActiveIdentityId(): Promise<string | null> {
  const jar = await cookies()
  const value = jar.get(ACTIVE_IDENTITY_COOKIE)?.value ?? null
  return isIdentityId(value) ? value : null
}

/** The identity is usable only when this rep is assigned to it, or is an admin. */
export async function resolveAccessibleIdentity(identityId: string): Promise<WorkspaceIdentity | null> {
  if (!isIdentityId(identityId)) return null
  const auth = await getAuthContext()
  if (!auth) return null

  const store = await createScoutStore()
  const identities = auth.isOwner || auth.isAdmin
    ? await store.listRevenueIdentitiesAdmin()
    : await store.listMyAssignedIdentities()
  const identity = identities.find((item) => item.id === identityId && item.status === 'active')
  if (!identity) return null

  return {
    id: identity.id,
    identityName: identity.identityName,
    title: identity.title,
    channel: identity.channel,
    profileId: identity.profileId,
  }
}

export async function resolveActiveWorkspace(): Promise<WorkspaceIdentity | null> {
  const auth = await getAuthContext()
  if (!auth) return null

  const store = await createScoutStore()
  const identities = (auth.isOwner || auth.isAdmin
    ? await store.listRevenueIdentitiesAdmin()
    : await store.listMyAssignedIdentities()
  ).filter((identity) => identity.status === 'active')
  if (identities.length === 0) return null

  const requestedId = await readActiveIdentityId()
  const identity = identities.find((item) => item.id === requestedId) ?? identities[0]

  return {
    id: identity.id,
    identityName: identity.identityName,
    title: identity.title,
    channel: identity.channel,
    profileId: identity.profileId,
  }
}
