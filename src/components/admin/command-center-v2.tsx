'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Eye,
  MessageSquare,
  Target,
  Users,
  Zap,
  Briefcase,
  UserCircle2,
  BarChart3,
  Settings,
  PenLine,
  TrendingUp,
  Send,
  Reply,
  UserPlus,
} from 'lucide-react'
import { cn } from 'cn'
import { StatusBadge } from '@/components/ui/status-badge'
import { EventsDrilldown } from '@/components/admin/events-drilldown'
import { ContributionHeatmap } from '@/components/performance/contribution-heatmap'

import { formatMinutesAgo } from '@/lib/ui/time'
import type { CommandCenterData, TeamRow, ExceptionItem, OpportunityFeedItem, TeamMemberStatus, ExceptionSeverity, RepQueueSnapshot } from '@/lib/admin/command-center-v2'
import { loadRepQueueSnapshot } from '@/lib/admin/command-center-v2'


function today(): string {
  return new Date().toISOString().split('T')[0]
}

function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function formatDateLabel(date: string): string {
  const d = new Date(date + 'T00:00:00')
  const todayDate = today()
  if (date === todayDate) return 'Today'
  const yestDate = yesterday()
  if (date === yestDate) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}


function statusConfig(status: TeamMemberStatus): { label: string; variant: 'success' | 'warning' | 'danger' | 'orange' | 'neutral' } {
  switch (status) {
    case 'active': return { label: 'Active', variant: 'success' }
    case 'waiting': return { label: 'Waiting', variant: 'neutral' }
    case 'needs_attention': return { label: 'Needs attention', variant: 'warning' }
    case 'inactive': return { label: 'Inactive', variant: 'danger' }
  }
}

function severityConfig(severity: ExceptionSeverity): { label: string; variant: 'warning' | 'danger' | 'orange' } {
  switch (severity) {
    case 'attention': return { label: 'Attention', variant: 'warning' }
    case 'urgent': return { label: 'Urgent', variant: 'orange' }
    case 'critical': return { label: 'Critical', variant: 'danger' }
  }
}


