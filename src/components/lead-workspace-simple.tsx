'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Send, Reply, MessageSquare, Copy, Check, Trophy, Clock,
  Building2, User, ExternalLink, AlertTriangle, Sparkles,
  CheckCircle2, XCircle, Target, Shield, Users, Calendar,
  RefreshCw, ChevronDown, ChevronUp, Flame, Archive,
} from 'lucide-react'
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
  const searchParams = useSearchParams()
  const [lead, setLead] = useState(initialLead)
  const [leadVersion, setLeadVersion] = useState(0)
  const [mode, setMode] = useState<Mode>(null)
  const [draftText, setDraftText] = useState('')
  const [sentText, setSentText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['timeline']))

  const relationshipState = computeRelationshipState(lead)
  const action = deriveNextLeadAction(lead)

  const messages = lead.messages ?? []
  const lastInbound = messages.filter((m) => m.direction === 'inbound').at(0) ?? null

  const refreshLead = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${lead.id}`)
      if (res.ok) setLead(await res.json())
    } catch { /* ignore */ }
  }, [lead.id])

  useEffect(() => {
    if (leadVersion > 0) refreshLead()
  }, [leadVersion, refreshLead])

  // Deep linking: ?next=generate-connection, generate-dm, generate-reply, generate-followup
  useEffect(() => {
    const next = searchParams.get('next')
    if (!next || mode || generating) return
    const match = next.match(/^generate-(connection|dm|reply|followup)$/)
    if (match) {
      setMode(match[1] as Mode)
      generateDraft(match[1] as Mode)
      // Clean URL without reload
      const url = new URL(window.location.href)
      url.searchParams.delete('next')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams, mode, generating])

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
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Generation failed (${res.status})`)
      }
      let buffer = ''
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const json = JSON.parse(line.slice(6))
            if (json.type === 'draft') { buffer += json.chunk ?? ''; setDraftText(buffer) }
            else if (json.type === 'done' && json.draft) setDraftText(json.draft.draftText)
            else if (json.type === 'error') { setGenerationStatus(json.message || 'Generation failed'); return }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setGenerationStatus(err instanceof Error ? err.message : 'Generation failed. Retry.')
    } finally {
      setGenerating(false)
    }
  }, [lead.id, lastInbound])

  const logSend = useCallback(async (text: string, type: Mode) => {
    if (!text.trim() || !type) return
    setSending(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentText: text.trim(), type }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to log send.')
      setDraftText('')
      setSentText('')
      setMode(null)
      setLeadVersion((v) => v + 1)
      router.refresh()
    } catch (err) {
      setGenerationStatus(err instanceof Error ? err.message : 'Failed to log send.')
    } finally {
      setSending(false)
    }
  }, [lead.id, router])

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

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleMessages = messages
    .filter((m) => m.sentText || m.direction === 'inbound')
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))

  const scoreBreakdown = (lead.canonicalIntelligence as Record<string, unknown>)?.scoreBreakdown as Record<string, unknown> | null
  const dimensions = Array.isArray(scoreBreakdown?.dimensions) ? scoreBreakdown.dimensions as Array<Record<string, unknown>> : []

  const phase = relationshipState.phase
  const isTheirMove = relationshipState.kind === 'their_move' && phase !== 'replied'
  const isTerminal = relationshipState.kind === 'won' || relationshipState.kind === 'lost'

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Contact header */}
      <div className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cobalt/10 text-lg font-semibold text-cobalt">
                {(lead.contactName ?? lead.company ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="text-[18px] font-medium text-ink truncate">{lead.contactName ?? 'Unnamed prospect'}</h1>
                <p className="text-[13px] text-graphite truncate">
                  {lead.company && <span className="flex items-center gap-1"><Building2 className="size-3" />{lead.company}</span>}
                  {lead.contactTitle && <span className="ml-2 text-stone">{lead.contactTitle}</span>}
                </p>
              </div>
            </div>
            {/* Score + verdict */}
            <div className="mt-3 flex items-center gap-4">
              <ScoreRing score={lead.score} canonicalScore={lead.canonicalScore} size={44} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">
                    {lead.score != null ? `${lead.score}/12` : lead.canonicalScore != null ? `${Math.round(lead.canonicalScore / 10)}/10` : '—'}
                  </span>
                  {(() => {
                    const q = (lead.canonicalIntelligence as Record<string, unknown>)?.qualification
                    if (!q) return null
                    const qs = String(q)
                    return (
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium',
                        qs === 'strong' || qs === 'worth_pursuing' ? 'bg-status-success/10 text-status-success' :
                        qs === 'maybe' ? 'bg-orange/10 text-orange' : 'bg-stone-100 text-stone-500'
                      )}>
                        {qs}
                      </span>
                    )
                  })()}
                </div>
                {lead.verdict && <p className="text-[11px] text-stone">Verdict: {lead.verdict}</p>}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <StatusPill phase={phase} />
          </div>
        </div>
      </div>

      {/* Score breakdown (if canonical) */}
      {dimensions.length > 0 && (
        <CollapsibleSection
          title="Score breakdown"
          icon={<Target className="size-4" />}
          expanded={expandedSections.has('score')}
          onToggle={() => toggleSection('score')}
          count={dimensions.length}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {dimensions.map((dim) => {
              const contribution = Number(dim.contribution ?? 0)
              const weight = Number(dim.weight ?? 0)
              const pct = weight > 0 ? Math.min(100, Math.round((contribution / (weight * 100)) * 100)) : 0
              return (
                <div key={String(dim.key)} className="rounded-lg border border-line/50 bg-bone p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-ink">{String(dim.label ?? dim.key)}</span>
                    <span className="text-[11px] text-stone">{contribution.toFixed(1)} pts</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-line/40 overflow-hidden">
                    <div className={cn('h-full rounded-full', pct >= 70 ? 'bg-status-success' : pct >= 40 ? 'bg-orange' : 'bg-status-warning')} style={{ width: `${pct}%` }} />
                  </div>
                  {dim.note != null && <p className="mt-1 text-[10px] text-stone">{String(dim.note)}</p>}
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Action area */}
      {!isTerminal && (
        <div className="rounded-2xl border border-line bg-bone overflow-hidden">
          {/* State indicator */}
          <div className={cn(
            'px-5 py-3 border-b flex items-center justify-between',
            isTheirMove ? 'border-line/60 bg-bone-raised/40' : 'border-orange/20 bg-orange/[0.03]'
          )}>
            <div className="flex items-center gap-2">
              {!isTheirMove && !isTerminal && <span className="size-2 rounded-full bg-orange animate-pulse" />}
              {isTheirMove && <Clock className="size-3.5 text-stone" />}
              <span className="text-[13px] font-medium text-ink">{relationshipState.detail}</span>
            </div>
            {relationshipState.lastActionAt && (
              <span className="text-[11px] text-stone">{timeAgo(relationshipState.lastActionAt)}</span>
            )}
          </div>

          {/* Generating spinner */}
          {generating && !draftText && (
            <div className="px-5 py-4 flex items-center gap-3">
              <div className="size-5 animate-spin rounded-full border-2 border-orange/30 border-t-orange" />
              <span className="text-[13px] text-ink">{generationStatus ?? 'Generating...'}</span>
            </div>
          )}

          {/* Draft editor */}
          {!generating && mode && draftText && (
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
                  {mode === 'connection' ? 'Connection note' : mode === 'dm' ? 'Your message' : mode === 'reply' ? 'Reply' : 'Follow-up'}
                </span>
                <button type="button" onClick={() => { setMode(null); setDraftText('') }} className="text-stone hover:text-ink">
                  <XCircle className="size-4" />
                </button>
              </div>
              <Textarea
                value={sentText || draftText}
                onChange={(e) => setSentText(e.target.value)}
                rows={5}
                className="text-[13px]"
                placeholder="Edit before sending..."
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => logSend(sentText || draftText, mode)} disabled={sending || !(sentText || draftText).trim()}>
                  <Send className="size-3" /> {sending ? 'Sending...' : 'Log as sent'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText((sentText || draftText).trim()) }}>
                  <Copy className="size-3" /> Copy
                </Button>
              </div>
              {generationStatus && generationStatus.includes('fail') && (
                <div className="flex items-center gap-2 rounded-lg bg-status-danger/5 px-3 py-2 text-[11px] text-status-danger">
                  <AlertTriangle className="size-3" />
                  {generationStatus}
                  <button onClick={() => generateDraft(mode)} className="ml-auto font-medium underline">Retry</button>
                </div>
              )}
              {dailyLimit > 0 && (
                <p className="text-[10px] text-stone">{todaySends}/{dailyLimit} sends used today</p>
              )}
            </div>
          )}

          {/* Primary actions (no draft open) */}
          {!generating && !(mode && draftText) && (
            <div className="px-5 py-4 space-y-3">
              {phase === 'connection_due' && !lead.connectionAcceptedAt && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="sm" onClick={() => generateDraft('connection')} className="w-full justify-center sm:flex-1">
                    <Send className="size-3.5" /> Generate connection note
                  </Button>
                  <Button size="sm" variant="outline" className="w-full justify-center sm:w-auto" onClick={async () => {
                    await fetch(`/api/leads/${lead.id}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'connection', sentText: '', sendWithoutNote: true }) })
                    setLeadVersion((v) => v + 1); router.refresh()
                  }}>
                    Send without note
                  </Button>
                </div>
              )}
              {(phase === 'replied' || (relationshipState.kind === 'your_move' && lastInbound)) && (
                <Button size="sm" onClick={() => generateDraft('reply')} className="w-full justify-center">
                  <MessageSquare className="size-3.5" /> {lastInbound ? `Reply to "${lastInbound.sentText?.slice(0, 40)}..."` : 'Generate reply'}
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
              {phase === 'dm_sent' && action.action === 'SEND_FOLLOWUP' && (
                <Button size="sm" variant="outline" onClick={() => generateDraft('followup')} className="w-full justify-center">
                  <Clock className="size-3.5" /> Send follow-up now
                </Button>
              )}

              {/* Quick actions */}
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
        <div className="rounded-2xl border border-line bg-bone-raised/30 px-5 py-3">
          <p className="text-[13px] text-graphite">{relationshipState.title}</p>
        </div>
      )}

      {/* Timeline */}
      <CollapsibleSection
        title="Conversation history"
        icon={<MessageSquare className="size-4" />}
        expanded={expandedSections.has('timeline')}
        onToggle={() => toggleSection('timeline')}
        count={visibleMessages.length}
        defaultExpanded
      >
        {visibleMessages.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-stone">No messages yet. Generate one above.</p>
        ) : (
          <div className="space-y-3">
            {visibleMessages.map((msg) => (
              <div key={msg.id} className={cn('rounded-lg border p-3', msg.direction === 'inbound' ? 'border-orange/20 bg-orange/[0.02]' : 'border-line bg-bone-raised/20')}>
                <div className="flex items-center gap-2 text-[10px] text-stone mb-1">
                  <span className={cn('rounded px-1 py-0.5 text-[9px] font-medium uppercase', msg.direction === 'inbound' ? 'bg-orange/10 text-orange' : 'bg-cobalt/10 text-cobalt')}>
                    {msg.direction === 'inbound' ? '← Received' : '→ Sent'}
                  </span>
                  <span className="capitalize">{msg.type}</span>
                  {msg.sentAt && <span>· {timeAgo(msg.sentAt)}</span>}
                  {msg.draftText && !msg.sentText && <span className="text-orange">· Draft</span>}
                </div>
                <p className="text-[13px] text-ink whitespace-pre-wrap">{msg.sentText || msg.draftText || '(empty)'}</p>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Context panel — signals & company info */}
      {(lead.signalEvidence || lead.company || lead.contactTitle) && (
        <CollapsibleSection
          title="Context"
          icon={<Sparkles className="size-4" />}
          expanded={expandedSections.has('context')}
          onToggle={() => toggleSection('context')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {lead.company && (
              <div className="rounded-lg border border-line/50 bg-bone p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Company</p>
                <p className="text-[13px] text-ink">{lead.company}</p>
              </div>
            )}
            {lead.contactTitle && (
              <div className="rounded-lg border border-line/50 bg-bone p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Title</p>
                <p className="text-[13px] text-ink">{lead.contactTitle}</p>
              </div>
            )}
            {lead.signalEvidence && (
              <div className="rounded-lg border border-line/50 bg-bone p-3 sm:col-span-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Signal evidence</p>
                <p className="text-[12px] text-ink">{lead.signalEvidence}</p>
              </div>
            )}
            {(lead.tags?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-line/50 bg-bone p-3 sm:col-span-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {lead.tags!.map((tag) => (
                    <span key={tag} className="rounded-full bg-line/40 px-2 py-0.5 text-[10px] text-ink/70">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

/* — shared components — */

function CollapsibleSection({ title, icon, expanded, onToggle, count, children, defaultExpanded }: {
  title: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  count?: number
  children: React.ReactNode
  defaultExpanded?: boolean
}) {
  // First render: use defaultExpanded to decide initial visibility
  const [hasRendered, setHasRendered] = useState(false)
  if (!hasRendered) {
    // This runs on first render only — if defaultExpanded is true, show content
    if (defaultExpanded) {
      return (
        <div className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
          <button onClick={onToggle} className="flex w-full items-center justify-between px-5 py-3 hover:bg-bone-raised/40 transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-stone">{icon}</span>
              <span className="text-sm font-medium text-ink">{title}</span>
              {count !== undefined && <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-stone">{count}</span>}
            </div>
            <ChevronUp className={cn('size-4 text-stone transition-transform', expanded ? '' : 'rotate-180')} />
          </button>
          <div className="px-5 pb-4">{children}</div>
        </div>
      )
    }
    // defaultExpanded false → collapsed
    return (
      <div className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
        <button onClick={onToggle} className="flex w-full items-center justify-between px-5 py-3 hover:bg-bone-raised/40 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-stone">{icon}</span>
            <span className="text-sm font-medium text-ink">{title}</span>
            {count !== undefined && <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-stone">{count}</span>}
          </div>
          <ChevronDown className="size-4 text-stone" />
        </button>
      </div>
    )
  }
  // After first render: controlled by `expanded` state
  return (
    <div className="rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-5 py-3 hover:bg-bone-raised/40 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-stone">{icon}</span>
          <span className="text-sm font-medium text-ink">{title}</span>
          {count !== undefined && <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-stone">{count}</span>}
        </div>
        {expanded ? <ChevronUp className="size-4 text-stone" /> : <ChevronDown className="size-4 text-stone" />}
      </button>
      {expanded && <div className="px-5 pb-4">{children}</div>}
    </div>
  )
}

function StatusPill({ phase }: { phase: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    connection_due: { label: 'To Contact', cls: 'bg-stone-100 text-stone-600' },
    connection_sent: { label: 'Pending', cls: 'bg-cobalt/10 text-cobalt' },
    connection_accepted: { label: 'Accepted', cls: 'bg-cobalt/10 text-cobalt' },
    dm_due: { label: 'DM Due', cls: 'bg-cobalt/10 text-cobalt' },
    dm_sent: { label: 'Waiting', cls: 'bg-cobalt/10 text-cobalt' },
    waiting_for_reply: { label: 'Waiting', cls: 'bg-cobalt/10 text-cobalt' },
    replied: { label: 'Replied', cls: 'bg-orange/10 text-orange' },
    follow_up_due: { label: 'Follow-Up Due', cls: 'bg-orange/10 text-orange' },
  }
  const { label, cls } = map[phase] ?? { label: phase, cls: 'bg-stone-100 text-stone-500' }
  return <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', cls)}>{label}</span>
}

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
        <Button size="sm" disabled={!text.trim() || saving} onClick={() => { setSaving(true); onSave(text).finally(() => { setSaving(false); setText(''); setOpen(false); }); }}>
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
