'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/status-badge'
import { Progress } from '@/components/ui/progress'
import { ContributionHeatmap } from '@/components/performance/contribution-heatmap'
import type { DailyActivity } from '@/lib/performance/activity-model'
import { cn } from 'cn'

/**
 * Rep "My Day" — the accountability control plane home.
 * Interactive: close day, request exception, view remaining work.
 */

export interface MyDayData {
  status: 'not_started' | 'on_track' | 'at_risk' | 'behind' | 'ready_to_close' | 'completed' | 'completed_with_exception' | 'missed' | 'approved_unavailable'
  timeRemaining: string
  dayElapsedPct: number
  totalCompleted: number
  totalTarget: number
  totalRemaining: number
  categories: Array<{
    key: string
    label: string
    completed: number
    target: number
    remaining: number
    href: string
  }>
  heatmapData?: DailyActivity[]
  warning: {
    level: string
    message: string
    categories: Array<{ label: string; remaining: number; href: string }>
  } | null
  canCloseDay: boolean
  dayCloseStatus: string | null
  hasContract: boolean
  identityId?: string
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'orange' | 'neutral' }> = {
  not_started: { label: 'NOT STARTED', variant: 'neutral' },
  on_track: { label: 'ON TRACK', variant: 'success' },
  at_risk: { label: 'AT RISK', variant: 'warning' },
  behind: { label: 'BEHIND', variant: 'danger' },
  ready_to_close: { label: 'READY TO CLOSE', variant: 'success' },
  completed: { label: 'COMPLETED', variant: 'success' },
  completed_with_exception: { label: 'COMPLETE (EXCEPTION)', variant: 'info' },
  missed: { label: 'MISSED', variant: 'danger' },
  approved_unavailable: { label: 'UNAVAILABLE', variant: 'neutral' },
  no_quotas: { label: 'NO QUOTAS', variant: 'neutral' },
}

const EXCEPTION_REASONS = [
  { value: 'no_qualified_inventory', label: 'No Qualified Inventory' },
  { value: 'channel_limit', label: 'Channel Limit' },
  { value: 'identity_blocked', label: 'Identity Blocked' },
  { value: 'system_issue', label: 'System Issue' },
  { value: 'client_priority', label: 'Client Priority' },
  { value: 'manager_approved', label: 'Manager Approved' },
  { value: 'other', label: 'Other' },
]

function StatusBadgeForStatus({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'neutral' as const }
  return <StatusBadge status={config.label} variant={config.variant} />
}

