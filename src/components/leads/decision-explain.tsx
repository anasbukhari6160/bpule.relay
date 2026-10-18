'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'
import { cn } from 'cn'

interface ExplainabilityProps {
  title: string
  positiveSignals: string[]
  negativeSignals: string[]
  recommendation: string
  score?: number | null
  confidence?: number | null
  details?: {
    label: string
    value: string
  }[]
}

/**
 * Compact "Why Relay chose this" explainer.
 * Shows positive signals, negative signals, and a recommendation in ~5 seconds read.
 * "View full scoring" expands to detailed diagnostics.
 */
export function DecisionExplainability({
  title,
  positiveSignals,
  negativeSignals,
  recommendation,
  score,
  confidence,
  details,
}: ExplainabilityProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-line bg-bone-raised overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bone"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="size-3.5 text-orange" />
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone">
            Why Relay chose this
          </span>
          {score != null && (
            <span className="rounded-full bg-orange/10 px-1.5 py-0.5 text-[9px] font-medium text-orange">
              {score}/100
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="size-3.5 text-stone" />
        ) : (
          <ChevronDown className="size-3.5 text-stone" />
        )}
      </button>

      {/* Summary — always visible */}
      <div className="border-t border-line/60 px-4 py-3">
        <p className="text-[13px] font-medium text-ink">{title}</p>

        {positiveSignals.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-status-success">Worth connecting because:</p>
            <ul className="mt-1 space-y-0.5">
              {positiveSignals.slice(0, 3).map((signal, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-graphite">
                  <span className="mt-0.5 text-status-success">+</span>
                  {signal}
                </li>
              ))}
            </ul>
          </div>
        )}

        {negativeSignals.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-status-warning">But:</p>
            <ul className="mt-1 space-y-0.5">
              {negativeSignals.slice(0, 2).map((signal, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-graphite">
                  <span className="mt-0.5 text-status-warning">−</span>
                  {signal}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 rounded-md border border-orange/20 bg-orange/[0.02] px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-stone">Recommended:</p>
          <p className="mt-0.5 text-[12px] text-ink">{recommendation}</p>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && details && details.length > 0 && (
        <div className="border-t border-line/60 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-stone">Full scoring details</p>
          <div className="mt-2 space-y-1">
            {details.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-graphite">{d.label}</span>
                <span className="font-mono text-ink">{d.value}</span>
              </div>
            ))}
          </div>
          {confidence != null && (
            <div className="mt-2 text-[10px] text-graphite">
              Confidence: {Math.round(confidence * 100)}%
            </div>
          )}
        </div>
      )}
    </div>
  )
}
