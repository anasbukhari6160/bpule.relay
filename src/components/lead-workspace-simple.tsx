'use client'

import { useState, useCallback, useEffect } from 'react'
import { hasUnfilledValues, UNFILLED_VALUES_MESSAGE } from '@/lib/relay/unfilled-values'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Send, Reply, MessageSquare, X, Copy, Check, Trophy, Clock,
  Building2, ExternalLink, AlertTriangle, Sparkles,
  XCircle, Target, CalendarDays, Flame,
  ChevronDown, ChevronUp, Mail, Archive,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LeadScoreRing } from '@/components/score-ring'
import { cn } from 'cn'
import Link from 'next/link'
import type { LeadDetail } from '@/lib/store/types'
import { computeRelationshipState } from '@/lib/relay/relationship-state'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import type { Message } from '@/lib/domain/types'
import { getLeadDisplayScore, normalizeScoreDimensions, scoreExplanation } from '@/lib/scoring/display-score'
import { calendarDaysBetween, followupDueInDays } from '@/lib/leads/followup'
import { formatRoleLine, stripEmployerFromTitle } from '@/lib/leads/role-line'
import { ScoreBreakdown } from '@/components/score-breakdown'
import { DecisionExplainability } from '@/components/leads/decision-explain'
import { DecisionTraceView } from '@/components/leads/decision-trace-view'
import { buildDecisionTrace } from '@/lib/relay/decision-trace'
import { LeadDecisionContextCard, type DecisionContext } from '@/components/lead-decision-context-card'

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
  const [markingAccepted, setMarkingAccepted] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const relationshipState = computeRelationshipState(lead)
  const nextAction = deriveNextLeadAction(lead)
  const messages = lead.messages ?? []
  const lastInbound = messages.filter((m) => m.direction === 'inbound').at(0) ?? null
  const [decisionCtx, setDecisionCtx] = useState<DecisionContext | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/leads/${lead.id}/decision-context`)
        if (res.ok && !cancelled) {
          const json = await res.json()
          setDecisionCtx(json as DecisionContext)
        }
      } catch { /* non-fatal */ }
    }
    load()
    return () => { cancelled = true }
  }, [lead.id])
  const phase = relationshipState.phase
  // The server refuses contact actions on a no/dead lead. Do not offer them.
  const leadLocked = lead.status === 'no' || lead.status === 'dead'
  // A SKIP verdict never recommends outreach; connecting is a manual override.
  const skipVerdict = lead.verdict === 'skip'
  const isTheirMove = relationshipState.kind === 'their_move' && phase !== 'replied'
  const isTerminal = relationshipState.kind === 'won' || relationshipState.kind === 'lost'
  // BUG-18: an unanswered inbound exists when the newest inbound is newer than
  // the newest outbound reply — covers follow-up messages after the first reply.
  const lastOutboundReply = messages
    .filter((m) => m.type === 'reply' && m.direction !== 'inbound' && m.sentAt)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0] ?? null
  const hasUnansweredInbound = lastInbound && (!lastOutboundReply || (lastInbound.sentAt ?? '') > (lastOutboundReply.sentAt ?? ''))

  const refreshLead = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${lead.id}`)
      if (res.ok) {
        const json = await res.json()
        // API returns { lead: {...} }, extract the lead object
        const fresh = json.lead ?? json
        // Merge: keep existing arrays if the fresh response omits them
        setLead((prev) => ({
          ...fresh,
          messages: fresh.messages ?? prev.messages ?? [],
          outcomes: fresh.outcomes ?? prev.outcomes ?? [],
          tags: fresh.tags ?? prev.tags ?? [],
        }))
      }
    } catch { /* ignore */ }
  }, [lead.id])

  useEffect(() => { if (leadVersion > 0) refreshLead() }, [leadVersion, refreshLead])

  // Deep linking
  useEffect(() => {
    const next = searchParams.get('next')
    if (!next || mode || generating) return
    const match = next.match(/^generate-(connection|dm|reply|followup)$/)
    if (match) {
      const requested = match[1] as Mode
      if (requested === 'followup' && phase !== 'follow_up_due') return
      if (requested === 'connection' && phase !== 'connection_due') return
      setMode(requested)
      generateDraft(requested)
      const url = new URL(window.location.href)
      url.searchParams.delete('next')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams, phase])

  const generateDraft = useCallback(async (type: Mode) => {
    if (!type) return
    setMode(type); setGenerating(true); setDraftText(''); setGenerationStatus(null)
    try {
      const replyText = type === 'reply' ? (lastInbound?.sentText || '') : undefined
      const replyToMessageId = type === 'reply' ? (lastInbound?.id || undefined) : undefined
      const res = await fetch(`/api/leads/${lead.id}/draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, replyText, replyToMessageId }),
      })
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Generation failed (${res.status})`) }
      let buffer = ''
      let sawTerminal = false
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value).split('\n\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const json = JSON.parse(line.slice(6))
            if (json.type === 'draft') { buffer += json.chunk ?? ''; setDraftText(buffer) }
            else if (json.type === 'done' && json.draft) { sawTerminal = true; setDraftText(json.draft.draftText) }
            else if (json.type === 'needs_rescoring') {
              // The server could not derive a strategy. Say so instead of
              // leaving a blank note (QA RQA-012).
              sawTerminal = true
              setGenerationStatus(json.reason || 'This lead needs rescoring before a message can be written.')
              return
            }
            else if (json.type === 'error') { sawTerminal = true; setGenerationStatus(json.message || 'Generation failed'); return }
          } catch { /* skip */ }
        }
      }
      // A stream that ends without a terminal event must not look like a
      // silent success — the rep sees nothing and cannot tell what happened.
      if (!sawTerminal) setGenerationStatus('Generation ended without a result. Please try again.')
    } catch (err) {
      setGenerationStatus(err instanceof Error ? err.message : 'Generation failed. Retry.')
    } finally { setGenerating(false) }
  }, [lead.id, lastInbound])

  // "Send without note" logs a connection with no text. It must surface
  // server refusals (daily ceiling, lock, ownership) instead of failing
  // silently, and cannot be double-submitted.
  const [loggingConnection, setLoggingConnection] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const sendWithoutNote = useCallback(async () => {
    if (loggingConnection) return
    setLoggingConnection(true)
    setActionError(null)
    setDraftText(''); setMode(null)
    try {
      const res = await fetch(`/api/leads/${lead.id}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'connection', sentText: '', sendWithoutNote: true, idempotencyKey: `${lead.id}:connection:no-note` }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not log the connection request.')
      setLeadVersion((v) => v + 1); router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not log the connection request.')
    } finally {
      setLoggingConnection(false)
    }
  }, [lead.id, loggingConnection, router])

  const logSend = useCallback(async (text: string, type: Mode) => {
    if (!text.trim() || !type) return
    setSending(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // originalDraft lets the server learn from the rep's edits; the key
        // makes a double-click log the send once.
        body: JSON.stringify({
          sentText: text.trim(),
          type,
          originalDraft: draftText.trim() || null,
          idempotencyKey: `${lead.id}:${type}:${draftText.length}:${text.trim().length}:${lead.messages.length}`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to log send.')
      setDraftText(''); setSentText(''); setMode(null); setLeadVersion((v) => v + 1); router.refresh()
    } catch (err) {
      setGenerationStatus(err instanceof Error ? err.message : 'Failed to log send.')
    } finally { setSending(false) }
  }, [lead.id, lead.messages.length, draftText, router])

  const markAccepted = useCallback(async () => {
    setMarkingAccepted(true)
    try { await fetch(`/api/leads/${lead.id}/connection-accepted`, { method: 'POST' }); setLeadVersion((v) => v + 1); router.refresh() }
    finally { setMarkingAccepted(false) }
  }, [lead.id, router])

  const logInboundReply = useCallback(async (text: string) => {
    await fetch(`/api/leads/${lead.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.trim() }) })
    setLeadVersion((v) => v + 1); router.refresh()
  }, [lead.id, router])

  // A connection logged without a note has no text but still happened.
  const visibleMessages = messages.filter((m) => m.sentText || m.direction === 'inbound' || (m.type === 'connection' && m.sentAt)).sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))

  // Inbound leads store the opening message on the lead itself (lead.inboundMessage)
  // rather than as a message row. Surface it as the first timeline entry so the
  // History tab reflects what the Conversation tab already shows.
  const inboundFirstEntry = lead.inboundMessage?.trim()
    ? {
        id: 'inbound-first',
        type: 'inbound_first' as const,
        direction: 'inbound' as const,
        sentText: lead.inboundMessage.trim(),
        sentAt: lead.createdAt ?? null,
      }
    : null
  const timelineEntries = inboundFirstEntry
    ? [inboundFirstEntry, ...visibleMessages]
    : visibleMessages

  // The Won/Lost outcome is an event, not a message; show it as its own timeline
  // row so History records the outcome (QA RQA-015).
  const outcomeEntry = lead.status === 'won'
    ? { id: 'outcome-won', type: 'won', sentText: 'Opportunity won', sentAt: lead.wonAt ?? null }
    : lead.status === 'lost'
      ? { id: 'outcome-lost', type: 'lost', sentText: 'Opportunity lost', sentAt: lead.lostAt ?? null }
      : null

  // canonicalIntelligence may arrive as a JSON string from the DB — parse it
  let canonicalObj: Record<string, unknown> | null = null
  const ci = lead.canonicalIntelligence
  if (ci && typeof ci === 'object') canonicalObj = ci as Record<string, unknown>
  else if (typeof ci === 'string') { try { canonicalObj = JSON.parse(ci) } catch { /* ignore */ } }
  const scoreBreakdown = canonicalObj?.scoreBreakdown as Record<string, unknown> | null
  const rawDimensions = Array.isArray(scoreBreakdown?.dimensions) ? scoreBreakdown.dimensions : []
  const dimensions = normalizeScoreDimensions(rawDimensions)
  const qualification = typeof canonicalObj?.qualification === 'string' ? canonicalObj.qualification : null
  // Same policy as the pipeline and dashboard.
  const leadScore = getLeadDisplayScore(lead)
  const displayScore = leadScore.max === 10 ? leadScore.value : null
  const reasons = Array.isArray(scoreBreakdown?.reasons) ? scoreBreakdown.reasons.map(String) : []
  const watchOut = Array.isArray(scoreBreakdown?.watchOut) ? scoreBreakdown.watchOut.map(String) : []
  const missingInfo = Array.isArray(scoreBreakdown?.missingInfo) ? scoreBreakdown.missingInfo.map(String) : []
  const lastConversationAt = messages
    .filter((m) => m.direction !== 'inbound' && (m.type === 'dm' || m.type === 'followup') && m.sentAt)
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
    .at(-1)?.sentAt ?? null
  const followupDueIn = followupDueInDays(lead.followupCount ?? 0)
  const daysSinceConversation = lastConversationAt ? calendarDaysBetween(new Date(lastConversationAt), new Date()) : 0
  const followupDueOn = lastConversationAt
    ? new Date(new Date(lastConversationAt).getTime() + followupDueIn * 24 * 60 * 60 * 1000)
    : null
  const followupDueLabel = followupDueOn
    ? followupDueOn.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="space-y-6">
      {/* Contact Header */}
      <div className="rounded-2xl border border-line bg-bone-raised/20 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cobalt/10 text-lg font-semibold text-cobalt">
                {(lead.contactName ?? lead.company ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="text-[18px] font-medium text-ink truncate">{lead.contactName ?? 'Unnamed prospect'}</h1>
                <p className="text-[13px] text-graphite truncate flex items-center gap-1">
                  <Building2 className="size-3 shrink-0" /><span className="truncate">{formatRoleLine(lead.contactTitle, lead.company)}</span>
                  {lead.companyKey && (
                    <Link href={`/account?companyKey=${encodeURIComponent(lead.companyKey)}`} className="ml-1 text-[10px] text-cobalt hover:underline shrink-0">
                      Account 360 →
                    </Link>
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4">
              <LeadScoreRing lead={lead} size={44} />
              <div>
                <div className="flex items-center gap-2">
                   <span className="text-[13px] font-medium text-ink">{leadScore.text}</span>
                  {leadScore.qualification && (
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium',
                      leadScore.qualification === 'STRONG' || leadScore.qualification === 'WORTH_PURSUING' ? 'bg-status-success/10 text-status-success' :
                      leadScore.qualification === 'MAYBE' ? 'bg-orange/10 text-orange' : 'bg-stone-100 text-stone-500'
                    )}>{leadScore.label}</span>
                  )}
                </div>
                {lead.verdict && <p className="text-[11px] text-stone">Verdict: {lead.verdict}</p>}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <StatusPill phase={phase} />
            {lead.url && <a href={lead.url} target="_blank" rel="noopener" className="mt-1 inline-block text-[10px] text-cobalt hover:underline">LinkedIn ↗</a>}
            {(leadScore.qualification === 'STRONG' || leadScore.qualification === 'WORTH_PURSUING') && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/leads/${lead.id}/refresh-intelligence`, {
                      method: 'POST',
                      headers: { 'x-force-refresh': 'true' },
                    })
                    if (res.ok) {
                      const json = await res.json()
                      if (json.refreshed) {
                        window.location.reload()
                      }
                    }
                  } catch { /* non-fatal */ }
                }}
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-graphite hover:text-ink"
                title="Refresh intelligence signals"
              >
                <Target className="size-3" /> Refresh signals
              </button>
            )}

            {/* Manual soft-archive / restore — distinct from the automatic
                stale sweep and the Won/Lost conversation archive (QA RQA-019). */}
            <button
              disabled={archiving}
              onClick={async () => {
                setArchiving(true)
                try {
                  await fetch(`/api/leads/${lead.id}/archive`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: lead.archived ? 'restore' : 'archive' }),
                  })
                  await refreshLead()
                  router.refresh()
                } finally {
                  setArchiving(false)
                }
              }}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-graphite hover:text-ink disabled:opacity-50"
              title={lead.archived ? 'Restore this lead' : 'Archive this lead'}
            >
              <Archive className="size-3" /> {archiving ? 'Working…' : lead.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        </div>
      </div>

      {/* Decision Context: Sender Routing + Conversation Override */}
      {!isTerminal && decisionCtx && (
        <LeadDecisionContextCard context={decisionCtx} />
      )}

      {/* Lead Status Control */}
      {!isTerminal && (
        <div className="rounded-2xl border border-line bg-bone-raised/20 px-5 py-3 flex items-center justify-between">
          <span className="text-[12px] text-stone">Mark lead as:</span>
          <div className="flex items-center gap-2">
            <button
              disabled={markingAccepted}
              onClick={async () => {
                setMarkingAccepted(true)
                try {
                  await fetch(`/api/leads/${lead.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status_type: 'meeting_booked' }) })
                  await refreshLead()
                } finally { setMarkingAccepted(false) }
              }}
              className="rounded-lg bg-status-success/10 px-2.5 py-1 text-[11px] font-medium text-status-success hover:bg-status-success/20 transition-colors disabled:opacity-50"
            >{markingAccepted ? "..." : "Won"}</button>
            <button
              disabled={markingAccepted}
              onClick={async () => {
                setMarkingAccepted(true)
                try {
                  await fetch(`/api/leads/${lead.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status_type: 'not_interested' }) })
                  await refreshLead()
                } finally { setMarkingAccepted(false) }
              }}
              className="rounded-lg bg-status-danger/10 px-2.5 py-1 text-[11px] font-medium text-status-danger hover:bg-status-danger/20 transition-colors disabled:opacity-50"
            >{markingAccepted ? "..." : "Lost"}</button>
          </div>
        </div>
      )}

      {/* Score Breakdown */}
      {dimensions.length > 0 && (
        <details className="group rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
          <summary className="px-5 py-3 cursor-pointer flex items-center gap-2 select-none hover:bg-bone-raised/40 transition-colors">
            <Target className="size-4 text-cobalt" />
            <span className="text-sm font-medium text-ink">Score Breakdown</span>
            <span className="ml-auto text-stone group-open:hidden"><ChevronDown className="size-4" /></span>
            <span className="ml-auto text-stone hidden group-open:inline"><ChevronUp className="size-4" /></span>
          </summary>
          <div className="space-y-3 border-t border-line/40 p-5">
            <div>
              <p className="text-[12px] text-graphite">
                {scoreExplanation({
                  displayScore,
                  canonicalScore: lead.canonicalScore ?? null,
                  qualification,
                })}
              </p>
              {reasons.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {reasons.slice(0, 4).map((reason) => (
                    <li key={reason} className="text-[11px] text-ink">Strongest evidence: {reason}</li>
                  ))}
                </ul>
              )}
              {[...watchOut, ...missingInfo].length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {[...watchOut, ...missingInfo].slice(0, 4).map((gap) => (
                    <li key={gap} className="text-[11px] text-stone">Missing: {gap}</li>
                  ))}
                </ul>
              )}
            </div>
            <ScoreBreakdown
              dimensions={rawDimensions}
              calculation={scoreBreakdown?.calculation}
              decisionAdjustments={Array.isArray(scoreBreakdown?.decisionAdjustments) ? scoreBreakdown.decisionAdjustments.map(String) : []}
              canonicalScore={lead.canonicalScore ?? null}
              layout="grid"
            />
          </div>
        </details>
      )}

      {/* Decision Explainability — why this lead, why now */}
      {!isTerminal && lead.canonicalScore != null && (
        <DecisionExplainability
          title={leadScore.qualification ? `${leadScore.label} · ${leadScore.text}` : leadScore.text}
          positiveSignals={buildPositiveSignals(lead)}
          negativeSignals={buildNegativeSignals(lead)}
          recommendation={nextAction.reason}
          score={lead.canonicalScore}
          confidence={null}
          details={buildScoreDetails(lead)}
        />
      )}

      {/* Decision Trace — full lineage */}
      {!isTerminal && (
        <DecisionTraceView trace={buildDecisionTrace(lead.id, lead.company, lead.canonicalIntelligence as Record<string, unknown>)} />
      )}

      {/* Relationship State + Actions */}
      {!isTerminal && (
        <div className={cn('rounded-2xl border overflow-hidden', isTheirMove ? 'border-line/60 bg-bone-raised/30' : 'border-orange/20 bg-orange/[0.03]')}>
          <div className="px-5 py-3 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-2">
              {!isTheirMove && <span className="size-2 rounded-full bg-orange animate-pulse" />}
              {isTheirMove && <Clock className="size-3.5 text-stone" />}
              <span className="text-[13px] font-medium text-ink">{relationshipState.detail}</span>
            </div>
            {relationshipState.lastActionAt && <span className="text-[11px] text-stone">{timeAgo(relationshipState.lastActionAt)}</span>}
          </div>

          {generating && !draftText && (
            <div className="px-5 py-4 flex items-center gap-3">
              <div className="size-5 animate-spin rounded-full border-2 border-orange/30 border-t-orange" />
              <span className="text-[13px] text-ink">{generationStatus ?? 'Generating...'}</span>
            </div>
          )}

          {!generating && mode && draftText && (
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
                  {mode === 'connection' ? 'Connection note' : mode === 'dm' ? 'Your message' : mode === 'reply' ? 'Reply' : 'Follow-up'}
                </span>
                <button onClick={() => { setMode(null); setDraftText('') }} className="text-stone hover:text-ink"><XCircle className="size-4" /></button>
              </div>
              <Textarea value={sentText || draftText} onChange={(e) => setSentText(e.target.value)} rows={5} className="text-[13px]" placeholder="Edit before sending..." />
              {hasUnfilledValues(sentText || draftText) && (
                <p role="alert" className="flex items-start gap-1.5 text-[12px] text-status-danger">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {UNFILLED_VALUES_MESSAGE}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => logSend(sentText || draftText, mode)} disabled={sending || !(sentText || draftText).trim() || hasUnfilledValues(sentText || draftText)}>
                  <Send className="size-3" /> {sending ? 'Sending...' : 'Log as sent'}
                </Button>
                <Button size="sm" variant="ghost" disabled={hasUnfilledValues(sentText || draftText)} onClick={() => navigator.clipboard.writeText((sentText || draftText).trim())}>
                  <Copy className="size-3" /> Copy
                </Button>
              </div>
              {generationStatus && generationStatus.toLowerCase().includes('fail') && (
                <div className="flex items-center gap-2 rounded-lg bg-status-danger/5 px-3 py-2 text-[11px] text-status-danger">
                  <AlertTriangle className="size-3" /> {generationStatus}
                  <button onClick={() => generateDraft(mode)} className="ml-auto font-medium underline">Retry</button>
                </div>
              )}
              {dailyLimit > 0 && <p className="text-[10px] text-stone">{todaySends}/{dailyLimit} sends used today</p>}
            </div>
          )}

          {!generating && !(mode && draftText) && (
            <div className="px-5 py-4 space-y-3">
              {phase === 'connection_due' && !lead.connectionAcceptedAt && !leadLocked && (
                <div className="space-y-2">
                  {skipVerdict && (
                    <p className="text-[11px] text-ink-muted">
                      Verdict is skip. Outreach is not recommended; the actions below are a manual override.
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button size="sm" variant={skipVerdict ? 'outline' : undefined} onClick={() => generateDraft('connection')} disabled={loggingConnection} className="w-full justify-center sm:flex-1">
                      <Send className="size-3.5" /> {skipVerdict ? 'Connect anyway (override)' : 'Generate connection note'}
                    </Button>
                    <Button size="sm" variant="outline" className="w-full justify-center sm:w-auto" loading={loggingConnection} disabled={loggingConnection} onClick={() => void sendWithoutNote()}>
                      Send without note
                    </Button>
                  </div>
                </div>
              )}
              {actionError && (
                <p role="alert" className="flex items-start gap-1.5 text-[12px] text-status-danger">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {actionError}
                </p>
              )}
              {hasUnansweredInbound && (
                <Button size="sm" onClick={() => generateDraft('reply')} className="w-full justify-center">
                  <MessageSquare className="size-3.5" /> {lastInbound ? `Reply to "${lastInbound.sentText?.slice(0, 40)}..."` : 'Generate reply'}
                </Button>
              )}
              {(phase === 'connection_accepted' || phase === 'dm_due') && !messages.some((m) => m.type === 'dm' && m.sentText) && (
                <Button size="sm" onClick={() => generateDraft('dm')} className="w-full justify-center">
                  <MessageSquare className="size-3.5" /> Send first message
                </Button>
              )}
              {phase === 'connection_sent' && !lead.connectionAcceptedAt && (
                <p className="text-[12px] text-graphite">
                  Waiting for acceptance. The sent note and date stay in history. A follow-up is not due until they accept, you send the first message, and {followupDueIn} calendar days pass.
                </p>
              )}
              {phase === 'dm_sent' && !hasUnansweredInbound && lastConversationAt && (
                <p className="text-[12px] text-graphite">
                  Waiting for a reply. Follow-up is due {followupDueLabel} ({daysSinceConversation} of {followupDueIn} calendar days so far). Reason: no reply yet.
                </p>
              )}
              {phase === 'follow_up_due' && !hasUnansweredInbound && (
                <div className="space-y-2">
                  <p className="text-[12px] text-graphite">
                    Follow-up is due{followupDueLabel ? ` ${followupDueLabel}` : ''}. Reason: no reply after {followupDueIn} calendar days.
                  </p>
                  <Button size="sm" onClick={() => generateDraft('followup')} className="w-full justify-center">
                    <Send className="size-3.5" /> Send follow-up
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-line/30">
                {phase === 'connection_sent' && !lead.connectionAcceptedAt && (
                  leadLocked ? (
                    <p className="text-[11px] text-ink-muted">
                      Lead is closed ({lead.status}). The connection can&apos;t be marked accepted while it is locked.
                    </p>
                  ) : (
                    <Button size="sm" variant="outline" onClick={markAccepted} loading={markingAccepted}>
                      <Trophy className="size-3" /> Mark accepted
                    </Button>
                  )
                )}
                {phase === 'follow_up_due' && !hasUnansweredInbound && (
                  <Button size="sm" variant="outline" onClick={() => generateDraft('followup')}>
                    <Clock className="size-3" /> Follow up
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
      <details open className="group rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer flex items-center gap-2 select-none hover:bg-bone-raised/40 transition-colors">
          <MessageSquare className="size-4 text-cobalt" />
          <span className="text-sm font-medium text-ink">History</span>
          <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-stone">{timelineEntries.length}</span>
          <span className="ml-auto text-stone group-open:hidden"><ChevronDown className="size-4" /></span>
          <span className="ml-auto text-stone hidden group-open:inline"><ChevronUp className="size-4" /></span>
        </summary>
        <div className="border-t border-line/40">
          {/* The Won/Lost outcome is an event, not a message — without this row
              the History tab showed only the connection and no outcome
              (QA RQA-015). */}
          {outcomeEntry && (
            <div className="border-b border-line/30 bg-status-success/5 px-5 py-3">
              <div className="mb-1 flex items-center gap-2 text-[10px] text-stone">
                <span className="rounded bg-status-success/10 px-1 py-0.5 text-[9px] font-medium uppercase text-status-success">Outcome</span>
                <span className="capitalize">{outcomeEntry.type}</span>
                {outcomeEntry.sentAt && <span>· {timeAgo(outcomeEntry.sentAt)}</span>}
              </div>
              <p className="text-[13px] text-ink">{outcomeEntry.sentText}</p>
            </div>
          )}
          {timelineEntries.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-stone">No messages yet. Generate one above.</p>
          ) : (
            <div className="divide-y divide-line/30">
              {timelineEntries.map((msg) => (
                <div key={msg.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 text-[10px] text-stone mb-1">
                    <span className={cn('rounded px-1 py-0.5 text-[9px] font-medium uppercase',
                      msg.direction === 'inbound' ? 'bg-orange/10 text-orange' : 'bg-cobalt/10 text-cobalt'
                    )}>
                      {msg.direction === 'inbound' ? '← Received' : '→ Sent'}
                    </span>
                    <span className="capitalize">{msg.type === 'inbound_first' ? 'Received' : msg.type}</span>
                    {msg.sentAt && <span>· {timeAgo(msg.sentAt)}</span>}
                  </div>
                  <p className="text-[13px] text-ink whitespace-pre-wrap">{msg.sentText || (msg.type === 'connection' ? 'Connection request sent (no note).' : '(empty)')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Context */}
      {(lead.company || lead.contactTitle || lead.signalEvidence || lead.rawInput || (lead.tags?.length ?? 0) > 0) && (
        <details className="group rounded-2xl border border-line bg-bone-raised/20 overflow-hidden">
          <summary className="px-5 py-3 cursor-pointer flex items-center gap-2 select-none hover:bg-bone-raised/40 transition-colors">
            <Sparkles className="size-4 text-cobalt" />
            <span className="text-sm font-medium text-ink">Context</span>
            <span className="ml-auto text-stone group-open:hidden"><ChevronDown className="size-4" /></span>
            <span className="ml-auto text-stone hidden group-open:inline"><ChevronUp className="size-4" /></span>
          </summary>
          <div className="grid gap-3 p-5 border-t border-line/40 sm:grid-cols-2">
            <div className="rounded-lg border border-line/50 bg-bone p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Company</p>
              <p className="text-[13px] text-ink">{lead.company?.trim() && lead.company !== 'Unknown company' ? lead.company : 'Unknown'}</p>
            </div>
            <div className="rounded-lg border border-line/50 bg-bone p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Title</p>
              <p className="text-[13px] text-ink">{stripEmployerFromTitle(lead.contactTitle, lead.company) || 'Unknown'}</p>
            </div>
            {lead.signalEvidence && (
              <div className="rounded-lg border border-line/50 bg-bone p-3 sm:col-span-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Signal evidence</p>
                <p className="text-[12px] text-ink whitespace-pre-wrap">{lead.signalEvidence}</p>
              </div>
            )}
            {lead.rawInput?.trim() && (
              <details className="group/raw rounded-lg border border-line/50 bg-bone p-3 sm:col-span-2">
                <summary className="cursor-pointer select-none text-[11px] font-medium text-cobalt hover:underline">
                  View original pasted evidence
                </summary>
                <p className="mt-1 text-[10px] text-stone">Exactly what was pasted when this lead was analyzed.</p>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bone-raised/60 p-2 font-mono text-[11px] text-ink">{lead.rawInput}</pre>
              </details>
            )}
            {(lead.tags?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-line/50 bg-bone p-3 sm:col-span-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-stone mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {(lead.tags ?? []).map((tag) => (
                    <span key={tag} className="rounded-full bg-line/40 px-2 py-0.5 text-[10px] text-ink/70">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
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
        <Button size="sm" disabled={!text.trim() || saving} onClick={() => { setSaving(true); onSave(text).finally(() => { setSaving(false); setText(''); setOpen(false); }) }}>
          <Check className="size-3" /> Log reply
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText('') }}>Cancel</Button>
      </div>
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

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days > 0) return `${days}d ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs > 0) return `${hrs}h ago`
  return `${Math.floor(diff / 60_000)}m ago`
}

/** Stored score rows for a lead, normalized once. Each row's share of its own maximum (0-1). */
function leadDimensionShares(lead: LeadDetail): Map<string, { share: number; label: string; points: number | null; max: number | null }> {
  let ci = lead.canonicalIntelligence as Record<string, unknown> | string | null | undefined
  if (typeof ci === 'string') { try { ci = JSON.parse(ci) as Record<string, unknown> } catch { ci = null } }
  const breakdown = (ci && typeof ci === 'object' ? (ci as Record<string, unknown>).scoreBreakdown : null) as Record<string, unknown> | null
  const dims = normalizeScoreDimensions(Array.isArray(breakdown?.dimensions) ? breakdown.dimensions : [])
  const out = new Map<string, { share: number; label: string; points: number | null; max: number | null }>()
  for (const d of dims) {
    const share = d.points != null && d.max != null && d.max > 0 ? d.points / d.max : 0
    out.set(d.key, { share, label: d.label, points: d.points, max: d.max })
  }
  return out
}

function buildPositiveSignals(lead: LeadDetail): string[] {
  const signals: string[] = []
  const byKey = leadDimensionShares(lead)
  const display = getLeadDisplayScore(lead)

  if ((byKey.get('fit')?.share ?? 0) >= 0.7) signals.push('Strong capability fit — matches what you deliver')
  if ((byKey.get('buyerIntent')?.share ?? 0) >= 0.6) signals.push('Verified request for outside help')
  if ((byKey.get('timing')?.share ?? 0) >= 0.6) signals.push('Current buyer timing or recent activity')
  if ((byKey.get('commercialPotential')?.share ?? 0) >= 0.5) signals.push('High commercial potential')
  if ((byKey.get('authority')?.share ?? 0) >= 0.75) signals.push(`Decision maker${lead.contactTitle ? ` (${lead.contactTitle})` : ''}`)
  if (display.qualification === 'STRONG' || display.qualification === 'WORTH_PURSUING') signals.push(`Scored ${display.label.toLowerCase()}`)

  return signals
}

function buildNegativeSignals(lead: LeadDetail): string[] {
  const signals: string[] = []
  const byKey = leadDimensionShares(lead)
  const display = getLeadDisplayScore(lead)

  if ((byKey.get('buyerIntent')?.share ?? 1) < 0.3) signals.push('No verified buyer request')
  if ((byKey.get('timing')?.share ?? 1) < 0.4) signals.push('No current buyer timing')
  if ((byKey.get('access')?.share ?? 1) < 0.4) signals.push('May be hard to reach or engage')
  if ((byKey.get('evidenceQuality')?.share ?? 1) < 0.4) signals.push('Limited evidence — research before acting')
  if (display.qualification === 'SKIP' || display.qualification === 'LOW') signals.push(`Scored ${display.label.toLowerCase()}`)
  if (lead.status === 'new' && lead.createdAt) {
    const days = (Date.now() - new Date(lead.createdAt).getTime()) / 86_400_000
    if (days > 14) signals.push(`Aging lead (${Math.round(days)} days) — signal may be stale`)
  }

  return signals
}

function buildScoreDetails(lead: LeadDetail): { label: string; value: string }[] {
  const byKey = leadDimensionShares(lead)
  const details = [...byKey.values()].map((d) => ({
    label: d.label,
    value: d.points != null && d.max != null ? `${Math.round(d.points * 10) / 10}/${d.max}` : '—',
  }))
  const display = getLeadDisplayScore(lead)
  details.push({ label: 'Total', value: display.canonical != null ? `${display.canonical}/100 · ${display.text}` : display.text })
  return details
}
