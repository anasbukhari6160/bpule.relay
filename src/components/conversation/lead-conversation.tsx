'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notifyError, notifySuccess } from '@/lib/ui/notify'
import type { ConversationView } from '@/lib/conversation/service'
import type { ComposeIntent, ComposerDraft, ConversationTurn } from '@/lib/conversation/types'
import { CONNECTION_NOTE_LIMIT } from '@/lib/conversation/limits'

const INTENT_LABEL: Record<ComposeIntent, string> = {
  connection: 'Connection note',
  dm: 'First message',
  followup: 'Follow-up',
  reply: 'Reply',
  custom: 'Message',
}

const REFINEMENTS: Array<{ label: string; instruction: string }> = [
  { label: 'Shorter', instruction: 'Make it shorter and tighter. Keep the same job.' },
  { label: 'Warmer', instruction: 'Make it warmer and more personal, still concise.' },
  { label: 'More direct', instruction: 'Make it more direct and confident. Cut any hedging.' },
  { label: 'Propose a call', instruction: 'End by proposing a short 15-20 minute call with two concrete time options this week.' },
  { label: 'Answer their question', instruction: 'Answer the client\'s latest question fully and concretely first.' },
  { label: 'Add a relevant example', instruction: 'Add one short, relevant example from what I can claim, only if it fits.' },
]

