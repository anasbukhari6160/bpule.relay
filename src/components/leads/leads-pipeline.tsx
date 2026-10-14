'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'motion/react'
import { Search, GripVertical, Clock, User, PenLine, Inbox, Send, Reply, CheckCircle2, Snowflake, Target, Bell } from 'lucide-react'
import { cn } from 'cn'
import { ScoreRing } from '@/components/score-ring'
import { signalById } from '@/lib/score/signals'
import { EmptyState } from '@/components/ui/empty-state'
import {
  PIPELINE_COLUMNS,
  TERMINAL_COLUMNS,
  derivePipelineStage,
  filterLeads,
  sortLeads,
  formatRelativeTime,
  truncate,
  type LeadRow,
  type PipelineStage,
  type SortMode,
} from './pipeline-utils'
import { getStalenessColor } from '@/lib/leads/lifecycle-policy'

interface LeadsPipelineProps {
  leads: LeadRow[]
  orgView: boolean
}

interface GroupedLeads {
  to_contact: LeadRow[]
  waiting: LeadRow[]
  follow_up_due: LeadRow[]
  needs_reply: LeadRow[]
  done: LeadRow[]
  cold: LeadRow[]
}

const COLUMN_ICONS: Record<PipelineStage, React.ReactNode> = {
  to_contact: <Send className="size-3.5" />,
  waiting: <Clock className="size-3.5" />,
  follow_up_due: <Bell className="size-3.5" />,
  needs_reply: <Reply className="size-3.5" />,
  done: <CheckCircle2 className="size-3.5" />,
  cold: <Snowflake className="size-3.5" />,
}

