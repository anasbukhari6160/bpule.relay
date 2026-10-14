'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Briefcase,
  Mail,
  MessageSquare,
  Reply,
  ScanSearch,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'

export interface DailyJob {
  key: string
  title: string
  hint: string
  done: number
  goal: number
  href: string
  button: string
}

const ORDER = [
  'prospect_extracted',
  'connection_request',
  'dm',
  'followup',
  'email',
  'application',
]

const COPY: Record<string, { title: string; short: string; hint: string; href: string; button: string; icon: LucideIcon }> = {
  prospect_extracted: {
    title: 'Pull profiles',
    short: 'Pull',
    hint: 'Find people before you send.',
    href: '/prospect',
    button: 'Pull profiles',
    icon: ScanSearch,
  },
  connection_request: {
    title: 'Send connection notes',
    short: 'Notes',
    hint: 'Ask to connect. Do not pitch yet.',
    href: '/leads?filter=connect',
    button: 'Send notes',
    icon: UserPlus,
  },
  dm: {
    title: 'Send first messages',
    short: 'Messages',
    hint: 'Only after they accept.',
    href: '/leads?filter=dm',
    button: 'Send messages',
    icon: MessageSquare,
  },
  followup: {
    title: 'Follow up',
    short: 'Follow up',
    hint: 'Write again if they went quiet.',
    href: '/leads?filter=followup',
    button: 'Follow up',
    icon: Reply,
  },
  email: {
    title: 'Send emails',
    short: 'Email',
    hint: 'Email is a separate list.',
    href: '/revenue/email',
    button: 'Open email',
    icon: Mail,
  },
  application: {
    title: 'Upwork applications',
    short: 'Apply',
    hint: 'Apply to jobs that fit.',
    href: '/upwork',
    button: 'Apply',
    icon: Briefcase,
  },
}

export function jobsFromTargets(
  identities: Array<{ targets: Array<{ activityType: string; targetCount: number; completedCount: number; remaining: number }> }>,
): DailyJob[] {
  const totals = new Map<string, { done: number; goal: number }>()
  for (const identity of identities) {
    for (const target of identity.targets) {
      if (target.targetCount <= 0) continue
      const current = totals.get(target.activityType) ?? { done: 0, goal: 0 }
      current.done += target.completedCount
      current.goal += target.targetCount
      totals.set(target.activityType, current)
    }
  }

  const keys = [
    ...ORDER.filter((key) => totals.has(key)),
    ...[...totals.keys()].filter((key) => !ORDER.includes(key)),
  ]

  return keys.map((key) => {
    const counts = totals.get(key) ?? { done: 0, goal: 0 }
    const copy = COPY[key] ?? {
      title: key.replaceAll('_', ' '),
      short: key.replaceAll('_', ' '),
      hint: 'Finish this number.',
      href: '/leads',
      button: 'Open',
      icon: ScanSearch,
    }
    return {
      key,
      title: copy.title,
      hint: copy.hint,
      done: counts.done,
      goal: counts.goal,
      href: copy.href,
      button: copy.button,
    }
  })
}

export function dayVerdict(doneJobs: number, openJobs: number, workingDay: boolean): {
  tone: 'won' | 'start' | 'push' | 'off'
  title: string
  detail: string
} {
  if (!workingDay) {
    return {
      tone: 'off',
      title: 'Day off',
      detail: 'Numbers are not due today. Still answer anyone who replied.',
    }
  }
  if (openJobs === 0 && doneJobs > 0) {
    return {
      tone: 'won',
      title: 'Day won',
      detail: 'You covered every number. Pull more profiles if you want a bigger day.',
    }
  }
  if (doneJobs === 0) {
    return {
      tone: 'start',
      title: 'Not started',
      detail: 'Nothing is done yet. Start at the first open job. The day is not done until every bar is full.',
    }
  }
  return {
    tone: 'push',
    title: `${openJobs} still open`,
    detail: 'Finish the red rows. You get the day win only when every number is covered.',
  }
}

export function paceReading(done: number, goal: number, now: Date): {
  expected: number
  gap: number
  label: string
  tone: 'ahead' | 'behind' | 'even' | 'waiting' | 'closed' | 'won'
} {
  if (goal <= 0) return { expected: 0, gap: 0, label: 'No numbers today', tone: 'waiting' }
  if (done >= goal) return { expected: goal, gap: 0, label: 'Every number is covered', tone: 'won' }
  const minutes = now.getHours() * 60 + now.getMinutes()
  const start = 9 * 60
  const end = 17 * 60
  if (minutes < start) return { expected: 0, gap: done, label: 'Window opens at 9. Anything you send now is ahead.', tone: 'waiting' }
  if (minutes >= end) {
    return { expected: goal, gap: done - goal, label: `${goal - done} still open after the window`, tone: 'closed' }
  }
  const fraction = (minutes - start) / (end - start)
  const expected = Math.round(goal * fraction)
  const gap = done - expected
  if (gap >= 1) return { expected, gap, label: `${gap} ahead of the clock`, tone: 'ahead' }
  if (gap <= -1) return { expected, gap, label: `${Math.abs(gap)} behind the clock`, tone: 'behind' }
  return { expected, gap: 0, label: 'Right on the clock', tone: 'even' }
}

