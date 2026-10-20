'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ACTIVE_IDENTITY_STORAGE_KEY,
  readActiveIdentityCookie,
  writeActiveIdentityCookie,
  type WorkspaceIdentity,
} from '@/lib/workspace/active-identity'

interface ActiveIdentityContextValue {
  identities: WorkspaceIdentity[]
  active: WorkspaceIdentity | null
  selectIdentity: (identityId: string) => void
}

const ActiveIdentityContext = createContext<ActiveIdentityContextValue | null>(null)

export function ActiveIdentityProvider({
  identities,
  initialActiveId,
  children,
}: {
  identities: WorkspaceIdentity[]
  initialActiveId: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const identityKey = identities.map((identity) => identity.id).join(',')
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (initialActiveId && identities.some((identity) => identity.id === initialActiveId)) return initialActiveId
    return identities[0]?.id ?? null
  })

  useEffect(() => {
    const known = new Set(identities.map((identity) => identity.id))
    let saved: string | null = null
    try {
      saved = localStorage.getItem(ACTIVE_IDENTITY_STORAGE_KEY)
    } catch {
      saved = null
    }
    const preferred = saved && known.has(saved) ? saved : identities[0]?.id ?? null
    if (!preferred) return

    if (readActiveIdentityCookie() === preferred) {
      setActiveId(preferred)
      return
    }

    try {
      localStorage.setItem(ACTIVE_IDENTITY_STORAGE_KEY, preferred)
    } catch {
      // Ignore local storage failures. The cookie still scopes the server.
    }
    writeActiveIdentityCookie(preferred)
    setActiveId(preferred)
    if (preferred !== activeId) router.refresh()
  }, [identityKey, identities, activeId, router])

  const active = identities.find((identity) => identity.id === activeId) ?? identities[0] ?? null

  const value = useMemo<ActiveIdentityContextValue>(() => ({
    identities,
    active,
    selectIdentity(identityId: string) {
      if (!identities.some((identity) => identity.id === identityId)) return
      if (identityId === active?.id && readActiveIdentityCookie() === identityId) return
      setActiveId(identityId)
      try {
        localStorage.setItem(ACTIVE_IDENTITY_STORAGE_KEY, identityId)
      } catch {
        // Ignore local storage failures.
      }
      writeActiveIdentityCookie(identityId)
      router.refresh()
    },
  }), [identities, active, router])

  return (
    <ActiveIdentityContext.Provider value={value}>
      {children}
    </ActiveIdentityContext.Provider>
  )
}

export function useActiveIdentity(): ActiveIdentityContextValue {
  const value = useContext(ActiveIdentityContext)
  if (!value) {
    throw new Error('useActiveIdentity must be used within ActiveIdentityProvider')
  }
  return value
}
