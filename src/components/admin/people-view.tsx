'use client'

import { use, useState } from 'react'
import { ChevronDown, ChevronRight, Shield, Users, UserPlus, Settings, CheckCircle2 } from 'lucide-react'
import { cn } from 'cn'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'

interface PeopleData {
  orgName: string
  teams: Array<{ id: string; name: string; description: string | null }>
  people: Array<{
    id: string
    name: string
    role: string
    managedTeams: Array<{ id: string; name: string }>
    memberTeams: Array<{ id: string; name: string }>
  }>
  owners: Array<{ id: string; name: string; role: string; managedTeams: any[]; memberTeams: any[] }>
  admins: Array<{ id: string; name: string; role: string; managedTeams: any[]; memberTeams: any[] }>
  managers: Array<{ id: string; name: string; role: string; managedTeams: any[]; memberTeams: any[] }>
  members: Array<{ id: string; name: string; role: string; managedTeams: any[]; memberTeams: any[] }>
  isOwner: boolean
}

export function PeopleView({ dataPromise }: { dataPromise: Promise<PeopleData> }) {
  const data = use(dataPromise)
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())

  const toggleTeam = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  const totalPeople = data.people.length
  const totalTeams = data.teams.length

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">Organization</p>
          <h1 className="mt-1 text-[26px] font-medium tracking-[-0.02em] text-ink">{data.orgName}</h1>
          <p className="mt-1 text-[13px] text-graphite">{totalPeople} people · {totalTeams} teams</p>
        </div>
        <div className="flex gap-2">
          <BypassAllButton />
          <button className="flex items-center gap-1.5 rounded bg-orange px-3 py-1.5 text-[12px] font-medium text-on-accent hover:bg-orange-dark transition-colors">
            <UserPlus className="size-3.5" />
            Add person
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded border border-line px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">Total people</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{totalPeople}</p>
        </div>
        <div className="rounded border border-orange/20 bg-orange/5 px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light">Owners</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{data.owners.length}</p>
        </div>
        <div className="rounded border border-cobalt/20 bg-cobalt/5 px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-cobalt">Admins</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{data.admins.length}</p>
        </div>
        <div className="rounded border border-line px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-ststone">Managers</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{data.managers.length}</p>
        </div>
      </div>

      {/* Owners */}
      {data.owners.length > 0 && (
        <section className="space-y-2">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">Owner</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.owners.map((person) => (
              <PersonCard key={person.id} person={person} isOwner={data.isOwner} />
            ))}
          </div>
        </section>
      )}

      {/* Admins */}
      {data.admins.length > 0 && (
        <section className="space-y-2">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-cobalt">Admins</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.admins.map((person) => (
              <PersonCard key={person.id} person={person} isOwner={data.isOwner} />
            ))}
          </div>
        </section>
      )}

      {/* Teams */}
      {data.teams.map((team) => {
        const teamManagers = data.managers.filter((m) => m.managedTeams.some((t) => t.id === team.id))
        const teamMembers = data.members.filter((m) => m.memberTeams.some((t) => t.id === team.id))
        const isExpanded = expandedTeams.has(team.id)
        const totalInTeam = teamManagers.length + teamMembers.length

        return (
          <section key={team.id} className="rounded-lg border border-line bg-bone-raised overflow-hidden">
            <button
              onClick={() => toggleTeam(team.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bone"
            >
              {isExpanded ? <ChevronDown className="size-4 text-stone" /> : <ChevronRight className="size-4 text-stone" />}
              <Users className="size-4 text-cobalt" />
              <div className="flex-1">
                <p className="text-[14px] font-medium text-ink">{team.name}</p>
                {team.description && <p className="text-[12px] text-graphite">{team.description}</p>}
              </div>
              <span className="text-[12px] text-graphite">{totalInTeam} members</span>
            </button>

            {isExpanded && (
              <div className="border-t border-line px-4 py-3 space-y-2">
                {teamManagers.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-stone mb-1">Managers</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {teamManagers.map((person) => (
                        <PersonCard key={person.id} person={person} isOwner={data.isOwner} />
                      ))}
                    </div>
                  </div>
                )}
                {teamMembers.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-stone mb-1">Members</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {teamMembers.map((person) => (
                        <PersonCard key={person.id} person={person} isOwner={data.isOwner} />
                      ))}
                    </div>
                  </div>
                )}
                {totalInTeam === 0 && (
                  <p className="text-[12px] text-graphite py-4 text-center">No members yet.</p>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function BypassAllButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)

  async function handleBypass() {
    if (!confirm('Skip voice-calibration onboarding for every rep without a voice profile?')) return
    setStatus('running'); setResult(null)
    try {
      const res = await fetch('/api/admin/people/bypass-onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setResult({ created: json.created, skipped: json.skipped })
      setStatus('done')
    } catch { setStatus('error') }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={handleBypass} disabled={status === 'running'} className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-bone disabled:opacity-50">
        <Settings className="size-3.5" />
        {status === 'running' ? 'Running…' : 'Bypass Onboarding'}
      </button>
      {status === 'done' && result && (
        <p className="text-[10px] text-status-success flex items-center gap-1"><CheckCircle2 className="size-3" />{result.created} created · {result.skipped} skipped</p>
      )}
    </div>
  )
}

function PersonCard({ person, isOwner }: { person: any; isOwner: boolean }) {
  return (
    <div className="rounded border border-line bg-bone p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-solid text-[11px] font-medium text-on-solid">
          {person.name.charAt(0)}
        </div>
        <div>
          <p className="text-[13px] font-medium text-ink">{person.name}</p>
          <div className="flex items-center gap-2">
            <StatusBadge status={person.role} variant={person.role === 'OWNER' ? 'orange' : person.role === 'ADMIN' ? 'cobalt' : person.role === 'MANAGER' ? 'success' : 'neutral'} />
            {person.managedTeams?.length > 0 && (
              <span className="text-[10px] text-graphite">Manages: {person.managedTeams.map((t: any) => t.name).join(', ')}</span>
            )}
            {person.memberTeams?.length > 0 && person.managedTeams?.length === 0 && (
              <span className="text-[10px] text-graphite">{person.memberTeams.map((t: any) => t.name).join(', ')}</span>
            )}
          </div>
        </div>
      </div>
      {isOwner && (
        <button className="rounded border border-line px-2 py-1 text-[11px] text-graphite hover:text-ink hover:bg-bone-raised transition-colors">
          Edit
        </button>
      )}
    </div>
  )
}

export function PeopleViewSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-6 sm:px-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-3.5 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[0,1,2,3].map(i => (<Skeleton key={i} className="h-20" />))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  )
}