const EMPTY_MESSAGES: Record<PipelineStage, { title: string; hint: string }> = {
  to_contact: { title: 'Nothing to contact', hint: 'New leads appear here' },
  waiting: { title: 'No one waiting', hint: 'Sent messages will show here' },
  follow_up_due: { title: 'No follow-ups due', hint: 'Waiting leads appear here after 5 days' },
  needs_reply: { title: 'No replies yet', hint: 'Client responses land here' },
  done: { title: 'Nothing closed', hint: 'Won or lost leads go here' },
  cold: { title: 'No cold leads', hint: 'Unresponsive leads appear here' },
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function getScoreColor(score: number | null): string {
  if (score === null) return 'bg-line'
  if (score >= 80) return 'bg-status-success/20 text-status-success'
  if (score >= 60) return 'bg-orange/10 text-orange'
  if (score >= 40) return 'bg-status-warning/10 text-status-warning'
  return 'bg-line text-stone'
}

export function LeadsPipeline({ leads, orgView }: LeadsPipelineProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('activity')
  const [now, setNow] = useState(() => Date.now())
  const [localGroups, setLocalGroups] = useState<GroupedLeads | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const filtered = useMemo(() => filterLeads(leads, search), [leads, search])

  const grouped = useMemo<GroupedLeads>(() => {
    const groups: GroupedLeads = { to_contact: [], waiting: [], follow_up_due: [], needs_reply: [], done: [], cold: [] }
    for (const lead of filtered) {
      const stage = derivePipelineStage(lead)
      groups[stage].push(lead)
    }
    for (const stage of Object.keys(groups) as PipelineStage[]) {
      groups[stage] = sortLeads(groups[stage], sort)
    }
    return groups
  }, [filtered, sort])

  const displayGroups = localGroups ?? grouped

  const totalActive = displayGroups.to_contact.length + displayGroups.waiting.length + displayGroups.needs_reply.length

  const [draggedLead, setDraggedLead] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<PipelineStage | null>(null)

  function handleDragStart(leadId: string) {
    setDraggedLead(leadId)
  }

  function handleDragOver(e: React.DragEvent, stage: PipelineStage) {
    e.preventDefault()
    setDragOverColumn(stage)
  }

  function handleDragLeave() {
    setDragOverColumn(null)
  }

  async function handleDrop(e: React.DragEvent, destStage: PipelineStage) {
    e.preventDefault()
    setDragOverColumn(null)
    setDraggedLead(null)
    if (!draggedLead) return

    const sourceStage = findLeadStage(draggedLead, displayGroups)
    if (!sourceStage || sourceStage === destStage) return

    const lead = filtered.find((l) => l.id === draggedLead)
    if (!lead) return

    const updatedGroups = { ...displayGroups }
    const leadItem = updatedGroups[sourceStage].find((l) => l.id === draggedLead)
    if (!leadItem) return

    updatedGroups[sourceStage] = updatedGroups[sourceStage].filter((l) => l.id !== draggedLead)
    updatedGroups[destStage] = [...updatedGroups[destStage], leadItem]
    setLocalGroups(updatedGroups)

    const success = await executeStageTransition(draggedLead, sourceStage, destStage, lead)
    if (!success) {
      setLocalGroups(null)
    } else {
      setTimeout(() => setLocalGroups(null), 300)
    }
  }

  function findLeadStage(leadId: string, groups: GroupedLeads): PipelineStage | null {
    for (const stage of Object.keys(groups) as PipelineStage[]) {
      if (groups[stage].some((l) => l.id === leadId)) return stage
    }
    return null
  }

  if (leads.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No leads yet"
        description="Paste a LinkedIn profile, add a company, or import from Upwork. Drag cards between columns to move them through your pipeline."
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="w-full rounded-lg border border-line bg-bone py-1.5 pl-8 pr-3 text-[13px] text-ink placeholder:text-stone focus:border-orange focus:outline-none transition-colors"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="rounded-lg border border-line bg-bone px-2 py-1.5 text-[12px] text-ink focus:border-orange focus:outline-none transition-colors"
        >
          <option value="activity">Last activity</option>
          <option value="score">Highest score</option>
          <option value="recent">Newest</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-orange/10 px-2.5 py-0.5 text-[11px] font-medium text-orange count-pop">{totalActive} active</span>
        </div>
      </div>

      {/* Kanban — Active pipeline */}
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        {PIPELINE_COLUMNS.map((col) => (
          <PipelineColumn
            key={col.id}
            column={col}
            leads={displayGroups[col.id] ?? []}
            now={now}
            orgView={orgView}
            dragOverColumn={dragOverColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {/* Terminal columns */}
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        {TERMINAL_COLUMNS.map((col) => (
          <PipelineColumn
            key={col.id}
            column={col}
            leads={displayGroups[col.id] ?? []}
            now={now}
            orgView={orgView}
            dragOverColumn={dragOverColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </div>
  )
}

interface PipelineColumnProps {
  column: { id: PipelineStage; label: string; description: string; dotColor: string; iconColor: string; borderColor: string; headerBg: string }
  leads: LeadRow[]
  now: number
  orgView: boolean
  dragOverColumn: PipelineStage | null
  onDragStart: (leadId: string) => void
  onDragOver: (e: React.DragEvent, stage: PipelineStage) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, stage: PipelineStage) => void
}

function PipelineColumn({ column, leads, now, orgView, dragOverColumn, onDragStart, onDragOver, onDragLeave, onDrop }: PipelineColumnProps) {
  const isOver = dragOverColumn === column.id
  const emptyMsg = EMPTY_MESSAGES[column.id]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'flex w-[300px] shrink-0 flex-col rounded-xl border overflow-hidden transition-all duration-200',
        'border-t-[3px]',
        isOver ? 'border-orange/50 bg-orange/[0.03] shadow-sm shadow-orange/10' : 'border-line bg-bone',
        column.borderColor,
      )}
      onDragOver={(e) => onDragOver(e, column.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, column.id)}
    >
      <div className={cn('flex items-center justify-between px-3 py-2.5', column.headerBg)}>
        <div className="flex items-center gap-2">
          <span className={cn('flex size-6 items-center justify-center rounded-md', column.headerBg, column.iconColor)}>
            {COLUMN_ICONS[column.id]}
          </span>
          <div>
            <h3 className="text-[12px] font-medium text-ink leading-tight">{column.label}</h3>
            <p className="text-[10px] text-stone leading-tight">{column.description}</p>
          </div>
        </div>
        <span className={cn(
          'flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium transition-colors',
          leads.length > 0 ? 'bg-orange/10 text-orange' : 'bg-bone text-stone'
        )}>
          {leads.length}
        </span>
      </div>

      <div className="flex-1 space-y-2 p-2 min-h-[120px]">
        <AnimatePresence mode="popLayout">
          {leads.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line/50 py-8 text-center"
            >
              <Inbox className="size-5 text-stone/30 mb-1.5" />
              <p className="text-[11px] text-stone/60">{emptyMsg.title}</p>
              <p className="text-[10px] text-stone/40">{emptyMsg.hint}</p>
            </motion.div>
          ) : (
            leads.map((lead, i) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                orgView={orgView}
                now={now}
                onDragStart={() => onDragStart(lead.id)}
                index={i}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

interface LeadCardProps {
  lead: LeadRow
  orgView: boolean
  now: number
  onDragStart: () => void
  index: number
}

function LeadCard({ lead, orgView, now, onDragStart, index }: LeadCardProps) {
  const signal = signalById(lead.signalType)
  const score = lead.canonicalScore ?? lead.score ?? null
  const lifecycleState = lead.lifecycle?.state ?? 'active'
  const isCold = lifecycleState === 'cold' || lifecycleState === 'frozen'
  const scoreColor = getScoreColor(score)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.25), ease: [0.16, 1, 0.3, 1] }}
      draggable
      onDragStart={onDragStart}
      className={cn(
        'group rounded-lg border bg-bone-raised transition-all duration-150 cursor-grab active:cursor-grabbing',
        'border-line/50 hover:border-line hover:shadow-sm hover:shadow-black/[0.03]',
        isCold && 'opacity-70',
      )}
    >
      <div className="p-3">
        {/* Header row */}
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0 cursor-grab text-stone/30 hover:text-stone transition-colors">
            <GripVertical className="size-3.5" />
          </div>
          <div className="shrink-0">
            {score !== null ? (
              <ScoreRing score={lead.score} canonicalScore={lead.canonicalScore} size={32} />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-bone border border-line/60">
                <span className="text-[9px] font-medium text-stone">{getInitials(lead.company)}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <Link
              href={`/leads/${lead.id}`}
              className="text-[12px] font-medium text-ink hover:text-orange transition-colors leading-snug"
            >
              {lead.company}
            </Link>
            {lead.contactName && (
              <p className="truncate text-[10px] text-graphite leading-tight mt-0.5">{lead.contactName}</p>
            )}
          </div>
          {score !== null && (
            <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium', scoreColor)}>
              {Math.round(score)}
            </span>
          )}
        </div>

        {/* Sender + signal + staleness */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {lead.senderProfileName && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-bone px-1.5 py-0.5 text-[9px] text-stone">
              <User className="size-2" />
              {lead.senderProfileName}
            </span>
          )}
          {signal && (
            <span className="rounded-md bg-bone px-1.5 py-0.5 text-[9px] text-stone">{signal.short}</span>
          )}
          {orgView && lead.ownerName && (
            <span className="text-[9px] text-stone/60">{lead.ownerName}</span>
          )}
          {isCold && lead.lifecycle && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-status-warning/10 px-1.5 py-0.5 text-[9px] text-status-warning">
              <span className={cn('size-1.5 rounded-full', getStalenessColor(lifecycleState))} />
              {lead.lifecycle.reason}
            </span>
          )}
        </div>

        {/* Message preview */}
        {(lead.lastOutboundText || lead.lastInboundText) && (
          <div className="mt-2 space-y-1">
            {lead.lastOutboundText && (
              <p className="truncate text-[10px] text-graphite leading-snug">
                <span className="text-stone/50">→</span> {truncate(lead.lastOutboundText, 45)}
              </p>
            )}
            {lead.lastInboundText && (
              <p className="truncate text-[10px] text-graphite leading-snug">
                <span className="text-status-success/70">←</span> {truncate(lead.lastInboundText, 45)}
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] text-stone/70">
            <Clock className="size-2.5" />
            {formatRelativeTime(lead.lastActivityAt ?? lead.createdAt, now)}
          </div>
          <div className="flex items-center gap-1.5">
            {lead.followupCount != null && lead.followupCount > 0 && (
              <span className="text-[9px] text-stone/60">F{lead.followupCount}/3</span>
            )}
            {lifecycleState !== 'active' && (
              <span className={cn('size-1.5 rounded-full', getStalenessColor(lifecycleState))} />
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1 border-t border-line/30 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Link
          href={`/leads/${lead.id}`}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-graphite hover:bg-bone hover:text-ink transition-colors"
        >
          <PenLine className="size-2.5" />
          Open
        </Link>
        {isCold && (
          <Link
            href={`/leads/${lead.id}`}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-orange hover:bg-orange/10 transition-colors ml-auto"
          >
            Reactivate
          </Link>
        )}
      </div>
    </motion.div>
  )
}

async function executeStageTransition(leadId: string, _source: PipelineStage, dest: PipelineStage, lead: LeadRow): Promise<boolean> {
  try {
    if (dest === 'to_contact') return true

    if (dest === 'cold') return true
    if (dest === 'follow_up_due') return true

    const statusMap: Record<string, string> = {
      done: lead.status === 'won' ? 'won' : 'lost',
      waiting: lead.status === 'new' ? 'contacted' : lead.status,
      needs_reply: 'replied',
      follow_up_due: lead.status,
    }
    const nextStatus = statusMap[dest]
    if (!nextStatus || nextStatus === lead.status) return true

    const res = await fetch(`/api/leads/${leadId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status_type: nextStatus }),
    })
    return res.ok
  } catch {
    return false
  }
}
