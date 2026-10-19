'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  Send, Reply, Bell, AlertTriangle, ChevronRight, Flame, Target, Zap, Calendar,
  ArrowRight, CheckCircle2, Search,
} from 'lucide-react'
import { cn } from 'cn'
import type { RepWorkspaceData } from '@/components/rep/rep-workspace'
import type { RelayTodayAction } from '@/components/relay-today-workspace'
import type { ActivityType } from '@/lib/domain/types'
import { computeDailyProgress } from '@/lib/performance/daily-progress'
import { activityLabel } from '@/lib/accountability/default-targets'
import { ContributionHeatmap } from '@/components/performance/contribution-heatmap'
import { DashHeader, EmptyNote, Meter, Panel, Pill, StatTile } from '@/components/dashboard/kit'
import type { DailyActivity, ActivitySummary } from '@/lib/performance/activity-model'

type ActionKind = RelayTodayAction['kind']

function taskIcon(kind: ActionKind) {
  switch (kind) {
    case 'reply_needed': return <Reply className="size-3.5 text-orange" />
    case 'followup_due': return <Bell className="size-3.5 text-orange" />
    case 'connection_dm_due': return <Send className="size-3.5 text-cobalt" />
    case 'lead_going_cold': return <AlertTriangle className="size-3.5 text-status-warning" />
    case 'inbound_opportunity': return <Flame className="size-3.5 text-orange" />
    case 'job_worth_apply': return <Zap className="size-3.5 text-cobalt" />
    default: return <Target className="size-3.5 text-stone" />
  }
}

const ACTION_VERB: Record<string, string> = {
  REPLY_NOW: 'Reply now',
  SEND_CONNECTION: 'Send connection',
  SEND_FIRST_DM: 'Send first message',
  SEND_FOLLOWUP: 'Send follow-up',
  RESEARCH: 'Research lead',
  REVIEW_REFERRAL: 'Review referral',
  APPLY_UPWORK: 'Apply on Upwork',
  RESUME_DRAFT: 'Finish draft',
  WAIT: 'Check in',
}

function priorityValue(p: string) { return p === 'urgent' ? 0 : p === 'high' ? 1 : p === 'medium' ? 2 : 3 }

function priorityTone(p: string) {
  return p === 'urgent' ? 'danger' as const : p === 'high' ? 'orange' as const : 'neutral' as const
}

