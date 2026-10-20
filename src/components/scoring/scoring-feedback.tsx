'use client'

/**
 * Scoring feedback buttons (Phase 31).
 *
 * "Was this decision right?" — persists a human judgement with the versions
 * that produced the decision. It never changes the score or any model; the
 * admin QA center and the next calibration pass read it.
 */

import { useState } from 'react'
import { Check, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from 'cn'
import { notifyError } from '@/lib/ui/notify'

export type ScoringFeedbackType =
  | 'SCORE_TOO_HIGH' | 'SCORE_TOO_LOW' | 'WRONG_INTENT' | 'WRONG_SENDER' | 'WRONG_INDUSTRY'
  | 'WRONG_ACTION' | 'WRONG_COMPANY' | 'WRONG_TIMING' | 'CORRECT'

const WRONG_OPTIONS: Array<{ type: ScoringFeedbackType; label: string }> = [
  { type: 'SCORE_TOO_HIGH', label: 'Score too high' },
  { type: 'SCORE_TOO_LOW', label: 'Score too low' },
  { type: 'WRONG_INTENT', label: 'Not actually buying' },
  { type: 'WRONG_COMPANY', label: 'Wrong company' },
  { type: 'WRONG_INDUSTRY', label: 'Wrong industry' },
  { type: 'WRONG_TIMING', label: 'Wrong timing' },
  { type: 'WRONG_ACTION', label: 'Wrong next step' },
  { type: 'WRONG_SENDER', label: 'Wrong sender' },
]

export function ScoringFeedback({ leadId, capturedProspectId, decisionRunId, observed, className }: {
  leadId?: string | null
  capturedProspectId?: string | null
  decisionRunId?: string | null
  /** What the decision said (score, qualification, action, versions…) so calibration can compare. */
  observed: Record<string, unknown>
  className?: string
}) {
  const [mode, setMode] = useState<'idle' | 'wrong' | 'sent'>('idle')
  const [busy, setBusy] = useState<ScoringFeedbackType | null>(null)
  const [note, setNote] = useState('')

  async function send(type: ScoringFeedbackType) {
    setBusy(type)
    try {
      const res = await fetch('/api/scoring-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: leadId ?? null, capturedProspectId: capturedProspectId ?? null, decisionRunId: decisionRunId ?? null, feedbackType: type, note: note || null, observed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        notifyError(typeof body.error === 'string' ? body.error : 'Could not save feedback.', 'Feedback not saved')
        return
      }
      setMode('sent')
    } finally {
      setBusy(null)
    }
  }

  if (!leadId && !capturedProspectId && !decisionRunId) return null

  if (mode === 'sent') {
    return (
      <p className={cn('flex items-center gap-1.5 text-[11px] text-status-success', className)} data-testid="scoring-feedback-sent">
        <Check className="size-3" aria-hidden="true" /> Feedback saved. It will be reviewed; scores never change automatically.
      </p>
    )
  }

  return (
    <div className={cn('text-[11px]', className)} data-testid="scoring-feedback">
      {mode === 'idle' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-graphite">Was this decision right?</span>
          <button type="button" onClick={() => send('CORRECT')} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-ink hover:bg-bone-raised disabled:opacity-50">
            {busy === 'CORRECT' ? <Loader2 className="size-3 animate-spin" /> : <ThumbsUp className="size-3" />} Yes
          </button>
          <button type="button" onClick={() => setMode('wrong')} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-ink hover:bg-bone-raised">
            <ThumbsDown className="size-3" /> No
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-graphite">What was wrong?</p>
          <div className="flex flex-wrap gap-1.5">
            {WRONG_OPTIONS.map((o) => (
              <button key={o.type} type="button" onClick={() => send(o.type)} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-ink hover:bg-bone-raised disabled:opacity-50">
                {busy === o.type && <Loader2 className="size-3 animate-spin" />} {o.label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (no personal data, please)"
            maxLength={300}
            className="w-full rounded-md border border-line bg-bone px-2 py-1 text-[11px] text-ink placeholder:text-stone"
          />
          <button type="button" onClick={() => setMode('idle')} className="text-graphite underline-offset-2 hover:underline">Cancel</button>
        </div>
      )}
    </div>
  )
}
