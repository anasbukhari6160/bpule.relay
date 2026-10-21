'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from 'cn'
import type { UpworkJob, UpworkJobStatus } from '@/lib/domain/types'
import {
  UPWORK_CLOSE_STAGES,
  UPWORK_OPEN_STAGES,
  isLegacyUpworkStatus,
  upworkStageDetail,
  upworkStageLabel,
} from '@/lib/upwork/pipeline'

export function UpworkJobTimeline({ job }: { job: UpworkJob }) {
  const router = useRouter()
  const [status, setStatus] = useState<UpworkJobStatus>(job.status)
  const [updating, setUpdating] = useState<UpworkJobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closed = status === 'no' || status === 'dead'

  async function updateStatus(next: UpworkJobStatus) {
    if (next === status || updating) return
    setUpdating(next)
    setError(null)
    try {
      const res = await fetch(`/api/upwork/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The stage did not save.')
      setStatus(next)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The stage did not save.')
    } finally {
      setUpdating(null)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-bone-raised/30 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink">On Upwork</h2>
          <p className="mt-1 max-w-xl text-[13px] text-graphite">{upworkStageDetail(status)}</p>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium',
          closed ? 'bg-bone text-stone' : 'bg-ink text-on-solid',
        )}>
          {upworkStageLabel(status)}
        </span>
      </div>

      {isLegacyUpworkStatus(status) && (
        <p className="mt-3 rounded-xl bg-status-warning/10 px-3 py-2 text-[12px] text-status-warning">
          This job is marked {upworkStageLabel(status)}. Move it to a stage below so the record matches what happened on Upwork.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Upwork stage">
        {UPWORK_OPEN_STAGES.map((stage, index) => {
          const currentIndex = UPWORK_OPEN_STAGES.findIndex((item) => item.key === status)
          const reached = currentIndex >= 0 && index <= currentIndex
          const selected = status === stage.key
          return (
            <button
              key={stage.key}
              type="button"
              aria-pressed={selected}
              disabled={Boolean(updating) || selected}
              onClick={() => void updateStatus(stage.key)}
              className={cn(
                'rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-default',
                selected
                  ? 'border-ink bg-ink text-on-solid'
                  : 'border-line bg-paper hover:border-ink/30',
              )}
            >
              <span className="block text-[12px] text-current/70">{index + 1}</span>
              <span className={cn('mt-1 block text-[13px] font-medium', selected ? 'text-on-solid' : 'text-ink')}>{stage.label}</span>
              <span className={cn('mt-1 block text-[11px] leading-snug', selected ? 'text-on-solid/70' : reached ? 'text-graphite' : 'text-stone')}>
                {updating === stage.key ? 'Saving…' : stage.detail}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {UPWORK_CLOSE_STAGES.map((stage) => {
          const selected = status === stage.key
          return (
            <button
              key={stage.key}
              type="button"
              aria-pressed={selected}
              disabled={Boolean(updating) || selected}
              onClick={() => void updateStatus(stage.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-default',
                selected
                  ? 'border-ink bg-bone text-ink'
                  : 'border-line text-graphite hover:text-ink',
              )}
            >
              {updating === stage.key ? 'Saving…' : stage.label}
            </button>
          )
        })}
      </div>

      {error && <p className="mt-3 text-[13px] text-status-danger">{error}</p>}
    </section>
  )
}