export function RepDashboard({ data }: { data: RepWorkspaceData }) {
  const { day, nextAction, upNext, resumeWork, notifications } = data

  const sortedTasks = [...upNext].sort((a, b) => priorityValue(a.priority) - priorityValue(b.priority))
  const groups: Array<{ label: string; hint: string; tasks: RelayTodayAction[] }> = [
    { label: 'Needs reply', hint: 'Clients waiting on you', tasks: sortedTasks.filter((t) => t.kind === 'reply_needed') },
    { label: 'Follow-ups due', hint: 'Keep conversations warm', tasks: sortedTasks.filter((t) => t.kind === 'followup_due') },
    { label: 'To contact', hint: 'Connections and first messages', tasks: sortedTasks.filter((t) => t.kind === 'connection_dm_due') },
    { label: 'Other work', hint: 'Research, jobs and reviews', tasks: sortedTasks.filter((t) => !['reply_needed', 'followup_due', 'connection_dm_due'].includes(t.kind)) },
  ].filter((g) => g.tasks.length > 0)

  // Real completed execution only — never inflate from remaining queue items
  const progress = computeDailyProgress({
    totalTarget: data.targetSummary?.totalTarget ?? 0,
    totalCompleted: data.targetSummary?.totalCompleted ?? 0,
    totalRemaining: data.targetSummary?.totalRemaining ?? 0,
    repliesWaiting: day.repliesWaiting ?? 0,
    followUpsDue: day.followUpsDue ?? 0,
    outreachRemaining: day.outreachRemaining ?? 0,
  })
  const completionPct = progress.progressPct
  const totalTarget = data.targetSummary?.totalTarget ?? 0
  const totalCompleted = data.targetSummary?.totalCompleted ?? 0
  const openTasks = (nextAction ? 1 : 0) + upNext.length

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        title={<>Good {greeting()}, {data.rep.name.split(' ')[0]}</>}
        subtitle={openTasks > 0
          ? `${openTasks} ${openTasks === 1 ? 'task' : 'tasks'} in your queue${(day.repliesWaiting ?? 0) > 0 ? ` · ${day.repliesWaiting} ${day.repliesWaiting === 1 ? 'client is' : 'clients are'} waiting for a reply` : ''}.`
          : 'Your queue is clear. Find new leads to keep the pipeline moving.'}
        actions={
          <>
            <Link href="/prospect" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bone-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:border-ink/20">
              <Search className="size-3.5" aria-hidden="true" />Prospect
            </Link>
            <Link href="/leads" className="inline-flex items-center gap-1.5 rounded-md bg-solid px-3 py-1.5 text-[12px] font-medium text-on-solid hover:opacity-90">
              Open leads<ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {/* Quick numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Replies waiting" value={day.repliesWaiting ?? 0} tone={(day.repliesWaiting ?? 0) > 0 ? 'orange' : 'neutral'} icon={<Reply className="size-3.5" />} sub={(day.repliesWaiting ?? 0) > 0 ? 'Answer these first' : 'Inbox clear'} href="/inbound" />
        <StatTile label="Follow-ups due" value={day.followUpsDue ?? 0} tone={(day.followUpsDue ?? 0) > 0 ? 'warning' : 'neutral'} icon={<Bell className="size-3.5" />} sub={(day.followUpsDue ?? 0) > 0 ? 'Due today' : 'Nothing due'} href="/leads" />
        <StatTile label="Outreach left" value={day.outreachRemaining ?? 0} tone="cobalt" icon={<Send className="size-3.5" />} sub={(day.outreachRemaining ?? 0) > 0 ? 'Toward today’s target' : 'Outreach complete'} />
        <StatTile label="Done today" value={totalCompleted} tone={progress.status === 'COMPLETE' ? 'success' : 'neutral'} icon={<CheckCircle2 className="size-3.5" />} sub={totalTarget > 0 ? `of ${totalTarget} target` : 'No target set'} href="/accountability" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Primary action + up next */}
        <div className="min-w-0 space-y-4 lg:col-span-3">
          {nextAction ? (
            <Link href={nextAction.href} className="group block rounded-xl border border-orange/30 bg-orange/[0.05] p-5 transition-colors hover:bg-orange/[0.09]">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-orange px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-on-accent">Do this next</span>
                <Pill tone={priorityTone(nextAction.priority)}>{nextAction.priority}</Pill>
              </div>
              <p className="mt-3 text-[17px] font-medium leading-snug text-ink">{nextAction.title}</p>
              {nextAction.subtitle && <p className="mt-1 text-[13px] text-graphite">{nextAction.subtitle}</p>}
              {nextAction.whatHappened && nextAction.whatHappened !== nextAction.subtitle && (
                <p className="mt-2 line-clamp-2 text-[12px] text-stone">{nextAction.whatHappened}</p>
              )}
              <span className="mt-4 inline-flex items-center gap-1 rounded-md bg-orange px-3 py-1.5 text-[12px] font-medium text-on-accent">
                {ACTION_VERB[nextAction.humanAction ?? ''] ?? 'Open'}
                <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          ) : (
            <Panel>
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="size-6 text-status-success" aria-hidden="true" />
                <p className="mt-2 text-[14px] font-medium text-ink">Nothing urgent right now</p>
                <p className="mt-1 max-w-sm text-[12px] text-graphite">Add leads from Prospect or work through your follow-ups to keep moving.</p>
              </div>
            </Panel>
          )}

          {(resumeWork?.length ?? 0) > 0 && (
            <Panel title="Pick up where you left off" subtitle="Drafts started but not sent" flush>
              <ul className="divide-y divide-line/70">
                {resumeWork!.slice(0, 3).map((lead) => (
                  <li key={lead.id}>
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bone sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink">{lead.contactName ? `${lead.contactName} · ${lead.company}` : lead.company}</p>
                        <p className="truncate text-[11px] text-stone">{lead.state} · {lead.lastAction}</p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-stone" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {/* Today's targets */}
        <Panel
          className="lg:col-span-2"
          title="Today’s targets"
          subtitle={totalTarget > 0 ? `${totalCompleted} of ${totalTarget} actions` : 'Set by your admin'}
          action={<span className={cn('text-[13px] font-medium tabular-nums', progress.status === 'COMPLETE' ? 'text-status-success' : 'text-ink')}>{progress.status === 'COMPLETE' ? 'Done' : `${completionPct}%`}</span>}
        >
          {totalTarget === 0 ? (
            <EmptyNote>No daily targets assigned yet. Your admin sets them per identity.</EmptyNote>
          ) : (
            <div className="space-y-4">
              <Meter value={completionPct} max={100} className="h-2" />
              {data.targetSummary.byIdentity.filter((identity) => identity.targets.length > 0).map((identity) => (
                <div key={identity.assignmentId}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-ink">{identity.identityName}</p>
                    <span className="text-mono-medium shrink-0 text-[10px] uppercase tracking-[0.1em] text-stone">{identity.channel}</span>
                  </div>
                  <ul className="space-y-2">
                    {identity.targets.map((t) => (
                      <li key={t.targetId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                        <span className="truncate text-[12px] text-graphite">{activityLabel(t.activityType as ActivityType)}</span>
                        <span className="text-[12px] font-medium tabular-nums text-ink">{t.completedCount}<span className="text-stone">/{t.targetCount}</span></span>
                        <Meter value={t.completedCount} max={t.targetCount} className="col-span-2 h-1" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Task groups */}
      {groups.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <Panel key={group.label} title={group.label} subtitle={group.hint} action={<Pill>{group.tasks.length}</Pill>} flush>
              <ul className="divide-y divide-line/70">
                {group.tasks.slice(0, 5).map((task, i) => (
                  <li key={`${task.id}-${i}`}>
                    <Link href={task.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bone sm:px-5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-bone">{taskIcon(task.kind)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink">{task.title}</p>
                        {task.subtitle && <p className="truncate text-[11px] text-stone">{task.subtitle}</p>}
                      </div>
                      {task.priority === 'urgent' && <Pill tone="danger">urgent</Pill>}
                      <ChevronRight className="size-4 shrink-0 text-stone" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              {group.tasks.length > 5 && (
                <Link href="/leads" className="block border-t border-line px-4 py-2 text-[12px] font-medium text-cobalt hover:underline sm:px-5">
                  View all {group.tasks.length}
                </Link>
              )}
            </Panel>
          ))}
        </div>
      )}

      <ActivityHeatmapSection />

      {(notifications?.length ?? 0) > 0 && (
        <Panel title="Notices" flush>
          <ul className="divide-y divide-line/70">
            {(notifications ?? []).slice(0, 3).map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden="true" />
                <div>
                  <p className="text-[13px] text-ink">{n.title}</p>
                  <p className="text-[11px] text-stone">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

/**
 * Consistency — the rep's 12-week activity calendar with the totals beside it.
 */
function ActivityHeatmapSection() {
  const [activity, setActivity] = useState<DailyActivity[] | null>(null)
  const [summary, setSummary] = useState<ActivitySummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch('/api/performance/activity?range=12w')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { daily: DailyActivity[]; summary: ActivitySummary } | null) => {
        if (cancelled) return
        if (data) {
          setActivity(data.daily)
          setSummary(data.summary)
          setState('ready')
        } else setState('error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  if (state === 'error') return null // heatmap is supplementary

  return (
    <Panel
      title="Your consistency"
      subtitle="Every logged action over the last 12 weeks"
      action={<Link href="/performance" className="text-[11px] font-medium text-cobalt hover:underline">Full history</Link>}
    >
      {state === 'loading' || !activity || !summary ? (
        <div className="grid animate-pulse gap-5 lg:grid-cols-[1fr_240px]" aria-busy="true">
          <div className="h-[150px] rounded-lg bg-bone" />
          <div className="h-[150px] rounded-lg bg-bone" />
        </div>
      ) : summary.totalActions === 0 ? (
        <div className="py-6 text-center">
          <Calendar className="mx-auto size-6 text-stone" aria-hidden="true" />
          <p className="mt-2 text-[13px] text-graphite">No activity yet</p>
          <p className="mt-1 text-[11px] text-stone">Your history fills in as you analyze leads, send outreach, follow up and reply.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <ContributionHeatmap daily={activity} maxCell={30} />
          <div className="grid grid-cols-2 gap-2">
            <ConsistencyStat label="Streak" value={`${summary.currentStreak}d`} icon={<Flame className="size-3 text-orange" />} />
            <ConsistencyStat label="Active days" value={`${summary.activeDays}/${summary.totalDays}`} />
            <ConsistencyStat label="Connections" value={summary.breakdown.connections} />
            <ConsistencyStat label="First DMs" value={summary.breakdown.firstDMs} />
            <ConsistencyStat label="Replies" value={summary.breakdown.replies} />
            <ConsistencyStat label="Wins" value={summary.breakdown.wins} highlight={summary.breakdown.wins > 0} />
          </div>
        </div>
      )}
    </Panel>
  )
}

function ConsistencyStat({ label, value, highlight, icon }: { label: string; value: number | string; highlight?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/70 bg-bone px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] text-stone">{icon}{label}</p>
      <p className={cn('mt-0.5 text-[16px] font-medium tabular-nums', highlight ? 'text-status-success' : 'text-ink')}>{value}</p>
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
