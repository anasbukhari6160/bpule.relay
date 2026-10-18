'use client'

import { motion } from 'motion/react'
import Link from 'next/link'
import {
  Users, TrendingUp, CheckCircle2, AlertTriangle,
  Clock, ChevronRight, Send, Reply, Bell,
  Target, Flame, MessageSquare, Mail,
} from 'lucide-react'
import { cn } from 'cn'
import { AdminPerformanceOverview } from '@/components/performance/admin-performance-overview'
import type { AccountabilityDashboardData } from '@/lib/relay/dashboard-loader'

/* ─── helpers ─── */
function catKeyToIcon(key: string): React.ReactNode {
  if (key.includes('connection')) return <Send className="size-3.5" />
  if (key.includes('dm') || key.includes('message')) return <MessageSquare className="size-3.5" />
  if (key.includes('reply')) return <Reply className="size-3.5" />
  if (key.includes('follow')) return <Bell className="size-3.5" />
  if (key.includes('email')) return <Mail className="size-3.5" />
  return <Target className="size-3.5" />
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-status-success bg-status-success/10'
    case 'on_track': return 'text-cobalt bg-cobalt/10'
    case 'behind': return 'text-orange bg-orange/10'
    case 'blocked': return 'text-status-danger bg-status-danger/10'
    default: return 'text-stone bg-stone-100'
  }
}

function completionPct(completed: number, target: number): number {
  if (target === 0) return 100
  return Math.min(100, Math.round((completed / target) * 100))
}

