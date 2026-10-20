'use client'

import { useState } from 'react'
import { cn } from 'cn'
import {
  ArrowRight, Check, HelpCircle, MessageSquare,
  ChevronDown, ChevronUp, AlertTriangle, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RejectedSignalInspector, type RejectedSignalView } from '@/components/scoring/rejected-signal-inspector'
import { ScoringFeedback } from '@/components/scoring/scoring-feedback'

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
  onRefer?: (senderId: string) => void
  onAskHelp?: (senderId: string, helpType: string) => void
  onKeepOwner?: () => void
}

export function LeadDecisionContextCard({ context, onRefer, onAskHelp, onKeepOwner }: Props) {
  const [helpLoading] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const best = context.routing.rankings[0] ?? null
  const current = context.routing.rankings.find((r) => r.senderId === context.routing.currentSenderId) ?? null
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

      {/* Routing recommendation that needs a human decision (ASSIGN / REFER / ASK_FOR_HELP). */}
      {context.routingRecommendation && context.routingRecommendation.recommendation !== 'KEEP' && !context.hasMismatch && (
        <div className="rounded-xl border border-orange/30 bg-orange/5 px-4 py-2.5 text-[11px] text-ink" data-testid="routing-recommendation">
          <span className="font-medium">Routing: {context.routingRecommendation.recommendation.replaceAll('_', ' ').toLowerCase()}.</span>{' '}
          {context.routingRecommendation.reason}
        </div>
      )}

      {/* Routing Mismatch Banner */}
      {context.hasMismatch && best && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-amber-800">
                Another sender is a stronger match
              </p>
              <p className="mt-1 text-[12px] text-amber-700">
                <span className="font-medium">{best.name ?? 'Unknown'}</span> is{' '}
                <span className="font-semibold">+{context.mismatchDelta}%</span> stronger for this lead.
                {current && (
                  <> Current sender: {current.name ?? 'Unknown'} ({current.profileMatch}%)</>
                )}
              </p>
              {best.reasons.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {best.reasons.slice(0, 3).map((reason) => (
                    <li key={reason} className="text-[11px] text-amber-700">• {reason}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-100"
                  onClick={() => onRefer?.(best.senderId)}
                >
                  <ArrowRight className="size-3" /> Refer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-100"
                  onClick={() => onAskHelp?.(best.senderId, 'BETTER_SENDER')}
                  disabled={helpLoading}
                >
                  {helpLoading ? <Loader2 className="size-3 animate-spin" /> : <HelpCircle className="size-3" />}
                  Ask for help
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-amber-600 hover:bg-amber-100"
                  onClick={() => onKeepOwner?.()}
                >
                  <Check className="size-3" /> Keep current owner
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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
