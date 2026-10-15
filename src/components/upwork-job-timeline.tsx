'use client'

import { useState } from 'react'
import type { ComponentType } from 'react'
import { CheckCircle2, Clock, Trophy, XCircle, AlertTriangle, Send, MessageCircle } from 'lucide-react'
import { cn } from 'cn'
import type { UpworkJob } from '@/lib/domain/types'

const STATUSES: Array<{ key: UpworkJob['status']; label: string; icon: ComponentType<{ className?: string }>; color: string }> = [
  { key: 'new', label: 'Discovered', icon: Clock, color: 'text-stone' },
  { key: 'drafted', label: 'Drafted', icon: MessageCircle, color: 'text-cobalt' },
  { key: 'applied', label: 'Applied', icon: Send, color: 'text-cobalt' },
  { key: 'shortlisted', label: 'Shortlisted', icon: AlertTriangle, color: 'text-orange' },
  { key: 'interviewing', label: 'Interviewing', icon: MessageCircle, color: 'text-orange' },
  { key: 'offer_sent', label: 'Offer', icon: Trophy, color: 'text-status-success' },
  { key: 'awarded', label: 'Won', icon: CheckCircle2, color: 'text-status-success' },
  { key: 'no', label: 'Closed', icon: XCircle, color: 'text-stone' },
  { key: 'dead', label: 'Dead', icon: XCircle, color: 'text-stone' },
]

export function UpworkJobTimeline({ job }: { job: UpworkJob }) {
  const [updating, setUpdating] = useState(false)
  const currentIdx = STATUSES.findIndex((s) => s.key === job.status)

  async function updateStatus(status: UpworkJob['status']) {
    setUpdating(true)
    try {
      await fetch(`/api/upwork/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      window.location.reload()
    } catch { /* ignore */ }
    setUpdating(false)
  }

  return (
    <section className="reveal-up stagger-4 rounded border border-line bg-bone-raised p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-ink">Pipeline</h2>
        <span className={cn(
          'rounded-full px-2.5 py-1 text-[11px] font-medium',
          job.status === 'awarded' ? 'bg-status-success/10 text-status-success' :
          job.status === 'rejected' ? 'bg-status-danger/10 text-status-danger' :
          'bg-cobalt/10 text-cobalt'
        )}>
          {STATUSES.find((s) => s.key === job.status)?.label ?? job.status}
        </span>
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STATUSES.filter((s) => s.key !== 'no' && s.key !== 'dead').map((s, i) => {
          const Icon = s.icon
          const isActive = i <= currentIdx
          const isCurrent = s.key === job.status
          return (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => !updating && s.key !== job.status && updateStatus(s.key)}
                disabled={updating || s.key === job.status}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 transition-colors min-w-[60px]',
                  isCurrent ? 'bg-bone-raised ring-1 ring-cobalt' : '',
                  isActive ? 'opacity-100' : 'opacity-40',
                  s.key !== job.status && !updating ? 'hover:bg-bone-raised cursor-pointer' : 'cursor-default'
                )}
              >
                <Icon className={cn('size-4', isCurrent ? 'text-cobalt' : isActive ? s.color : 'text-stone')} />
                <span className={cn('text-[9px]', isCurrent ? 'text-ink font-medium' : 'text-stone')}>
                  {s.label}
                </span>
              </button>
              {i < STATUSES.filter((s) => s.key !== 'rejected' && s.key !== 'no' && s.key !== 'dead').length - 1 && (
                <div className={cn('h-0.5 w-3 shrink-0 rounded-full', i < currentIdx ? 'bg-cobalt' : 'bg-line')} />
              )}
            </div>
          )
        })}
      </div>

      {/* Quick status actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <span className="text-[11px] text-stone">Quick update:</span>
        {job.status === 'applied' && (
          <>
            <StatusBtn onClick={() => updateStatus('shortlisted')} disabled={updating}>Shortlisted</StatusBtn>
            <StatusBtn onClick={() => updateStatus('interviewing')} disabled={updating}>Interview</StatusBtn>
            <StatusBtn onClick={() => updateStatus('rejected')} disabled={updating} danger>Rejected</StatusBtn>
          </>
        )}
        {job.status === 'shortlisted' && (
          <>
            <StatusBtn onClick={() => updateStatus('interviewing')} disabled={updating}>Interviewing</StatusBtn>
            <StatusBtn onClick={() => updateStatus('rejected')} disabled={updating} danger>Rejected</StatusBtn>
          </>
        )}
        {job.status === 'interviewing' && (
          <>
            <StatusBtn onClick={() => updateStatus('offer_sent')} disabled={updating}>Offer</StatusBtn>
            <StatusBtn onClick={() => updateStatus('awarded')} disabled={updating}>Won</StatusBtn>
            <StatusBtn onClick={() => updateStatus('rejected')} disabled={updating} danger>Rejected</StatusBtn>
          </>
        )}
        {job.status === 'new' && (
          <>
            <StatusBtn onClick={() => updateStatus('drafted')} disabled={updating}>Drafted</StatusBtn>
            <StatusBtn onClick={() => updateStatus('applied')} disabled={updating}>Applied</StatusBtn>
          </>
        )}
      </div>
    </section>
  )
}

function StatusBtn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
        danger ? 'bg-status-danger/10 text-status-danger hover:bg-status-danger/20' : 'bg-bone text-ink hover:bg-bone-raised'
      )}
    >
      {children}
    </button>
  )
}
