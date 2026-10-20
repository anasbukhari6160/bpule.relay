'use client'

/**
 * Rejected Signal Inspector (Phase 30).
 *
 * Shows every candidate signal the source reader saw and did NOT credit:
 * what it looked like, whose it was, when it was, and why it was rejected.
 * Rendered on the prospect page, the lead workspace and the admin QA center
 * so a human can tell "ignored by design" from "missed".
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, ShieldOff } from 'lucide-react'
import { cn } from 'cn'

export interface RejectedSignalView {
  signal: string
  value: string | null
  sourceLine: string
  sourceSection?: string
  actor: string
  organization?: string | null
  temporalClass: string
  reason: string
}

const ACTOR_LABEL: Record<string, string> = {
  prospect: 'prospect',
  prospect_past: 'prospect (past role)',
  third_party: 'someone else',
  customer: "prospect's customer",
  unknown: 'unclear actor',
}

export function RejectedSignalInspector({ signals, defaultOpen = false, compact = false, className }: {
  signals: RejectedSignalView[]
  defaultOpen?: boolean
  compact?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!signals || signals.length === 0) return null
  const byKind = signals.reduce<Record<string, number>>((acc, s) => { acc[s.signal] = (acc[s.signal] ?? 0) + 1; return acc }, {})

  return (
    <div className={cn('rounded-xl border border-line bg-bone-raised/20', className)} data-testid="rejected-signal-inspector">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-bone-raised/40"
        aria-expanded={open}
      >
        <ShieldOff className="size-3.5 text-stone" aria-hidden="true" />
        <span className="text-[12px] font-medium text-ink">
          {signals.length} signal{signals.length === 1 ? '' : 's'} seen but not credited
        </span>
        <span className="ml-auto hidden text-[10px] text-graphite sm:inline">
          {Object.entries(byKind).map(([k, n]) => `${k.replaceAll('_', ' ')} ×${n}`).join(' · ')}
        </span>
        <span className="ml-1 text-stone">{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</span>
      </button>
      {open && (
        <ul className={cn('space-y-2 border-t border-line/40 px-4 py-3', compact && 'space-y-1')}>
          {signals.map((s, i) => (
            <li key={`${s.signal}-${i}`} className="text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-stone/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-[9px] text-graphite">{s.signal.replaceAll('_', ' ')}</span>
                {s.value && <span className="font-medium text-ink">{s.value}</span>}
                <span className="text-stone">· {ACTOR_LABEL[s.actor] ?? s.actor} · {s.temporalClass.toLowerCase()}</span>
              </div>
              <p className="mt-0.5 text-graphite">{s.reason}</p>
              {!compact && s.sourceLine && (
                <p className="mt-0.5 truncate text-[10px] italic text-stone" title={s.sourceLine}>“{s.sourceLine.slice(0, 160)}”</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
