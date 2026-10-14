'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useHotkeys } from 'react-hotkeys-hook'
import { motion } from 'motion/react'
import {
  ArrowLeft, CalendarDays, Check, Clock, Copy, ExternalLink, Flame,
  MessageSquare, Reply, Send, Trophy, X, Keyboard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from 'cn'
import { ScoreRing } from '@/components/score-ring'
import { signalById } from '@/lib/score/signals'
import { computeRelationshipState, type RelationshipState } from '@/lib/relay/relationship-state'
import { evaluateDmGate, evaluateFollowupGate } from '@/lib/relay/message-eligibility'
import { readSse } from '@/lib/sse/client'
import { notifyError, notifySuccess } from '@/lib/ui/notify'
import { trackEvent } from '@/lib/analytics/tracker'
import { timeAgo } from '@/lib/ui/time'
import type { LeadDetail } from '@/lib/store/types'
import type { ProofItem } from '@/lib/domain/types'
import type { DraftResult } from '@/lib/ai/draft'


interface Props {
  lead: LeadDetail
  profiles: { id: string; label: string | null; platform: string; headline: string | null }[]
  dailyLimit: number
  todaySends: number
}

type WorkspaceMode = 'dm' | 'connection' | 'reply' | 'followup' | 'upwork' | null


export function LeadWorkspaceSimple({ lead: initialLead, profiles, dailyLimit, todaySends }: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [leadVersion, setLeadVersion] = useState(0)

  // Profile
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(profiles[0]?.id ?? null)

  // Workspace
  const [mode, setMode] = useState<WorkspaceMode>(null)
  const [draftText, setDraftText] = useState('')
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)

  // Send
  const [sentText, setSentText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sentOk, setSentOk] = useState(false)

  // Panels

  const [capturedReplyText, setCapturedReplyText] = useState('')
  const [savingReply, setSavingReply] = useState(false)

  // Proof
  const [proofList, setProofList] = useState<ProofItem[]>([])

  // Now
  const [now, setNow] = useState(() => Date.now())

  // Refs
  const idempotencyKeyRef = useRef(crypto.randomUUID())

  // Refetch lead on version bump
  useEffect(() => {
    if (leadVersion === 0) return
    let active = true
    fetch(`/api/leads/${lead.id}`)
      .then((r) => r.json())
      .then((data) => { if (active && data.lead) setLead(data.lead) })
      .catch(() => {})
    return () => { active = false }
  }, [leadVersion, lead.id])

  // Tick now
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  // Derived
  const relationshipState = computeRelationshipState(lead, now)
  const signal = signalById(lead.signalType)
  // Canonical (V3) is the source of truth — it is what was shown during extraction.
  // Legacy (V2) is a fallback for old leads that pre-date canonical scoring.
  const canonical = lead.canonicalScore ?? null
  const hasCanonical = canonical != null
  const displayScore = hasCanonical ? Math.round(canonical / 10) : (lead.score ?? 0)
  const scoreLabel = hasCanonical
    ? (displayScore >= 7 ? 'Strong' : displayScore >= 5 ? 'Good' : displayScore >= 3 ? 'Fair' : 'Weak')
    : (displayScore >= 10 ? 'Strong' : displayScore >= 7 ? 'Good' : displayScore >= 4 ? 'Fair' : 'Weak')

  // Sender profile context
  const senderProfile = profiles.find((p) => p.id === lead.senderProfileId) ?? profiles[0] ?? null
  const profileMatchPct = lead.profileMatchScore ?? null
  const hasBetterProfile = lead.bestProfileId && lead.bestProfileId !== lead.senderProfileId && lead.bestProfileMatchScore && lead.bestProfileMatchScore > (lead.profileMatchScore ?? 0)
  const betterProfile = hasBetterProfile ? profiles.find((p) => p.id === lead.bestProfileId) ?? null : null

  const dmGate = evaluateDmGate({ messages: lead.messages, connectionAcceptedAt: lead.connectionAcceptedAt })
  const followupGate = evaluateFollowupGate({
    status: lead.status, messages: lead.messages, followupCount: lead.followupCount, now,
  })

  // Generate "why" sentence for better profile
  const betterProfileReason = hasBetterProfile && betterProfile
    ? (() => {
        const diff = Math.round((lead.bestProfileMatchScore ?? 0) - (lead.profileMatchScore ?? 0))
        return `${betterProfile.label ?? 'Another profile'} is a ${diff}% stronger match than ${senderProfile?.label ?? 'current'}`
      })()
    : null
  const lastInboundMessage = lead.messages.filter((m) => m.direction === 'inbound').at(0) ?? null


  const generateDraft = useCallback(async (type: string) => {
    setGenerating(true)
    setGenerationStatus(null)
    setDraftText('')
    setDraftResult(null)
    let buffer = ''
    try {
      let replyText: string | undefined
      let replyToMessageId: string | undefined
      if (type === 'reply') {
        replyText = capturedReplyText || lastInboundMessage?.sentText || undefined
        replyToMessageId = lastInboundMessage?.id || undefined
      }
      const res = await fetch(`/api/leads/${lead.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          profileId: selectedProfileId,
          proofId: proofList[0]?.id ?? null,
          replyText,
          replyToMessageId,
        }),
      })
      await readSse<{ type: string; message?: string; items?: ProofItem[]; chunk?: string; draft?: DraftResult; reason?: string }>(res, {
        onEvent: (ev) => {
          if (ev.type === 'status') setGenerationStatus(ev.message ?? '')
          else if (ev.type === 'proof') setProofList(ev.items ?? [])
          else if (ev.type === 'draft') { buffer += ev.chunk ?? ''; setDraftText(buffer) }
          else if (ev.type === 'done' && ev.draft) { setDraftResult(ev.draft); setDraftText(ev.draft.draftText) }
          else if (ev.type === 'needs_rescoring') { setGenerationStatus(ev.message ?? 'Lead needs rescoring'); notifyError(ev.message ?? 'This lead needs to be rescored before generating outreach.') }
          else if (ev.type === 'error') { setGenerationStatus(ev.message ?? ''); notifyError(ev.message ?? '') }
        },
        onError: (msg) => { setGenerationStatus(msg) },
      })
    } catch {
      setGenerationStatus('Generation failed. Retry.')
    } finally {
      setGenerating(false)
    }
  }, [lead.id, selectedProfileId, proofList, capturedReplyText, lastInboundMessage])

  const logSend = useCallback(async () => {
    const text = sentText.trim() || draftText.trim()
    if (!text) return
    setSending(true)
    setSendError(null)
    setSentOk(false)
    try {
      const res = await fetch(`/api/leads/${lead.id}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentText: text, type: mode, idempotencyKey: idempotencyKeyRef.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to log send.')
      setSentOk(true)
      setSentText('')
      setDraftText('')
      setDraftResult(null)
      setMode(null)
      setLeadVersion((v) => v + 1)
      // Instrument outbound sends
      const eventMap: Record<string, Parameters<typeof trackEvent>[0]['event']> = {
        connection: 'connection_sent',
        dm: 'dm_sent',
        followup: 'followup_completed',
        reply: 'reply_sent',
      }
      trackEvent({ event: eventMap[mode ?? ''] ?? 'dm_sent', leadId: lead.id })
      notifySuccess(`${mode === 'connection' ? 'Connection' : mode === 'dm' ? 'Message' : mode === 'followup' ? 'Follow-up' : 'Reply'} logged.`)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to log send.')
      notifyError('Failed to log send.')
    } finally {
      setSending(false)
    }
  }, [lead.id, sentText, draftText, mode])

  const saveReply = useCallback(async () => {
    if (!capturedReplyText.trim()) return
    setSavingReply(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: capturedReplyText.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save reply.')
      setCapturedReplyText('')
      // After capturing a reply, the next generate action must produce a
      // reply — not another first DM. Without this, the mode stays stale
      // and the user gets the same first message again.
      setMode('reply')
      setLeadVersion((v) => v + 1)
    } catch {
      notifyError('Failed to save reply.')
    } finally {
      setSavingReply(false)
    }
  }, [lead.id, capturedReplyText])

  const [markingAccepted, setMarkingAccepted] = useState(false)
  const markAccepted = useCallback(async () => {
    if (markingAccepted || lead.connectionAcceptedAt) return // prevent double-trigger
    setMarkingAccepted(true)
    try {
      await fetch(`/api/leads/${lead.id}/connection-accepted`, { method: 'POST' })
      setLeadVersion((v) => v + 1)
      notifySuccess('Connection accepted — send DM next.')
    } catch { notifyError('Failed to mark connection as accepted.') } finally {
      setMarkingAccepted(false)
    }
  }, [lead.id, lead.connectionAcceptedAt, markingAccepted])

  const [undoAction, setUndoAction] = useState<{ label: string; onUndo: () => void } | null>(null)

  const referToProfile = useCallback(async (targetProfileId: string) => {
    const previousStatus = lead.status
    try {
      const res = await fetch(`/api/leads/${lead.id}/refer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProfileId }),
      })
      if (!res.ok) throw new Error('Failed to refer.')
      notifySuccess('Lead referred.')
      setUndoAction({
        label: 'Lead referred',
        onUndo: async () => {
          try {
            await fetch(`/api/leads/${lead.id}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status_type: previousStatus === 'new' ? 'reviewed' : previousStatus }),
            })
            setLeadVersion((v) => v + 1)
            notifySuccess('Referral undone.')
          } catch {
            notifyError('Failed to undo.')
          }
        },
      })
      setLeadVersion((v) => v + 1)
    } catch {
      notifyError('Failed to refer lead.')
    }
  }, [lead.id, lead.status])

  const markNotInterested = useCallback(async () => {
    const previousStatus = lead.status
    try {
      const res = await fetch(`/api/leads/${lead.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_type: 'not_interested' }),
      })
      if (!res.ok) throw new Error('Failed to update.')
      notifySuccess('Marked not interested.')
      setUndoAction({
        label: 'Marked not interested',
        onUndo: async () => {
          try {
            await fetch(`/api/leads/${lead.id}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status_type: previousStatus }),
            })
            setLeadVersion((v) => v + 1)
            notifySuccess('Status restored.')
          } catch {
            notifyError('Failed to undo.')
          }
        },
      })
      setLeadVersion((v) => v + 1)
    } catch {
      notifyError('Failed to update status.')
    }
  }, [lead.id, lead.status])

  // No auto-generate on page load — drafts are only created on explicit user action.
  // Auto-generation was burning AI credits on every page visit.


  // Full message history: drafts, sent, received — clearly distinguished.
  // Hide drafts whose content was later sent — the sent message stands in
  // for them (BUG-05: one send = one timeline item, not a duplicate pair).
  const allMessages = lead.messages
    .sort((a, b) => (a.sentAt ?? a.createdAt).localeCompare(b.sentAt ?? b.createdAt))

  const sentTypes = new Set(
    allMessages.filter((m) => m.sentText && m.direction !== 'inbound').map((m) => m.type),
  )
  const visibleMessages = allMessages.filter(
    (m) => m.direction === 'inbound' || m.sentText || !sentTypes.has(m.type),
  )

  const sentMessages = visibleMessages.filter((m) => m.sentText)
  const draftMessages = visibleMessages.filter((m) => !m.sentText && m.draftText && m.direction !== 'inbound')

  const showFollowupOption = relationshipState.phase === 'dm_sent' && !followupGate.alreadyUsed
  const hasOutboundReply = sentMessages.some((m) => m.type === 'reply' && m.direction !== 'inbound')
  const showReplyOption = (relationshipState.phase === 'replied' || sentMessages.some((m) => m.direction === 'inbound')) && !hasOutboundReply
  const showDmOption = Boolean(dmGate.connectionAccepted || lead.connectionAcceptedAt)

  // Keyboard shortcuts for rapid processing
  useHotkeys('g', () => {
    if (relationshipState.phase === 'connection_due' && !lead.connectionAcceptedAt) {
      setMode('connection'); generateDraft('connection')
    } else if (showReplyOption) {
      setMode('reply'); generateDraft('reply')
    } else if (relationshipState.phase === 'follow_up_due') {
      setMode('followup'); generateDraft('followup')
    } else if (showDmOption && (relationshipState.phase === 'connection_accepted' || relationshipState.phase === 'dm_due')) {
      setMode('dm'); generateDraft('dm')
    }
  }, { preventDefault: true, useKey: true, enabled: relationshipState.kind === 'your_move' && !mode }, [relationshipState, mode, showDmOption, lead.connectionAcceptedAt, generateDraft])

  useHotkeys('s', () => {
    if (mode && (sentText || draftText).trim()) void logSend()
  }, { preventDefault: true, useKey: true, enabled: mode !== null && (sentText || draftText).trim().length > 0 && !sending }, [mode, sentText, draftText, sending, logSend])

  useHotkeys('escape', () => {
    if (mode) { setMode(null); setDraftText('') }
  }, { preventDefault: false, useKey: true }, [mode])

  return (
    <div className="space-y-3 mx-auto max-w-3xl sm:space-y-4">
      {/* Undo toast */}
      {undoAction && (
        <div className="flex items-center justify-between rounded-lg border border-orange/20 bg-orange/[00.03] px-4 py-2.5">
          <span className="text-[12px] text-ink">{undoAction.label}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { undoAction.onUndo(); setUndoAction(null) }}
              className="text-[12px] font-medium text-orange hover:text-orange-light"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => setUndoAction(null)}
              className="text-stone hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex items-center justify-between">
          <Link href="/leads" className="inline-flex items-center gap-1.5 text-[12px] text-graphite hover:text-ink transition-colors">
            <ArrowLeft className="size-3.5" /> Pipeline
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-0.5 text-[10px] text-stone">
              <Keyboard className="size-2.5" />
              <kbd className="font-mono">G</kbd> generate · <kbd className="font-mono">S</kbd> send
            </span>
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-[11px] text-graphite hover:text-ink transition-colors">
              Today
            </Link>
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-medium leading-tight text-ink sm:text-[22px] tracking-tight">{lead.company}</h1>
            {lead.contactName && (
              <p className="mt-0.5 text-[13px] text-graphite sm:text-[14px]">{lead.contactName}{lead.contactTitle ? ` · ${lead.contactTitle}` : ''}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
              {senderProfile && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-bone px-2 py-0.5">
                  <span className="size-1.5 rounded-full bg-orange" />
                  <span className="font-medium text-ink">{senderProfile.label ?? 'Unnamed'}</span>
                  {profileMatchPct != null && (
                    <span className="text-stone">{Math.round(profileMatchPct)}% match</span>
                  )}
                </span>
              )}
              {signal && (
                <span className="inline-flex items-center gap-1 rounded-md bg-orange/10 px-2 py-0.5 text-orange">
                  <Flame className="size-3" />{signal.short}
                </span>
              )}
              {lead.url && (
                <a href={lead.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-graphite hover:text-ink transition-colors">
                  LinkedIn <ExternalLink className="size-2.5" />
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1.5 shrink-0 rounded-lg border border-line/40 bg-bone-raised/30 px-3 py-2">
            <ScoreRing score={lead.score} canonicalScore={lead.canonicalScore} size={44} />
            <span className="text-[11px] font-medium text-ink">{scoreLabel}</span>
            {hasCanonical && (
              <span className="text-[10px] text-stone">{displayScore}/10</span>
            )}
          </div>
        </div>
      </motion.div>

      {/* Better profile recommendation — explains why */}
      {hasBetterProfile && betterProfile && betterProfileReason && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.25 }}
          className="rounded-lg border border-orange/20 bg-orange/[0.02] px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-ink">Better sender: {betterProfile.label ?? 'Unnamed'}</span>
                {lead.bestProfileMatchScore != null && profileMatchPct != null && (
                  <span className="text-[10px] font-mono text-stone">
                    {Math.round(lead.bestProfileMatchScore)}% vs {Math.round(profileMatchPct)}%
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-graphite">{betterProfileReason}.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => referToProfile(betterProfile.id)}
            >
              Refer
            </Button>
          </div>
        </motion.div>
      )}

      {/* Relationship state — YOUR MOVE / THEIR MOVE */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className={cn(
          'rounded-lg border p-4',
          relationshipState.kind === 'your_move' ? 'border-orange/30 bg-orange/[0.03]' :
          relationshipState.kind === 'their_move' ? 'border-line bg-bone-raised/40' :
          relationshipState.kind === 'won' ? 'border-status-success/20 bg-status-success/[0.03]' :
          'border-line bg-bone-raised/30'
        )}
      >
        <div className="flex items-center gap-2">
          {relationshipState.kind === 'your_move' && <span className="size-2 rounded-full bg-orange animate-pulse" />}
          {relationshipState.kind === 'their_move' && <Clock className="size-3.5 text-stone" />}
          {relationshipState.kind === 'won' && <Trophy className="size-3.5 text-status-success" />}
          <span className={cn(
            'text-[12px] font-medium uppercase tracking-[0.1em]',
            relationshipState.kind === 'your_move' ? 'text-orange' :
            relationshipState.kind === 'their_move' ? 'text-stone' :
            relationshipState.kind === 'won' ? 'text-status-success' : 'text-stone'
          )}>
            {relationshipState.kind === 'your_move' ? 'Your move' : relationshipState.kind === 'their_move' ? 'Their move' : relationshipState.title}
          </span>
        </div>
        <p className="mt-1.5 text-[14px] font-medium text-ink">{relationshipState.detail}</p>
        {relationshipState.lastClientMessage && (
          <div className="mt-3 rounded-md border border-line/60 bg-bone px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-stone">They said</p>
            <p className="mt-0.5 text-[13px] text-ink leading-relaxed line-clamp-3">
              &ldquo;{relationshipState.lastClientMessage.sentText}&rdquo;
            </p>
          </div>
        )}
        {relationshipState.kind === 'their_move' && relationshipState.lastActionLabel && (
          <p className="mt-2 text-[11px] text-stone">
            {relationshipState.lastActionLabel} {relationshipState.lastActionAt && timeAgo(relationshipState.lastActionAt, now)}
          </p>
        )}
      </motion.div>

      {/* Score breakdown — visual bars */}
      {(() => {
        // Only show breakdown when displaying canonical score (V3 dimensions match 0-100 scale).
        // Legacy 0-12 score has no per-dimension breakdown to display.
        if (hasCanonical) return null
        const ci = lead.canonicalIntelligence as Record<string, unknown> | null
        const breakdown = ci?.scoreBreakdown as Record<string, unknown> | null
        const dimensions = Array.isArray(breakdown?.dimensions) ? breakdown.dimensions as Array<Record<string, unknown>> : []
        const revenue = ci?.revenue as Record<string, unknown> | null
        const noMessageReason = revenue?.noMessageReason as string | null
        if (dimensions.length === 0) return null
        return (
          <div className="rounded-lg border border-line/60 bg-bone-raised/20 px-4 py-3">
            <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone mb-2">Score breakdown</h2>
            <div className="space-y-2">
              {dimensions.slice(0, 4).map((dim, i) => {
                const pct = Math.min(100, ((dim.contribution as number) / ((dim.weight as number) * 100)) * 100)
                return (
                  <motion.div
                    key={dim.key as string}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.2 }}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-graphite">{dim.label as string}</span>
                      <span className="text-[10px] font-medium text-stone">{Math.round(pct)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-line/40 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: i * 0.05 + 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                          'h-full rounded-full',
                          pct >= 70 ? 'bg-status-success' : pct >= 40 ? 'bg-orange' : 'bg-status-warning'
                        )}
                      />
                    </div>
                    {typeof dim.note === 'string' && <p className="mt-0.5 text-[11px] text-graphite truncate">{dim.note}</p>}
                  </motion.div>
                )
              })}
            </div>
            {noMessageReason && (
              <p className="mt-2 text-[10px] text-status-warning">{noMessageReason}</p>
            )}
          </div>
        )
      })()}

      {/* Conversation history — grouped by day */}
      {visibleMessages.length > 0 && (() => {
        const grouped = new Map<string, typeof visibleMessages>()
        for (const msg of visibleMessages) {
          const raw = msg.sentAt ?? msg.createdAt
          const dateKey = raw ? raw.slice(0, 10) : 'unknown'
          if (!grouped.has(dateKey)) grouped.set(dateKey, [])
          grouped.get(dateKey)!.push(msg)
        }
        const sortedEntries = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))

        return (
          <div className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[12px] font-medium text-stone uppercase tracking-wider">History</h2>
              <span className="text-[10px] text-stone">{visibleMessages.length} message{visibleMessages.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-4">
              {sortedEntries.map(([dateKey, msgs]) => (
                <div key={dateKey}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-line/40" />
                    <span className="text-[10px] text-stone px-2">
                      {dateKey === 'unknown' ? 'Earlier' : dateKey === new Date().toISOString().slice(0, 10) ? 'Today' : new Date(dateKey + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <div className="h-px flex-1 bg-line/40" />
                  </div>
                  <div className="space-y-1.5">
                    {msgs.map((msg, i) => {
                      const isDraft = !msg.sentText && msg.draftText && msg.direction !== 'inbound'
                      const isReceived = msg.direction === 'inbound'
                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.2 }}
                          className={cn(
                            'rounded-lg border p-3',
                            isReceived ? 'border-status-success/20 bg-status-success/[0.03]' :
                            isDraft ? 'border-orange/20 bg-orange/[0.02] border-dashed' :
                            'border-line bg-bone-raised/20',
                          )}
                        >
                          <div className="flex items-center gap-2 text-[10px] text-stone">
                            {isReceived && <span className="font-medium text-status-success">← Received</span>}
                            {isDraft && <span className="font-medium text-orange">✦ Draft</span>}
                            {!isReceived && !isDraft && <span>→ Sent</span>}
                            <span className="text-line">·</span>
                            <span className="capitalize">{msg.type}</span>
                            {msg.sentAt && <span className="text-stone/50">· {timeAgo(msg.sentAt, now)}</span>}
                            {msg.modelUsed && isDraft && <span className="text-stone/50">· AI</span>}
                          </div>
                          <p className={cn(
                            'mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap',
                            isDraft ? 'text-graphite italic' : 'text-ink',
                          )}>
                            {msg.sentText || msg.draftText}
                          </p>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* COMMAND STATION — all operations in one place */}
      <CommandStation
        lead={lead}
        relationshipState={relationshipState}
        showReplyOption={showReplyOption}
        showFollowupOption={showFollowupOption}
        showDmOption={showDmOption}
        dailyLimit={dailyLimit}
        todaySends={todaySends}
        generating={generating}
        mode={mode}
        setMode={setMode}
        generateDraft={generateDraft}
        draftText={draftText}
        setDraftText={setDraftText}
        sentText={sentText}
        setSentText={setSentText}
        sending={sending}
        logSend={logSend}
        sentOk={sentOk}
        sendError={sendError}
        generationStatus={generationStatus}
        setGenerationStatus={setGenerationStatus}
        markAccepted={markAccepted}
        markingAccepted={markingAccepted}
        markNotInterested={markNotInterested}
        onLeadUpdate={() => setLeadVersion((v) => v + 1)}
      />


    </div>
  )
}

// One surface for ALL lead operations. No panel hunting, no scrolling.

interface CommandStationProps {
  lead: LeadDetail
  relationshipState: RelationshipState
  showReplyOption: boolean
  showFollowupOption: boolean
  showDmOption: boolean
  dailyLimit: number
  todaySends: number
  generating: boolean
  mode: WorkspaceMode
  setMode: (m: WorkspaceMode) => void
  generateDraft: (type: string) => void
  draftText: string
  setDraftText: (t: string) => void
  sentText: string
  setSentText: (t: string) => void
  sending: boolean
  logSend: () => void
  sentOk: boolean
  sendError: string | null
  generationStatus: string | null
  setGenerationStatus: (s: string | null) => void
  markAccepted: () => void
  markingAccepted: boolean
  markNotInterested: () => void
  onLeadUpdate: () => void
}

function CommandStation({
  lead,
  relationshipState,
  showReplyOption,
  showFollowupOption,
  showDmOption,
  dailyLimit,
  todaySends,
  generating,
  mode,
  setMode,
  generateDraft,
  draftText,
  setDraftText,
  sentText,
  setSentText,
  sending,
  logSend,
  sentOk,
  sendError,
  generationStatus,
  setGenerationStatus,
  markAccepted,
  markingAccepted,
  markNotInterested,
  onLeadUpdate,
}: CommandStationProps) {
  const [quickLog, setQuickLog] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  // Quick-log options based on current phase
  const quickLogOptions: Array<{ value: string; label: string; needsText: boolean; icon: React.ReactNode }> = []
  const phase = relationshipState.phase

  if (phase === 'connection_due' || phase === 'connection_sent') {
    quickLogOptions.push({ value: 'connection_accepted', label: 'Connection accepted', needsText: false, icon: <Trophy className="size-3.5" /> })
  }
  quickLogOptions.push({ value: 'client_replied', label: 'They replied', needsText: true, icon: <MessageSquare className="size-3.5" /> })
  if (phase === 'connection_due' || phase === 'connection_sent' || phase === 'connection_accepted') {
    quickLogOptions.push({ value: 'connection', label: 'Sent connection', needsText: true, icon: <Send className="size-3.5" /> })
  }
  if (phase !== 'connection_due') {
    quickLogOptions.push({ value: 'dm', label: 'Sent message', needsText: true, icon: <MessageSquare className="size-3.5" /> })
  }
  if (phase === 'replied') {
    quickLogOptions.push({ value: 'reply', label: 'Sent reply', needsText: true, icon: <Reply className="size-3.5" /> })
  }
  if (phase === 'dm_sent' || phase === 'replied') {
    quickLogOptions.push({ value: 'followup', label: 'Followed up', needsText: true, icon: <Clock className="size-3.5" /> })
  }
  quickLogOptions.push({ value: 'meeting_booked', label: 'Meeting booked', needsText: false, icon: <CalendarDays className="size-3.5" /> })
  quickLogOptions.push({ value: 'interested', label: 'Interested', needsText: false, icon: <Flame className="size-3.5" /> })
  quickLogOptions.push({ value: 'not_interested', label: 'Not interested', needsText: false, icon: <X className="size-3.5" /> })

  async function handleQuickLog(value: string) {
    setLogSaving(true)
    setLogError(null)
    try {
      let res: Response
      if (value === 'connection_accepted') {
        res = await fetch(`/api/leads/${lead.id}/connection-accepted`, { method: 'POST' })
      } else if (value === 'client_replied') {
        res = await fetch(`/api/leads/${lead.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: logText.trim() }) })
      } else if (value === 'not_interested' || value === 'interested' || value === 'meeting_booked') {
        res = await fetch(`/api/leads/${lead.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status_type: value }) })
      } else {
        res = await fetch(`/api/leads/${lead.id}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: value, sentText: logText.trim(), direction: 'outbound' }) })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed.')
      setQuickLog(null)
      setLogText('')
      onLeadUpdate()
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed.')
    } finally {
      setLogSaving(false)
    }
  }

  const selectedQuickLog = quickLogOptions.find(o => o.value === quickLog)
  const isTheirMove = relationshipState.kind === 'their_move' && relationshipState.phase !== 'replied'
  const isTerminal = relationshipState.kind === 'won' || relationshipState.kind === 'lost'

  return (
    <div className="rounded-xl border border-line bg-bone overflow-hidden">
      {/* State header */}
      <div className={cn(
        'px-4 py-3 border-b',
        isTheirMove ? 'border-line/60 bg-bone-raised/40' : isTerminal ? 'border-line/60 bg-bone-raised/30' : 'border-orange/20 bg-orange/[0.03]'
      )}>
        <div className="flex items-center gap-2">
          {!isTerminal && !isTheirMove && <span className="size-2 rounded-full bg-orange animate-pulse" />}
          {isTheirMove && <Clock className="size-3.5 text-stone" />}
          {relationshipState.kind === 'won' && <Trophy className="size-3.5 text-status-success" />}
          <span className={cn(
            'text-[13px] font-medium',
            isTheirMove ? 'text-stone' : isTerminal ? (relationshipState.kind === 'won' ? 'text-status-success' : 'text-stone') : 'text-ink'
          )}>
            {isTheirMove ? 'Waiting on them' : isTerminal ? relationshipState.title : relationshipState.detail}
          </span>
        </div>
        {relationshipState.lastActionLabel && (isTheirMove || isTerminal) && (
          <p className="mt-1 text-[11px] text-stone">
            {relationshipState.lastActionLabel} {relationshipState.lastActionAt && timeAgo(relationshipState.lastActionAt, now)}
          </p>
        )}
      </div>

      {/* Terminal state */}
      {isTerminal && (
        <div className="px-4 py-3">
          <p className="text-[12px] text-graphite">{relationshipState.detail}</p>
        </div>
      )}

      {/* Active: Generation in progress */}
      {!isTerminal && generating && !draftText && (
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="size-5 animate-spin rounded-full border-2 border-orange/30 border-t-orange" />
          <span className="text-[13px] text-ink">{generationStatus ?? 'Generating...'}</span>
        </div>
      )}

      {/* Active: Draft workspace */}
      {!isTerminal && mode && draftText && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
              {mode === 'connection' ? 'Connection note' : mode === 'dm' ? 'Your message' : mode === 'reply' ? 'Reply' : 'Follow-up'}
            </span>
            <button type="button" onClick={() => { setMode(null); setDraftText('') }} className="text-stone hover:text-ink"><X className="size-3.5" /></button>
          </div>
          <Textarea
            value={sentText || draftText}
            onChange={(e) => setSentText(e.target.value)}
            rows={5}
            className="text-[13px]"
            placeholder="Edit before sending..."
          />
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="orange" size="sm" onClick={logSend} disabled={sending || !(sentText || draftText).trim() || todaySends >= dailyLimit} loading={sending} className="w-full justify-center sm:w-auto">
                <Send className="size-3" /> {todaySends >= dailyLimit ? 'Daily limit reached' : 'Log as sent'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText((sentText || draftText).trim()) }} className="w-full justify-center sm:w-auto">
                <Copy className="size-3" /> Copy
              </Button>
              {sentOk && <span className="text-[11px] text-status-success">✓ Sent</span>}
              {sendError && <span className="text-[11px] text-status-danger">{sendError}</span>}
            </div>
            {dailyLimit > 0 && (
              <p className="mt-2 text-[10px] text-stone">
                {todaySends >= dailyLimit ? (
                  <span className="text-status-danger">Daily send limit reached ({dailyLimit}/{dailyLimit})</span>
                ) : (
                  <span>{todaySends}/{dailyLimit} sends used today</span>
                )}
              </p>
            )}
        </div>
      )}

      {/* Active: Primary action + quick log (when no draft open) */}
      {!isTerminal && !generating && !(mode && draftText) && (
        <div className="px-4 py-3 space-y-3">
          {/* Primary generate action */}
          {phase === 'connection_due' && !lead.connectionAcceptedAt && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="orange" size="sm" onClick={() => { setMode('connection'); generateDraft('connection') }} className="w-full justify-center sm:flex-1">
                <Send className="size-3.5" /> Generate connection note
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center sm:w-auto"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/leads/${lead.id}/contact`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ type: 'connection', sentText: '', sendWithoutNote: true, direction: 'outbound' }),
                    })
                    if (!res.ok) throw new Error('Failed to send connection')
                    onLeadUpdate()
                  } catch (err) {
                    notifyError(err instanceof Error ? err.message : 'Failed to send')
                  }
                }}
              >
                Send without note
              </Button>
            </div>
          )}

          {showReplyOption && (
            <Button variant="orange" size="sm" onClick={() => { setMode('reply'); generateDraft('reply') }} className="w-full justify-center">
              <MessageSquare className="size-3.5" /> {relationshipState.lastClientMessage?.sentText ? `Reply to "${relationshipState.lastClientMessage.sentText.slice(0, 40)}..."` : 'Generate reply'}
            </Button>
          )}

          {phase === 'follow_up_due' && showFollowupOption && (
            <Button variant="orange" size="sm" onClick={() => { setMode('followup'); generateDraft('followup') }} className="w-full justify-center">
              <Send className="size-3.5" /> Send follow-up
            </Button>
          )}

          {(showDmOption && (phase === 'connection_accepted' || phase === 'dm_due')) && (
            <Button variant="orange" size="sm" onClick={() => { setMode('dm'); generateDraft('dm') }} className="w-full justify-center">
              <MessageSquare className="size-3.5" /> Send first message
            </Button>
          )}

          {phase === 'dm_sent' && showFollowupOption && (
            <Button variant="outline" size="sm" onClick={() => { setMode('followup'); generateDraft('followup') }} className="w-full justify-center">
              <Clock className="size-3.5" /> Send follow-up now
            </Button>
          )}

          {/* THEIR MOVE: Mark Accepted is primary for LinkedIn */}
          {isTheirMove && (
            <div className="space-y-2">
              {phase === 'connection_sent' && !lead.connectionAcceptedAt && (
                <Button variant="orange" size="sm" onClick={markAccepted} loading={markingAccepted} disabled={markingAccepted} className="w-full justify-center">
                  <Trophy className="size-3.5" /> {markingAccepted ? 'Updating...' : 'Connection accepted — send DM'}
                </Button>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" size="sm" onClick={() => setQuickLog('client_replied')} className="w-full justify-center sm:flex-1">
                  <MessageSquare className="size-3.5" /> They replied
                </Button>
                {phase !== 'connection_sent' && !lead.connectionAcceptedAt && (
                  <Button variant="outline" size="sm" onClick={markAccepted} loading={markingAccepted} disabled={markingAccepted} className="w-full justify-center sm:flex-1">
                    <Trophy className="size-3.5" /> Mark accepted
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Quick-log strip */}
          <div className="flex flex-wrap gap-1.5">
            {quickLogOptions.filter(o => {
              if (phase === 'connection_due') return ['connection_accepted', 'client_replied', 'connection'].includes(o.value)
              if (phase === 'connection_sent') return ['connection_accepted', 'client_replied'].includes(o.value)
              return true
            }).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setQuickLog(quickLog === opt.value ? null : opt.value); setLogError(null) }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  quickLog === opt.value
                    ? 'border-orange/40 bg-orange/5 text-ink'
                    : 'border-line text-graphite hover:border-orange/30 hover:text-ink',
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>

          {/* Quick-log text input + submit */}
          {quickLog && selectedQuickLog && (
            <div className="space-y-2 pt-1">
              {selectedQuickLog.needsText && (
                <Textarea
                  value={logText}
                  onChange={(e) => setLogText(e.target.value)}
                  rows={3}
                  className="text-[12px]"
                  placeholder={quickLog === 'client_replied' ? 'Paste their reply...' : 'Paste message text...'}
                  disabled={logSaving}
                />
              )}
              {logError && <p className="text-[11px] text-status-danger">{logError}</p>}
              <div className="flex gap-2">
                <Button
                  variant="orange"
                  size="sm"
                  onClick={() => handleQuickLog(quickLog)}
                  disabled={logSaving || (selectedQuickLog.needsText && !logText.trim())}
                  loading={logSaving}
                  className="w-full justify-center sm:w-auto"
                >
                  <Check className="size-3" /> Log this
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setQuickLog(null); setLogText('') }} className="w-full justify-center sm:w-auto">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Needs rescoring state */}
      {generationStatus && generationStatus.includes('rescor') && !generating && !isTerminal && (
        <div className="px-4 py-3 border-t border-status-warning/20 bg-status-warning/[0.03]">
          <p className="text-[12px] font-medium text-status-warning">Lead needs rescoring</p>
          <p className="mt-0.5 text-[11px] text-graphite">{generationStatus}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setGenerationStatus(null); setMode(null) }} className="w-full justify-center sm:w-auto">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Failure state */}
      {generationStatus && generationStatus.includes('failed') && !generating && !isTerminal && (
        <div className="px-4 py-3 border-t border-status-danger/20 bg-status-danger/[0.03]">
          <p className="text-[12px] font-medium text-status-danger">Generation failed</p>
          <p className="mt-0.5 text-[11px] text-graphite">{generationStatus}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="orange" size="sm" onClick={() => generateDraft(mode ?? 'connection')} className="w-full justify-center sm:w-auto">
              <Send className="size-3" /> Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setGenerationStatus(null); setMode(null) }} className="w-full justify-center sm:w-auto">
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