type Mode = 'write' | 'client'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed.')
  return data as T
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso: string | null): string {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function toLocalInput(date: Date): string {
  const off = date.getTimezoneOffset()
  return new Date(date.getTime() - off * 60_000).toISOString().slice(0, 16)
}

/**
 * Chat-style conversation for one lead: the thread on the left, the AI
 * composer under it, and what Relay knows about the deal on the right.
 * Sending stays manual (LinkedIn): copy the message, send it there, log it.
 */
export function LeadConversation({ leadId, onChanged }: { leadId: string; onChanged?: () => void }) {
  const [view, setView] = useState<ConversationView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('write')
  const [intent, setIntent] = useState<ComposeIntent>('custom')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<ComposerDraft | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [composing, setComposing] = useState(false)
  const [sending, setSending] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [clientText, setClientText] = useState('')
  // Blank = "now". A default captured at page load went stale and could
  // date the client's message before our own latest message.
  const [clientAt, setClientAt] = useState('')
  const [savingClient, setSavingClient] = useState(false)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydrated = useRef(false)

  const applyView = useCallback((v: ConversationView, { keepComposer = false } = {}) => {
    setView(v)
    if (!keepComposer) {
      setDraft(v.draft)
      setText(v.draft?.text ?? '')
      setIntent(v.draft?.intent ?? v.suggestedIntent)
      setIssues([])
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const v = await api<ConversationView>(`/api/leads/${leadId}/conversation`)
      applyView(v)
      setLoadError(null)
      hydrated.current = true
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the conversation.')
    }
  }, [leadId, applyView])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [view?.thread.length])

  // Autosave the composer so a draft survives navigation.
  useEffect(() => {
    if (!hydrated.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if ((draft?.text ?? '') === text) return
      void api(`/api/leads/${leadId}/conversation/draft`, { method: 'PUT', body: JSON.stringify({ text, intent }) }).catch(() => {})
    }, 900)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [text, intent, leadId, draft?.text])

  const compose = useCallback(async (opts: { instruction?: string; refine?: boolean } = {}) => {
    setComposing(true)
    try {
      const res = await api<{ draft: ComposerDraft; issues: string[]; fallback: boolean }>(`/api/leads/${leadId}/conversation/compose`, {
        method: 'POST',
        body: JSON.stringify({
          intent,
          instruction: opts.instruction ?? null,
          previousText: opts.refine && text.trim() ? text : null,
        }),
      })
      setDraft(res.draft)
      setText(res.draft.text)
      setIssues(res.issues)
      setInstruction('')
      if (res.fallback) notifyError('AI is unavailable right now. A plain template was filled in.', 'AI unavailable')
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Could not write the message.', 'Could not write the message')
    } finally {
      setComposing(false)
    }
  }, [leadId, intent, text])

  const copy = useCallback(async () => {
    if (!text.trim()) return false
    try {
      await navigator.clipboard.writeText(text.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      return true
    } catch {
      notifyError('Copy failed. Select the text and copy it manually.', 'Copy failed')
      return false
    }
  }, [text])

  const logSent = useCallback(async ({ copyFirst }: { copyFirst: boolean }) => {
    if (!text.trim() && intent !== 'connection') return
    if (copyFirst) await copy()
    setSending(true)
    try {
      const v = await api<ConversationView>(`/api/leads/${leadId}/conversation/send`, {
        method: 'POST',
        body: JSON.stringify({ text, intent, idempotencyKey: `${leadId}:${draft?.updatedAt ?? 'manual'}:${text.trim().length}` }),
      })
      applyView(v)
      notifySuccess('Logged as sent. Relay will track the reply and follow-up.', 'Logged')
      onChanged?.()
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Could not log the message.', 'Not logged')
    } finally {
      setSending(false)
    }
  }, [text, intent, leadId, draft?.updatedAt, copy, applyView, onChanged])

  const addClientMessage = useCallback(async () => {
    if (!clientText.trim()) return
    setSavingClient(true)
    try {
      const receivedAt = clientAt ? new Date(clientAt).toISOString() : null
      const v = await api<ConversationView>(`/api/leads/${leadId}/conversation/inbound`, {
        method: 'POST',
        body: JSON.stringify({ text: clientText, receivedAt }),
      })
      applyView(v, { keepComposer: Boolean(text.trim()) })
      if (!text.trim()) setIntent(v.suggestedIntent)
      setClientText('')
      setClientAt('')
      setMode('write')
      onChanged?.()
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Could not add the message.', 'Not added')
    } finally {
      setSavingClient(false)
    }
  }, [clientText, clientAt, leadId, applyView, text, onChanged])

  const groups = useMemo(() => {
    const out: Array<{ day: string; turns: ConversationTurn[] }> = []
    for (const turn of view?.thread ?? []) {
      const day = formatDay(turn.at)
      const last = out.at(-1)
      if (last && last.day === day) last.turns.push(turn)
      else out.push({ day, turns: [turn] })
    }
    return out
  }, [view?.thread])

  if (loadError) {
    return (
      <div className="rounded-2xl border border-line bg-bone-raised/20 p-6 text-center">
        <p className="text-[13px] text-ink">{loadError}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
          <RefreshCw className="size-3" aria-hidden="true" /> Retry
        </Button>
      </div>
    )
  }
  if (!view) {
    return <div className="h-64 animate-pulse rounded-2xl border border-line bg-bone-raised/30" aria-label="Loading conversation" />
  }

  const memory = view.memory
  const facts = memory.facts
  const firstName = view.contactName?.split(/\s+/)[0] ?? 'Client'
  const charCount = text.trim().length
  const overLimit = intent === 'connection' && charCount > CONNECTION_NOTE_LIMIT

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-bone-raised/20" aria-label="Conversation">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="rounded-full bg-cobalt/10 px-2 py-0.5 text-[11px] font-medium text-cobalt">{view.stageLabel}</span>
          <span className={cn('text-[12px] font-medium', view.nextAction.requiresAction ? 'text-orange' : 'text-graphite')}>
            {view.nextAction.primaryLabel}
          </span>
          <span className="text-[11px] text-stone">{view.nextAction.reason}</span>
          {view.url && (
            <a href={view.url} target="_blank" rel="noopener" className="ml-auto inline-flex items-center gap-1 text-[11px] text-cobalt hover:underline">
              Open on LinkedIn <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" style={{ maxHeight: 520 }}>
          {view.thread.length === 0 && (
            <p className="py-10 text-center text-[12px] text-stone">
              No messages yet. Write the first one below, or paste a message {firstName} sent you.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.day} className="space-y-2.5">
              <p className="text-center text-[10px] uppercase tracking-[0.12em] text-stone">{g.day}</p>
              {g.turns.map((turn) => (
                <Bubble key={turn.id} turn={turn} name={turn.role === 'me' ? 'You' : view.contactName ?? 'Client'} />
              ))}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-line bg-bone/60 p-3">
          <div role="tablist" className="mb-2 flex gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'write'}
              onClick={() => setMode('write')}
              className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium', mode === 'write' ? 'bg-solid text-on-solid' : 'text-graphite hover:bg-bone-raised')}
            >
              Your message
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'client'}
              onClick={() => setMode('client')}
              className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium', mode === 'client' ? 'bg-solid text-on-solid' : 'text-graphite hover:bg-bone-raised')}
            >
              <ClipboardPaste className="size-3" aria-hidden="true" /> {firstName} replied
            </button>
          </div>

          {mode === 'client' ? (
            <div className="space-y-2">
              <Textarea
                value={clientText}
                onChange={(e) => setClientText(e.target.value)}
                placeholder={`Paste ${firstName}'s message from LinkedIn...`}
                rows={4}
                className="text-[13px]"
                aria-label={`${firstName}'s message`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-graphite">
                  When they sent it (optional)
                  <input
                    type="datetime-local"
                    value={clientAt}
                    max={toLocalInput(new Date())}
                    onChange={(e) => setClientAt(e.target.value)}
                    className="rounded-md border border-line bg-bone px-2 py-1 text-[11px] text-ink"
                  />
                </label>
                <Button variant="orange" size="sm" className="ml-auto" onClick={() => void addClientMessage()} loading={savingClient} disabled={!clientText.trim()}>
                  Add to conversation
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['connection', 'dm', 'followup', 'reply', 'custom'] as ComposeIntent[]).map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIntent(i)}
                    aria-pressed={intent === i}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px]',
                      intent === i ? 'border-orange bg-orange/10 text-orange' : 'border-line text-graphite hover:text-ink',
                      i === view.suggestedIntent && intent !== i && 'border-orange/40',
                    )}
                  >
                    {INTENT_LABEL[i]}{i === view.suggestedIntent ? ' · suggested' : ''}
                  </button>
                ))}
                <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void compose()} loading={composing}>
                  <Sparkles className="size-3" aria-hidden="true" /> {text.trim() ? 'Rewrite with AI' : 'Write with AI'}
                </Button>
              </div>

              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={view.awaitingReply ? `Reply to ${firstName}, or click "Write with AI".` : 'Write your message, or click "Write with AI".'}
                rows={6}
                className="text-[13px]"
                aria-label="Your message"
              />

              {draft?.rationale && text.trim() && (
                <div className="rounded-md border border-line/70 bg-bone-raised/50 p-2 text-[11px] text-graphite">
                  <p><span className="font-medium text-ink">Goal:</span> {draft.rationale.goal}</p>
                  {draft.rationale.answers.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {draft.rationale.answers.map((a) => (
                        <li key={a} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-status-success" aria-hidden="true" />Answers: {a}</li>
                      ))}
                    </ul>
                  )}
                  {draft.rationale.why && <p className="mt-1 text-stone">{draft.rationale.why}</p>}
                </div>
              )}

              {issues.length > 0 && (
                <ul className="space-y-0.5" aria-label="Things to check">
                  {issues.map((i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-status-warning">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />{i}
                    </li>
                  ))}
                </ul>
              )}

              {text.trim() && (
                <div className="flex flex-wrap gap-1.5" aria-label="Refine with AI">
                  {REFINEMENTS.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      disabled={composing}
                      onClick={() => void compose({ instruction: r.instruction, refine: true })}
                      className="rounded-full border border-line px-2 py-0.5 text-[11px] text-graphite hover:border-cobalt/40 hover:text-ink disabled:opacity-50"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (instruction.trim()) void compose({ instruction, refine: Boolean(text.trim()) })
                }}
              >
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder='Tell Relay what to change, e.g. "propose Thursday 3pm" or "mention the Shopify project"'
                  className="min-w-0 flex-1 rounded-md border border-line bg-bone px-2.5 py-1.5 text-[12px] text-ink placeholder:text-stone"
                  aria-label="Instruction for the AI"
                />
                <Button type="submit" variant="ghost" size="sm" disabled={!instruction.trim() || composing}>
                  <Wand2 className="size-3" aria-hidden="true" /> Apply
                </Button>
              </form>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className={cn('font-mono text-[11px]', overLimit ? 'text-status-danger' : 'text-stone')}>
                  {intent === 'connection' ? `${charCount}/${CONNECTION_NOTE_LIMIT}` : `${text.trim() ? text.trim().split(/\s+/).length : 0} words`}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => void copy()} disabled={!text.trim()}>
                    {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void logSent({ copyFirst: false })} loading={sending} disabled={(!text.trim() && intent !== 'connection') || overLimit}>
                    Log as sent
                  </Button>
                  <Button variant="orange" size="sm" onClick={() => void logSent({ copyFirst: true })} loading={sending} disabled={!text.trim() || overLimit}>
                    <Send className="size-3" aria-hidden="true" /> Copy &amp; log as sent
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-stone">Send the message on LinkedIn yourself, then log it here so Relay keeps the thread and timing right.</p>
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-3" aria-label="Deal context">
        <div className="rounded-2xl border border-line bg-bone-raised/20 p-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-stone">Deal</p>
          <p className="mt-1 text-[14px] font-medium text-ink">{view.contactName ?? 'Unnamed'} · {view.company}</p>
          {view.contactTitle && <p className="text-[12px] text-graphite">{view.contactTitle}</p>}
          <dl className="mt-3 space-y-1.5 text-[12px]">
            <Fact label="Stage" value={view.stageLabel} />
            <Fact label="Need" value={facts.need} />
            <Fact label="Timeline" value={facts.timeline} />
            <Fact label="Budget" value={facts.budget} />
            <Fact label="Decision maker" value={facts.decisionMaker} />
            <Fact label="Next step" value={facts.nextStepNotes} />
          </dl>
        </div>

        {(facts.openQuestions.length > 0 || facts.objections.length > 0 || facts.buyingSignals.length > 0) && (
          <div className="rounded-2xl border border-line bg-bone-raised/20 p-4 text-[12px]">
            {facts.openQuestions.length > 0 && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-orange">Waiting for your answer</p>
                <ul className="mt-1 space-y-0.5 text-ink">{facts.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
            {facts.buyingSignals.length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-status-success">Buying signals</p>
                <ul className="mt-1 space-y-0.5 text-graphite">{facts.buyingSignals.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
            {facts.objections.length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-status-warning">Objections</p>
                <ul className="mt-1 space-y-0.5 text-graphite">{facts.objections.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {memory.lastClientAnalysis && (
          <div className="rounded-2xl border border-line bg-bone-raised/20 p-4 text-[12px]">
            <p className="text-[10px] font-medium uppercase tracking-wider text-stone">Their last message</p>
            <p className="mt-1 text-ink">{memory.lastClientAnalysis.summary}</p>
            <p className="mt-1 text-[11px] text-stone">Intent: {memory.lastClientAnalysis.intent.replaceAll('_', ' ')} · {memory.lastClientAnalysis.sentiment}</p>
          </div>
        )}

        {memory.rollingSummary && (
          <div className="rounded-2xl border border-line bg-bone-raised/20 p-4 text-[12px]">
            <p className="text-[10px] font-medium uppercase tracking-wider text-stone">Earlier in the conversation</p>
            <p className="mt-1 text-graphite">{memory.rollingSummary}</p>
          </div>
        )}
      </aside>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-stone">{label}</dt>
      <dd className={cn('min-w-0', value ? 'text-ink' : 'text-stone/70')}>{value ?? 'Unknown'}</dd>
    </div>
  )
}

function Bubble({ turn, name }: { turn: ConversationTurn; name: string }) {
  const mine = turn.role === 'me'
  const kind = turn.kind === 'connection' ? 'Connection note' : turn.kind === 'followup' ? 'Follow-up' : turn.kind === 'inbound_first' ? 'First message' : null
  return (
    <div className={cn('message-entrance flex', mine ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[85%] min-w-0">
        <div className={cn(
          'rounded-2xl px-3.5 py-2.5',
          mine ? 'rounded-br-md bg-cobalt/10 border border-cobalt/20' : 'rounded-bl-md bg-bone border border-line',
        )}>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{turn.text}</p>
        </div>
        <p className={cn('mt-1 flex gap-1.5 px-1 text-[10px] text-stone', mine ? 'justify-end' : 'justify-start')}>
          <span className="font-medium">{name}</span>
          {kind && <span>· {kind}</span>}
          {turn.at && <span>· {formatTime(turn.at)}</span>}
        </p>
      </div>
    </div>
  )
}
