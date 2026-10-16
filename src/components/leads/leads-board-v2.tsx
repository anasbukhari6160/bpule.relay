'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'motion/react'
import {
  Search, ChevronDown, Clock, Send, Reply, Bell,
  CheckCircle2, Snowflake, Users, Building2, ExternalLink,
  AlertTriangle, Archive,
} from 'lucide-react'
import { cn } from 'cn'
import { ScoreRing } from '@/components/score-ring'
import { derivePipelineStage, type LeadRow, type PipelineStage } from './pipeline-utils'

/* ─── config ─── */
const PAGE_SIZE = 50

const STAGE_META: Record<PipelineStage, {
  label: string
  icon: React.ReactNode
  color: string
  description: string
}> = {
  to_contact: { label: 'To Contact', icon: <Send className="size-3.5" />, color: 'text-stone-500', description: 'New leads waiting for first contact' },
  needs_reply: { label: 'Needs Reply', icon: <Reply className="size-3.5" />, color: 'text-orange', description: 'Prospect replied — respond now' },
  follow_up_due: { label: 'Follow-Up Due', icon: <Bell className="size-3.5" />, color: 'text-orange', description: 'Time to re-engage' },
  waiting: { label: 'Waiting', icon: <Clock className="size-3.5" />, color: 'text-cobalt', description: 'Sent, awaiting response' },
  done: { label: 'Done', icon: <CheckCircle2 className="size-3.5" />, color: 'text-status-success', description: 'Won or closed' },
  cold: { label: 'Cold', icon: <Snowflake className="size-3.5" />, color: 'text-status-warning', description: 'Unresponsive — will auto-archive' },
}

const FILTERS: Array<{ key: PipelineStage | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'to_contact', label: 'To Contact' },
  { key: 'needs_reply', label: 'Needs Reply' },
  { key: 'follow_up_due', label: 'Follow-Up' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'done', label: 'Done' },
]

/* ─── helpers ─── */
function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days > 0) return `${days}d`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs > 0) return `${hrs}h`
  return `${Math.floor(diff / 60_000)}m`
}

