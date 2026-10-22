'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, HelpCircle, Clock } from 'lucide-react'
import { cn } from 'cn'
import type { DecisionTrace as DecisionTraceType, DecisionTraceNode } from '@/lib/relay/decision-trace'

interface DecisionTraceViewProps {
  trace: DecisionTraceType
}

/**
 * Decision Trace — "Why did Relay do that?"
 * Shows stored reasoning lineage from source → score → action.
 * No fabricated evidence — only stored decision facts.
 */
export function DecisionTraceView({ trace }: DecisionTraceViewProps) {
  const [expanded, setExpanded] = useState(false)

  if (trace.trace.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-bone-raised/40 p-4 text-center">
        <HelpCircle className="mx-auto size-6 text-stone" />
        <p className="mt-2 text-[13px] text-graphite">No decision trace available for this lead.</p>
      </div>
    )
  }

  const visibleTrace = expanded ? trace.trace : trace.trace.slice(0, 3)

  return (
    <div className="rounded-lg border border-line bg-bone-raised overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bone"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="size-3.5 text-orange" />
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
            Decision Trace
          </span>
          <span className="rounded-full bg-bone px-1.5 py-0.5 text-[9px] text-stone">
            {trace.trace.length} steps
          </span>
        </div>
        {expanded ? <ChevronUp className="size-3.5 text-stone" /> : <ChevronDown className="size-3.5 text-stone" />}
      </button>

      <div className="border-t border-line/60 px-4 py-3">
        <div className="space-y-0">
          {visibleTrace.map((node, i) => (
            <div key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {/* Timeline line */}
              {i < visibleTrace.length - 1 && (
                <div className="absolute left-[7px] top-4 h-full w-px bg-line/40" />
              )}
              {/* Node icon */}
              <div className="relative z-10 mt-0.5">
                {node.step === 'GUARDRAILS_APPLIED' ? (
                  <AlertCircle className="size-3.5 text-status-warning" />
                ) : node.step === 'RESCORE' ? (
                  <Clock className="size-3.5 text-cobalt" />
                ) : (
                  <CheckCircle2 className="size-3.5 text-status-success" />
                )}
              </div>
              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-ink">{formatStepName(node.step)}</span>
                  {node.confidence != null && (
                    <span className="rounded bg-bone px-1 py-0.5 text-[9px] text-stone">
                      {Math.round(node.confidence)}% conf
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-graphite">{node.decision}</p>
                {node.evidence.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {node.evidence.slice(0, 2).map((e, j) => (
                      <p key={j} className="text-[10px] text-stone italic truncate">&quot;{e}&quot;</p>
                    ))}
                  </div>
                )}
                {node.version && (
                  <p className="mt-0.5 text-[9px] text-stone">{node.version}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {trace.trace.length > 3 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-2 text-[11px] text-orange hover:underline"
          >
            Show all {trace.trace.length} steps
          </button>
        )}
      </div>
    </div>
  )
}

function formatStepName(step: string): string {
  const names: Record<string, string> = {
    'SOURCE_INGESTED': 'Source Ingested',
    'FACTS_EXTRACTED': 'Facts Extracted',
    'EVIDENCE_VERIFIED': 'Evidence Verified',
    'EPISODES_BUILT': 'Episodes Built',
    'SCORE': 'Score Computed',
    'GUARDRAILS_APPLIED': 'Guardrails Applied',
    'ACTION': 'Action Recommended',
    'RESCORE': 'Re-score',
  }
  return names[step] ?? step
}
