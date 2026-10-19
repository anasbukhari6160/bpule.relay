'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Send } from 'lucide-react'
import { cn } from 'cn'

interface IdentityLite {
  id: string
  identityName: string
  title: string | null
  channel: string
  status: string
  profileId: string | null
}

const CHANNEL: Record<string, { label: string; short: string; cls: string }> = {
  linkedin: { label: 'LinkedIn', short: 'in', cls: 'bg-cobalt/10 text-cobalt' },
  email: { label: 'Email', short: '@', cls: 'bg-orange/10 text-orange' },
  upwork: { label: 'Upwork', short: 'U', cls: 'bg-status-success/10 text-status-success' },
  other: { label: 'Other', short: '•', cls: 'bg-bone text-graphite' },
}

/** Admin-only: the sending identities built from this profile, and a way to add one. */
export function SendingIdentitiesPanel({ profileId }: { profileId: string }) {
  const [identities, setIdentities] = useState<IdentityLite[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/revenue-identities')
      .then((r) => (r.ok ? r.json() : { identities: [] }))
      .then((d) => { if (!cancelled) setIdentities((d.identities ?? []).filter((i: IdentityLite) => i.profileId === profileId)) })
      .catch(() => { if (!cancelled) setIdentities([]) })
    return () => { cancelled = true }
  }, [profileId])

  const createHref = `/profile-intelligence?tab=identities&fromProfile=${encodeURIComponent(profileId)}`

  return (
    <section id="identities" className="rounded-xl border border-line bg-bone-raised px-5 py-5 sm:px-6" aria-label="Sending identities">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium text-ink">Sending identities</h2>
          <p className="mt-0.5 text-[12px] text-graphite">How reps show up in outreach as this person.</p>
        </div>
        <Link href={createHref} className="inline-flex items-center gap-1.5 rounded-md bg-orange px-3 py-1.5 text-[12px] font-medium text-on-accent hover:bg-orange-dark">
          <Plus className="size-3.5" aria-hidden="true" />Create sending identity
        </Link>
      </div>
      {identities === null ? (
        <div className="mt-4 h-10 animate-pulse rounded-lg bg-bone" />
      ) : identities.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-graphite">
          <Send className="size-3.5 text-stone" aria-hidden="true" />
          No identity yet — reps can&apos;t send as this person until you create one.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line/70 rounded-lg border border-line/70">
          {identities.map((i) => {
            const meta = CHANNEL[i.channel] ?? CHANNEL.other
            return (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn('flex size-7 items-center justify-center rounded-md text-[10px] font-semibold', meta.cls)}>{meta.short}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{i.identityName}</p>
                  <p className="truncate text-[11px] text-stone">{[i.title, meta.label, i.status === 'archived' ? 'archived' : null].filter(Boolean).join(' · ')}</p>
                </div>
                <Link href="/profile-intelligence?tab=identities" className="text-[11px] font-medium text-cobalt hover:underline">Manage</Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
