'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useHotkeys } from 'react-hotkeys-hook'
import { motion } from 'motion/react'
import {
  ArrowRight,
  Clock,
  MessageSquare,
  Sparkles,
  UserPlus,
  Briefcase,
  Handshake,
  Search,
  ExternalLink,
  AlertCircle,
  Link2,
  ClipboardList,
  Users,
  PartyPopper,
} from 'lucide-react'
import { cn } from 'cn'
import { Progress } from '@/components/ui/progress'
import { StatusBadge } from '@/components/ui/status-badge'
import { buttonVariants } from '@/components/ui/button'
import { readSse } from '@/lib/sse/client'
import type { RelayTodayAction } from '@/components/relay-today-workspace'
import type { DailyJob } from '@/components/rep/daily-jobs'

// ── Types ──────────────────────────────────────────────────────────────────

export interface RepTodayData {
  rep: { id: string; name: string }
  isWorkingDay: boolean
  hasAssignments: boolean
  completion: { done: number; remaining: number }
  dayElapsedPct: number
  timeRemaining: string
  nextAction: RelayTodayAction | null
  upNext: RelayTodayAction[]
  dailyJobs: DailyJob[]
  yourMove: RelayTodayAction[]
  theirMove: RelayTodayAction[]
  repliesWaiting: number
  followUpsDue: number
  referredLeads: Array<{
    id: string
    company: string
    score: number | null
    referrerName?: string | null
    reason?: string | null
  }>
  recentLeads: Array<{
    id: string
    company: string
    score: number | null
    canonicalScore: number | null
    createdAt: string
  }>
  identities: Array<{
    assignmentId: string
    revenueIdentityId: string
    identityName: string
    title: string | null
    channel: string
    targets: Array<{
      activityType: string
      targetCount: number
      completedCount: number
      remaining: number
      status: string
    }>
  }>
  hasAnyWork: boolean
  profilesPulled: number
  status: 'not_started' | 'on_track' | 'at_risk' | 'behind' | 'ready_to_close' | 'completed'
  warning?: { level: string; message: string } | null
  executionHealth?: ExecutionHealthData
}

export interface ExecutionHealthData {
  executionHealth: number
  state: string
  warnings: Array<{ level: string; message: string }>
  completions: Array<{ action: string; actual: number; target: number; rawRatio: number }>
  slaScore: number
  primaryNextAction: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

const EASE = [0.32, 0.72, 0, 1] as const

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    reply_needed: 'Reply',
    followup_due: 'Follow up',
    high_fit_lead: 'Contact',
    new_opportunity: 'Review',
    job_worth_apply: 'Apply',
    proposal_ready: 'Proposal',
    inbound_opportunity: 'Inbound',
    connection_dm_due: 'DM',
  }
  return map[kind] ?? 'Action'
}

function waitLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function whyThisIsNext(action: RelayTodayAction): string {
  const map: Record<string, string> = {
    reply_needed: action.whatHappened || 'Client responded',
    followup_due: action.whatHappened || 'No reply after 5d',
    connection_dm_due: 'Connection accepted — send first message',
    high_fit_lead: action.whyItMatters || 'Strong opportunity',
    new_opportunity: 'New lead saved — start outreach',
    job_worth_apply: action.whyItMatters || 'Strong fit',
    inbound_opportunity: action.whatHappened || 'Inbound — review',
  }
  return map[action.kind] ?? action.whatHappened ?? ''
}

function channelIcon(kind: string) {
  if (kind === 'job_worth_apply') return <Briefcase className="size-3 text-cobalt" />
  if (['reply_needed', 'followup_due', 'connection_dm_due'].includes(kind)) return <Link2 className="size-3 text-cobalt/70" />
  return null
}

// ── Inline Preview type ───────────────────────────────────────────────────

interface InlinePreview {
  score: number | null
  label: string
  name: string
  title: string
  company: string
}

// ── Main Component ────────────────────────────────────────────────────────