export function MyDayCard({ data }: { data: MyDayData }) {
  const router = useRouter()
  const [closing, setClosing] = useState(false)
  const [closeResult, setCloseResult] = useState<{ blocked: boolean; remaining?: Record<string, number>; message?: string } | null>(null)
  const [showExceptionForm, setShowExceptionForm] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')
  const [exceptionNote, setExceptionNote] = useState('')
  const [exceptionSubmitting, setExceptionSubmitting] = useState(false)
  const [exceptionResult, setExceptionResult] = useState<{ success: boolean; message: string } | null>(null)

  async function handleCloseDay() {
    setClosing(true)
    setCloseResult(null)
    try {
      const res = await fetch('/api/accountability/day-close-strict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId: data.identityId }),
      })
      const json = await res.json()
      if (res.ok && json.eligible) {
        setCloseResult({ blocked: false, message: json.message })
        // Reload to reflect new state
        router.refresh()
      } else {
        setCloseResult({
          blocked: true,
          remaining: json.remaining,
          message: json.message,
        })
      }
    } catch {
      setCloseResult({ blocked: true, message: 'Network error. Try again.' })
    } finally {
      setClosing(false)
    }
  }

  async function handleRequestException() {
    if (!exceptionReason) return
    setExceptionSubmitting(true)
    setExceptionResult(null)
    try {
      const res = await fetch('/api/accountability/day-close-strict', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_exception',
          identityId: data.identityId,
          reason: exceptionReason,
          note: exceptionNote || undefined,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setExceptionResult({ success: true, message: json.message || 'Exception requested.' })
        setShowExceptionForm(false)
        router.refresh()
      } else {
        setExceptionResult({ success: false, message: json.error || 'Failed to submit exception.' })
      }
    } catch {
      setExceptionResult({ success: false, message: 'Network error. Try again.' })
    } finally {
      setExceptionSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="srf-console srf-console-edge overflow-hidden p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">My Day</p>
          <StatusBadgeForStatus status={data.totalTarget === 0 ? 'no_quotas' : data.status} />
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-[28px] font-light tracking-tight text-ink">
            {data.totalTarget === 0 ? '—' : data.totalRemaining === 0 ? '✓' : data.totalRemaining}
          </span>
          <span className="text-[13px] text-graphite">
            {data.totalTarget === 0
              ? 'No quotas assigned today'
              : data.totalRemaining === 0
                ? 'All work complete'
                : `${data.totalRemaining} of ${data.totalTarget} remaining`}
          </span>
        </div>
        {data.totalTarget > 0 && (
          <div className="mt-3 space-y-1">
            <Progress
              value={data.totalCompleted}
              max={data.totalTarget}
              variant={data.totalRemaining === 0 ? 'success' : data.dayElapsedPct > 0.7 && data.totalRemaining > data.totalTarget * 0.3 ? 'danger' : 'warning'}
              size="md"
              showLabel
            />
            <div className="flex justify-between text-[11px] text-graphite">
              <span>{data.timeRemaining} remaining</span>
              <span>{Math.round(data.dayElapsedPct * 100)}% of day elapsed</span>
            </div>
          </div>
        )}
      </div>

      {/* Warning banner */}
      {data.warning && (
        <div className={cn(
          'rounded-lg border p-4',
          data.warning.level === 'very_late' ? 'border-status-danger/30 bg-status-danger/5' :
          data.warning.level === 'late' ? 'border-status-warning/30 bg-status-warning/5' :
          data.warning.level === 'ready' ? 'border-status-success/30 bg-status-success/5' :
          'border-line bg-bone-raised',
        )}>
          <p className={cn(
            'text-[13px] font-medium',
            data.warning.level === 'very_late' ? 'text-status-danger' :
            data.warning.level === 'ready' ? 'text-status-success' :
            'text-ink',
          )}>
            {data.warning.message}
          </p>
          {data.warning.categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {data.warning.categories.map((cat) => (
                <Link
                  key={cat.label}
                  href={cat.href}
                  className="inline-flex items-center gap-1 rounded border border-line bg-bone px-2 py-1 text-[11px] font-medium text-ink hover:underline"
                >
                  {cat.remaining} {cat.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {data.heatmapData && data.heatmapData.length > 0 && (
        <div className="rounded-lg border border-line bg-bone-raised p-4">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone mb-3">Activity</p>
          <ContributionHeatmap daily={data.heatmapData} />
        </div>
      )}

      {/* Day Close action */}
      {data.hasContract && (
        <div className="rounded-lg border border-line bg-bone-raised p-4">
          {data.dayCloseStatus === 'completed' ? (
            <div className="flex items-center gap-2">
              <span className="text-status-success">✓</span>
              <span className="text-[13px] font-medium text-status-success">Day closed</span>
            </div>
          ) : data.dayCloseStatus === 'completed_with_exception' ? (
            <div className="flex items-center gap-2">
              <span className="text-status-info">✓</span>
              <span className="text-[13px] font-medium text-status-info">Day closed with exception</span>
              {exceptionResult && <span className="text-[12px] text-graphite">{exceptionResult.message}</span>}
            </div>
          ) : data.dayCloseStatus === 'missed' ? (
            <div className="flex items-center gap-2">
              <span className="text-status-danger">✗</span>
              <span className="text-[13px] font-medium text-status-danger">Day missed</span>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Close result: blocked */}
              {closeResult?.blocked && (
                <div className="rounded border border-status-danger/30 bg-status-danger/5 p-3">
                  <p className="text-[13px] font-medium text-status-danger">Day Close is blocked</p>
                  {closeResult.remaining && Object.keys(closeResult.remaining).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {Object.entries(closeResult.remaining).map(([key, count]) => {
                        const label = key === 'connections' ? 'Connections' :
                          key === 'firstDms' ? 'First DMs' :
                          key === 'emails' ? 'Emails' :
                          key === 'followups' ? 'Follow-ups' : key
                        return (
                          <p key={key} className="text-[12px] text-ink">
                            {label}: {count} remaining
                          </p>
                        )
                      })}
                    </div>
                  )}
                  {!showExceptionForm && (
                    <button
                      onClick={() => setShowExceptionForm(true)}
                      className="mt-3 rounded border border-line bg-bone px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bone-raised"
                    >
                      Request Exception
                    </button>
                  )}
                </div>
              )}

              {/* Exception form */}
              {showExceptionForm && (
                <div className="rounded border border-line bg-bone p-3 space-y-3">
                  <p className="text-[13px] font-medium text-ink">Request Exception</p>
                  <div>
                    <select
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      className="w-full rounded border border-line bg-bone px-3 py-2 text-[13px]"
                    >
                      <option value="">Select reason...</option>
                      {EXCEPTION_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  {exceptionReason === 'other' && (
                    <textarea
                      value={exceptionNote}
                      onChange={(e) => setExceptionNote(e.target.value)}
                      placeholder="Provide details (min 10 characters)..."
                      className="w-full rounded border border-line bg-bone px-3 py-2 text-[13px]"
                      rows={3}
                    />
                  )}
                  {exceptionResult && (
                    <p className={cn('text-[12px]', exceptionResult.success ? 'text-status-success' : 'text-status-danger')}>
                      {exceptionResult.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleRequestException}
                      disabled={!exceptionReason || exceptionSubmitting || (exceptionReason === 'other' && exceptionNote.trim().length < 10)}
                      className={cn(
                        'rounded px-3 py-1.5 text-[12px] font-medium',
                        exceptionReason && !exceptionSubmitting
                          ? 'bg-ink text-bone hover:bg-ink/90'
                          : 'cursor-not-allowed border border-line bg-bone text-stone',
                      )}
                    >
                      {exceptionSubmitting ? 'Submitting...' : 'Submit Request'}
                    </button>
                    <button
                      onClick={() => { setShowExceptionForm(false); setExceptionResult(null) }}
                      className="rounded border border-line bg-bone px-3 py-1.5 text-[12px] font-medium text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Main close area */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-ink">Day Close</p>
                  <p className="mt-0.5 text-[12px] text-graphite">
                    {data.canCloseDay
                      ? 'All required work is complete.'
                      : `${data.totalRemaining} actions remaining before you can close.`}
                  </p>
                </div>
                <button
                  onClick={handleCloseDay}
                  disabled={closing}
                  className={cn(
                    'rounded px-4 py-2 text-[12px] font-medium transition-colors',
                    'bg-ink text-bone hover:bg-ink/90',
                  )}
                >
                  {closing ? 'Closing...' : 'Close Day'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
