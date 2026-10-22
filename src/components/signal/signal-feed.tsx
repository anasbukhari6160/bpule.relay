'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bell, RefreshCw, UserPlus, MessageSquare, Eye, X, ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import type { SignalFeedItem } from '@/lib/relay/signal-watch'

interface SignalFeedProps {
  items: SignalFeedItem[]
  onRefresh?: () => void
  onDismiss?: (id: string) => void
  loading?: boolean
}

/**
 * Compact "What's changed" feed for Rep Home.
 * Ranked by commercial relevance × freshness × confidence.
 * No raw activity stream — only meaningful changes.
 */
export function SignalFeed({ items, onRefresh, onDismiss, loading }: SignalFeedProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = items.filter(item => !dismissed.has(item.id))

  if (visible.length === 0 && !loading) {
    return (
      <section className="rounded-lg border border-line bg-bone-raised p-4">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-stone" />
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
            What&apos;s changed
          </h3>
        </div>
        <p className="mt-2 text-[12px] text-graphite">No new signals. High-value leads will appear here when something changes.</p>
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-orange" />
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
            What&apos;s changed
          </h3>
          {visible.length > 0 && (
            <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[9px] font-medium text-orange">
              {visible.length}
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 text-[10px] text-graphite hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
            Refresh
          </button>
        )}
      </div>

      {loading && (
        <div className="space-y-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="animate-pulse rounded-lg border border-line bg-bone-raised p-3">
              <div className="h-3 w-3/4 rounded bg-bone" />
              <div className="mt-1.5 h-2 w-1/2 rounded bg-bone" />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {visible.slice(0, 5).map(item => (
          <div
            key={item.id}
            className={cn(
              'rounded-lg border bg-bone-raised p-3 transition-colors',
              item.severity === 'urgent' ? 'border-orange/30 bg-orange/[0.02]' :
              item.severity === 'notable' ? 'border-line' : 'border-line/60'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {item.title}
                  </span>
                  {item.severity === 'urgent' && (
                    <span className="shrink-0 rounded-full bg-status-danger/10 px-1.5 py-0.5 text-[9px] font-medium text-status-danger">
                      NOW
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-graphite">{item.detail}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-stone">{timeAgo(item.createdAt)}</span>
                  {item.cta && (
                    <Link
                      href={item.leadId ? `/leads/${item.leadId}` : '#'}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-orange hover:underline"
                    >
                      {item.cta} <ChevronRight className="size-2.5" />
                    </Link>
                  )}
                </div>
              </div>
              {onDismiss && (
                <button
                  onClick={() => { setDismissed(prev => new Set([...prev, item.id])); onDismiss(item.id) }}
                  className="shrink-0 text-stone hover:text-ink"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
