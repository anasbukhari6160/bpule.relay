'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Users, CheckCircle2, AlertTriangle, Activity, ChevronRight, Shield, Target } from 'lucide-react'
import { cn } from 'cn'
import type { AccountabilityDashboardData } from '@/lib/relay/dashboard-loader'
import { DashHeader, EmptyNote, Initials, Meter, Panel, Pill, StatTile, type Tone } from '@/components/dashboard/kit'

type TeamPerson = NonNullable<AccountabilityDashboardData['commandCenter']>['team'][number]

interface Health {
  health: number
  state: string
  bottleneck: string | null
}

const STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  ON_TRACK: { label: 'On track', tone: 'success' },
  NEEDS_ATTENTION: { label: 'Attention', tone: 'warning' },
  BEHIND: { label: 'Behind', tone: 'danger' },
  CAUGHT_UP: { label: 'Caught up', tone: 'cobalt' },
  BLOCKED: { label: 'Blocked', tone: 'neutral' },
}

function parseProgress(progress: string): { done: number; target: number } {
  const [done, target] = progress.split('/').map((n) => Number.parseInt(n, 10) || 0)
  return { done: done ?? 0, target: target ?? 0 }
}

function statusPill(person: TeamPerson): { label: string; tone: Tone } {
  if (person.status === 'completed' || person.remaining === 0) return { label: 'Done', tone: 'success' }
  if (person.status === 'behind') return { label: `Behind · ${person.remaining} left`, tone: 'warning' }
  return { label: `${person.remaining} left`, tone: 'cobalt' }
}

