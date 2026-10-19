'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Reply,
  Send,
  Target,
  UserPlus,
  Users,
} from 'lucide-react'
import { cn } from 'cn'
import { EventsDrilldown } from '@/components/admin/events-drilldown'
import { DashHeader, EmptyNote, Initials, Panel, Pill, type Tone } from '@/components/dashboard/kit'
import { formatMinutesAgo } from '@/lib/ui/time'
import type { CommandCenterData, TeamRow, ExceptionItem, OpportunityFeedItem, TeamMemberStatus, ExceptionSeverity, RepQueueSnapshot } from '@/lib/admin/command-center-v2'
import { loadRepQueueSnapshot } from '@/lib/admin/command-center-v2'

function isoDay(d: Date): string {
  return d.toISOString().split('T')[0]
}

function today(): string {
  return isoDay(new Date())
}

function shiftDay(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return isoDay(d)
}

function formatDateLabel(date: string): string {
  if (date === today()) return 'Today'
  if (date === shiftDay(today(), -1)) return 'Yesterday'
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const STATUS: Record<TeamMemberStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  waiting: { label: 'Waiting', tone: 'neutral' },
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  inactive: { label: 'Inactive', tone: 'danger' },
}

const SEVERITY: Record<ExceptionSeverity, { label: string; tone: Tone; rank: number }> = {
  critical: { label: 'Critical', tone: 'danger', rank: 0 },
  urgent: { label: 'Urgent', tone: 'orange', rank: 1 },
  attention: { label: 'Attention', tone: 'warning', rank: 2 },
}

/**
 * Command center — the admin's decision queue for one day: what happened,
 * what is stuck, which leads are with the wrong sender, and each person's queue.
 */
