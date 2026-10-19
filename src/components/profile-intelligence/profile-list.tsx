'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ChevronRight, Search, Send } from 'lucide-react'
import { cn } from 'cn'
import { EmptyNote, Initials, Pill, type Tone } from '@/components/dashboard/kit'

interface Profile {
  id: string
  fullName: string | null
  displayName: string | null
  currentRole: string | null
  company: string | null
  primarySkills: string[]
  specialties: string[]
  readiness: string
  sourceCount: number
  proofCount: number
  platform?: string | null
  updatedAt: string
  // The API embeds `reps` (Supabase relation name); older payloads used `rep`.
  assignments: Array<{ rep?: { name: string } | null; reps?: { name: string } | null }>
  rep: { name: string } | null
}

interface IdentityLite {
  id: string
  identityName: string
  channel: string
  status: string
  profileId: string | null
}

const READINESS: Record<string, { label: string; tone: Tone }> = {
  ready: { label: 'Ready', tone: 'success' },
  needs_review: { label: 'Needs review', tone: 'cobalt' },
  needs_source: { label: 'Needs a source', tone: 'warning' },
  incomplete: { label: 'Incomplete', tone: 'neutral' },
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'needs_source', label: 'Needs a source' },
  { value: 'incomplete', label: 'Incomplete' },
]

const CHANNEL_SHORT: Record<string, string> = { linkedin: 'in', email: '@', upwork: 'U', other: '•' }

export function ProfileList({ isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [identities, setIdentities] = useState<IdentityLite[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/profile-intelligence/profiles?limit=200')
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setProfiles(data.profiles ?? []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    if (isAdmin) {
      fetch('/api/admin/revenue-identities')
        .then((r) => (r.ok ? r.json() : { identities: [] }))
        .then((data) => { if (!cancelled) setIdentities(data.identities ?? []) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [isAdmin])

  const identitiesByProfile = useMemo(() => {
    const map = new Map<string, IdentityLite[]>()
    for (const i of identities) {
      if (!i.profileId || i.status === 'archived') continue
      map.set(i.profileId, [...(map.get(i.profileId) ?? []), i])
    }
    return map
  }, [identities])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: profiles.length }
    for (const p of profiles) c[p.readiness] = (c[p.readiness] ?? 0) + 1
    return c
  }, [profiles])

  const q = query.trim().toLowerCase()
  const visible = profiles.filter((p) => {
    if (filter !== 'all' && p.readiness !== filter) return false
    if (!q) return true
    const hay = [p.fullName, p.displayName, p.currentRole, p.company, ...(p.primarySkills ?? []), ...(p.specialties ?? [])].join(' ').toLowerCase()
    return hay.includes(q)
  })

  return (
    <section className="rounded-xl border border-line bg-bone-raised" aria-label="Profiles">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, role or skill"
            aria-label="Search profiles"
            className="h-8 w-full rounded-md border border-line bg-bone pl-8 pr-3 text-[12px] text-ink placeholder:text-stone focus:border-orange/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by readiness">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                filter === f.value ? 'bg-solid text-on-solid' : 'text-graphite hover:bg-bone hover:text-ink',
              )}
            >
              {f.label}
              {(counts[f.value] ?? 0) > 0 && <span className="ml-1 tabular-nums opacity-60">{counts[f.value]}</span>}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <ul className="divide-y divide-line/70" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3">
              <span className="size-8 animate-pulse rounded-full bg-bone" />
              <span className="h-3 w-48 animate-pulse rounded bg-bone" />
            </li>
          ))}
        </ul>
      ) : profiles.length === 0 ? (
        <EmptyNote>No profiles yet. {isAdmin ? 'Add people from documents above to get started.' : 'Ask your admin to assign one to you.'}</EmptyNote>
      ) : visible.length === 0 ? (
        <EmptyNote>No profiles match.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line/70">
          {visible.map((p) => {
            const name = p.fullName ?? p.displayName ?? 'Unnamed profile'
            const readiness = READINESS[p.readiness] ?? READINESS.incomplete
            const skills = [...(p.primarySkills ?? []), ...(p.specialties ?? [])].slice(0, 3)
            const assigned = [...new Set((p.assignments ?? []).map((a) => a.rep?.name ?? a.reps?.name).filter((n): n is string => Boolean(n)))]
            const linked = identitiesByProfile.get(p.id) ?? []
            return (
              <li key={p.id}>
                <Link href={`/profile-intelligence/${p.id}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-bone sm:px-5 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Initials name={name} tone={readiness.tone} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      <span className="truncate">{name}</span>
                      <Pill tone={readiness.tone}>{readiness.label}</Pill>
                    </p>
                    <p className="truncate text-[11px] text-stone">
                      {p.currentRole ?? 'No role yet'}{p.company ? ` · ${p.company}` : ''} · {p.proofCount} proof · {p.sourceCount} {p.sourceCount === 1 ? 'source' : 'sources'}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-stone group-hover:text-ink md:order-last" aria-hidden="true" />
                  <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap gap-1 md:col-span-1 md:col-start-auto">
                    {skills.length > 0
                      ? skills.map((skill) => <span key={skill} className="max-w-[160px] truncate rounded bg-bone px-1.5 py-0.5 text-[10px] text-graphite">{skill}</span>)
                      : <span className="text-[11px] text-stone">No skills yet</span>}
                  </div>
                  <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-center gap-1 md:col-span-1 md:col-start-auto">
                    {linked.length > 0 ? linked.map((i) => (
                      <span key={i.id} className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-line bg-bone px-2 py-0.5 text-[10px] text-ink" title={`Sends as ${i.identityName} on ${i.channel}`}>
                        <span className="font-semibold text-cobalt">{CHANNEL_SHORT[i.channel] ?? '•'}</span>{i.identityName}
                      </span>
                    )) : isAdmin ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-stone"><Send className="size-3" aria-hidden="true" />No sending identity</span>
                    ) : null}
                    {assigned.length > 0 && <span className="truncate text-[11px] text-graphite">· {assigned.join(', ')}</span>}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
