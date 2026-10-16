'use client'

import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Check, MessageSquare } from 'lucide-react'
import type { RelationshipPhase } from '@/lib/relay/relationship-state'

type PhaseFilter = RelationshipPhase | '*'

interface LogRelationshipUpdateProps {
  leadId: string
  phase: RelationshipPhase
  onLogged?: () => void
  onCancel?: () => void
}

interface UpdateOption {
  phase: PhaseFilter[]
  label: string
  value: string
  isMessageAction: boolean
}

const UPDATE_OPTIONS: UpdateOption[] = [
  { phase: ['connection_sent', 'connection_due', 'connection_accepted'], label: 'They accepted my connection', value: 'connection_accepted', isMessageAction: false },
  { phase: ['dm_sent', 'waiting_for_reply', 'replied', 'follow_up_due', 'conversation'], label: 'They replied', value: 'client_replied', isMessageAction: true },
  { phase: ['connection_due'], label: 'I sent a connection request', value: 'connection', isMessageAction: true },
  { phase: ['connection_accepted', 'dm_sent', 'waiting_for_reply'], label: 'I sent a message', value: 'dm', isMessageAction: true },
  { phase: ['dm_sent', 'waiting_for_reply', 'replied'], label: 'I followed up', value: 'followup', isMessageAction: true },
  { phase: ['replied', 'conversation'], label: 'I sent a reply', value: 'reply', isMessageAction: true },
  { phase: ['replied', 'conversation'], label: 'Meeting booked', value: 'meeting_booked', isMessageAction: false },
  { phase: ['conversation', 'meeting'], label: 'Proposal sent', value: 'proposal_sent', isMessageAction: false },
  { phase: ['conversation', 'meeting', 'proposal'], label: 'They are interested', value: 'interested', isMessageAction: false },
  { phase: ['conversation', 'meeting', 'proposal'], label: 'Not interested', value: 'not_interested', isMessageAction: false },
  { phase: ['dm_sent', 'waiting_for_reply', 'follow_up_due'], label: 'No response yet', value: 'no_response', isMessageAction: false },
  { phase: ['*'], label: 'Something else', value: 'reviewed', isMessageAction: false },
]

export function LogRelationshipUpdate({ leadId, phase, onLogged, onCancel }: LogRelationshipUpdateProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [messageText, setMessageText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedOption = UPDATE_OPTIONS.find((o) => o.value === selected)
  const requiresText = selectedOption?.isMessageAction === true

  const visibleOptions = UPDATE_OPTIONS.filter(
    (opt) => opt.phase.includes(phase) || opt.phase.includes('*' as PhaseFilter),
  )

  async function handleLog() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      let res: Response

      if (selected === 'connection_accepted') {
        res = await fetch(`/api/leads/${leadId}/connection-accepted`, { method: 'POST' })
      } else if (selected === 'client_replied') {
        const text = messageText.trim()
        if (!text) {
          setError('Paste their reply text to log it.')
          setSaving(false)
          return
        }
        res = await fetch(`/api/leads/${leadId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      } else if (requiresText) {
        const text = messageText.trim()
        if (!text) {
          setError('Paste the message you actually sent.')
          setSaving(false)
          return
        }
        res = await fetch(`/api/leads/${leadId}/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: selected, sentText: text, direction: 'outbound' }),
        })
      } else {
        res = await fetch(`/api/leads/${leadId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status_type: selected }),
        })
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not log update.')
      setSelected(null)
      setMessageText('')
      onLogged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log update.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-bone p-4">
      <div className="flex items-center gap-2">
        <Pencil className="size-4 text-stone" />
        <p className="text-[12px] font-medium text-ink">Log an update</p>
      </div>

      <div className="mt-3 space-y-1">
        {visibleOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSelected(opt.value)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-all duration-150',
              selected === opt.value
                ? 'border-orange/40 bg-orange/5 text-ink'
                : 'border-line bg-bone-raised/50 text-graphite hover:bg-bone-raised hover:text-ink',
            )}
          >
            <span className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full border transition-all',
              selected === opt.value
                ? 'border-orange bg-orange'
                : 'border-line bg-bone',
            )}>
              {selected === opt.value && <Check className="size-2.5 text-on-accent" />}
            </span>
            {opt.label}
            {opt.isMessageAction && (
              <span className="ml-auto text-[10px] text-stone">text required</span>
            )}
          </button>
        ))}
      </div>

      {requiresText && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-3.5 text-orange" />
            <p className="text-[12px] font-medium text-ink">
              {selected === 'client_replied' ? 'Paste their reply' : 'Paste the message you actually sent'}
            </p>
          </div>
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            rows={4}
            className="text-[13px] bg-bone-raised/30 border-line focus:border-orange/40"
            placeholder={selected === 'client_replied' ? 'Paste their message here...' : 'Paste the exact message text here...'}
            disabled={saving}
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-[12px] text-status-danger" role="alert">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="orange"
          size="sm"
          onClick={() => void handleLog()}
          disabled={saving || !selected || (requiresText && !messageText.trim())}
          loading={saving}
        >
          Log this
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