function getInitials(name: string | null | undefined): string {
  return (name ?? '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function archivalCountdown(lead: LeadRow): number | null {
  // Days until auto-archive (frozen state). Returns null if not approaching.
  const lifecycle = lead.lifecycle
  if (!lifecycle || lifecycle.state === 'frozen') return null
  if (lifecycle.state === 'cold') {
    // Cold leads get archived after frozenDays (21) of cold state
    const frozenAfter = 21
    const daysInCold = lifecycle.daysStale || 0
    const remaining = frozenAfter - daysInCold
    if (remaining <= 7) return remaining // Only show when ≤ 7 days left
  }
  if (lifecycle.state === 'stale') {
    const coldAfter = 14
    const daysStale = lifecycle.daysStale || 0
    const remainingUntilCold = coldAfter - daysStale
    if (remainingUntilCold <= 3) return remainingUntilCold + 21 // Days until archive
  }
  return null
}

function smartSort(leads: LeadRow[]): LeadRow[] {
  // Agentic priority: needs_reply first (client waiting), then follow_up_due (timing),
  // then to_contact (new), then waiting (we wait), then cold/done
  const priority: Record<PipelineStage, number> = {
    needs_reply: 0,
    follow_up_due: 1,
    to_contact: 2,
    waiting: 3,
    cold: 4,
    done: 5,
  }
  return [...leads].sort((a, b) => {
    const pa = priority[derivePipelineStage(a)]
    const pb = priority[derivePipelineStage(b)]
    if (pa !== pb) return pa - pb
    // Within same stage: most recent activity first
    const aTime = a.lastInboundAt || a.lastOutboundAt || a.createdAt
    const bTime = b.lastInboundAt || b.lastOutboundAt || b.createdAt
    return new Date(bTime).getTime() - new Date(aTime).getTime()
  })
}

/* ─── component ─── */
export function LeadsBoardV2({ leads }: { leads: LeadRow[] }) {
  const [filter, setFilter] = useState<PipelineStage | 'all'>('all')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<PipelineStage>>(new Set(['done', 'cold']))
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (filter !== 'all' && derivePipelineStage(l) !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          l.contactName?.toLowerCase().includes(q) ||
          l.company?.toLowerCase().includes(q) ||
          l.contactTitle?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [leads, filter, search])

  const sorted = useMemo(() => smartSort(filtered), [filtered])

  const displayed = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount])
  const hasMore = sorted.length > visibleCount

  const loadMore = useCallback(() => {
    setVisibleCount((v) => v + PAGE_SIZE)
  }, [])

  const grouped = useMemo(() => {
    const groups: Record<PipelineStage, LeadRow[]> = { to_contact: [], needs_reply: [], follow_up_due: [], waiting: [], done: [], cold: [] }
    for (const lead of displayed) {
      groups[derivePipelineStage(lead)].push(lead)
    }
    return groups
  }, [displayed])

  const stats = useMemo(() => ({
    total: leads.length,
    to_contact: leads.filter((l) => derivePipelineStage(l) === 'to_contact').length,
    needs_reply: leads.filter((l) => derivePipelineStage(l) === 'needs_reply').length,
    follow_up_due: leads.filter((l) => derivePipelineStage(l) === 'follow_up_due').length,
    archivingSoon: leads.filter((l) => (archivalCountdown(l) ?? 99) <= 7).length,
  }), [leads])

  const toggleCollapse = (stage: PipelineStage) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  const activeStages: PipelineStage[] =
    filter === 'all' ? ['needs_reply', 'follow_up_due', 'to_contact', 'waiting', 'cold', 'done'] : [filter]

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard icon={<Users className="size-4" />} label="Total" value={stats.total} />
        <StatCard icon={<Send className="size-4" />} label="To Contact" value={stats.to_contact} accent="stone" />
        <StatCard icon={<Reply className="size-4" />} label="Needs Reply" value={stats.needs_reply} accent="orange" />
        <StatCard icon={<Bell className="size-4" />} label="Follow-Up Due" value={stats.follow_up_due} accent="orange" />
        <StatCard icon={<Archive className="size-4" />} label="Archiving Soon" value={stats.archivingSoon} accent="red" />
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone/40" />
          <input
            type="text"
            placeholder="Search by name, company, or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-bone pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-stone/40 focus:border-orange/40 focus:outline-none transition-colors"
          />
        </div>
        <div className="flex rounded-xl border border-line bg-bone p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200',
                filter === f.key ? 'bg-orange text-on-accent shadow-sm' : 'text-ink/50 hover:text-ink/80'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Groups */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {activeStages.map((stage) => {
            const leadsInStage = grouped[stage]
            if (!leadsInStage || leadsInStage.length === 0) return null
            const meta = STAGE_META[stage]
            const isCollapsed = collapsed.has(stage)

            return (
              <motion.div
                key={stage}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden"
              >
                <button
                  onClick={() => toggleCollapse(stage)}
                  className="flex w-full items-center justify-between px-5 py-3 hover:bg-bone-raised/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn('flex items-center justify-center rounded-lg p-1.5', meta.color, 'bg-bone-raised')}>
                      {meta.icon}
                    </span>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">{meta.label}</span>
                        <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-stone">
                          {leadsInStage.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone/60">{meta.description}</p>
                    </div>
                  </div>
                  <ChevronDown className={cn('size-4 text-stone transition-transform duration-200', isCollapsed && '-rotate-90')} />
                </button>

                <AnimatePresence>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="divide-y divide-line/30">
                        {leadsInStage.map((lead, i) => (
                          <LeadCard key={lead.id} lead={lead} index={i} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            className="rounded-xl border border-line bg-bone px-6 py-2.5 text-sm font-medium text-ink/70 hover:bg-bone-raised hover:text-ink transition-colors"
          >
            Load more ({sorted.length - visibleCount} remaining)
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="py-16 text-center">
          <Search className="mx-auto mb-3 size-8 text-stone/30" />
          <p className="text-sm text-stone">No leads match your search.</p>
        </div>
      )}
    </div>
  )
}

/* ─── lead card ─── */
function LeadCard({ lead, index }: { lead: LeadRow; index: number }) {
  const stage = derivePipelineStage(lead)
  const action = primaryAction(lead)
  const countdown = archivalCountdown(lead)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className="group"
    >
      <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-bone-raised/30 transition-colors">
        {/* Avatar + status dot */}
        <div className="relative shrink-0">
          <div className="flex size-10 items-center justify-center rounded-full bg-cobalt/10 text-sm font-semibold text-cobalt">
            {getInitials(lead.contactName ?? lead.company ?? '?')}
          </div>
          {stage === 'needs_reply' && (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-orange ring-2 ring-bone-raised" />
          )}
          {countdown !== null && (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-status-warning text-[8px] font-bold text-on-accent ring-2 ring-bone-raised">
              {countdown}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-ink hover:text-orange transition-colors truncate">
              {lead.contactName ?? 'Unnamed prospect'}
            </Link>
            {lead.company && (
              <span className="flex items-center gap-1 text-xs text-stone truncate">
                <Building2 className="size-3 shrink-0" />
                {lead.company}
              </span>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-xs text-stone/70">
            {lead.contactTitle && <span className="truncate">{lead.contactTitle}</span>}
            {lead.contactTitle && lead.lastOutboundAt && <span className="text-line">·</span>}
            {(lead.lastInboundAt || lead.lastOutboundAt) && (
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="size-3" />
                {timeAgo(lead.lastInboundAt ?? lead.lastOutboundAt ?? null)}
              </span>
            )}
          </div>

          {/* Rep assignment (admin view) */}
          {lead.ownerName && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-cobalt/80">
              <Users className="size-3" />
              <span>{lead.ownerName}</span>
            </div>
          )}

          {/* Archival warning */}
          {countdown !== null && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-status-warning">
              <AlertTriangle className="size-3" />
              <span>Auto-archiving in {countdown} day{countdown !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Score + action */}
        <div className="flex items-center gap-3 shrink-0">
          <ScoreRing score={lead.score} canonicalScore={lead.canonicalScore} size={38} />
          <Link
            href={action.href}
            className="flex items-center gap-1.5 rounded-lg bg-orange px-3 py-1.5 text-xs font-medium text-on-accent transition-all duration-200 hover:bg-orange/90 hover:shadow-sm active:scale-[0.97]"
          >
            {action.label}
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function primaryAction(lead: LeadRow): { label: string; href: string } {
  const stage = derivePipelineStage(lead)
  if (stage === 'to_contact') return { label: 'Send connection', href: `/leads/${lead.id}` }
  if (stage === 'needs_reply') return { label: 'Reply', href: `/leads/${lead.id}?tab=conversation` }
  if (stage === 'follow_up_due') return { label: 'Follow up', href: `/leads/${lead.id}?tab=conversation` }
  return { label: 'View', href: `/leads/${lead.id}` }
}

/* ─── stat card ─── */
function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode
  label: string
  value: number
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-bone-raised/30 px-4 py-3 flex items-center gap-3">
      <div className={cn(
        'flex items-center justify-center rounded-lg p-2',
        accent === 'orange' ? 'bg-orange/10 text-orange' :
        accent === 'red' ? 'bg-red-50 text-red-500' :
        accent === 'stone' ? 'bg-stone-100 text-stone-500' :
        'bg-cobalt/10 text-cobalt'
      )}>
        {icon}
      </div>
      <div>
        <p className="text-lg font-semibold text-ink">{value}</p>
        <p className="text-[11px] text-stone/60">{label}</p>
      </div>
    </div>
  )
}