const OPERATE_NAV = [
  { href: '/admin/revenue-identities', label: 'Identities', icon: UserCircle2, detail: 'Sender identities' },
  { href: '/admin/targets', label: 'Targets', icon: Target, detail: 'Daily expectations' },
  { href: '/admin/people', label: 'People', icon: Users, detail: 'Roles and teams' },
  { href: '/admin/revenue-intelligence', label: 'Revenue', icon: BarChart3, detail: 'Funnel analytics' },
  { href: '/leads', label: 'Leads', icon: Target, detail: 'All prospects' },
  { href: '/inbound', label: 'Inbound', icon: MessageSquare, detail: 'Replies waiting' },
  { href: '/upwork', label: 'Jobs', icon: Briefcase, detail: 'Upwork pipeline' },
  { href: '/relay', label: 'Conversations', icon: MessageSquare, detail: 'Live threads' },
  { href: '/content', label: 'Studio', icon: PenLine, detail: 'Content engine' },
  { href: '/content-v2/growth', label: 'Growth', icon: TrendingUp, detail: 'Editorial' },
  { href: '/profiles', label: 'Profiles', icon: UserCircle2, detail: 'Team profiles' },
  { href: '/admin/ai-usage', label: 'AI Runtime', icon: Settings, detail: 'Provider health' },
]


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
        if (res.ok && !cancelled) {
          const json = await res.json()
          setData(json)
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to load command center:', err)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [date])

  return (
    <div className="min-h-screen bg-bone pb-10">
      {/* Header */}
      <header className="border-b border-line bg-bone-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
          <div>
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">
              Command Center
            </p>
            <h1 className="mt-1 text-[22px] font-medium tracking-[-0.02em] text-ink">
              {formatDateLabel(date)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <DateNavigator date={date} onChange={setDate} />
          </div>
        </div>
      </header>

      {/* Events drill-down drawer */}
      {drilldown && (
        <EventsDrilldown
          date={date}
          actionType={drilldown.action}
          repId={drilldown.repId}
          onClose={() => setDrilldown(null)}
        />
      )}

      <main className="mx-auto max-w-6xl px-5 py-6 sm:px-6">
        {loading ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-line bg-bone-raised p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="size-4 animate-pulse rounded bg-bone" />
                <div className="h-3 w-20 animate-pulse rounded bg-bone" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} className="animate-pulse rounded-lg border border-line/40 bg-bone p-3">
                    <div className="h-3 w-12 rounded bg-bone-raised mb-2" />
                    <div className="h-5 w-8 rounded bg-bone-raised mb-1.5" />
                    <div className="h-4 w-full rounded bg-bone-raised" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-bone-raised p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="size-4 animate-pulse rounded bg-bone" />
                <div className="h-3 w-16 animate-pulse rounded bg-bone" />
              </div>
              <div className="space-y-3">
                {[0,1,2].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="size-16 animate-pulse rounded bg-bone" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 animate-pulse rounded bg-bone" />
                      <div className="h-2.5 w-48 animate-pulse rounded bg-bone" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Since Yesterday */}
            {data.sinceYesterday && (
              <SinceYesterdaySection diff={data.sinceYesterday} />
            )}

            {/* Today's Intelligence */}
            {data.todaysIntelligence && (
              <TodaysIntelligenceSection intelligence={data.todaysIntelligence} />
            )}

            {/* Team Consistency */}
            <TeamConsistencySection orgId={orgId} date={date} />

            {/* Daily Brief */}
            <DailyBriefSection brief={data.brief} date={date} onDrilldown={(action) => setDrilldown({ action, repId: null })} />

            {/* Exceptions */}
            {data.exceptions.length > 0 && (
              <ExceptionSection exceptions={data.exceptions} />
            )}

            {/* Team */}
            <TeamSection
              team={data.team}
              expandedRep={expandedRep}
              onToggleExpand={(id) => setExpandedRep(expandedRep === id ? null : id)}
              date={date}
              orgId={orgId}
            />

            {/* Opportunities */}
            {data.opportunities.length > 0 && (
              <OpportunitySection opportunities={data.opportunities} />
            )}

            {/* Routing Opportunities */}
            <RoutingOpportunitiesSection orgId={orgId} />

            {/* Navigation */}
            <OperateSection />
          </div>
        ) : (
          <p className="py-12 text-center text-graphite">No data available.</p>
        )}
      </main>
    </div>
  )
}


function DateNavigator({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(yesterday())}
        className="rounded-md border border-line px-2 py-1 text-[12px] text-graphite hover:border-ink/20 hover:text-ink"
      >
        ← Prev
      </button>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-md border border-line bg-bone-raised px-3 py-1 text-[12px] text-ink hover:border-ink/20"
        >
          <Calendar className="size-3" />
          {formatDateLabel(date)}
          <ChevronDown className="size-3" />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-10 mt-1 rounded-md border border-line bg-bone-raised p-1 shadow-lg">
            {[
              { label: 'Today', value: today() },
              { label: 'Yesterday', value: yesterday() },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={cn(
                  'block w-full rounded px-3 py-1.5 text-left text-[12px] hover:bg-bone',
                  date === opt.value ? 'text-orange font-medium' : 'text-ink',
                )}
              >
                {opt.label}
              </button>
            ))}
            <div className="border-t border-line/60 px-2 py-1">
              <input
                type="date"
                value={date}
                onChange={e => { onChange(e.target.value); setOpen(false) }}
                className="w-full rounded border border-line bg-bone px-2 py-1 text-[12px] text-ink"
              />
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => onChange(today())}
        className="rounded-md border border-line px-2 py-1 text-[12px] text-graphite hover:border-ink/20 hover:text-ink"
      >
        Today
      </button>
    </div>
  )
}


