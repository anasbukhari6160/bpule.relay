'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Briefcase,
  Inbox,
  AlertCircle,
  Clock,
  Filter,
  Search,
  ArrowRight,
} from 'lucide-react'
import { cn } from 'cn'
import type { RelayTodayAction } from '@/components/relay-today-workspace'
import type { NextBestAction } from '@/lib/relay/next-best-action'

export type InboxCategory =
  | 'BUYING_INTENT'
  | 'QUESTION'
  | 'INTERESTED'
  | 'NEUTRAL'
  | 'DEFERRED'
  | 'NEGATIVE'
  | 'CLOSED'
  | 'UNKNOWN'

export interface UnifiedInboxItem {
  id: string
  prospect: string
  channel: 'LINKEDIN' | 'UPWORK' | 'INBOUND'
  latestInbound: string
  category: InboxCategory
  urgency: 'urgent' | 'high' | 'medium' | 'low'
  recommendedAction: string
  leadScore: number | null
  assignedSender: string | null
  lastOutbound: string | null
  href: string
  createdAt: string
}

interface UnifiedInboxProps {
  items: UnifiedInboxItem[]
  onCategoryChange?: (id: string, category: InboxCategory) => void
  onDismiss?: (id: string) => void
}

const CATEGORY_LABELS: Record<InboxCategory, string> = {
  BUYING_INTENT: 'Buying intent',
  QUESTION: 'Question',
  INTERESTED: 'Interested',
  NEUTRAL: 'Neutral',
  DEFERRED: 'Deferred',
  NEGATIVE: 'Negative',
  CLOSED: 'Closed',
  UNKNOWN: 'Unknown',
}

const CATEGORY_COLORS: Record<InboxCategory, string> = {
  BUYING_INTENT: 'bg-status-success/10 text-status-success',
  QUESTION: 'bg-cobalt/10 text-cobalt',
  INTERESTED: 'bg-orange/10 text-orange',
  NEUTRAL: 'bg-graphite/10 text-graphite',
  DEFERRED: 'bg-status-warning/10 text-status-warning',
  NEGATIVE: 'bg-status-danger/10 text-status-danger',
  CLOSED: 'bg-stone/10 text-stone',
  UNKNOWN: 'bg-stone/10 text-stone',
}

const ALL_CATEGORIES: InboxCategory[] = [
  'BUYING_INTENT', 'QUESTION', 'INTERESTED', 'NEUTRAL',
  'DEFERRED', 'NEGATIVE', 'CLOSED', 'UNKNOWN',
]

/**
 * Unified inbox surface — one view for all inbound replies across channels.
 * Uses existing intent classification; does not create a second conversation model.
 */
export function UnifiedInbox({ items, onCategoryChange, onDismiss }: UnifiedInboxProps) {
  const [filterCategory, setFilterCategory] = useState<InboxCategory | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = items.filter((item) => {
    if (filterCategory && item.category !== filterCategory) return false
    if (searchQuery && !item.prospect.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  // Sort: urgent first, then by createdAt desc
  const sorted = [...filtered].sort((a, b) => {
    const urgencyOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="size-4 text-orange" />
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
            Inbox
          </h3>
          <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[9px] font-medium text-orange">
            {items.length}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-stone" />
          <input
            type="text"
            placeholder="Search prospects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-line bg-bone pl-7 pr-3 py-1.5 text-[12px] text-ink placeholder:text-stone focus:border-orange/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setFilterCategory(null)}
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
            !filterCategory ? 'bg-orange text-on-accent' : 'bg-bone text-graphite hover:bg-bone-raised'
          )}
        >
          All
        </button>
        {ALL_CATEGORIES.map((cat) => {
          const count = items.filter((i) => i.category === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                filterCategory === cat ? 'bg-orange text-on-accent' : 'bg-bone text-graphite hover:bg-bone-raised'
              )}
            >
              {CATEGORY_LABELS[cat]} ({count})
            </button>
          )
        })}
      </div>

      {/* Items */}
      <div className="space-y-1.5">
        {sorted.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="block rounded-lg border border-line bg-bone-raised p-3 transition-colors hover:border-orange/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {item.prospect}
                  </span>
                  {item.urgency === 'urgent' && (
                    <span className="shrink-0 rounded-full bg-status-danger/10 px-1.5 py-0.5 text-[9px] font-medium text-status-danger">
                      URGENT
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-graphite">
                  {item.latestInbound}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-medium', CATEGORY_COLORS[item.category])}>
                    {CATEGORY_LABELS[item.category]}
                  </span>
                  {item.channel === 'UPWORK' && (
                    <span className="rounded bg-cobalt/10 px-1.5 py-0.5 text-[9px] font-medium text-cobalt">
                      Upwork
                    </span>
                  )}
                  {item.channel === 'INBOUND' && (
                    <span className="rounded bg-status-success/10 px-1.5 py-0.5 text-[9px] font-medium text-status-success">
                      Inbound
                    </span>
                  )}
                  {item.leadScore != null && (
                    <span className="text-[10px] font-mono text-stone">{item.leadScore}/100</span>
                  )}
                </div>
              </div>
              <ArrowRight className="size-3.5 shrink-0 text-stone" />
            </div>
          </Link>
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-bone-raised/40 p-6 text-center">
          <MessageSquare className="mx-auto size-6 text-stone" />
          <p className="mt-2 text-[13px] text-graphite">
            {items.length === 0
              ? 'No replies yet. They will appear here when prospects respond.'
              : 'No items match this filter.'}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Derive inbox items from existing queue tasks.
 * Maps reply_needed and inbound_opportunity tasks to unified inbox items.
 */
export function deriveInboxItems(
  replyActions: RelayTodayAction[],
): UnifiedInboxItem[] {
  const items: UnifiedInboxItem[] = []

  for (const action of replyActions) {
    const channel = action.kind === 'inbound_opportunity'
      ? 'INBOUND' as const
      : 'LINKEDIN' as const

    items.push({
      id: action.id,
      prospect: action.title,
      channel,
      latestInbound: action.whatHappened,
      category: classifyActionToInbox(action),
      urgency: action.priority === 'urgent' ? 'urgent' : action.priority === 'high' ? 'high' : 'medium',
      recommendedAction: action.humanAction,
      leadScore: action.fitScore,
      assignedSender: action.identity?.name ?? null,
      lastOutbound: action.subtitle ?? null,
      href: action.href,
      createdAt: action.createdAt,
    })
  }

  return items
}

function classifyActionToInbox(action: RelayTodayAction): InboxCategory {
  const text = `${action.whatHappened} ${action.subtitle}`.toLowerCase()

  if (/interested|yes|let's talk|demo|meeting|call/.test(text)) return 'INTERESTED'
  if (/question|how|what|when|price|cost/.test(text)) return 'QUESTION'
  if (/buying|need|looking for|hiring|budget/.test(text)) return 'BUYING_INTENT'
  if (/not now|later|busy|defer/.test(text)) return 'DEFERRED'
  if (/not interested|no|pass|unsubscribe/.test(text)) return 'NEGATIVE'
  if (/won|closed|converted/.test(text)) return 'CLOSED'

  return 'UNKNOWN'
}