/* ─── component ─── */
export function AdminDashboard({ data }: { data: AccountabilityDashboardData | null }) {
  if (!data) {
    return <p className="py-12 text-center text-sm text-stone">Could not load dashboard data.</p>
  }

  const { commandCenter, myDay } = data
  const health = commandCenter?.teamHealth
  const totalReps = (health?.working ?? 0) + (health?.closed ?? 0)
  const activeReps = (health?.onTrack ?? 0) + (health?.behind ?? 0) + (health?.atRisk ?? 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.2em] text-stone">Command Center</p>
        <h1 className="mt-1 text-display text-[32px] font-light tracking-[-0.02em] text-ink">Team Overview</h1>
        <p className="mt-1 text-[13px] text-graphite">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </header>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={<Users className="size-4" />}
          label="Active Reps"
          value={activeReps}
          accent="cobalt"
          sub={`${totalReps} total`}
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Day Complete"
          value={health?.closed ?? 0}
          accent="green"
          sub={`of ${totalReps}`}
        />
        <StatCard
          icon={<AlertTriangle className="size-4" />}
          label="Need Attention"
          value={commandCenter?.attentionItems?.length ?? 0}
          accent="orange"
          sub={commandCenter?.attentionItems?.length ? 'act now' : 'all clear'}
        />
        <StatCard
          icon={<Flame className="size-4" />}
          label="My Progress"
          value={myDay ? `${Math.round(100 - (myDay.dayElapsedPct * 100))}%` : '—'}
          accent="cobalt"
          sub={myDay?.status ?? '—'}
        />
      </div>

      {/* Attention items */}
      {commandCenter?.attentionItems && commandCenter.attentionItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-orange/20 bg-orange/[0.03] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-5 py-3 border-b border-orange/10">
            <AlertTriangle className="size-4 text-orange" />
            <span className="text-sm font-medium text-ink">Needs Attention</span>
            <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange">
              {commandCenter.attentionItems.length}
            </span>
          </div>
          <div className="divide-y divide-orange/10">
            {commandCenter.attentionItems.map((item, i) => (
              <div key={`${item.repId}-${i}`} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{item.repName}</p>
                  <p className="text-[11px] text-stone">{item.message}</p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor(item.status))}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Weighted Performance Overview */}
      {commandCenter?.team && commandCenter.team.length > 0 && (
        <AdminPerformanceOverview
          repIds={commandCenter.team.map((t) => t.personId)}
          repNames={Object.fromEntries(commandCenter.team.map((t) => [t.personId, t.personName]))}
        />
      )}

      {/* Team roster */}
      {commandCenter?.team && commandCenter.team.length > 0 && (
        <div className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-line/40">
            <span className="text-sm font-medium text-ink">Team Roster</span>
            <span className="text-[11px] text-stone">{commandCenter.team.length} members</span>
          </div>
          <div className="divide-y divide-line/30">
            {[...commandCenter.team]
              .sort((a, b) => {
                if (a.status === 'behind' && b.status !== 'behind') return -1
                if (b.status === 'behind' && a.status !== 'behind') return 1
                return b.remaining - a.remaining
              })
              .map((person, i) => (
                <RepRow key={person.personId} person={person} index={i} />
              ))}
          </div>
        </div>
      )}

      {/* My activity (admin's own outreach) */}
      {myDay && (
        <div className="rounded-2xl border border-line bg-bone-raised/20 px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone mb-3">Your Outreach Today</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(myDay.categories ?? []).map((cat) => (
              <MiniStat
                key={cat.key}
                icon={catKeyToIcon(cat.key)}
                label={cat.label}
                value={cat.completed}
                target={cat.target}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── rep row ─── */
interface TeamPerson {
  personId: string
  personName: string
  workingAs: string[]
  progress: string
  remaining: number
  status: string
  dayCloseStatus: string | null
}

function RepRow({ person, index }: { person: TeamPerson; index: number }) {
  const pct = completionPct(
    parseInt(person.progress.split('/')[0]) || 0,
    parseInt(person.progress.split('/')[1]) || 0,
  )
  const isComplete = person.status === 'completed' || person.remaining === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="flex items-center gap-4 px-5 py-3 hover:bg-bone-raised/30 transition-colors"
    >
      {/* Avatar + name */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={cn(
          'flex size-9 items-center justify-center rounded-full text-xs font-semibold shrink-0',
          isComplete ? 'bg-status-success/10 text-status-success' : person.status === 'behind' ? 'bg-orange/10 text-orange' : 'bg-cobalt/10 text-cobalt'
        )}>
          {person.personName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{person.personName}</p>
          <p className="text-[11px] text-stone truncate">
            {person.workingAs.length > 0 ? person.workingAs.join(', ') : 'No profile assigned'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="hidden sm:block w-32 shrink-0">
        <div className="h-1.5 rounded-full bg-line/40 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, delay: index * 0.03 }}
            className={cn('h-full rounded-full', isComplete ? 'bg-status-success' : person.status === 'behind' ? 'bg-orange' : 'bg-cobalt')}
          />
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor(person.status))}>
          {isComplete ? 'Done' : person.status === 'behind' ? `${person.remaining} left` : person.status}
        </span>
      </div>
    </motion.div>
  )
}

/* ─── stat card ─── */
function StatCard({ icon, label, value, accent, sub }: {
  icon: React.ReactNode; label: string; value: number | string; accent: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-bone-raised/30 px-4 py-3.5 flex items-center gap-3">
      <div className={cn(
        'flex items-center justify-center rounded-lg p-2',
        accent === 'cobalt' ? 'bg-cobalt/10 text-cobalt' :
        accent === 'green' ? 'bg-status-success/10 text-status-success' :
        accent === 'orange' ? 'bg-orange/10 text-orange' :
        'bg-stone-100 text-stone-500'
      )}>
        {icon}
      </div>
      <div>
        <p className="text-lg font-semibold text-ink">{value}</p>
        <p className="text-[11px] text-stone/60">{label}{sub ? ` · ${sub}` : ''}</p>
      </div>
    </div>
  )
}

/* ─── mini stat ─── */
function MiniStat({ icon, label, value, target }: { icon: React.ReactNode; label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 100
  return (
    <div className="rounded-lg border border-line/50 bg-bone px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-stone">{icon}</span>
        <span className="text-[11px] text-stone">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold text-ink">{value}</span>
        {target > 0 && <span className="text-[10px] text-stone">/ {target}</span>}
      </div>
      {target > 0 && (
        <div className="mt-1.5 h-1 rounded-full bg-line/40 overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', pct >= 80 ? 'bg-status-success' : pct >= 40 ? 'bg-cobalt' : 'bg-orange')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
