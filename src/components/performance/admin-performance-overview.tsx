'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from 'cn'
import type { ExecutionHealthData } from '@/components/rep/rep-today'

interface RepPerformanceRow {
  repId: string
  repName: string
  health: number
  state: string
  bottleneck: string | null
  sla: number
}

const EASE = [0.32, 0.72, 0, 1] as const

interface Props {
  repIds: string[]
  repNames: Record<string, string>
}

export function AdminPerformanceOverview({ repIds, repNames }: Props) {
  const [rows, setRows] = useState<RepPerformanceRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all(
      repIds.map(async (repId) => {
        try {
          const res = await fetch(`/api/admin/performance?repId=${repId}`, { cache: 'no-store' })
          const data: ExecutionHealthData & { repId?: string; repName?: string; primaryBottleneck?: string | null; sla?: { score?: number } } = await res.json()
          return {
            repId,
            repName: repNames[repId] ?? data.repName ?? repId.slice(0, 8),
            health: data.executionHealth ?? 0,
            state: data.state ?? 'ON_TRACK',
            bottleneck: data.primaryBottleneck ?? null,
            sla: data.sla?.score ?? 100,
          }
        } catch {
          return { repId, repName: repNames[repId] ?? repId.slice(0, 8), health: 0, state: 'BLOCKED', bottleneck: null, sla: 100 }
        }
      }),
    ).then((result) => {
      if (!cancelled) {
        setRows(result.sort((a, b) => a.health - b.health))
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [repIds, repNames])

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
        <div className="px-5 py-3 border-b border-line/40">
          <span className="text-sm font-medium text-ink">Weighted Performance</span>
        </div>
        <div className="p-5 space-y-2">
          {repIds.map((id) => (
            <div key={id} className="h-8 animate-pulse rounded bg-stone-100" />
          ))}
        </div>
      </div>
    )
  }

  if (rows.length === 0) return null

  const stateLabel: Record<string, { label: string; color: string }> = {
    ON_TRACK: { label: 'On Track', color: 'text-status-success' },
    NEEDS_ATTENTION: { label: 'Attention', color: 'text-status-warning' },
    BEHIND: { label: 'Behind', color: 'text-status-danger' },
    CAUGHT_UP: { label: 'Caught Up', color: 'text-cobalt' },
    BLOCKED: { label: 'Blocked', color: 'text-stone' },
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-line/40">
        <span className="text-sm font-medium text-ink">Weighted Performance</span>
        <span className="text-[11px] text-stone">{rows.length} reps</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line/30 text-left text-[11px] text-stone">
              <th className="px-5 py-2 font-medium">Rep</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">SLA</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-5 py-2 font-medium">Bottleneck</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/20">
            {rows.map((row) => {
              const sc = stateLabel[row.state] ?? { label: row.state, color: 'text-stone' }
              return (
                <tr key={row.repId} className="hover:bg-bone/50 transition-colors">
                  <td className="px-5 py-2.5 font-medium text-ink">{row.repName}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-line/40">
                        <div
                          className={cn('h-full rounded-full',
                            row.health >= 70 ? 'bg-status-success' :
                            row.health >= 40 ? 'bg-orange' : 'bg-status-danger'
                          )}
                          style={{ width: `${row.health}%` }}
                        />
                      </div>
                      <span className="text-[12px] text-graphite">{row.health}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-graphite">{row.sla}%</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('text-[11px] font-medium', sc.color)}>{sc.label}</span>
                  </td>
                  <td className="px-5 py-2.5 text-[12px] text-graphite">
                    {row.bottleneck ? row.bottleneck.replace(/_/g, ' ') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
