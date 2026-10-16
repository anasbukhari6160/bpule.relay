'use client'

import { useState, useEffect } from 'react'
import { Zap, TrendingUp, AlertTriangle, DollarSign } from 'lucide-react'
import { cn } from 'cn'

interface ConnectsData {
  totalUsed: number
  weekUsed: number
  monthUsed: number
  appliedCount: number
  perProfile: Array<{ name: string; used: number; jobs: number }>
  recentJobs: Array<{ id: string; title: string; connects: number; status: string; date: string }>
}

export function ConnectsPanel() {
  const [data, setData] = useState<ConnectsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/upwork/connects')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <p className="text-[12px] text-stone">Loading connects...</p>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="size-4 text-cobalt" />
          <h2 className="text-sm font-medium text-ink">Connects Usage</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ConnectStat label="This Week" value={data.weekUsed} />
          <ConnectStat label="This Month" value={data.monthUsed} />
          <ConnectStat label="All Time" value={data.totalUsed} />
        </div>
        <p className="mt-3 text-[11px] text-stone">
          {data.appliedCount} proposals submitted • {data.totalUsed} Connects spent
        </p>
      </div>

      {/* Per Profile */}
      {data.perProfile.length > 0 && (
        <div className="rounded-2xl border border-line bg-bone-raised/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="size-4 text-cobalt" />
            <h3 className="text-sm font-medium text-ink">By Profile</h3>
          </div>
          <div className="space-y-2">
            {data.perProfile.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg bg-bone px-3 py-2">
                <div>
                  <p className="text-[12px] font-medium text-ink">{p.name}</p>
                  <p className="text-[10px] text-stone">{p.jobs} proposal{p.jobs !== 1 ? 's' : ''}</p>
                </div>
                <span className="text-[12px] font-mono font-medium text-cobalt">{p.used} Connects</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {data.recentJobs.length > 0 && (
        <div className="rounded-2xl border border-line bg-bone-raised/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="size-4 text-cobalt" />
            <h3 className="text-sm font-medium text-ink">Recent Proposals</h3>
          </div>
          <div className="space-y-2">
            {data.recentJobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded-lg bg-bone px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink truncate">{j.title}</p>
                  <p className="text-[10px] text-stone">
                    {new Date(j.date).toLocaleDateString()} • <StatusBadge status={j.status} />
                  </p>
                </div>
                <span className="ml-2 shrink-0 text-[11px] font-mono text-stone">{j.connects} ⚡</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ConnectStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bone p-3 text-center">
      <p className="text-[10px] text-stone">{label}</p>
      <p className="text-lg font-semibold text-ink">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    applied: { label: 'Applied', cls: 'text-cobalt bg-cobalt/10' },
    shortlisted: { label: 'Shortlisted', cls: 'text-orange bg-orange/10' },
    interviewing: { label: 'Interview', cls: 'text-orange bg-orange/10' },
    awarded: { label: 'Won', cls: 'text-status-success bg-status-success/10' },
    rejected: { label: 'Lost', cls: 'text-status-danger bg-status-danger/10' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'text-stone bg-bone' }
  return <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', cls)}>{label}</span>
}
