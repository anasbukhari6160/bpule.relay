'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from 'cn'
import type { ExecutionHealthData } from '@/components/rep/rep-today'

const EASE = [0.32, 0.72, 0, 1] as const

interface Props {
  repId?: string
  date?: string
}

export function ExecutionHealthCard({ repId, date }: Props) {
  const [data, setData] = useState<ExecutionHealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (repId) params.set('repId', repId)
    if (date) params.set('date', date)
    setLoading(true)
    fetch(`/api/admin/performance?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        setData({
          executionHealth: json.executionHealth ?? 0,
          state: json.state ?? 'ON_TRACK',
          warnings: json.warnings ?? [],
          completions: (json.completions ?? []).map((c: any) => ({
            action: c.action,
            actual: c.actual,
            target: c.target,
            rawRatio: c.rawRatio,
          })),
          slaScore: json.sla?.score ?? 100,
          primaryNextAction: json.primaryNextAction ?? null,
        })
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [repId, date])

  if (loading) {
    return (
      <div className="srf-console h-full p-5">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Execution Health</p>
        <div className="mt-3 animate-pulse space-y-2">
          <div className="h-6 w-20 rounded bg-console-line/40" />
          <div className="h-4 w-full rounded bg-console-line/30" />
          <div className="h-4 w-3/4 rounded bg-console-line/30" />
        </div>
      </div>
    )
  }

  if (!data) return null

  const stateConfig: Record<string, { label: string; color: string; bg: string }> = {
    ON_TRACK: { label: 'ON TRACK', color: 'text-status-success', bg: 'bg-status-success/10' },
    NEEDS_ATTENTION: { label: 'NEEDS ATTENTION', color: 'text-status-warning', bg: 'bg-status-warning/10' },
    BEHIND: { label: 'BEHIND', color: 'text-status-danger', bg: 'bg-status-danger/10' },
    CAUGHT_UP: { label: 'CAUGHT UP', color: 'text-cobalt', bg: 'bg-cobalt/10' },
    BLOCKED: { label: 'BLOCKED', color: 'text-console-mute', bg: 'bg-console-line/20' },
  }
  const sc = stateConfig[data.state] ?? { label: data.state, color: 'text-console-mute', bg: 'bg-console-line/20' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="srf-console h-full p-5"
    >
      <div className="flex items-center justify-between">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-console-mute">Execution Health</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.color}`}>
          {sc.label}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[28px] font-light tracking-tight text-console-text">{data.executionHealth}%</span>
        <span className="text-[11px] text-console-mute">SLA {data.slaScore}%</span>
      </div>

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
                    className={cn('h-full rounded-full transition-all duration-700',
                      pct >= 80 ? 'bg-status-success' : pct >= 40 ? 'bg-orange' : 'bg-status-danger'
                    )}
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

      {data.primaryNextAction && (
        <p className="mt-3 text-[11px] text-orange">Next: {data.primaryNextAction}</p>
      )}
    </motion.div>
  )
}
