'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { AlertTriangle, Shield, Trophy, PartyPopper } from 'lucide-react'
import { trackEvent } from '@/lib/analytics/tracker'
import { Progress } from '@/components/ui/progress'
import { DailyJobs, jobsFromTargets } from './daily-jobs'
import { DoThisNext } from './do-this-next'
import { UpNext } from './up-next'
import { BdDailyDesk } from './bd-daily-desk'
import { Skeleton } from '@/components/ui/skeleton'
import type { RelayTodayAction } from '@/components/relay-today-workspace'
import { cn } from 'cn'

export interface RepWorkspaceData {
  rep: { id: string; name: string }
  isWorkingDay: boolean
  hasAssignments: boolean
  identities: Array<{
    assignmentId: string
    revenueIdentityId: string
    identityName: string
    title: string | null
    channel: string
    targets: Array<{
      targetId: string
      activityType: string
      targetCount: number
      completedCount: number
      remaining: number
      status: string
    }>
  }>
  targetSummary: {
    totalTarget: number
    totalCompleted: number
    totalRemaining: number
    overallStatus: 'on_track' | 'at_risk' | 'completed' | 'missed'
    byIdentity: Array<{
      assignmentId: string
      revenueIdentityId: string
      identityName: string
      title: string | null
      channel: string
      targets: Array<{
        targetId: string
        activityType: string
        targetCount: number
        completedCount: number
        remaining: number
        status: string
      }>
    }>
  }
  day: {
    totalRemaining: number
    repliesWaiting: number
    followUpsDue: number
    outreachRemaining: number
    isComplete: boolean
  }
  nextAction: RelayTodayAction | null
  upNext: RelayTodayAction[]
  notifications: Array<{ id: string; title: string; body: string }>
  profilesPulled?: number
  isManager?: boolean
  teamName?: string
  teamMembers?: any[]
  referredLeads?: Array<{ id: string; company: string; score: number | null; canonicalScore: number | null; referredAt: string | null }>
  recentLeads?: Array<{ id: string; company: string; score: number | null; canonicalScore: number | null; createdAt: string }>
  upworkJobs?: Array<{ id: string; title: string; company: string; canonicalScore: number | null; fitScore: number | null }>
  completion?: { done: number; remaining: number }
  resumeWork?: Array<{ id: string; company: string; contactName: string | null; lastAction: string; state: string }>
  signalFeed?: import('@/lib/relay/signal-watch').SignalFeedItem[]
  onRefreshSignals?: () => void
  onDismissSignal?: (id: string) => void
}

interface RepWorkspaceProps {
  data: RepWorkspaceData
  mode?: 'rep' | 'manager'
  teamData?: {
    teams: Array<{
      teamId: string
      teamName: string
      memberCount: number
      totalTarget: number
      totalCompleted: number
      totalRemaining: number
      needsAttention: number
      members: Array<{
        repId: string
        repName: string
        role: string
        revenueIdentities: Array<{
          identityName: string
          channel: string
          targets: Array<{
            activityType: string
            targetCount: number
            completedCount: number
            remaining: number
            status: string
          }>
        }>
        totalTarget: number
        totalCompleted: number
        totalRemaining: number
        attentionReason: string | null
      }>
    }>
    isOwner: boolean
  }
}