/** Admin "Today": the team's day, never the admin's own numbers. */
export function AdminDashboard({ data }: { data: AccountabilityDashboardData | null }) {
  const team = useMemo(() => data?.commandCenter?.team ?? [], [data])
  const health = useTeamHealth(team.map((t) => t.personId))

  if (!data) {
    return <EmptyNote className="rounded-xl border border-dashed border-line">Could not load the team dashboard. Refresh to try again.</EmptyNote>
  }

  const { commandCenter } = data
  const teamHealth = commandCenter?.teamHealth
  const attention = commandCenter?.attentionItems ?? []
  const working = teamHealth?.working ?? 0
  const totals = team.reduce((acc, p) => {
    const { done, target } = parseProgress(p.progress)
    return { done: acc.done + done, target: acc.target + target }
  }, { done: 0, target: 0 })
  const teamPct = totals.target > 0 ? Math.round((totals.done / totals.target) * 100) : 0

  const sorted = [...team].sort((a, b) => {
    const rank = (p: TeamPerson) => (p.status === 'behind' ? 0 : p.remaining > 0 ? 1 : 2)
    return rank(a) - rank(b) || b.remaining - a.remaining
  })

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        title="Team today"
        subtitle={working > 0
          ? `${working} ${working === 1 ? 'person is' : 'people are'} working against targets today${attention.length > 0 ? ` · ${attention.length} need${attention.length === 1 ? 's' : ''} attention` : ' · everyone is on pace'}.`
          : 'Nobody has targets for today yet. Assign daily packs to start tracking.'}
        actions={
          <>
            <Link href="/admin/targets" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bone-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:border-ink/20">
              <Target className="size-3.5" aria-hidden="true" />Targets
            </Link>
            <Link href="/admin/command-center" className="inline-flex items-center gap-1.5 rounded-md bg-solid px-3 py-1.5 text-[12px] font-medium text-on-solid hover:opacity-90">
              <Shield className="size-3.5" aria-hidden="true" />Command center
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Working today" value={working} icon={<Users className="size-3.5" />} tone="cobalt" sub={`${teamHealth?.onTrack ?? 0} on pace`} href="/team" />
        <StatTile label="Day complete" value={teamHealth?.closed ?? 0} icon={<CheckCircle2 className="size-3.5" />} tone="success" sub={working > 0 ? `of ${working} people` : '—'} />
        <StatTile label="Behind" value={teamHealth?.behind ?? 0} icon={<AlertTriangle className="size-3.5" />} tone={(teamHealth?.behind ?? 0) > 0 ? 'warning' : 'neutral'} sub={(teamHealth?.behind ?? 0) > 0 ? 'Check in with them' : 'All clear'} href="/admin/accountability" />
        <StatTile label="Team actions" value={`${totals.done}`} icon={<Activity className="size-3.5" />} tone="orange" sub={totals.target > 0 ? `${teamPct}% of ${totals.target} target` : 'No targets today'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Who is covering their numbers"
          subtitle="Sorted by who needs help first · health blends pace, replies and follow-ups"
          action={<Link href="/admin/accountability" className="text-[11px] font-medium text-cobalt hover:underline">This week</Link>}
          flush
        >
          {sorted.length === 0 ? (
            <EmptyNote>
              <span>No targets assigned for today. <Link href="/admin/targets" className="font-medium text-cobalt hover:underline">Assign daily packs</Link></span>
            </EmptyNote>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.1em] text-stone">
                    <th scope="col" className="px-4 py-2 font-medium sm:px-5">Person</th>
                    <th scope="col" className="w-[150px] px-3 py-2 font-medium">Progress</th>
                    <th scope="col" className="px-3 py-2 font-medium">Health</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    <th scope="col" className="w-8 px-3 py-2"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {sorted.map((person) => {
                    const { done, target } = parseProgress(person.progress)
                    const h = health[person.personId]
                    const pill = statusPill(person)
                    const state = h ? STATE_LABEL[h.state] : undefined
                    return (
                      <tr key={person.personId} className="group hover:bg-bone">
                        <td className="px-4 py-2.5 sm:px-5">
                          <Link href={`/team/${person.personId}`} className="flex items-center gap-2.5">
                            <Initials name={person.personName} tone={pill.tone} />
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-ink group-hover:underline">{person.personName}</span>
                              <span className="block truncate text-[11px] text-stone">{person.workingAs.length > 0 ? person.workingAs.join(', ') : 'No identity assigned'}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Meter value={done} max={target} className="min-w-[60px] flex-1" />
                            <span className="w-12 text-right tabular-nums text-graphite">{done}/{target}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {h ? (
                            <span className="flex items-center gap-1.5">
                              <span className={cn('tabular-nums font-medium', h.health >= 70 ? 'text-status-success' : h.health >= 40 ? 'text-orange' : 'text-status-danger')}>{h.health}</span>
                              {h.bottleneck && <span className="truncate text-[11px] text-stone">{h.bottleneck.replace(/_/g, ' ').toLowerCase()}</span>}
                            </span>
                          ) : h === null ? (
                            <span className="text-stone">—</span>
                          ) : (
                            <span className="inline-block h-3 w-10 animate-pulse rounded bg-bone" aria-label="Loading health" />
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            <Pill tone={pill.tone}>{pill.label}</Pill>
                            {state && pill.label !== 'Done' && state.tone !== 'success' && state.tone !== pill.tone && <Pill tone={state.tone}>{state.label}</Pill>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link href={`/team/${person.personId}`} aria-label={`Open ${person.personName}`}>
                            <ChevronRight className="size-4 text-stone group-hover:text-ink" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Needs attention" subtitle="Half the day gone, under 60% done" action={attention.length > 0 ? <Pill tone="warning">{attention.length}</Pill> : undefined} flush>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <CheckCircle2 className="size-6 text-status-success" aria-hidden="true" />
              <p className="mt-2 text-[13px] font-medium text-ink">Everyone is on pace</p>
              <p className="mt-1 text-[11px] text-stone">People show up here once they fall behind.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line/70">
              {attention.map((item, i) => (
                <li key={`${item.repId}-${i}`}>
                  <Link href={`/team/${item.repId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-bone sm:px-5">
                    <Initials name={item.repName} tone="warning" size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{item.repName}</p>
                      <p className="text-[11px] text-graphite">{item.remaining} actions left · {item.identityName}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-stone" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

/** Execution health per rep — fetched after paint so the table shows immediately. */
function useTeamHealth(repIds: string[]): Record<string, Health | null> {
  const [rows, setRows] = useState<Record<string, Health | null>>({})
  const key = repIds.join(',')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    for (const repId of key.split(',')) {
      fetch(`/api/admin/performance?repId=${encodeURIComponent(repId)}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((d: { executionHealth?: number; state?: string; primaryBottleneck?: string | null } | null) => {
          if (cancelled) return
          setRows((prev) => ({
            ...prev,
            [repId]: d ? { health: d.executionHealth ?? 0, state: d.state ?? 'ON_TRACK', bottleneck: d.primaryBottleneck ?? null } : null,
          }))
        })
        .catch(() => { if (!cancelled) setRows((prev) => ({ ...prev, [repId]: null })) })
    }
    return () => { cancelled = true }
  }, [key])

  return rows
}