function SinceYesterdaySection({ diff }: { diff: NonNullable<CommandCenterData['sinceYesterday']> }) {
  const items: Array<{ label: string; positive: boolean }> = []

  if (diff.newLeads > 0) items.push({ label: `${diff.newLeads} new lead${diff.newLeads === 1 ? '' : 's'}`, positive: true })
  if (diff.newReplies > 0) items.push({ label: `${diff.newReplies} new repl${diff.newReplies === 1 ? 'y' : 'ies'}`, positive: true })
  if (diff.opportunitiesAdvanced > 0) items.push({ label: `${diff.opportunitiesAdvanced} opportun${diff.opportunitiesAdvanced === 1 ? 'ity' : 'ies'} advanced`, positive: true })
  if (diff.wins > 0) items.push({ label: `${diff.wins} win${diff.wins === 1 ? '' : 's'}`, positive: true })
  if (diff.leadsWentStale > 0) items.push({ label: `${diff.leadsWentStale} lead${diff.leadsWentStale === 1 ? '' : 's'} went stale`, positive: false })
  if (diff.referralsUntouched > 0) items.push({ label: `${diff.referralsUntouched} referral${diff.referralsUntouched === 1 ? '' : 's'} untouched`, positive: false })
  if (diff.repsWentInactive > 0) items.push({ label: `${diff.repsWentInactive} rep${diff.repsWentInactive === 1 ? '' : 's'} inactive`, positive: false })

  if (items.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-line bg-bone-raised p-5"
    >
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-orange" />
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
          Since yesterday
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {items.map((item, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05, duration: 0.2 }}
            className={item.positive ? 'text-status-success' : 'text-status-warning'}
          >
            {item.positive ? '+' : ''}{item.label}
          </motion.span>
        ))}
      </div>
    </motion.section>
  )
}