export function RepWorkspace({ data, teamData, mode = 'rep' }: RepWorkspaceProps) {
  // Track home opened
  useEffect(() => {
    if (mode === 'rep') {
      trackEvent({ event: 'home_opened' })
    }
  }, [mode])

  const members = teamData?.teams.flatMap((team) => team.members) ?? []

  if (!data.hasAssignments && mode !== 'manager') {
    return <NoAssignmentsState repName={data.rep.name} />
  }

  return (
    <div className="space-y-6 pb-8">
      {mode === 'manager' && members.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-line bg-bone-raised">
          <div className="px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Team</p>
            <p className="mt-1 text-[14px] text-graphite">Who has not covered their numbers.</p>
          </div>
          <ul className="divide-y divide-line/70 border-t border-line">
            {[...members].sort((a, b) => b.totalRemaining - a.totalRemaining).map((member, i) => {
              const won = member.totalTarget > 0 && member.totalRemaining === 0
              return (
                <motion.li
                  key={member.repId}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.2 }}
                >
                  <Link href={`/team/${member.repId}`} className="block px-4 py-3 hover:bg-bone transition-colors">
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        {won && <Trophy className="size-3.5 text-status-success" />}
                        <span className="text-[14px] font-medium text-ink">{member.repName}</span>
                      </span>
                      <span className={cn('text-[13px] font-medium', won ? 'text-status-success' : 'text-ink')}>
                        {won ? 'Day won' : `${member.totalCompleted} of ${member.totalTarget}`}
                      </span>
                    </span>
                    <Progress
                      className="mt-1.5"
                      value={member.totalCompleted}
                      max={member.totalTarget > 0 ? member.totalTarget : 1}
                      size="md"
                      variant={won ? 'success' : 'default'}
                    />
                  </Link>
                </motion.li>
              )
            })}
          </ul>
        </section>
      )}

      {data.hasAssignments && (
        <>
          {/* Daily completion context */}
          {data.completion && data.completion.done + data.completion.remaining > 0 && (() => {
            const total = data.completion.done + data.completion.remaining
            const pct = total > 0 ? Math.round((data.completion.done / total) * 100) : 100
            const isComplete = data.completion.remaining === 0
            return (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                  isComplete ? 'border-status-success/30 bg-status-success/[0.04]' : 'border-line bg-bone-raised'
                )}
              >
                {isComplete ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="flex size-8 items-center justify-center rounded-full bg-status-success/10"
                  >
                    <PartyPopper className="size-4 text-status-success" />
                  </motion.div>
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-orange/10">
                    <span className="text-[13px] font-medium text-orange">{pct}%</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[12px] font-medium', isComplete ? 'text-status-success' : 'text-ink')}>
                    {isComplete ? 'Day complete — nothing left!' : `${data.completion.remaining} action${data.completion.remaining === 1 ? '' : 's'} left today`}
                  </p>
                  <p className="text-[11px] text-graphite">{data.completion.done} of {total} done</p>
                </div>
                <div className="h-2 w-20 overflow-hidden rounded-full bg-line/40">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className={cn('h-full rounded-full', isComplete ? 'bg-status-success' : 'bg-orange')}
                  />
                </div>
              </motion.div>
            )
          })()}

          {/* Resume Work — continue where you left off */}
          {data.resumeWork && data.resumeWork.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="rounded-lg border border-orange/20 bg-orange/[0.02] p-4"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone mb-2">Continue where you left off</p>
              <div className="space-y-1.5">
                {data.resumeWork.map((item, i) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.05, duration: 0.2 }}
                  >
                    <Link
                      href={`/leads/${item.id}`}
                      className="flex items-center gap-3 rounded-lg border border-line/60 bg-bone-raised/60 px-3 py-2.5 transition-colors hover:border-orange/30 hover:bg-bone"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink truncate">{item.company}{item.contactName ? ` · ${item.contactName}` : ''}</p>
                        <p className="text-[11px] text-graphite">{item.state}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-orange">Continue →</span>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.section>
          )}

          <DoThisNext action={data.nextAction} />

          <BdDailyDesk
            yourMove={data.upNext.filter(a => ['reply_needed', 'followup_due', 'connection_dm_due', 'high_fit_lead', 'new_opportunity', 'inbound_opportunity'].includes(a.kind))}
            theirMove={data.upNext.filter(a => ['lead_going_cold', 'proposal_ready'].includes(a.kind))}
            repliesWaiting={data.day.repliesWaiting}
            followUpsDue={data.day.followUpsDue}
            referredLeads={data.referredLeads ?? []}
            recentLeads={data.recentLeads ?? []}
            hasAnyWork={(data.upNext?.length > 0) || (data.referredLeads && data.referredLeads.length > 0) || (data.day.repliesWaiting > 0) || (data.day.followUpsDue > 0)}
            signalFeed={data.signalFeed}
            onRefreshSignals={data.onRefreshSignals}
            onDismissSignal={data.onDismissSignal}
          />

          {data.notifications.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-line bg-bone-raised px-4 py-3"
            >
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <AlertTriangle className="size-3.5 text-stone" />
                Recent signals
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {data.notifications.slice(0, 3).map((note) => (
                  <li key={note.id} className="text-[12px] text-graphite">
                    {note.title}: {note.body}
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          {/* Upwork opportunities */}
          {data.upworkJobs && data.upworkJobs.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Upwork</p>
                <Link href="/upwork" className="text-[11px] text-graphite hover:text-ink transition-colors">View all →</Link>
              </div>
              <div className="space-y-1">
                {data.upworkJobs.slice(0, 3).map((job, i) => (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.2 }}
                  >
                    <Link
                      href={`/upwork/${job.id}`}
                      className="flex items-center justify-between rounded-lg border border-line bg-bone-raised/40 px-3 py-2.5 transition-colors hover:bg-bone"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">{job.title}</p>
                        <p className="truncate text-[11px] text-graphite">{job.company}</p>
                      </div>
                      {job.fitScore != null && (
                        <span className="shrink-0 text-[11px] font-mono text-orange">{Math.round(job.fitScore)}% fit</span>
                      )}
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.section>
          )}

          <DailyJobs
            jobs={jobsFromTargets(data.identities)}
            workingDay={data.isWorkingDay}
            profilesPulled={data.profilesPulled ?? 0}
          />

          <UpNext
            actions={data.upNext}
            excludeId={data.nextAction?.id}
          />

          <section className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Working as</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.identities.map((identity, i) => {
                const left = identity.targets.reduce((sum, target) => sum + target.remaining, 0)
                const total = identity.targets.reduce((sum, target) => sum + target.targetCount, 0)
                const done = total - left
                const pct = total > 0 ? Math.round((done / total) * 100) : 0
                return (
                  <motion.div
                    key={identity.assignmentId}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.25 }}
                  >
                    <Link
                      href={`/workspace/${identity.revenueIdentityId}`}
                      className="flex items-center justify-between rounded-lg border border-line bg-bone-raised px-3 py-3 transition-colors hover:border-line/80 hover:bg-bone"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-ink">{identity.identityName}</span>
                        <span className="text-[12px] text-graphite">{identity.channel} · {identity.title || 'No title'}</span>
                        <div className="mt-1.5 h-1 w-16 rounded-full bg-line/40 overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', pct >= 80 ? 'bg-status-success' : pct > 0 ? 'bg-orange' : 'bg-line')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </span>
                      <span className={cn('shrink-0 text-[12px] font-medium', left === 0 ? 'text-status-success' : 'text-ink')}>
                        {left === 0 ? '✓ Covered' : `${left} left`}
                      </span>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function NoAssignmentsState({ repName }: { repName: string }) {
  return (
    <div className="space-y-6 pb-8">
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="srf-console srf-console-edge p-5"
      >
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">
          Your Day
        </p>
        <h2 className="mt-1 text-[24px] font-light tracking-[-0.02em] text-console-text">
          Good day, {repName}
        </h2>
      </motion.section>
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="srf-dossier flex flex-col items-center gap-3 px-6 py-10 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-orange/10">
          <Shield className="size-5 text-orange" />
        </div>
        <p className="text-[14px] font-medium text-ink">No work profile assigned yet</p>
        <p className="max-w-xs text-[13px] text-graphite">
          Your admin needs to assign a Revenue Identity before you can start revenue work.
          You don&apos;t need to do anything yet.
        </p>
      </motion.section>
    </div>
  )
}

export function RepWorkspaceSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      {/* Completion bar */}
      <div className="srf-console p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-1.5 w-full max-w-48" />
          </div>
          <Skeleton className="h-3 w-8" />
        </div>
      </div>
      {/* Do This Next */}
      <div className="srf-console srf-console-edge p-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-5 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-3 h-9 w-32" />
      </div>
      {/* Working as grid */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-20 rounded" />
          <Skeleton className="h-20 rounded" />
        </div>
      </div>
    </div>
  )
}