export function CommandCenterV2({ orgId }: { orgId: string }) {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<CommandCenterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedRep, setExpandedRep] = useState<string | null>(null)
  const [drilldown, setDrilldown] = useState<{ action: string; repId: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/command-center-v2?date=${date}`)
        if (res.ok && !cancelled) setData(await res.json())
        else if (!cancelled) setData(null)
      } catch (err) {
        if (!cancelled) console.error('Failed to load command center:', err)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [date])

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow="Command center"
        title={formatDateLabel(date)}
        subtitle="What needs a decision: stuck replies, leads with the wrong sender, and each person's queue."
        actions={<DateNavigator date={date} onChange={(d) => { setExpandedRep(null); setDate(d) }} />}
      />

      {drilldown && (
        <EventsDrilldown date={date} actionType={drilldown.action} repId={drilldown.repId} onClose={() => setDrilldown(null)} />
      )}

      {loading ? (
        <CommandSkeleton />
      ) : !data ? (
        <EmptyNote className="rounded-xl border border-dashed border-line">The command center could not load. Refresh to try again.</EmptyNote>
      ) : (
        <>
          <BriefStrip brief={data.brief} onDrilldown={(action) => setDrilldown({ action, repId: null })} />
          <ChangesStrip data={data} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="min-w-0 space-y-4 lg:col-span-3">
              <TeamSection
                team={data.team}
                expandedRep={expandedRep}
                onToggleExpand={(id) => setExpandedRep(expandedRep === id ? null : id)}
                date={date}
                orgId={orgId}
              />
              <OpportunitySection opportunities={data.opportunities} />
            </div>
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <ExceptionSection exceptions={data.exceptions} />
              <RoutingOpportunitiesSection orgId={orgId} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DateNavigator({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const isToday = date === today()
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-bone p-0.5">
      <button type="button" onClick={() => onChange(shiftDay(date, -1))} className="rounded-md p-1.5 text-stone hover:text-ink" aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-ink hover:bg-bone-raised">
        <Calendar className="size-3.5 text-stone" aria-hidden="true" />
        <span>{formatDateLabel(date)}</span>
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Pick a date"
        />
      </label>
      <button type="button" onClick={() => onChange(shiftDay(date, 1))} disabled={isToday} className="rounded-md p-1.5 text-stone hover:text-ink disabled:opacity-30" aria-label="Next day">
        <ChevronRight className="size-4" />
      </button>
      {!isToday && (
        <button type="button" onClick={() => onChange(today())} className="rounded-md px-2 py-1 text-[12px] font-medium text-cobalt hover:bg-bone-raised">
          Today
        </button>
      )}
    </div>
  )
}

function BriefStrip({ brief, onDrilldown }: { brief: CommandCenterData['brief']; onDrilldown: (action: string) => void }) {
  const metrics = [
    { key: 'activeReps', label: 'Active people', value: brief.activeReps, icon: <Users className="size-3.5" /> },
    { key: 'connectionsSent', label: 'Connections', value: brief.connectionsSent, icon: <UserPlus className="size-3.5" />, drilldown: 'CONNECTION_SENT' },
    { key: 'dmsSent', label: 'First DMs', value: brief.dmsSent, icon: <Send className="size-3.5" />, drilldown: 'DM_SENT' },
    { key: 'followupsSent', label: 'Follow-ups', value: brief.followupsSent, icon: <MessageSquare className="size-3.5" />, drilldown: 'FOLLOWUP_SENT' },
    { key: 'repliesReceived', label: 'Client replies', value: brief.repliesReceived, icon: <Reply className="size-3.5" />, drilldown: 'REPLY_RECEIVED' },
    { key: 'leadsExtracted', label: 'Leads added', value: brief.leadsExtracted, icon: <Target className="size-3.5" />, drilldown: 'LEAD_EXTRACTED' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {metrics.map((m) => {
        const clickable = Boolean(m.drilldown && m.value > 0)
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-mono-medium truncate text-[10px] uppercase tracking-[0.12em] text-stone">{m.label}</p>
              <span className="text-stone">{m.icon}</span>
            </div>
            <p className="mt-2 text-[24px] font-light leading-none tabular-nums text-ink">{m.value}</p>
            <p className="mt-1.5 text-[11px] text-stone">{clickable ? 'See who →' : ' '}</p>
          </>
        )
        return clickable ? (
          <button key={m.key} type="button" onClick={() => onDrilldown(m.drilldown!)} className="rounded-xl border border-line bg-bone-raised px-4 py-3.5 text-left transition-colors hover:border-orange/40">
            {body}
          </button>
        ) : (
          <div key={m.key} className="rounded-xl border border-line bg-bone-raised px-4 py-3.5">{body}</div>
        )
      })}
    </div>
  )
}

/** Since yesterday + today's intelligence, as one line of change chips. */
function ChangesStrip({ data }: { data: CommandCenterData }) {
  const d = data.sinceYesterday
  const intel = data.todaysIntelligence
  const items: Array<{ label: string; tone: Tone }> = []
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  if (d) {
    if (d.newLeads > 0) items.push({ label: plural(d.newLeads, 'new lead', 'new leads'), tone: 'success' })
    if (d.newReplies > 0) items.push({ label: plural(d.newReplies, 'new reply', 'new replies'), tone: 'success' })
    if (d.opportunitiesAdvanced > 0) items.push({ label: plural(d.opportunitiesAdvanced, 'deal advanced', 'deals advanced'), tone: 'success' })
    if (d.wins > 0) items.push({ label: plural(d.wins, 'win', 'wins'), tone: 'success' })
    if (d.leadsWentStale > 0) items.push({ label: plural(d.leadsWentStale, 'lead went stale', 'leads went stale'), tone: 'warning' })
    if (d.referralsUntouched > 0) items.push({ label: plural(d.referralsUntouched, 'referral untouched', 'referrals untouched'), tone: 'warning' })
    if (d.repsWentInactive > 0) items.push({ label: plural(d.repsWentInactive, 'person inactive', 'people inactive'), tone: 'danger' })
  }
  if (intel) {
    if (intel.newHighValueSignals > 0) items.push({ label: plural(intel.newHighValueSignals, 'high-value signal', 'high-value signals'), tone: 'orange' })
    if (intel.leadsToReassign > 0) items.push({ label: plural(intel.leadsToReassign, 'lead to reassign', 'leads to reassign'), tone: 'cobalt' })
  }
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bone-raised px-4 py-3">
      <span className="text-mono-medium mr-1 text-[10px] uppercase tracking-[0.14em] text-stone">Since yesterday</span>
      {items.map((item) => <Pill key={item.label} tone={item.tone}>{item.label}</Pill>)}
    </div>
  )
}

function ExceptionSection({ exceptions }: { exceptions: ExceptionItem[] }) {
  const [showAll, setShowAll] = useState(false)
  const sorted = [...exceptions].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank)
  const visible = showAll ? sorted : sorted.slice(0, 6)

  return (
    <Panel
      title="Exceptions"
      subtitle="Stuck replies, overdue follow-ups, idle people"
      action={exceptions.length > 0 ? <Pill tone="warning">{exceptions.length}</Pill> : undefined}
      flush
    >
      {exceptions.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <CheckCircle2 className="size-6 text-status-success" aria-hidden="true" />
          <p className="mt-2 text-[13px] font-medium text-ink">Nothing is stuck</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line/70">
            {visible.map((item) => {
              const sev = SEVERITY[item.severity]
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <Pill tone={sev.tone} className="mt-0.5 shrink-0">{sev.label}</Pill>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{item.title}</p>
                    <p className="text-[12px] text-graphite">{item.detail}</p>
                  </div>
                  {item.leadId && (
                    <Link href={`/leads/${item.leadId}`} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-graphite hover:border-ink/20 hover:text-ink">Open</Link>
                  )}
                </li>
              )
            })}
          </ul>
          {exceptions.length > 6 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="w-full border-t border-line px-5 py-2 text-left text-[12px] font-medium text-cobalt hover:underline">
              {showAll ? 'Show less' : `Show all ${exceptions.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  )
}