function TeamConsistencySection({ orgId, date }: { orgId: string; date: string }) {
  const [reps, setReps] = useState<Array<{
    repId: string
    repName: string
    activeDays: number
    totalDays: number
    currentStreak: number
    totalActions: number
    connections: number
    replies: number
    wins: number
    heatmap: DailyActivity[]
  }> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReps().then(() => setLoading(false))
  }, [orgId, date])

  async function fetchReps() {
    // Fetch team members
    const teamRes = await fetch(`/api/admin/command-center-v2?date=${date}`)
    if (!teamRes.ok) { setLoading(false); return }
    const teamData = await teamRes.json()
    const teamMembers: TeamRow[] = teamData.team ?? []

    // Fetch activity for each rep
    const activityResults = await Promise.all(
      teamMembers.map(async (rep): Promise<{
        repId: string
        repName: string
        activeDays: number
        totalDays: number
        currentStreak: number
        totalActions: number
        connections: number
        replies: number
        wins: number
        heatmap: DailyActivity[]
      } | null> => {
        const res = await fetch(`/api/admin/performance/activity?repId=${rep.repId}&range=12w`)
        if (!res.ok) return null
        const data = await res.json()
        return {
          repId: rep.repId,
          repName: rep.repName,
          activeDays: data.summary?.activeDays ?? 0,
          totalDays: data.summary?.totalDays ?? 0,
          currentStreak: data.summary?.currentStreak ?? 0,
          totalActions: data.summary?.totalActions ?? 0,
          connections: data.summary?.breakdown?.connections ?? 0,
          replies: data.summary?.breakdown?.replies ?? 0,
          wins: data.summary?.breakdown?.wins ?? 0,
          heatmap: data.daily ?? [],
        }
      })
    )
    setReps(activityResults.filter(Boolean) as NonNullable<typeof activityResults[number]>[])
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-bone-raised p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-32 rounded bg-bone" />
          <div className="h-[60px] rounded bg-bone/60" />
        </div>
      </section>
    )
  }

  if (!reps || reps.length === 0) return null

  return (
    <section className="rounded-lg border border-line bg-bone-raised">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-orange" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.12em] text-stone">
            Team Consistency
          </p>
        </div>
      </div>
      <div className="divide-y divide-line/60">
        {reps.map(rep => (
          <div key={rep.repId} className="flex items-center gap-4 px-5 py-3">
            {/* Mini heatmap */}
            <div className="hidden sm:block">
              <ContributionHeatmap daily={rep.heatmap} />
            </div>
            {/* Rep info */}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{rep.repName}</p>
              <p className="text-[11px] text-stone">
                {rep.activeDays}/{rep.totalDays} days · {rep.currentStreak}d streak
              </p>
            </div>
            {/* Stats */}
            <div className="flex items-center gap-3 text-[11px] text-graphite">
              <span>{rep.connections} conn</span>
              <span>{rep.replies} rep</span>
              {rep.wins > 0 && <span className="text-status-success">{rep.wins} win{rep.wins > 1 ? 's' : ''}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

import type { DailyActivity } from '@/lib/performance/activity-model'

function TodaysIntelligenceSection({ intelligence }: {
  intelligence: {
    newHighValueSignals: number
    repliesNeedingAction: number
    opportunitiesStronger: number
    leadsWentStale: number
    leadsToReassign: number
    intelligenceFallbacks: number
    notableEvents: Array<{ type: string; title: string; detail: string }>
  }
}) {
  const stats = [
    { label: 'New signals', value: intelligence.newHighValueSignals, color: 'text-orange' },
    { label: 'Replies need action', value: intelligence.repliesNeedingAction, color: 'text-status-warning' },
    { label: 'Stronger opportunities', value: intelligence.opportunitiesStronger, color: 'text-status-success' },
    { label: 'Stale high-value', value: intelligence.leadsWentStale, color: 'text-stone' },
    { label: 'Reassign candidates', value: intelligence.leadsToReassign, color: 'text-cobalt' },
    { label: 'Fallbacks', value: intelligence.intelligenceFallbacks, color: 'text-stone' },
  ].filter(s => s.value > 0)

  if (stats.length === 0 && intelligence.notableEvents.length === 0) return null

  return (
    <section className="rounded-lg border border-orange/20 bg-orange/[0.02] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="size-4 text-orange" />
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Today's Intelligence</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map(stat => (
          <div key={stat.label} className="flex items-center gap-2">
            <span className={cn('text-[18px] font-medium', stat.color)}>{stat.value}</span>
            <span className="text-[11px] text-graphite">{stat.label}</span>
          </div>
        ))}
      </div>
      {intelligence.notableEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {intelligence.notableEvents.slice(0, 3).map((event, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className="text-stone">•</span>
              <div>
                <span className="font-medium text-ink">{event.title}</span>
                <span className="ml-1 text-graphite">{event.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}


function DailyBriefSection({ brief, date, onDrilldown }: { brief: CommandCenterData['brief']; date: string; onDrilldown: (action: string) => void }) {
  const isToday = date === today()
  const totalActivity = brief.connectionsSent + brief.dmsSent + brief.followupsSent + brief.repliesReceived + brief.leadsExtracted

  const metrics = [
    { key: 'activeReps', label: 'Active reps', value: brief.activeReps, icon: <Users className="size-3.5" /> },
    { key: 'connectionsSent', label: 'Connections', value: brief.connectionsSent, icon: <UserPlus className="size-3.5" />, drilldown: 'CONNECTION_SENT' },
    { key: 'dmsSent', label: 'DMs', value: brief.dmsSent, icon: <Send className="size-3.5" />, drilldown: 'DM_SENT' },
    { key: 'followupsSent', label: 'Follow-ups', value: brief.followupsSent, icon: <MessageSquare className="size-3.5" />, drilldown: 'FOLLOWUP_SENT' },
    { key: 'repliesReceived', label: 'Replies', value: brief.repliesReceived, icon: <Reply className="size-3.5" />, drilldown: 'REPLY_RECEIVED' },
    { key: 'leadsExtracted', label: 'Leads', value: brief.leadsExtracted, icon: <Target className="size-3.5" />, drilldown: 'LEAD_EXTRACTED' },
  ].filter(m => m.key === 'activeReps' || m.value > 0)

  return (
    <section className="rounded-lg border border-line bg-bone-raised p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-orange" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
            {isToday ? 'Operating Brief' : `Operating Brief — ${formatDateLabel(date)}`}
          </p>
        </div>
        <span className="text-[11px] text-stone">{totalActivity} total actions</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((metric, i) => (
          <motion.button
            key={metric.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            onClick={() => metric.drilldown && onDrilldown(metric.drilldown)}
            className={cn(
              'rounded-lg border border-line/60 bg-bone p-3 text-left transition-colors',
              metric.drilldown && 'hover:border-orange/30 hover:bg-orange/[0.02] cursor-pointer',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-stone">{metric.icon}</span>
              <span className="text-[14px] font-medium text-ink count-pop">{metric.value}</span>
            </div>
            <p className="mt-1 text-[10px] text-stone">{metric.label}</p>
          </motion.button>
        ))}
      </div>
    </section>
  )
}


function ExceptionSection({ exceptions }: { exceptions: ExceptionItem[] }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? exceptions : exceptions.slice(0, 6)

  return (
    <section className="rounded-lg border border-line bg-bone-raised">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-status-warning" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
            Exceptions · {exceptions.length}
          </p>
        </div>
        {exceptions.length > 6 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[12px] text-graphite hover:text-ink"
          >
            {showAll ? 'Show less' : `Show all ${exceptions.length}`}
          </button>
        )}
      </div>
      <div className="divide-y divide-line/60">
        {visible.map((item, i) => {
          const sev = severityConfig(item.severity)
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="flex items-start gap-3 px-5 py-3"
            >
              <StatusBadge status={sev.label} variant={sev.variant} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{item.title}</p>
                <p className="text-[12px] text-graphite">{item.detail}</p>
              </div>
              {item.leadId && (
                <Link
                  href={`/leads/${item.leadId}`}
                  className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-graphite hover:border-ink/20 hover:text-ink transition-colors"
                >
                  Open
                </Link>
              )}
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}


function TeamSection({
  team,
  expandedRep,
  onToggleExpand,
  date,
  orgId,
}: {
  team: TeamRow[]
  expandedRep: string | null
  onToggleExpand: (id: string) => void
  date: string
  orgId: string
}) {
  const [repQueueSnapshots, setRepQueueSnapshots] = useState<Record<string, RepQueueSnapshot | null>>({})
  const [loadingSnapshot, setLoadingSnapshot] = useState<string | null>(null)

  useEffect(() => {
    if (!expandedRep || repQueueSnapshots[expandedRep]) return
    const row = team.find(t => t.repId === expandedRep)
    if (!row) return
    setLoadingSnapshot(expandedRep)
    loadRepQueueSnapshot(orgId, row.repId, row.repName, date)
      .then(snap => setRepQueueSnapshots(prev => ({ ...prev, [expandedRep]: snap })))
      .catch(() => setRepQueueSnapshots(prev => ({ ...prev, [expandedRep]: null })))
      .finally(() => setLoadingSnapshot(null))
  }, [expandedRep, date, team, repQueueSnapshots])
  return (
    <section className="rounded-lg border border-line bg-bone-raised">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-stone" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
            Team
          </p>
        </div>
        <span className="text-[11px] text-stone">{team.length} member{team.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-line/60">
        {team.map((row, i) => {
          const cfg = statusConfig(row.status)
          const isExpanded = expandedRep === row.repId
          const activityPct = row.actionsToday > 0 ? Math.min(100, (row.actionsToday / 10) * 100) : 0
          return (
            <motion.div
              key={row.repId}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
            >
              <div
                className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-bone/50 transition-colors"
                onClick={() => onToggleExpand(row.repId)}
              >
                <ChevronRight className={cn('size-3.5 text-stone transition-transform duration-200', isExpanded && 'rotate-90')} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/team/${row.repId}?date=${date}`}
                      className="text-[13px] font-medium text-ink hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {row.repName}
                    </Link>
                    <StatusBadge status={cfg.label} variant={cfg.variant} />
                  </div>
                  <div className="mt-1.5 h-1 w-24 rounded-full bg-line/40 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', activityPct > 60 ? 'bg-status-success' : activityPct > 30 ? 'bg-orange' : 'bg-line')}
                      style={{ width: `${activityPct}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[12px] text-graphite">
                  {row.actionsToday > 0 && (
                    <span className="hidden sm:flex items-center gap-3">
                      {row.connectionsSent > 0 && <span>{row.connectionsSent} conn</span>}
                      {row.dmsSent > 0 && <span>{row.dmsSent} DM</span>}
                      {row.followupsSent > 0 && <span>{row.followupsSent} follow</span>}
                      {row.repliesReceived > 0 && <span>{row.repliesReceived} reply</span>}
                    </span>
                  )}
                  {row.pendingReplies > 0 && (
                    <span className="text-status-warning">{row.pendingReplies} waiting</span>
                  )}
                  <span className="w-16 text-right text-stone">
                    {formatMinutesAgo(row.lastActivityMinutes)}
                  </span>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-line/40 bg-bone/30 px-5 py-3 drawer-slide-up">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MiniStat label="Actions" value={row.actionsToday} />
                    <MiniStat label="Assigned" value={row.assignedLeads} />
                    <MiniStat label="Pending replies" value={row.pendingReplies} highlight={row.pendingReplies > 0} />
                    <MiniStat label="Last active" value={formatMinutesAgo(row.lastActivityMinutes)} isText />
                  </div>

                  {/* Per-rep ranked work queue snapshot */}
                  {loadingSnapshot === row.repId && (
                    <div className="mt-3 text-[11px] text-stone">Loading queue...</div>
                  )}
                  {repQueueSnapshots[row.repId] && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone">Top actions</p>
                      {repQueueSnapshots[row.repId]!.topActions.length === 0 ? (
                        <p className="text-[11px] text-graphite">Nothing needs attention.</p>
                      ) : (
                        <div className="space-y-1">
                          {repQueueSnapshots[row.repId]!.topActions.map((action, idx) => (
                            <Link
                              key={idx}
                              href={action.leadId ? `/leads/${action.leadId}` : '#'}
                              className="flex items-center justify-between rounded-md border border-line/60 bg-bone-raised/60 px-3 py-2 text-[11px] transition-colors hover:bg-bone"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-medium text-ink">{action.action}</span>
                                <span className="ml-1.5 text-graphite">· {action.company}</span>
                                <p className="truncate text-[10px] text-stone">{action.reason}</p>
                              </div>
                              <span className={cn(
                                'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                                action.urgency === 'urgent' ? 'bg-status-danger/10 text-status-danger' :
                                action.urgency === 'high' ? 'bg-orange/10 text-orange' :
                                'bg-stone/10 text-stone'
                              )}>
                                {action.urgency}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`/team/${row.repId}?date=${date}`}
                      className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:border-ink/20 transition-colors"
                    >
                      View timeline
                    </Link>
                    {row.pendingReplies > 0 && (
                      <Link
                        href={`/inbound?repId=${row.repId}`}
                        className="rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-1.5 text-[12px] text-status-warning hover:bg-status-warning/10 transition-colors"
                      >
                        View replies
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

function MiniStat({ label, value, highlight, isText }: { label: string; value: number | string; highlight?: boolean; isText?: boolean }) {
  return (
    <div>
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.12em] text-stone">{label}</p>
      <p className={cn(
        'mt-0.5 text-[14px] font-medium',
        highlight ? 'text-status-warning' : 'text-ink',
      )}>
        {isText ? value : (typeof value === 'number' ? value.toLocaleString() : value)}
      </p>
    </div>
  )
}


function OpportunitySection({ opportunities }: { opportunities: OpportunityFeedItem[] }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? opportunities : opportunities.slice(0, 5)

  return (
    <section className="rounded-lg border border-line bg-bone-raised">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Eye className="size-4 text-orange" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
            Opportunities · {opportunities.length}
          </p>
        </div>
        {opportunities.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[12px] text-graphite hover:text-ink"
          >
            {showAll ? 'Show less' : `Show all ${opportunities.length}`}
          </button>
        )}
      </div>
      <div className="divide-y divide-line/60">
        {visible.map((opp, i) => {
          const hasWeakProfile = opp.recommendedProfileScore !== null &&
            opp.currentProfileScore !== null &&
            opp.recommendedProfileScore > opp.currentProfileScore + 15

          return (
            <motion.div
              key={opp.leadId}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="flex items-start gap-3 px-5 py-3"
            >
              <div className="mt-0.5 shrink-0 rounded bg-orange/10 px-2 py-0.5 text-mono-medium text-[11px] font-medium text-orange">
                {opp.score}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/leads/${opp.leadId}`} className="text-[13px] font-medium text-ink hover:underline">
                    {opp.company}
                  </Link>
                  {opp.contactName && (
                    <span className="text-[11px] text-stone">{opp.contactName}</span>
                  )}
                </div>
                <p className="text-[12px] text-graphite">
                  {opp.repName} · {opp.currentStage}
                  {opp.daysSinceAction !== null && opp.daysSinceAction > 3 && (
                    <span className="text-status-warning"> · {opp.daysSinceAction}d idle</span>
                  )}
                </p>
                {hasWeakProfile && (
                  <p className="mt-1 text-[11px] text-orange">
                    <AlertTriangle className="mr-1 inline size-3" />
                    Best profile: {opp.recommendedProfileName} ({opp.recommendedProfileScore}) vs current {opp.currentProfileName} ({opp.currentProfileScore})
                  </p>
                )}
              </div>
              <Link
                href={`/leads/${opp.leadId}`}
                className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-graphite hover:border-ink/20 hover:text-ink transition-colors"
              >
                Open
              </Link>
            </motion.div>
          )
        })}
      </div>
    </section>
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

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-bone-raised p-5">
        <div className="flex items-center gap-2 mb-3">
          <Users className="size-4 text-cobalt" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Routing Opportunities</p>
        </div>
        <p className="text-[12px] text-stone">Computing...</p>
      </section>
    )
  }

  if (data.length === 0) null

  return (
    <section className="rounded-lg border border-cobalt/20 bg-cobalt/[0.02]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-cobalt" />
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">
            Routing Opportunities · {data.length}
          </p>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="px-5 py-4 text-[12px] text-graphite">No sender mismatches detected. All leads are with their best sender.</p>
      ) : (
        <div className="divide-y divide-line/60">
          {data.slice(0, 10).map((item, i) => (
            <motion.div
              key={item.leadId}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="flex items-start gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/leads/${item.leadId}`}
                    className="text-[13px] font-medium text-ink hover:underline truncate"
                  >
                    {item.company}
                  </Link>
                  <span className="text-[10px] text-stone">{item.score}/100</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px]">
                  <span className="text-graphite">
                    Current: <span className="font-medium text-ink">{item.currentSenderName ?? '—'}</span> ({item.currentSenderMatch}%)
                  </span>
                  <span className="text-stone">→</span>
                  <span className="text-status-success">
                    Best: <span className="font-medium">{item.bestSenderName ?? '—'}</span> ({item.bestSenderMatch}%)
                  </span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                    +{item.mismatchDelta}%
                  </span>
                </div>
                {item.reasons.length > 0 && (
                  <p className="mt-0.5 text-[10px] text-graphite truncate">{item.reasons[0]}</p>
                )}
              </div>
              <Link
                href={`/leads/${item.leadId}`}
                className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-graphite hover:border-ink/20 hover:text-ink transition-colors"
              >
                Review
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}

function OperateSection() {
  return (
    <section>
      <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone mb-3">Operate</p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {OPERATE_NAV.map((item, i) => {
          const Icon = item.icon
          return (
            <motion.div
              key={item.href}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
            >
              <Link
                href={item.href}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-bone-raised px-3 py-2.5 transition-all hover:border-line/80 hover:bg-bone hover:shadow-sm"
              >
                <Icon className="size-3.5 shrink-0 text-stone" />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink">{item.label}</p>
                  <p className="truncate text-[10px] text-graphite">{item.detail}</p>
                </div>
              </Link>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
