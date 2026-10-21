'use client'

import { useState } from 'react'
import { cn } from 'cn'
import {
  MessageSquare,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { RejectedSignalInspector, type RejectedSignalView } from '@/components/scoring/rejected-signal-inspector'
import { ScoringFeedback } from '@/components/scoring/scoring-feedback'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

export interface SenderRanking {
  senderId: string
  name: string | null
  role: string | null
  platform: string | null
  profileMatch: number
  confidence: number
  reasons: string[]
  risks: string[]
  accessibleToRep: boolean
  holders: string[]
  holderRepIds: string[]
  primaryProof: string | null
}

export interface DecisionContext {
  leadId: string
  company: string | null
  contactName: string | null
  opportunityScore: number | null
  displayScore?: number | null
  qualification: string | null
  qualificationLabel?: string | null
  label: string | null
  buyerIntent?: string
  relationshipRole?: string
  commercialPotential?: string | null
  fit?: string
  access?: string | null
  buyerTiming?: string | null
  activityRecency?: string | null
  confidence?: string | null
  confidenceReasons?: string[]
  dimensions?: Array<{ key: string; label: string; contribution: number; raw: number; note: string }>
  rejectedSignals?: RejectedSignalView[]
  routingRecommendation?: { recommendation: string; reason: string | null; delta: number | null } | null
  messageEligible?: boolean
  versions?: { scoringVersion: string; modelVersion: string; analyzedAt: string } | null
  coldAction: string | null
  routing: {
    rankings: SenderRanking[]
    bestSenderId: string | null
    currentSenderId: string | null
    currentSenderRank: number | null
    currentSenderMatch: number | null
    bestSenderMatch: number | null
    mismatchDelta: number | null
    routingVersion: string
  }
  conversationOverride: boolean
  effectiveAction: string
  actionReason: string
  actionConfidence: 'high' | 'medium' | 'low'
  lastInboundIntent: string | null
  hasMismatch: boolean
  mismatchDelta: number | null
  scoringVersion: string
}

interface Props {
  context: DecisionContext
}

export function LeadDecisionContextCard({ context }: Props) {
  const [whyOpen, setWhyOpen] = useState(false)
  const facts: Array<[string, string | null | undefined]> = [
    ['Buyer intent', context.buyerIntent],
    ['Role', context.relationshipRole],
    ['Commercial potential', context.commercialPotential],
    ['Fit', context.fit],
    ['Buying timing', context.buyerTiming],
    ['Activity', context.activityRecency],
    ['Access', context.access],
    ['Confidence', context.confidence],
  ]

  return (
    <div className="space-y-3">
      {/* Sender match: the ranked senders and the mismatch actions. The
          opportunity block above never changes with the sender (QA RQA-009/010/011). */}
      {context.routing.rankings.length > 0 && <SenderMatchCard context={context} />}

      {/* Why this decision: the opportunity score explained from source facts.
          Opportunity ≠ sender match: nothing in this block changes when the sender changes. */}
      <div className="rounded-xl border border-line bg-bone-raised/20" data-testid="decision-why">
        <button
          type="button"
          onClick={() => setWhyOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-bone-raised/40"
          aria-expanded={whyOpen}
        >
          <span className="text-sm font-medium text-ink">Why this decision</span>
          <span className="ml-auto text-[11px] text-graphite">
            {context.displayScore != null ? `${context.displayScore}/10 · ` : ''}{context.qualificationLabel ?? context.label ?? '—'} · {context.effectiveAction.replaceAll('_', ' ').toLowerCase()}
          </span>
          <span className="ml-1 text-stone">{whyOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
        </button>
        {whyOpen && (
          <div className="space-y-3 border-t border-line/40 px-4 py-3">
            <p className="text-[12px] text-ink">{context.actionReason}</p>
            {context.messageEligible === false && (
              <p className="text-[11px] font-medium text-status-warning">No message recommended for this action.</p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <p className="text-[9px] uppercase tracking-wide text-stone">{k}</p>
                  <p className="text-[11px] font-medium text-ink">{String(v).replaceAll('_', ' ').toLowerCase()}</p>
                </div>
              ))}
            </div>
            {context.confidenceReasons && context.confidenceReasons.length > 0 && (
              <ul className="space-y-0.5">
                {context.confidenceReasons.slice(0, 4).map((r) => <li key={r} className="text-[11px] text-graphite">• {r}</li>)}
              </ul>
            )}
            {context.dimensions && context.dimensions.length > 0 && (
              <ul className="space-y-1">
                {context.dimensions.map((d) => (
                  <li key={d.key} className="flex items-center gap-2 text-[11px]">
                    <span className="w-32 shrink-0 truncate text-graphite">{d.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bone-raised"><div className="h-full rounded-full bg-cobalt" style={{ width: `${Math.max(0, Math.min(1, d.raw)) * 100}%` }} /></div>
                    <span className="w-8 shrink-0 text-right tabular-nums text-ink">+{Math.round(d.contribution)}</span>
                  </li>
                ))}
              </ul>
            )}
            {context.rejectedSignals && context.rejectedSignals.length > 0 && (
              <RejectedSignalInspector signals={context.rejectedSignals} compact />
            )}
            <ScoringFeedback
              leadId={context.leadId}
              observed={{ score: context.opportunityScore, displayScore: context.displayScore, qualification: context.qualification, action: context.effectiveAction, coldAction: context.coldAction, buyerIntent: context.buyerIntent, relationshipRole: context.relationshipRole, versions: context.versions }}
            />
            {context.versions && (
              <p className="text-[9px] text-stone">{context.versions.scoringVersion} · {context.versions.modelVersion} · analyzed {new Date(context.versions.analyzedAt).toLocaleString()}</p>
            )}
          </div>
        )}
      </div>

      {/* Conversation Override Indicator */}
      {context.conversationOverride && (
        <div className="rounded-xl border border-cobalt/20 bg-cobalt/5 p-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-3.5 text-cobalt" />
            <span className="text-[12px] font-medium text-cobalt">Live conversation state</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
              context.actionConfidence === 'high' ? 'bg-status-success/10 text-status-success' :
              context.actionConfidence === 'medium' ? 'bg-orange/10 text-orange' :
              'bg-stone-100 text-stone-500'
            )}>{context.actionConfidence}</span>
          </div>
          <p className="mt-1 text-[11px] text-cobalt/80">{context.actionReason}</p>
          <p className="mt-1 text-[10px] text-stone">
            Cold score: {context.opportunityScore ?? '—'}/100 ({context.coldAction ?? '—'}).{' '}
            Effective action: <span className="font-medium">{context.effectiveAction}</span>.
          </p>
        </div>
      )}

    </div>
  )
}

/**
 * Ranked senders + mismatch actions (QA RQA-009/010/011).
 *
 * The opportunity decision above is sender-independent; this block is the only
 * place the sender is chosen. When a stronger sender exists it offers:
 *   Keep Current Owner — dismiss the suggestion, change nothing
 *   Refer            — hand the lead to the stronger sender's holder
 *   Ask for Help     — open a help request to that holder
 */
function SenderMatchCard({ context }: { context: DecisionContext }) {
  const { routing } = context
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpReason, setHelpReason] = useState('')

  const best = routing.rankings.find((r) => r.senderId === routing.bestSenderId) ?? routing.rankings[0] ?? null
  const current = routing.rankings.find((r) => r.senderId === routing.currentSenderId) ?? null
  const recommendation = context.routingRecommendation?.recommendation ?? null
  const mismatch = !dismissed && (context.hasMismatch || recommendation === 'REFER' || recommendation === 'ASK_FOR_HELP' || recommendation === 'ASSIGN')

  const runAction = async (kind: 'refer' | 'help') => {
    if (!best || busy) return
    setBusy(kind)
    setStatus(null)
    try {
      if (kind === 'refer') {
        const res = await fetch(`/api/leads/${context.leadId}/refer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toProfileId: best.senderId, reason: `Stronger sender match (${best.profileMatch}% vs current ${current?.profileMatch ?? '—'}%)` }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not refer this lead.')
        setStatus(`Referred to ${best.name ?? 'the stronger sender'}.`)
      } else {
        const toRepId = best.holderRepIds[0] || ''
        if (!toRepId) throw new Error('No holder to ask for help. Refer the lead instead.')
        const res = await fetch(`/api/leads/${context.leadId}/help`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toRepId,
            helpType: 'SENDER_HANDOFF',
            reason: helpReason.trim() || `A stronger sender (${best.name ?? 'another profile'} at ${best.profileMatch}%) holds this lead.`,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not create the help request.')
        setStatus('Help requested. An admin or the holder will pick it up.')
        setHelpOpen(false)
        setHelpReason('')
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2" data-testid="sender-match-card">
      <div className="rounded-xl border border-line bg-bone-raised/20">
        <div className="flex items-center gap-2 px-4 py-3">
          <Users className="size-3.5 text-graphite" />
          <span className="text-sm font-medium text-ink">Sender match</span>
          {current && (
            <span className="ml-auto text-[11px] text-graphite">
              current {current.profileMatch}% vs best {best?.profileMatch ?? '—'}%
            </span>
          )}
        </div>
        <ul className="space-y-1.5 border-t border-line/40 px-4 py-3">
          {routing.rankings.slice(0, 4).map((r) => {
            const isBest = r.senderId === routing.bestSenderId
            const isCurrent = r.senderId === routing.currentSenderId
            return (
              <li key={r.senderId} className="flex items-center gap-2 text-[12px]">
                <span className="w-8 shrink-0 text-right tabular-nums font-medium text-ink">{r.profileMatch}%</span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.name ?? 'Unknown'}{r.role ? ` · ${r.role}` : ''}</span>
                {isCurrent && <span className="rounded-full bg-bone-raised px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-graphite">current</span>}
                {isBest && <span className="rounded-full bg-cobalt/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cobalt">best</span>}
                {!r.accessibleToRep && (
                  <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-orange">held by {r.holders.join(', ') || 'another rep'}</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {mismatch && best && (
        <div className="space-y-2 rounded-xl border border-orange/20 bg-orange/5 p-3" data-testid="sender-mismatch-banner">
          <p className="text-[12px] font-medium text-ink">
            Another sender is a stronger match: {best.name ?? 'another profile'} at {best.profileMatch}%
            {current ? ` vs your current ${current.profileMatch}%` : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setDismissed(true)}>
              Keep Current Owner
            </Button>
            <Button type="button" size="sm" onClick={() => void runAction('refer')} disabled={busy !== null}>
              {busy === 'refer' ? 'Referring…' : 'Refer'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setHelpOpen((v) => !v)} disabled={busy !== null}>
              Ask for Help
            </Button>
          </div>

          {helpOpen && (
            <div className="space-y-2 pt-1">
              <label className="block text-[11px] text-graphite">
                Ask {best.holders.join(', ') || 'the holder'}
                <input
                  className="mt-1 w-full rounded-md border border-line bg-bone-raised px-2 py-1.5 text-[12px] text-ink"
                  placeholder="What do you need?"
                  value={helpReason}
                  onChange={(e) => setHelpReason(e.target.value)}
                />
              </label>
              <Button type="button" size="sm" onClick={() => void runAction('help')} disabled={busy !== null}>
                {busy === 'help' ? 'Requesting…' : 'Request help'}
              </Button>
            </div>
          )}

          {status && <p role="status" className="text-[11px] text-graphite">{status}</p>}
        </div>
      )}
    </div>
  )
}
