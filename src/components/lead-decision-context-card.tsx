'use client'

import { useState } from 'react'
import { cn } from 'cn'
import {
  Users, ArrowRight, Check, HelpCircle, MessageSquare,
  ChevronDown, ChevronUp, AlertTriangle, Send, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  qualification: string | null
  label: string | null
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
  const [expanded, setExpanded] = useState(false)
  const [helpLoading, setHelpLoading] = useState(false)
  const best = context.routing.rankings[0] ?? null
  const current = context.routing.rankings.find((r) => r.senderId === context.routing.currentSenderId) ?? null

  return (
    <div className="space-y-3">
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

      {/* Sender Routing Card */}
      <div className="rounded-xl border border-line bg-bone-raised/20">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-bone-raised/40 transition-colors rounded-xl"
        >
          <Users className="size-4 text-cobalt" />
          <span className="text-sm font-medium text-ink">Sender match</span>
          {best && (
            <span className="ml-auto text-[11px] text-graphite">
              Best: {best.name ?? 'Unknown'} ({best.profileMatch}%)
            </span>
          )}
          <span className="ml-1 text-stone">
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-line/40 px-4 py-3 space-y-2">
            {context.routing.rankings.slice(0, 5).map((r, i) => (
              <div
                key={r.senderId}
                className={cn(
                  'flex items-center gap-3 rounded-lg p-2 text-[12px]',
                  r.senderId === context.routing.bestSenderId ? 'bg-status-success/5' :
                  r.senderId === context.routing.currentSenderId ? 'bg-cobalt/5' : ''
                )}
              >
                <span className="w-5 text-center text-[10px] text-stone font-medium">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink truncate">{r.name ?? 'Unknown'}</span>
                    {r.senderId === context.routing.currentSenderId && (
                      <span className="rounded bg-cobalt/10 px-1 py-0.5 text-[8px] font-medium text-cobalt uppercase">
                        current
                      </span>
                    )}
                    {r.senderId === context.routing.bestSenderId && (
                      <span className="rounded bg-status-success/10 px-1 py-0.5 text-[8px] font-medium text-status-success uppercase">
                        best
                      </span>
                    )}
                  </div>
                  {r.reasons.length > 0 && (
                    <p className="text-[10px] text-graphite truncate">{r.reasons[0]}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className={cn(
                    'text-[12px] font-semibold',
                    r.profileMatch >= 70 ? 'text-status-success' :
                    r.profileMatch >= 40 ? 'text-orange' : 'text-stone'
                  )}>
                    {r.profileMatch}%
                  </span>
                  <p className="text-[9px] text-graphite">
                    {Math.round(r.confidence * 100)}% conf
                  </p>
                </div>
              </div>
            ))}
            <p className="text-[9px] text-stone pt-1">
              Routing v{context.routing.routingVersion} · {context.routing.rankings.length} senders
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