export function RepToday({ data }: { data: RepTodayData }) {

  if (!data.hasAssignments) {
    return <NoAssignmentsState repName={data.rep.name} />
  }

  const total = data.completion.done + data.completion.remaining
  const pct = total > 0 ? Math.round((data.completion.done / total) * 100) : 100
  const isComplete = data.completion.remaining === 0

  return (
    <div className="space-y-6 pb-10">
      {/* ── Hero: Do This Next ─────────────────────────────────────── */}
      {data.nextAction && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <NextActionCard action={data.nextAction} isComplete={isComplete} completionPct={pct} />
        </motion.div>
      )}

      {/* ── Bento Grid ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Daily Jobs — spans 7 cols */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.08 }}
          className="lg:col-span-7"
        >
          <DailyJobsCard
            jobs={data.dailyJobs}
            workingDay={data.isWorkingDay}
            profilesPulled={data.profilesPulled}
            dayElapsedPct={data.dayElapsedPct}
            timeRemaining={data.timeRemaining}
            totalCompleted={data.completion.done}
            totalTarget={total}
            status={data.status}
            warning={data.warning ?? undefined}
          />
        </motion.div>

        {/* Execution Health + Quick Actions — spans 5 cols */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.14 }}
          className="space-y-4 lg:col-span-5"
        >
          {data.executionHealth && <ExecutionHealthCard data={data.executionHealth} />}
          <QuickActionsTile
            repliesWaiting={data.repliesWaiting}
            followUpsDue={data.followUpsDue}
            hasAnyWork={data.hasAnyWork}
          />
        </motion.div>
      </div>

      {/* ── Referred to You ────────────────────────────────────────── */}
      {data.referredLeads.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
        >
          <ReferredCard leads={data.referredLeads} />
        </motion.div>
      )}

      {/* ── Action Queue Row ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Replies Waiting */}
        {data.yourMove.filter(a => a.kind === 'reply_needed').length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.22 }}
          >
            <ActionListCard
              title="Replies waiting"
              tone="orange"
              actions={data.yourMove.filter(a => a.kind === 'reply_needed').slice(0, 3)}
            />
          </motion.div>
        )}

        {/* Follow-ups Due */}
        {data.yourMove.filter(a => a.kind === 'followup_due').length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.26 }}
          >
            <ActionListCard
              title="Follow-ups due"
              tone="warning"
              actions={data.yourMove.filter(a => a.kind === 'followup_due').slice(0, 3)}
            />
          </motion.div>
        )}
      </div>

      {/* ── Up Next ────────────────────────────────────────────────── */}
      {data.upNext.filter(a => a.id !== data.nextAction?.id).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.3 }}
        >
          <UpNextCard
            actions={data.upNext}
            excludeId={data.nextAction?.id}
          />
        </motion.div>
      )}

      {/* ── Working As ─────────────────────────────────────────────── */}
      {data.identities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.34 }}
        >
          <WorkingAsCard identities={data.identities} />
        </motion.div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NextActionCard({
  action,
  isComplete,
  completionPct,
}: {
  action: RelayTodayAction
  isComplete: boolean
  completionPct: number
}) {
  const router = useRouter()
  useHotkeys('j', () => { router.push(action.href) }, {
    preventDefault: true,
    useKey: true,
  }, [action, router])

  return (
    <div className="srf-console hero-console-pulse relative overflow-hidden p-6 sm:p-8">
      {/* Corner marks */}
      <div className="mark-corners absolute inset-3 pointer-events-none" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="srf-chip bg-orange/15 text-orange border-orange/25">
              {kindLabel(action.kind)}
            </span>
            <span className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">
              Do This Next
            </span>
          </div>
          <h2 className="mt-3 text-[24px] sm:text-[28px] font-light tracking-[-0.02em] text-console-text">
            {action.title}
          </h2>
          {action.createdAt && !isComplete && (
            <p className="mt-2 text-[13px] font-medium text-orange">
              Waiting {waitLabel(action.createdAt)}
            </p>
          )}
          {action.subtitle && !isComplete && (
            <p className="mt-1 text-[13px] text-console-mute">{action.subtitle}</p>
          )}
        </div>

        {/* Completion orb */}
        <div className="relative size-[64px] shrink-0">
          <svg className="size-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="var(--console-line)" strokeWidth="3" />
            <motion.circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke={isComplete ? 'var(--status-success)' : 'var(--orange)'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={175.93}
              initial={{ strokeDashoffset: 175.93 }}
              animate={{ strokeDashoffset: 175.93 - (175.93 * completionPct) / 100 }}
              transition={{ duration: 1, ease: EASE }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[13px] font-medium text-console-text">
            {completionPct}%
          </span>
        </div>
      </div>

      {/* What / Why rows */}
      {!isComplete && (
        <div className="mt-5 space-y-2">
          {action.whatHappened && (
            <div className="srf-console-inset flex items-start gap-3 px-3 py-2.5">
              <span className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-console-mute mt-0.5 shrink-0">What</span>
              <p className="text-[13px] text-console-text">{action.whatHappened}</p>
            </div>
          )}
          {action.whyItMatters && (
            <div className="srf-console-inset flex items-start gap-3 px-3 py-2.5">
              <span className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-console-mute mt-0.5 shrink-0">Why</span>
              <p className="text-[13px] text-console-text">{action.whyItMatters}</p>
            </div>
          )}
        </div>
      )}

      {isComplete && (
        <div className="mt-5 flex items-center gap-3">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="flex size-10 items-center justify-center rounded-full bg-status-success/15"
          >
            <PartyPopper className="size-5 text-status-success" />
          </motion.div>
          <div>
            <p className="text-[15px] font-medium text-status-success">Day complete</p>
            <p className="text-[12px] text-console-mute">Every number is covered. Nothing left.</p>
          </div>
        </div>
      )}

      {/* CTA */}
      {!isComplete && (
        <div className="mt-5 flex items-center gap-3">
          <Link
            href={action.href}
            className="relay-cta group"
          >
            <span className="relay-cta-pulse" />
            {action.humanAction}
            <span className="relay-cta-arrow flex size-6 items-center justify-center rounded-full bg-white/10">
              <ArrowRight className="size-3.5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5" />
            </span>
          </Link>
          <kbd className="hidden sm:inline-flex items-center rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-console-mute">
            J
          </kbd>
        </div>
      )}

      {action.identity && !isComplete && (
        <p className="mt-4 text-[11px] text-console-mute">
          Working as <span className="font-medium text-console-text">{action.identity.name}</span>
          {action.identity.channel && ` · ${action.identity.channel.toUpperCase()}`}
        </p>
      )}
    </div>
  )
}

// ── Quick Analyze ─────────────────────────────────────────────────────────

function QuickAnalyzeCard() {
  const [quickPasted, setQuickPasted] = useState('')
  const [inlinePreview, setInlinePreview] = useState<InlinePreview | null>(null)
  const [inlineAnalyzing, setInlineAnalyzing] = useState(false)

  const handleQuickAnalyze = async () => {
    if (quickPasted.trim().length < 24) return
    setInlineAnalyzing(true)
    setInlinePreview(null)
    try {
      const res = await fetch('/api/prospect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: quickPasted }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      let preview: InlinePreview | null = null
      await readSse<{ type: string; extracted?: Record<string, unknown>; score?: Record<string, unknown> }>(res, {
        onEvent: (ev) => {
          if (ev.type === 'done' && ev.score) {
            preview = {
              score: (ev.score as Record<string, unknown>).total as number | null ?? null,
              label: (ev.score as Record<string, unknown>).qualification as string ?? '',
              name: (ev.extracted as Record<string, unknown>)?.name as string ?? '',
              title: ((ev.extracted as Record<string, unknown>)?.titleRaw ?? (ev.extracted as Record<string, unknown>)?.title) as string ?? '',
              company: (ev.extracted as Record<string, unknown>)?.company as string ?? '',
            }
          }
        },
      })
      if (preview) setInlinePreview(preview)
      else window.location.href = `/prospect?paste=${encodeURIComponent(quickPasted)}`
    } catch {
      window.location.href = `/prospect?paste=${encodeURIComponent(quickPasted)}`
    } finally {
      setInlineAnalyzing(false)
    }
  }

  return (
    <div className="srf-console p-5">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-orange" />
        <h3 className="text-sm font-medium text-console-text">Analyze a prospect</h3>
      </div>
      <p className="mt-1 text-xs text-console-mute">
        Paste a profile, job, or conversation.
      </p>
      <textarea
        value={quickPasted}
        onChange={(e) => setQuickPasted(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            handleQuickAnalyze()
          }
        }}
        placeholder="Paste here..."
        rows={4}
        className="mt-3 w-full resize-none rounded border border-console-line bg-console-raised px-3 py-2 font-mono text-[13px] text-console-text placeholder:text-console-mute/50 focus:border-orange/40 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-console-mute">⌘ + Enter</span>
        <button
          onClick={handleQuickAnalyze}
          disabled={quickPasted.trim().length < 24 || inlineAnalyzing}
          className="relay-cta !min-h-8 !px-4 !py-1.5 text-[12px] disabled:opacity-40"
        >
          <Sparkles className="size-3.5" />
          {inlineAnalyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
      {inlinePreview && !inlineAnalyzing && (
        <div className="mt-3 rounded border border-orange/20 bg-orange/[0.06] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-console-text">
                {inlinePreview.name || 'Prospect'}
                {inlinePreview.company ? ` · ${inlinePreview.company}` : ''}
              </p>
              {inlinePreview.title && <p className="text-[11px] text-console-mute">{inlinePreview.title}</p>}
              {inlinePreview.score != null && (
                <span className="mt-1.5 inline-block rounded-full bg-orange/15 px-2 py-0.5 text-[11px] font-medium text-orange">
                  {Math.round(inlinePreview.score)}/100
                </span>
              )}
            </div>
            <button
              onClick={() => window.location.href = `/prospect?paste=${encodeURIComponent(quickPasted)}`}
              className={cn(buttonVariants({ variant: 'orange', size: 'sm' }), '!h-7 !px-3 text-[11px]')}
            >
              <ExternalLink className="size-3" />
              Open
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Quick Actions Tiles ────────────────────────────────────────────────────

function QuickActionsTile({
  repliesWaiting,
  followUpsDue,
  hasAnyWork,
}: {
  repliesWaiting: number
  followUpsDue: number
  hasAnyWork: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Link
        href="/prospect"
        className="srf-dossier group flex flex-col items-center gap-2 p-4 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[8px_8px_0_var(--bone-200)] hover:-translate-y-0.5"
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-orange/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110">
          <UserPlus className="size-4 text-orange" />
        </div>
        <span className="text-[11px] font-medium text-ink">Pull Profile</span>
      </Link>
      <Link
        href="/leads?filter=followup"
        className="srf-dossier group flex flex-col items-center gap-2 p-4 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[8px_8px_0_var(--bone-200)] hover:-translate-y-0.5"
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-status-warning/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110">
          <MessageSquare className="size-4 text-status-warning" />
        </div>
        <span className="text-[11px] font-medium text-ink">Follow-ups</span>
        {followUpsDue > 0 && (
          <span className="text-[10px] font-medium text-status-warning">{followUpsDue}</span>
        )}
      </Link>
      <Link
        href="/leads?filter=reply"
        className="srf-dossier group flex flex-col items-center gap-2 p-4 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[8px_8px_0_var(--bone-200)] hover:-translate-y-0.5"
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-cobalt/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110">
          <Handshake className="size-4 text-cobalt" />
        </div>
        <span className="text-[11px] font-medium text-ink">Replies</span>
        {repliesWaiting > 0 && (
          <span className="text-[10px] font-medium text-cobalt">{repliesWaiting}</span>
        )}
      </Link>
      <Link
        href="/upwork/new"
        className="srf-dossier group flex flex-col items-center gap-2 p-4 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[8px_8px_0_var(--bone-200)] hover:-translate-y-0.5"
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-cobalt/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110">
          <Briefcase className="size-4 text-cobalt" />
        </div>
        <span className="text-[11px] font-medium text-ink">Upwork</span>
      </Link>
    </div>
  )
}

// ── Daily Jobs Card ────────────────────────────────────────────────────────

function DailyJobsCard({
  jobs,
  workingDay,
  profilesPulled,
  dayElapsedPct,
  timeRemaining,
  totalCompleted,
  totalTarget,
  status,
  warning,
}: {
  jobs: DailyJob[]
  workingDay: boolean
  profilesPulled: number
  dayElapsedPct: number
  timeRemaining: string
  totalCompleted: number
  totalTarget: number
  status: string
  warning?: { level: string; message: string }
}) {
  const unitsPct = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0

  const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
    not_started: { label: 'NOT STARTED', variant: 'neutral' },
    on_track: { label: 'ON TRACK', variant: 'success' },
    at_risk: { label: 'AT RISK', variant: 'warning' },
    behind: { label: 'BEHIND', variant: 'danger' },
    ready_to_close: { label: 'READY TO CLOSE', variant: 'success' },
    completed: { label: 'COMPLETED', variant: 'success' },
  }
  const sc = statusConfig[status] ?? { label: status, variant: 'neutral' }

  return (
    <div className="srf-console h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Today</p>
          <StatusBadge status={sc.label} variant={sc.variant} />
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-[32px] font-light tracking-tight text-console-text">{unitsPct}%</span>
          <span className="text-[13px] text-console-mute">
            {totalTarget === 0 ? 'No quotas today' : `${totalCompleted} of ${totalTarget} covered`}
          </span>
        </div>
        <div className="mt-3">
          <Progress
            value={totalCompleted}
            max={totalTarget > 0 ? totalTarget : 1}
            variant={status === 'completed' || status === 'ready_to_close' ? 'success' : status === 'behind' ? 'danger' : 'warning'}
            size="md"
          />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-console-mute">
          <span>{timeRemaining} left</span>
          <span>{Math.round(dayElapsedPct * 100)}% of day elapsed</span>
        </div>
      </div>

      {/* Warning */}
      {warning && (
        <div className={cn(
          'mx-5 mb-3 rounded border px-3 py-2',
          warning.level === 'very_late' ? 'border-status-danger/30 bg-status-danger/8' :
          warning.level === 'late' ? 'border-status-warning/30 bg-status-warning/8' :
          'border-status-success/30 bg-status-success/8'
        )}>
          <p className={cn(
            'text-[12px] font-medium',
            warning.level === 'very_late' ? 'text-status-danger' :
            warning.level === 'late' ? 'text-status-warning' :
            'text-status-success'
          )}>
            {warning.message}
          </p>
        </div>
      )}

      {/* Jobs list */}
      {workingDay && jobs.length > 0 && (
        <ol className="border-t border-console-line">
          {jobs.slice(0, 5).map((job, i) => {
            const covered = job.done >= job.goal
            const pct = job.goal > 0 ? Math.min(100, Math.round((job.done / job.goal) * 100)) : 0
            return (
              <li key={job.key} className="border-b border-console-line/50 last:border-b-0 px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn(
                      'flex size-6 items-center justify-center rounded text-[10px] font-medium',
                      covered ? 'bg-status-success/15 text-status-success' : 'bg-orange/10 text-orange'
                    )}>
                      {covered ? '✓' : i + 1}
                    </span>
                    <span className="text-[13px] text-console-text truncate">{job.title}</span>
                  </div>
                  <span className={cn(
                    'shrink-0 text-[12px] font-medium',
                    covered ? 'text-status-success' : 'text-console-mute'
                  )}>
                    {covered ? 'Covered' : `${job.done}/${job.goal}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-console-line/40">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: EASE, delay: i * 0.06 }}
                    className={cn('h-full rounded-full', covered ? 'bg-status-success' : 'bg-orange')}
                  />
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {!workingDay && (
        <div className="border-t border-console-line px-5 py-6 text-center">
          <p className="text-[13px] text-console-mute">Numbers are not due today.</p>
        </div>
      )}
    </div>
  )
}

// ── Referred to You ─────────────────────────────────────────────────────────

function ReferredCard({ leads }: { leads: RepTodayData['referredLeads'] }) {
  return (
    <div className="srf-console srf-console-edge p-5">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-orange" />
        <h3 className="text-sm font-medium text-console-text">Referred to you</h3>
        <span className="rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-medium text-orange">{leads.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {leads.slice(0, 3).map((lead, i) => (
          <motion.div
            key={lead.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
          >
            <Link
              href={`/leads/${lead.id}`}
              className="flex items-center gap-3 rounded border border-orange/15 bg-orange/[0.04] px-3 py-2.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-orange/35 hover:bg-orange/[0.08]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-console-text">{lead.company}</p>
                {lead.referrerName && (
                  <p className="text-[11px] text-console-mute">From {lead.referrerName}</p>
                )}
              </div>
              <ArrowRight className="size-4 shrink-0 text-console-mute" />
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ── Action List Card ────────────────────────────────────────────────────────

function ActionListCard({
  title,
  tone,
  actions,
}: {
  title: string
  tone: 'orange' | 'warning'
  actions: RelayTodayAction[]
}) {
  const borderColor = tone === 'orange' ? 'border-orange/20' : 'border-status-warning/15'
  const bgColor = tone === 'orange' ? 'bg-orange/[0.03]' : 'bg-status-warning/[0.03]'

  return (
    <div className={cn('srf-console h-full p-5')}>
      <div className="flex items-center gap-2">
        {tone === 'orange' ? (
          <AlertCircle className="size-4 text-orange" />
        ) : (
          <Clock className="size-4 text-status-warning" />
        )}
        <h3 className="text-sm font-medium text-console-text">{title}</h3>
      </div>
      <div className="mt-3 space-y-2">
        {actions.map((action, i) => (
          <motion.div
            key={action.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
          >
            <Link
              href={action.href}
              className={cn(
                'flex items-center gap-3 rounded border px-3 py-2.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5',
                borderColor, bgColor
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {channelIcon(action.kind)}
                  <span className="text-[13px] font-medium text-console-text">{action.title}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-console-mute">{whyThisIsNext(action)}</p>
              </div>
              <ArrowRight className="size-3.5 shrink-0 text-console-mute" />
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ── Up Next Card ───────────────────────────────────────────────────────────

function UpNextCard({ actions, excludeId }: { actions: RelayTodayAction[]; excludeId?: string }) {
  const visible = actions.filter(a => a.id !== excludeId).slice(0, 5)
  if (visible.length === 0) return null

  return (
    <div className="srf-console p-5">
      <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Up Next</p>
      <div className="mt-3 space-y-1">
        {visible.map((action, i) => (
          <motion.div
            key={action.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          >
            <Link
              href={action.href}
              className="group flex items-start gap-3 rounded px-3 py-2.5 transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-console-raised"
            >
              <span className="mt-0.5 w-5 text-mono-medium text-[11px] text-console-mute">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-console-text truncate">{action.title}</p>
                {action.humanAction && (
                  <p className="mt-0.5 text-[12px] text-orange">{action.humanAction}</p>
                )}
              </div>
              <ArrowRight className="size-3.5 mt-0.5 shrink-0 text-console-mute transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:text-orange" />
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ── Working As ──────────────────────────────────────────────────────────────

function WorkingAsCard({ identities }: { identities: RepTodayData['identities'] }) {
  return (
    <div className="srf-console p-5">
      <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Working as</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {identities.map((identity, i) => {
          const left = identity.targets.reduce((s, t) => s + t.remaining, 0)
          const total = identity.targets.reduce((s, t) => s + t.targetCount, 0)
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
                className="block rounded border border-console-line bg-console-raised/50 px-3 py-3 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-orange/25 hover:bg-console-raised"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-console-text">{identity.identityName}</span>
                  <span className={cn('shrink-0 text-[11px] font-medium', left === 0 ? 'text-status-success' : 'text-console-mute')}>
                    {left === 0 ? '✓' : `${left} left`}
                  </span>
                </div>
                <p className="text-[11px] text-console-mute">{identity.channel} · {identity.title || 'No title'}</p>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-console-line/40">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: EASE }}
                    className={cn('h-full rounded-full', pct >= 80 ? 'bg-status-success' : pct > 0 ? 'bg-orange' : 'bg-console-line')}
                  />
                </div>
              </Link>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ── Execution Health Card ───────────────────────────────────────────────────

function ExecutionHealthCard({ data }: { data: ExecutionHealthData }) {
  const stateConfig: Record<string, { label: string; color: string; bg: string }> = {
    ON_TRACK: { label: 'ON TRACK', color: 'text-status-success', bg: 'bg-status-success/10' },
    NEEDS_ATTENTION: { label: 'NEEDS ATTENTION', color: 'text-status-warning', bg: 'bg-status-warning/10' },
    BEHIND: { label: 'BEHIND', color: 'text-status-danger', bg: 'bg-status-danger/10' },
    CAUGHT_UP: { label: 'CAUGHT UP', color: 'text-cobalt', bg: 'bg-cobalt/10' },
    BLOCKED: { label: 'BLOCKED', color: 'text-console-mute', bg: 'bg-console-line/20' },
  }
  const sc = stateConfig[data.state] ?? { label: data.state, color: 'text-console-mute', bg: 'bg-console-line/20' }

  return (
    <div className="srf-console h-full p-5">
      <div className="flex items-center justify-between">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Execution Health</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.color}`}>
          {sc.label}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[28px] font-light tracking-tight text-console-text">{data.executionHealth}%</span>
        <span className="text-[11px] text-console-mute">
          SLA {data.slaScore}%
        </span>
      </div>

      {/* Action breakdown */}
      {data.completions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {data.completions.map((c) => {
            const pct = Math.min(100, Math.round(c.rawRatio * 100))
            const label = c.action.replace(/_/g, ' ').toLowerCase()
            return (
              <div key={c.action} className="flex items-center gap-2">
                <span className="w-20 truncate text-[11px] text-console-mute">{label}</span>
                <div className="flex-1 h-1 overflow-hidden rounded-full bg-console-line/40">
                  <div
                    className={cn('h-full rounded-full', pct >= 80 ? 'bg-status-success' : pct >= 40 ? 'bg-orange' : 'bg-status-danger')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="shrink-0 text-[10px] font-medium text-console-mute">
                  {c.actual}/{c.target}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.warnings.map((w, i) => (
            <p key={i} className={cn(
              'text-[11px] font-medium',
              w.level === 'urgent' ? 'text-status-danger' :
              w.level === 'warning' ? 'text-status-warning' :
              'text-console-mute'
            )}>
              {w.message}
            </p>
          ))}
        </div>
      )}

      {/* Primary next action */}
      {data.primaryNextAction && (
        <p className="mt-3 text-[11px] text-orange">
          Next: {data.primaryNextAction}
        </p>
      )}
    </div>
  )
}

// ── No Assignments ─────────────────────────────────────────────────────────

function NoAssignmentsState({ repName }: { repName: string }) {
  return (
    <div className="space-y-6 pb-10">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="srf-console p-8"
      >
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Your Day</p>
        <h2 className="mt-2 text-[28px] font-light tracking-[-0.02em] text-console-text">
          Good day, {repName}
        </h2>
      </motion.section>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
        className="srf-dossier flex flex-col items-center gap-3 px-6 py-12 text-center"
      >
        <ClipboardList className="size-8 text-stone" />
        <p className="text-[14px] font-medium text-ink">No work profile assigned yet</p>
        <p className="max-w-xs text-[13px] text-graphite">
          Your admin needs to assign a Revenue Identity before you can start.
        </p>
      </motion.section>
    </div>
  )
}


