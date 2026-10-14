'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import {
  Send, Reply, Bell, Clock, CheckCircle2,
  TrendingUp, Flame, AlertTriangle, ChevronRight,
  Users, Target, Zap,
} from 'lucide-react'
import { cn } from 'cn'
import type { RepWorkspaceData } from '@/components/rep/rep-workspace'
import type { RelayTodayAction } from '@/components/relay-today-workspace'

/* ─── helpers ─── */
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days > 0) return `${days}d ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs > 0) return `${hrs}h ago`
  return `${Math.floor(diff / 60_000)}m ago`
}

// ActionKind is a subset of RelayTaskKind relevant to the queue
type ActionKind = RelayTodayAction['kind']

function taskIcon(kind: ActionKind) {
  switch (kind) {
    case 'reply_needed': return <Reply className="size-4 text-orange" />
    case 'followup_due': return <Bell className="size-4 text-orange" />
    case 'connection_dm_due': return <Send className="size-4 text-cobalt" />
    case 'lead_going_cold': return <AlertTriangle className="size-4 text-status-warning" />
    case 'inbound_opportunity': return <Flame className="size-4 text-orange" />
    case 'job_worth_apply': return <Zap className="size-4 text-cobalt" />
    default: return <Target className="size-4 text-stone" />
  }
}

function priorityValue(p: string) { return p === 'urgent' ? 0 : p === 'high' ? 1 : p === 'medium' ? 2 : 3 }

/* ─── component ─── */
export function RepDashboard({ data }: { data: RepWorkspaceData }) {
  const { day, nextAction, upNext, resumeWork, notifications } = data

  const sortedTasks = [...upNext].sort((a, b) => priorityValue(a.priority) - priorityValue(b.priority))
  const grouped = {
    'Needs Reply': sortedTasks.filter((t) => t.kind === 'reply_needed'),
    'Follow-Up Due': sortedTasks.filter((t) => t.kind === 'followup_due'),
    'To Contact': sortedTasks.filter((t) => t.kind === 'connection_dm_due'),
    'Other': sortedTasks.filter((t) => !['reply_needed', 'followup_due', 'connection_dm_due'].includes(t.kind)),
  }

  const completionPct = day.totalRemaining + (day.repliesWaiting || 0) + (day.followUpsDue || 0) > 0
    ? Math.round(((day.totalRemaining || 0) / ((day.totalRemaining || 0) + (day.repliesWaiting || 0) + (day.followUpsDue || 0) + (day.outreachRemaining || 0))) * 100)
    : 100

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.2em] text-stone">Your Relay</p>
        <h1 className="mt-1 text-display text-[32px] font-light tracking-[-0.02em] text-ink">
          Good {greeting()}, {data.rep.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-[13px] text-graphite">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </header>

      {/* Day progress */}
      <div className="rounded-2xl border border-line bg-bone-raised/30 px-6 py-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-cobalt" />
            <span className="text-sm font-medium text-ink">Today&apos;s Progress</span>
          </div>
          <span className={cn(
            'text-sm font-semibold',
            day.isComplete ? 'text-status-success' : 'text-ink'
          )}>
            {day.isComplete ? 'Day Complete ✓' : `${completionPct}% done`}
          </span>
        </div>
        <div className="h-2 rounded-full bg-line/40 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${completionPct}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'h-full rounded-full',
              day.isComplete ? 'bg-status-success' : completionPct >= 60 ? 'bg-cobalt' : 'bg-orange'
            )}
          />
        </div>
        <div className="mt-3 flex gap-4 text-[11px] text-stone">
          <span>{day.repliesWaiting || 0} replies waiting</span>
          <span>{day.followUpsDue || 0} follow-ups due</span>
          <span>{day.outreachRemaining || 0} outreach remaining</span>
        </div>
      </div>

      {/* Primary action */}
      {nextAction && (
            <Link href={nextAction.href} className="block group">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border border-orange/30 bg-orange/[0.04] px-6 py-5 hover:bg-orange/[0.08] transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded-full bg-orange px-2 py-0.5 text-[10px] font-semibold text-on-accent uppercase tracking-wider">
                Do This Next
              </span>
              <span className="text-[11px] text-stone">{nextAction.priority}</span>
            </div>
            <p className="text-[15px] font-medium text-ink">{nextAction.title}</p>
            {nextAction.subtitle && (
              <p className="mt-1 text-[13px] text-graphite">{nextAction.subtitle}</p>
            )}
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-orange group-hover:underline">
              Open lead <ChevronRight className="size-3" />
            </div>
          </motion.div>
        </Link>
      )}

      {/* Resume work */}
      {(resumeWork?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-orange/20 bg-orange/[0.02] px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-orange mb-3">Resume Work</p>
          <div className="space-y-2">
            {resumeWork!.slice(0, 3).map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-orange/[0.06] transition-colors">
                <div>
                  <p className="text-sm text-ink">{lead.contactName ?? lead.company}</p>
                  <p className="text-[11px] text-stone">{lead.lastAction}</p>
                </div>
                <ChevronRight className="size-4 text-stone" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Task groups */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(grouped).map(([label, tasks]) => {
          if (tasks.length === 0) return null
          return (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-line/40 px-5 py-3">
                <span className="text-sm font-medium text-ink">{label}</span>
                <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-stone">{tasks.length}</span>
              </div>
              <div className="divide-y divide-line/20">
                {tasks.slice(0, 5).map((task, i) => (
                  <Link key={`${task.id}-${i}`} href={task.href} className="flex items-start gap-3 px-5 py-3 hover:bg-bone-raised/40 transition-colors">
                    <span className="mt-0.5 shrink-0">{taskIcon(task.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">{task.title}</p>
                      {task.subtitle && <p className="text-[11px] text-stone truncate">{task.subtitle}</p>}
                    </div>
                    {task.identity?.name && (
                      <span className="shrink-0 text-[10px] text-stone hidden sm:block">{task.identity.name}</span>
                    )}
                  </Link>
                ))}
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Notifications */}
      {(notifications?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {(notifications ?? []).slice(0, 3).map((n, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-bone-raised/20 px-4 py-3">
              <AlertTriangle className="size-4 text-status-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-ink">{n.title}</p>
                <p className="text-[11px] text-stone">{n.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
