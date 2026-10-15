'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Send, Reply, MessageSquare, X, Copy, Check, ChevronDown, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScoreRing } from '@/components/score-ring'
import { cn } from 'cn'
import type { LeadDetail } from '@/lib/store/types'
import { computeRelationshipState } from '@/lib/relay/relationship-state'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import type { Message } from '@/lib/domain/types'

type Mode = 'connection' | 'dm' | 'reply' | 'followup' | null

interface Props {
  lead: LeadDetail
  dailyLimit: number
  todaySends: number
}

export function LeadWorkspace({ lead: initialLead, dailyLimit, todaySends }: Props) {
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [leadVersion, setLeadVersion] = useState(0)
  const [mode, setMode] = useState<Mode>(null)
  const [draftText, setDraftText] = useState('')
  const [sentText, setSentText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)

  const relationshipState = computeRelationshipState(lead)

  const lastInbound = lead.messages.filter((m) => m.direction === 'inbound').at(0) ?? null

  // Refetch lead data
  const refreshLead = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${lead.id}`)
      if (res.ok) setLead(await res.json())
    } catch { /* ignore */ }
  }, [lead.id])

  useEffect(() => {
    if (leadVersion > 0) refreshLead()
  }, [leadVersion, refreshLead])

  // Generate a message draft (no persistence — text lives in component state)
  const generateDraft = useCallback(async (type: Mode) => {
    if (!type) return
    setMode(type)
    setGenerating(true)
    setDraftText('')
    setGenerationStatus(null)
    try {
      const replyText = type === 'reply' ? (lastInbound?.sentText || '') : undefined
      const replyToMessageId = type === 'reply' ? (lastInbound?.id || undefined) : undefined
      const res = await fetch(`/api/leads/${lead.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, replyText, replyToMessageId }),
      })
      let buffer = ''
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response')
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const json = JSON.parse(line.slice(6))
            if (json.type === 'draft') { buffer += json.chunk ?? ''; setDraftText(buffer) }
            else if (json.type === 'done' && json.draft) setDraftText(json.draft.draftText)
            else if (json.type === 'error') { setGenerationStatus(json.message); return }
          } catch { /* skip */ }
        }
      }
    } catch { setGenerationStatus('Generation failed. Retry.') }
    finally { setGenerating(false) }
  }, [lead.id, lastInbound])

  // Log a message as sent
  const logSend = useCallback(async (text: string, type: Mode) => {
    if (!text.trim() || !type) return
    setSending(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentText: text.trim(), type }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to log send.')
      setDraftText('')
      setSentText('')
      setMode(null)
      setLeadVersion((v) => v + 1)
      router.refresh()
    } catch { /* handled by UI */ }
    finally { setSending(false) }
  }, [lead.id, router])

  // Quick actions
  const markAccepted = useCallback(async () => {
    await fetch(`/api/leads/${lead.id}/connection-accepted`, { method: 'POST' })
    setLeadVersion((v) => v + 1)
    router.refresh()
  }, [lead.id, router])

  const logInboundReply = useCallback(async (text: string) => {
    await fetch(`/api/leads/${lead.id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    })
    setLeadVersion((v) => v + 1)
    router.refresh()
  }, [lead.id, router])

  // Show sent messages + inbound. Hide orphaned drafts (draftText without sentText)
  // that pre-date the no-draft-persistence fix.
  const visibleMessages = lead.messages
    .filter((m) => m.sentText || m.direction === 'inbound')
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))

  const phase = relationshipState.phase
  const isTheirMove = relationshipState.kind === 'their_move' && phase !== 'replied'
  const isTerminal = relationshipState.kind === 'won' || relationshipState.kind === 'lost'

  return (
    <div className="space-y-6">
      {/* Contact header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-medium text-ink truncate">{lead.contactName ?? 'Unnamed'}</h1>
          <p className="text-[13px] text-graphite truncate">
            {lead.company} {lead.contactTitle ? `· ${lead.contactTitle}` : ''}
          </p>
        </div>
        <ScoreRing score={lead.score} canonicalScore={lead.canonicalScore} size={48} />
      </div>

      {/* Timeline */}
      {visibleMessages.length > 0 && (
        <div className="rounded-xl border border-line overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line/40 bg-bone-raised/30">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">History</span>
          </div>
          <div className="divide-y divide-line/30">
            {visibleMessages.map((msg) => (
              <div key={msg.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-[10px] text-stone mb-1">
                  <span className={cn(
                    'rounded px-1 py-0.5 text-[9px] font-medium uppercase',
                    msg.direction === 'inbound' ? 'bg-orange/10 text-orange' : 'bg-cobalt/10 text-cobalt'
                  )}>
                    {msg.direction === 'inbound' ? '← Received' : '→ Sent'}
                  </span>
                  <span className="capitalize">{msg.type}</span>
                  {msg.sentAt && <span>· {timeAgo(msg.sentAt)}</span>}
                  {msg.draftText && !msg.sentText && <span className="text-orange">· Draft</span>}
                </div>
                <p className="text-[13px] text-ink whitespace-pre-wrap">
                  {msg.sentText || msg.draftText || '(empty)'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action area */}
      {!isTerminal && (
        <div className="rounded-xl border border-line overflow-hidden">
          {/* State indicator */}
          <div className={cn(
            'px-4 py-3 border-b',
            isTheirMove ? 'border-line/60 bg-bone-raised/40' : 'border-orange/20 bg-orange/[0.03]'
          )}>
            <span className="text-[13px] font-medium text-ink">{relationshipState.detail}</span>
          </div>

          {/* Generating */}
          {generating && !draftText && (
            <div className="px-4 py-4 flex items-center gap-3">
              <div className="size-5 animate-spin rounded-full border-2 border-orange/30 border-t-orange" />
              <span className="text-[13px]">{generationStatus ?? 'Generating...'}</span>
            </div>
          )}

          {/* Draft editor */}
          {!generating && mode && draftText && (
            <div className="px-4 py-4 space-y-3">
              <Textarea
                value={sentText || draftText}
                onChange={(e) => setSentText(e.target.value)}
                rows={5}
                className="text-[13px]"
                placeholder="Edit before sending..."
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => logSend(sentText || draftText, mode)} disabled={sending || !(sentText || draftText).trim()}>
                  <Send className="size-3" /> Log as sent
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText((sentText || draftText).trim()) }}>
                  <Copy className="size-3" /> Copy
                </Button>
              </div>
              {todaySends < dailyLimit && (
                <p className="text-[10px] text-stone">{todaySends}/{dailyLimit} sends used today</p>
              )}
            </div>
          )}

          {/* Primary actions (no draft open) */}
          {!generating && !(mode && draftText) && (
            <div className="px-4 py-4 space-y-3">
              {/* Primary CTA based on state */}
              {phase === 'connection_due' && !lead.connectionAcceptedAt && (
                <Button size="sm" onClick={() => generateDraft('connection')} className="w-full justify-center">
                  <Send className="size-3.5" /> Generate connection note
                </Button>
              )}
              {(phase === 'replied' || relationshipState.kind === 'your_move') && lastInbound && (
                <Button size="sm" onClick={() => generateDraft('reply')} className="w-full justify-center">
                  <MessageSquare className="size-3.5" /> Generate reply
                </Button>
              )}
              {(phase === 'connection_accepted' || phase === 'dm_due') && !lead.messages.some((m) => m.type === 'dm' && m.sentText) && (
                <Button size="sm" onClick={() => generateDraft('dm')} className="w-full justify-center">
                  <MessageSquare className="size-3.5" /> Send first message
                </Button>
              )}
              {phase === 'follow_up_due' && (
                <Button size="sm" onClick={() => generateDraft('followup')} className="w-full justify-center">
                  <Send className="size-3.5" /> Send follow-up
                </Button>
              )}

              {/* Quick actions row */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-line/30">
                {phase === 'connection_sent' && !lead.connectionAcceptedAt && (
                  <Button size="sm" variant="outline" onClick={markAccepted}>
                    <Trophy className="size-3" /> Mark accepted
                  </Button>
                )}
                <QuickReplyInput onSave={logInboundReply} />
              </div>
            </div>
          )}
        </div>
      )}

      {isTerminal && (
        <div className="rounded-xl border border-line bg-bone-raised/30 px-4 py-3">
          <p className="text-[13px] text-graphite">{relationshipState.title}</p>
        </div>
      )}
    </div>
  )
}

/* — quick reply input — */
function QuickReplyInput({ onSave }: { onSave: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-graphite hover:border-orange/30 hover:text-ink transition-colors">
        <Reply className="size-3" /> They replied
      </button>
    )
  }

  return (
    <div className="flex-1 min-w-[200px] space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-[12px]" placeholder="Paste their reply..." />
      <div className="flex gap-2">
        <Button size="sm" disabled={!text.trim() || saving} onClick={() => { setSaving(true); onSave(text).finally(() => setSaving(false)); setText(''); setOpen(false); }}>
          <Check className="size-3" /> Log reply
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText('') }}>Cancel</Button>
      </div>
    </div>
  )
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days > 0) return `${days}d ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs > 0) return `${hrs}h ago`
  return `${Math.floor(diff / 60_000)}m ago`
}