export function workWindowLabel(now: Date): { text: string; running: boolean } {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const start = 9 * 60
  const end = 17 * 60
  const format = (total: number) => {
    const hours = Math.floor(total / 60)
    const mins = total % 60
    if (hours <= 0) return `${mins}m`
    return mins ? `${hours}h ${mins}m` : `${hours}h`
  }
  if (minutes < start) return { text: `Work starts in ${format(start - minutes)}`, running: false }
  if (minutes >= end) return { text: 'Work window is closed', running: false }
  return { text: `${format(end - minutes)} left`, running: true }
}

export function DailyJobs({
  jobs,
  workingDay,
  profilesPulled = 0,
}: {
  jobs: DailyJob[]
  workingDay: boolean
  profilesPulled?: number
}) {
  const router = useRouter()
  const [clock, setClock] = useState(() => workWindowLabel(new Date()))
  useEffect(() => {
    const tick = () => setClock(workWindowLabel(new Date()))
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])
  const doneJobs = jobs.filter((job) => job.done >= job.goal).length
  const openJobs = jobs.length - doneJobs
  const verdict = dayVerdict(doneJobs, openJobs, workingDay)
  const firstOpen = workingDay ? jobs.find((job) => job.done < job.goal) : null
  const unitsDone = jobs.reduce((sum, job) => sum + Math.min(job.done, job.goal), 0)
  const unitsGoal = jobs.reduce((sum, job) => sum + job.goal, 0)
  const unitsPct = unitsGoal > 0 ? Math.round((unitsDone / unitsGoal) * 100) : 0
  const pace = workingDay
    ? paceReading(unitsDone, unitsGoal, new Date())
    : { expected: 0, gap: 0, label: 'Numbers are not due today', tone: 'waiting' as const }
  const minutes = new Date().getHours() * 60 + new Date().getMinutes()
  const fraction = !workingDay ? 0 : minutes < 9 * 60 ? 0 : minutes >= 17 * 60 ? 1 : (minutes - 9 * 60) / (8 * 60)
  const chartRows = jobs.map((job) => ({
    key: job.key,
    name: COPY[job.key]?.short ?? job.title,
    done: job.done,
    clock: Math.round(job.goal * fraction),
    goal: job.goal,
  }))
  const paceColor = pace.tone === 'won' ? 'var(--status-success)' : pace.tone === 'behind' || pace.tone === 'closed' ? 'var(--status-danger)' : 'var(--orange)'
  const hasPullJob = jobs.some((job) => job.key === 'prospect_extracted')

  useHotkeys('p', () => router.push('/prospect'), { preventDefault: true, useKey: true })
  useHotkeys('n', () => { if (firstOpen) router.push(firstOpen.href) }, { preventDefault: true, useKey: true, enabled: Boolean(firstOpen) }, [firstOpen, router])
  useHotkeys('1,2,3,4,5,6,7,8,9', (event) => {
    const job = jobs[Number(event.key) - 1]
    if (job) router.push(job.href)
  }, {
    useKey: true,
    preventDefault: (event) => Boolean(jobs[Number(event.key) - 1]),
  }, [jobs, router])

  if (!workingDay) {
    return (
      <section className="rounded-lg border border-line bg-bone-raised px-4 py-5" aria-label="Today's jobs">
        <p className="text-mono-medium text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Today</p>
        <h2 className="mt-1 text-[20px] font-medium tracking-[-0.02em] text-ink">Day off</h2>
        <p className="mt-1.5 text-[13px] text-graphite">Numbers are not due today. Still answer anyone who replied.</p>
      </section>
    )
  }

  return (
    <>
    <section className="overflow-hidden rounded-lg border border-line bg-bone-raised" aria-label="Today's jobs">
      <div className={cn(
        'px-4 py-4',
        verdict.tone === 'won' && 'bg-status-success/10',
        verdict.tone === 'start' && 'bg-status-danger/10',
        verdict.tone === 'push' && 'bg-orange/10',
      )}>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Today</p>
        <h2 className="mt-1 text-[22px] font-medium tracking-[-0.02em] text-ink">{verdict.title}</h2>
        <p className="mt-1 max-w-xl text-[14px] text-graphite">{verdict.detail}</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="relative size-[72px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={unitsPct <= 0 ? [{ name: 'left', value: 100 }] : [{ name: 'done', value: unitsPct }, { name: 'left', value: Math.max(100 - unitsPct, 0) }]}
                  dataKey="value"
                  innerRadius={22}
                  outerRadius={32}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                >
                  <Cell fill={unitsPct === 0 ? 'var(--line)' : paceColor} />
                  <Cell fill="var(--line)" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-medium text-ink">{unitsPct}%</span>
          </div>
          <div className="min-w-0">
            <p className={cn(
              'text-[15px] font-medium',
              pace.tone === 'behind' || pace.tone === 'closed' ? 'text-status-danger' : pace.tone === 'ahead' || pace.tone === 'won' ? 'text-status-success' : 'text-ink',
            )}>{pace.label}</p>
            <p className="mt-1 text-[12px] text-graphite">
              {pace.tone === 'waiting' || pace.tone === 'won' ? clock.text : `Clock expects ${pace.expected}. You have ${unitsDone}.`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant={verdict.tone === 'won' ? 'success' : verdict.tone === 'start' ? 'destructive' : verdict.tone === 'push' ? 'orange' : 'outline'}>
                {jobs.length > 0 ? `${doneJobs} of ${jobs.length} covered` : 'No numbers'}
              </Badge>
              {workingDay && <Badge variant="outline">{clock.text}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-graphite">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-status-success" />Covered</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-status-danger" />Behind</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-orange" />Do this</span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-stone">Shortcuts: P pull profiles · N next open job · 1–{Math.min(9, jobs.length) || 1} jump</p>
        {workingDay && clock.running && doneJobs === 0 && jobs.length > 0 && (
          <p className="mt-1 text-[13px] font-medium text-status-danger">The clock is running and nothing is sent yet.</p>
        )}
      </div>

      {!hasPullJob && (
        <div className="border-t border-line px-4 py-3">
          <Link
            href="/prospect"
            className="flex items-center justify-between gap-3 rounded-md border border-line bg-bone px-3 py-3 hover:bg-bone-raised"
          >
            <span className="flex items-center gap-3">
              <ScanSearch className="size-4 text-ink" />
              <span>
                <span className="block text-[14px] font-medium text-ink">Pull profiles</span>
                <span className="text-[12px] text-graphite">{profilesPulled} pulled today. Find as many as you can.</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-graphite">P</kbd>
              <span className={buttonVariants({ size: 'sm' })}>Pull</span>
            </span>
          </Link>
        </div>
      )}

      {workingDay && jobs.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-[12px] text-graphite">The mark on each bar is where the clock says you should be.</p>
      )}

      <ol className="divide-y divide-line/70">
        {jobs.map((job, index) => {
          const covered = job.done >= job.goal
          const pct = job.goal > 0 ? Math.min(100, Math.round((job.done / job.goal) * 100)) : 0
          const isNext = firstOpen?.key === job.key
          const Icon = COPY[job.key]?.icon ?? ScanSearch
          const clockForJob = chartRows[index]?.clock ?? 0
          const behind = workingDay && !covered && job.done < clockForJob
          const clockPct = job.goal > 0 ? Math.min(100, Math.round((clockForJob / job.goal) * 100)) : 0
          const gap = clockForJob - job.done
          const status = covered ? 'Covered' : behind ? `${gap} behind` : job.done > clockForJob ? `${job.done - clockForJob} ahead` : 'On the clock'
          const hint = job.key === 'prospect_extracted' ? `${profilesPulled} pulled today. ${job.hint}` : job.hint
          return (
            <li key={job.key} className={cn('px-4 py-3', isNext && 'bg-orange/5')}>
              <div className="flex items-start gap-3">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', covered ? 'bg-status-success/10 text-status-success' : behind ? 'bg-status-danger/10 text-status-danger' : isNext ? 'bg-orange/10 text-orange' : 'bg-bone text-ink')}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14px] font-medium text-ink">
                      {index + 1}. {job.title}
                    </p>
                    <Badge variant={covered ? 'success' : isNext ? 'orange' : behind ? 'destructive' : 'outline'}>
                      {isNext ? 'Do this' : covered ? 'Covered' : `${job.done}/${job.goal}`}
                    </Badge>
                  </div>
                  <p className="text-[12px] text-graphite">{hint}</p>
                  <div className="relative mt-2 h-2.5 rounded-full bg-line/70">
                    <div
                      className={cn('h-full rounded-full', covered ? 'bg-status-success' : behind ? 'bg-status-danger' : isNext ? 'bg-orange' : 'bg-status-warning')}
                      style={{ width: `${covered ? 100 : pct}%` }}
                    />
                    {workingDay && clockPct > 0 && clockPct < 100 && (
                      <span className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-ink" style={{ left: `${clockPct}%` }} />
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <p className={cn('text-[12px] font-medium', covered ? 'text-status-success' : behind ? 'text-status-danger' : isNext ? 'text-orange' : 'text-graphite')}>
                      {status} · {job.done}/{job.goal}
                    </p>
                    <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-graphite">{index + 1}</kbd>
                  </div>
                  {!covered && workingDay && (
                    <Link href={job.href} className={cn('mt-2', buttonVariants({ variant: isNext ? 'orange' : 'outline', size: 'xs' }))}>
                      {job.button} · {job.goal - job.done} left
                    </Link>
                  )}
                  {!covered && !workingDay && (
                    <p className="mt-2 text-[12px] font-medium text-graphite">Paused</p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
    </>
  )
}