function TeamSection({ team, expandedRep, onToggleExpand, date, orgId }: {
  team: TeamRow[]
  expandedRep: string | null
  onToggleExpand: (id: string) => void
  date: string
  orgId: string
}) {
  const [snapshots, setSnapshots] = useState<Record<string, RepQueueSnapshot | null>>({})
  const [loadingSnapshot, setLoadingSnapshot] = useState<string | null>(null)

  useEffect(() => {
    if (!expandedRep || expandedRep in snapshots) return
    const row = team.find((t) => t.repId === expandedRep)
    if (!row) return
    setLoadingSnapshot(expandedRep)
    loadRepQueueSnapshot(orgId, row.repId, row.repName, date)
      .then((snap) => setSnapshots((prev) => ({ ...prev, [expandedRep]: snap })))
      .catch(() => setSnapshots((prev) => ({ ...prev, [expandedRep]: null })))
      .finally(() => setLoadingSnapshot(null))
  }, [expandedRep, date, team, snapshots, orgId])

  const sorted = [...team].sort((a, b) => {
    const rank = (r: TeamRow) => (r.status === 'needs_attention' ? 0 : r.status === 'inactive' ? 1 : r.status === 'waiting' ? 2 : 3)
    return rank(a) - rank(b) || b.pendingReplies - a.pendingReplies || b.actionsToday - a.actionsToday
  })

  return (
    <Panel title="Team" subtitle="Open a person to see their next actions" action={<span className="text-[11px] text-stone">{team.length} {team.length === 1 ? 'person' : 'people'}</span>} flush>
      {team.length === 0 ? (
        <EmptyNote>No one on the team yet.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line/70">
          {sorted.map((row) => {
            const cfg = STATUS[row.status]
            const open = expandedRep === row.repId
            const snap = snapshots[row.repId]
            return (
              <li key={row.repId}>
                <button
                  type="button"
                  onClick={() => onToggleExpand(row.repId)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bone sm:px-5"
                >
                  <Initials name={row.repName} tone={cfg.tone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[13px] font-medium text-ink">{row.repName}</span>
                      <Pill tone={cfg.tone}>{cfg.label}</Pill>
                      {row.pendingReplies > 0 && <Pill tone="warning">{row.pendingReplies} waiting</Pill>}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-stone">
                      {row.actionsToday > 0
                        ? [row.connectionsSent && `${row.connectionsSent} conn`, row.dmsSent && `${row.dmsSent} DM`, row.followupsSent && `${row.followupsSent} follow-up`, row.repliesReceived && `${row.repliesReceived} replies in`].filter(Boolean).join(' · ')
                        : 'No actions'}
                      {' · '}last active {formatMinutesAgo(row.lastActivityMinutes)}
                    </p>
                  </div>
                  <span className="text-[18px] font-light tabular-nums text-ink">{row.actionsToday}</span>
                  <ChevronRight className={cn('size-4 shrink-0 text-stone transition-transform', open && 'rotate-90')} aria-hidden="true" />
                </button>

                {open && (
                  <div className="space-y-3 border-t border-line/60 bg-bone/50 px-4 py-3 sm:px-5">
                    <dl className="grid grid-cols-3 gap-3 text-[11px]">
                      <div><dt className="text-stone">Assigned leads</dt><dd className="text-[14px] font-medium text-ink">{row.assignedLeads}</dd></div>
                      <div><dt className="text-stone">Replies waiting</dt><dd className={cn('text-[14px] font-medium', row.pendingReplies > 0 ? 'text-status-warning' : 'text-ink')}>{row.pendingReplies}</dd></div>
                      <div><dt className="text-stone">Leads added</dt><dd className="text-[14px] font-medium text-ink">{row.leadsExtracted}</dd></div>
                    </dl>

                    {loadingSnapshot === row.repId && <p className="text-[11px] text-stone">Loading queue…</p>}
                    {snap && (
                      snap.topActions.length === 0 ? (
                        <p className="text-[11px] text-graphite">Nothing needs attention in their queue.</p>
                      ) : (
                        <ul className="space-y-1">
                          {snap.topActions.map((action, idx) => (
                            <li key={idx}>
                              <Link href={action.leadId ? `/leads/${action.leadId}` : '#'} className="flex items-center gap-2 rounded-md border border-line/70 bg-bone-raised px-3 py-2 text-[11px] hover:border-ink/20">
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium text-ink">{action.action}</span>
                                  <span className="text-graphite"> · {action.company}</span>
                                  <span className="block truncate text-[10px] text-stone">{action.reason}</span>
                                </span>
                                <Pill tone={action.urgency === 'urgent' ? 'danger' : action.urgency === 'high' ? 'orange' : 'neutral'}>{action.urgency}</Pill>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Link href={`/team/${row.repId}?date=${date}`} className="rounded-md border border-line bg-bone-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:border-ink/20">View timeline</Link>
                      {row.pendingReplies > 0 && (
                        <Link href={`/inbound?repId=${row.repId}`} className="rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-1.5 text-[12px] font-medium text-status-warning hover:bg-status-warning/10">View replies</Link>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function OpportunitySection({ opportunities }: { opportunities: OpportunityFeedItem[] }) {
  const [showAll, setShowAll] = useState(false)
  if (opportunities.length === 0) return null
  const visible = showAll ? opportunities : opportunities.slice(0, 5)

  return (
    <Panel title="Best open opportunities" subtitle="Highest-scoring live leads and how long they have waited" action={<Pill tone="orange">{opportunities.length}</Pill>} flush>
      <ul className="divide-y divide-line/70">
        {visible.map((opp) => {
          const weakProfile = opp.recommendedProfileScore !== null && opp.currentProfileScore !== null && opp.recommendedProfileScore > opp.currentProfileScore + 15
          return (
            <li key={opp.leadId}>
              <Link href={`/leads/${opp.leadId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-bone sm:px-5">
                <span className="mt-0.5 w-9 shrink-0 rounded-md bg-orange/10 py-0.5 text-center text-[11px] font-medium tabular-nums text-orange">{opp.score}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{opp.company}{opp.contactName && <span className="font-normal text-stone"> · {opp.contactName}</span>}</p>
                  <p className="text-[12px] text-graphite">
                    {opp.repName} · {opp.currentStage}
                    {opp.daysSinceAction !== null && opp.daysSinceAction > 3 && <span className="text-status-warning"> · {opp.daysSinceAction}d idle</span>}
                  </p>
                  {weakProfile && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-orange">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      Better sender: {opp.recommendedProfileName} ({opp.recommendedProfileScore}) vs {opp.currentProfileName} ({opp.currentProfileScore})
                    </p>
                  )}
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-stone" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>
      {opportunities.length > 5 && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="w-full border-t border-line px-5 py-2 text-left text-[12px] font-medium text-cobalt hover:underline">
          {showAll ? 'Show less' : `Show all ${opportunities.length}`}
        </button>
      )}
    </Panel>
  )
}

function RoutingOpportunitiesSection({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Array<{
    leadId: string
    company: string
    score: number
    currentSenderName: string | null
    currentSenderMatch: number
    bestSenderName: string | null
    bestSenderMatch: number
    mismatchDelta: number
    reasons: string[]
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/routing-opportunities')
      .then((r) => (r.ok ? r.json() : { opportunities: [] }))
      .then((json) => { if (!cancelled) setData(json.opportunities ?? []) })
      .catch(() => { if (!cancelled) setData([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId])

  return (
    <Panel
      title="Wrong sender"
      subtitle="Leads another profile would match better"
      action={data.length > 0 ? <Pill tone="cobalt">{data.length}</Pill> : undefined}
      flush
    >
      {loading ? (
        <p className="px-5 py-4 text-[12px] text-stone">Checking sender fit…</p>
      ) : data.length === 0 ? (
        <EmptyNote>Every lead is with its best-matching sender.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line/70">
          {data.slice(0, 8).map((item) => (
            <li key={item.leadId}>
              <Link href={`/leads/${item.leadId}`} className="block px-4 py-3 hover:bg-bone sm:px-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">{item.company}</span>
                  <Pill tone="success">+{item.mismatchDelta}% fit</Pill>
                </div>
                <p className="mt-1 text-[11px] text-graphite">
                  {item.currentSenderName ?? 'Unassigned'} ({item.currentSenderMatch}%) → <span className="font-medium text-ink">{item.bestSenderName ?? '—'}</span> ({item.bestSenderMatch}%)
                </p>
                {item.reasons[0] && <p className="mt-0.5 truncate text-[10px] text-stone">{item.reasons[0]}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function CommandSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading command center">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-xl border border-line bg-bone-raised" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-[320px] animate-pulse rounded-xl border border-line bg-bone-raised lg:col-span-3" />
        <div className="h-[320px] animate-pulse rounded-xl border border-line bg-bone-raised lg:col-span-2" />
      </div>
    </div>
  )
}
