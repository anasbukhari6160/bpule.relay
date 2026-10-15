import { Suspense, type ComponentType } from 'react'
import Link from 'next/link'
import {
  MessageCircle,
  MessageSquare,
  Clock,
  Target,
  Search,
  FileText,
  Snowflake,
  PenLine,
  Shield,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import { buildRoleContext } from '@/lib/relay/role-intelligence'
import { buildRelayQueue, filterQueueByRole } from '@/lib/relay/queue-engine'
import type { RelayTask, RelayTaskKind } from '@/lib/domain/types'
import { cn } from 'cn'

export const dynamic = 'force-dynamic'

function kindLabel(kind: RelayTaskKind): string {
  switch (kind) {
    case 'reply_needed': return 'Reply needed'
    case 'connection_dm_due': return 'Connection message'
    case 'followup_due': return 'Follow-up'
    case 'high_fit_lead': return 'High-fit'
    case 'new_opportunity': return 'Opportunity'
    case 'job_worth_apply': return 'Apply'
    case 'proposal_ready': return 'Proposal ready'
    case 'lead_going_cold': return 'Going cold'
    case 'content_opportunity': return 'Content'
    case 'admin_review': return 'Admin'
    case 'inbound_opportunity': return 'Inbound'
    default: return kind
  }
}

function priorityColor(p: RelayTask['priority']): string {
  switch (p) {
    case 'urgent': return 'text-status-danger'
    case 'high': return 'text-orange'
    case 'medium': return 'text-graphite'
    case 'low': return 'text-stone'
  }
}

function priorityBg(p: RelayTask['priority']): string {
  switch (p) {
    case 'urgent': return 'bg-status-danger/10 border-status-danger/20'
    case 'high': return 'bg-orange/10 border-orange/20'
    case 'medium': return 'bg-bone border-line'
    case 'low': return 'bg-bone-raised border-line'
  }
}

function entityHref(task: RelayTask): string {
  if (task.entityType === 'lead') return `/leads/${task.entityId}`
  if (task.entityType === 'job') return `/upwork/${task.entityId}`
  return '#'
}

const KIND_ICON_MAP: Record<RelayTaskKind, ComponentType<{ className?: string }>> = {
  reply_needed: MessageCircle,
  connection_dm_due: MessageSquare,
  followup_due: Clock,
  high_fit_lead: Target,
  new_opportunity: Search,
  job_worth_apply: FileText,
  proposal_ready: PenLine,
  lead_going_cold: Snowflake,
  content_opportunity: PenLine,
  admin_review: Shield,
  inbound_opportunity: MessageCircle,
}

function TaskIcon({ kind, size = 'md', priority }: { kind: RelayTaskKind; size?: 'sm' | 'md'; priority: RelayTask['priority'] }) {
  const Icon = KIND_ICON_MAP[kind]
  return <Icon className={cn(size === 'md' ? 'size-5' : 'size-4', priorityColor(priority))} />
}

function TaskCard({ task, featured = false }: { task: RelayTask; featured?: boolean }) {
  return (
    <Link
      href={entityHref(task)}
      className={cn(
        'group block transition-all',
        featured
          ? 'rounded-lg border border-line bg-bone-raised pl-[16px] pr-4 py-4 space-y-3 border-l-[2px] border-l-orange'
          : 'border-b border-line/60 py-3 last:border-b-0',
        task.stale && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <TaskIcon kind={task.kind} size={featured ? 'md' : 'sm'} priority={task.priority} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              'text-[10px] font-medium',
              task.priority === 'urgent' ? 'text-status-danger' :
              task.priority === 'high' ? 'text-orange' :
              'text-stone',
            )}>
              {kindLabel(task.kind)}
            </span>
            {task.stale && (
              <span className="flex items-center gap-1 text-[10px] text-stone">
                <AlertTriangle className="size-2.5" /> Stale
              </span>
            )}
            {task.recommendation.forbidsImpersonation && (
              <span className="flex items-center gap-1 text-[10px] text-stone">
                <Shield className="size-2.5" /> Human only
              </span>
            )}
          </div>
          <h3 className={cn(
            'font-medium text-ink',
            featured ? 'mt-1 text-[16px]' : 'mt-0.5 text-[14px]',
          )}>
            {task.title}
          </h3>
          <p className={cn(
            'text-graphite',
            featured ? 'mt-0.5 text-[12px]' : 'text-[11px]',
          )}>
            {task.subtitle}
          </p>

          {/* What happened + why */}
          {featured && (
            <div className="mt-2 space-y-0.5">
              <p className="text-[12px] text-graphite">
                <span className="font-medium text-ink">What:</span> {task.whatHappened}
              </p>
              <p className="text-[12px] text-graphite">
                <span className="font-medium text-ink">Why:</span> {task.whyItMatters}
              </p>
            </div>
          )}

          {/* Evidence trail */}
          {featured && task.recommendation.evidence.length > 0 && (
            <div className="mt-2 space-y-0.5">
              <p className="text-[10px] font-medium text-stone uppercase tracking-wide">Evidence</p>
              {task.recommendation.evidence.map((e, i) => (
                <p key={i} className="flex items-start gap-1.5 text-[11px] text-graphite">
                  {e.verified ? (
                    <CheckCircle2 className="mt-0.5 size-2.5 shrink-0 text-status-success" />
                  ) : (
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-stone" />
                  )}
                  <span className="line-clamp-1">{e.detail}</span>
                </p>
              ))}
            </div>
          )}

          {/* Prepared output */}
          {featured && task.recommendation.preparedOutput && (
            <div className="mt-2 rounded bg-bone px-3 py-2">
              <p className="text-[10px] font-medium text-stone uppercase tracking-wide">Prepared</p>
              <p className="mt-0.5 text-[11px] text-graphite line-clamp-3">
                {task.recommendation.preparedOutput}
              </p>
            </div>
          )}

          {/* Human action */}
          {featured && task.humanAction && (
            <div className="action-line">
              <span className="font-medium text-orange">
                Action: {task.humanAction} →
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function RelayMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-console-mute">{label}</p>
      <p className="mt-0.5 text-[18px] font-medium text-[color:var(--console-text)]">{value}</p>
    </div>
  )
}

async function loadRelay() {
  const user = await getCurrentUser()
  if (!user) return { authenticated: false as const }

  const store = await createScoutStore()
  const roleContext = buildRoleContext(user.rep, user.organization)

  const [dash, relayData, allLeads] = await Promise.all([
    store.getTodayDashboard(),
    store.getRelayQueueData(),
    store.fetchLeadsAll(),
  ])

  const queue = buildRelayQueue({
    roleContext,
    queueData: dash.mine,
    followupsDue: dash.followupsDue,
    upwork: dash.upwork,
    conversations: relayData.conversations,
    messagesByLead: relayData.messagesByLead,
    messagesByJob: relayData.messagesByJob,
    assignedProfiles: relayData.assignedProfiles,
    allLeads,
  })

  const visibleTasks = filterQueueByRole(queue, roleContext.role)
  const [topAction, ...restQueue] = visibleTasks
  const highCount = visibleTasks.filter((task) => task.priority === 'high').length
  const mediumLowCount = visibleTasks.filter((task) => task.priority === 'medium' || task.priority === 'low').length

  return {
    authenticated: true as const,
    queue,
    topAction,
    restQueue,
    highCount,
    mediumLowCount,
    role: roleContext.role,
  }
}

type RelayData = Awaited<ReturnType<typeof loadRelay>>

export default function RelayPage() {
  const relayPromise = loadRelay()

  return (
    <div className="space-y-5">
      <header className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">
          Queue / Relay Priority Engine
        </p>
        <h1 className="mt-2 text-[30px] leading-[1.05] tracking-[-0.03em] text-[color:var(--console-text)]">
          Full action queue across your operating system.
        </h1>
        <Suspense fallback={<div className="mt-2 h-4 w-72 max-w-full rounded bg-bone" />}>
          <RelaySubtitle relayPromise={relayPromise} />
        </Suspense>
        <Suspense fallback={<RelayMetricsSkeleton />}>
          <RelayMetrics relayPromise={relayPromise} />
        </Suspense>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded border border-line px-3 py-1.5 text-[12px] font-medium text-[color:var(--console-mute)] hover:text-[color:var(--console-text)]"
          >
            <ArrowRight className="size-3.5 rotate-180" />
            Back to Today
          </Link>
          <Link
            href="/prospect"
            className="inline-flex items-center gap-2 rounded border border-line/30 px-3 py-1.5 text-[12px] font-medium text-[color:var(--console-mute)] hover:text-[color:var(--console-text)]"
          >
            Prospect new opportunities
          </Link>

        </div>
      </header>

      <Suspense fallback={<RelayBodySkeleton />}>
        <RelayBody relayPromise={relayPromise} />
      </Suspense>

      {/* Principle reminder */}
      <section className="reveal-up stagger-3 srf-proof px-4 py-4">
        <div className="flex items-start gap-3">
          <Shield className="size-5 shrink-0 text-stone mt-0.5" />
          <div>
            <p className="text-[13px] font-medium text-ink">Relay prepares, you act.</p>
            <p className="mt-0.5 text-[12px] text-graphite">
              Every recommendation is traceable to its source. Relay never sends outreach,
              applies to jobs, or impersonates you. The human is always the final actor.
            </p>
          </div>
        </div>
      </section>

      <div className="h-4 lg:hidden" />
    </div>
  )
}

async function RelaySubtitle({ relayPromise }: { relayPromise: Promise<RelayData> }) {
  const data = await relayPromise
  if (!data.authenticated) return null
  const { queue } = data
  return (
    <p className="mt-2 text-[13px] text-[color:var(--console-mute)]">
      {queue.summary.total > 0
        ? `${queue.summary.total} items prepared${queue.summary.urgent > 0 ? `, ${queue.summary.urgent} urgent` : ''}.`
        : 'No active queue items right now.'}
    </p>
  )
}

async function RelayMetrics({ relayPromise }: { relayPromise: Promise<RelayData> }) {
  const data = await relayPromise
  if (!data.authenticated) return null
  const { queue, highCount, mediumLowCount } = data
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      <RelayMetric label="Queue total" value={queue.summary.total} />
      <RelayMetric label="Urgent" value={queue.summary.urgent} />
      <RelayMetric label="High" value={highCount} />
      <RelayMetric label="Medium/Low" value={mediumLowCount} />
    </div>
  )
}

async function RelayBody({ relayPromise }: { relayPromise: Promise<RelayData> }) {
  const data = await relayPromise

  if (!data.authenticated) {
    return (
      <div className="rounded-lg border border-line p-8 text-center">
        <p className="text-[15px] font-medium text-ink">Not authenticated.</p>
      </div>
    )
  }

  const { topAction, restQueue, role } = data

  return (
    <>
      {/* Top Action Hero */}
      {topAction && (
        <section className="reveal-up stagger-1">
          <TaskCard task={topAction} featured />
        </section>
      )}

      {/* Queue list */}
      {restQueue.length > 0 && (
        <section className="reveal-up stagger-2">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">Action Queue</h2>
            <span className="text-mono-medium text-[10px] text-stone">
              {restQueue.length} more
            </span>
          </div>
          <div>
            {restQueue.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!topAction && restQueue.length === 0 && (
        <section className="reveal-up stagger-2 srf-dossier py-10 text-center">
          <div className="mx-auto max-w-sm space-y-3">
            <p className="text-[15px] font-medium text-ink">
              Relay has nothing prepared right now.
            </p>
            <p className="text-[13px] leading-relaxed text-graphite">
              {role === 'admin'
                ? 'Team is on track. Check back when new leads arrive or replies come in.'
                : 'All clear. Time to prospect, work on content, or refine your profiles.'}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Link
                href="/prospect"
                className="inline-flex items-center gap-2 rounded-lg bg-orange px-4 py-2 text-[13px] font-medium text-on-accent transition-all hover:bg-orange-dark"
              >
                <Search className="size-4" />
                Check a prospect
              </Link>
              <Link
                href="/leads/new"
                className="inline-flex items-center gap-2 rounded-lg bg-solid px-4 py-2 text-[13px] font-medium text-on-solid transition-all hover:bg-solid/90"
              >
                New lead
              </Link>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

function RelayMetricsSkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
          <div className="h-2.5 w-16 rounded bg-bone" />
          <div className="mt-2 h-5 w-10 rounded bg-bone" />
        </div>
      ))}
    </div>
  )
}

function RelayBodySkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-bone-raised p-4">
        <div className="flex items-start gap-3">
          <div className="size-10 shrink-0 rounded-lg bg-bone" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-20 rounded bg-bone" />
            <div className="h-4 w-56 max-w-full rounded bg-bone" />
            <div className="h-3 w-72 max-w-full rounded bg-bone" />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-bone-raised">
        <div className="divide-y divide-line">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 p-4">
              <div className="size-8 shrink-0 rounded-lg bg-bone" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-44 max-w-full rounded bg-bone" />
                <div className="h-3 w-64 max-w-full rounded bg-bone" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
