'use client'

import { cn } from 'cn'
import {
  normalizeScoreCalculation,
  normalizeScoreDimensions,
  type DisplayDimension,
} from '@/lib/scoring/display-score'

/**
 * Score explanation shared by Prospect Check and Lead Detail: the
 * aggregation trace ("Why 56/100?"), any decision guards, and every row with
 * the source text behind it. Rows only cite a quote when the text is
 * verbatim in the paste; anything else is labeled as a signal or inference.
 */
export function ScoreBreakdown({
  dimensions: rawDimensions,
  calculation: rawCalculation,
  decisionAdjustments = [],
  canonicalScore,
  layout = 'list',
}: {
  dimensions: unknown
  calculation?: unknown
  decisionAdjustments?: string[]
  canonicalScore: number | null
  layout?: 'list' | 'grid'
}) {
  const dimensions = normalizeScoreDimensions(rawDimensions)
  const calculation = normalizeScoreCalculation(rawCalculation)
  const modelRows = dimensions.filter((d) => d.group === 'model')
  const signalRows = dimensions.filter((d) => d.group === 'signals')
  const total = canonicalScore == null ? null : Math.round(canonicalScore)
  const noStoredEvidence = dimensions.length > 0 && dimensions.every((d) => d.evidence.length === 0)

  if (dimensions.length === 0 && !calculation) {
    return <p className="text-[11px] text-stone">Score details are unavailable for this analysis.</p>
  }

  return (
    <div className="space-y-4">
      <section aria-label="How the score was calculated">
        <p className="text-[12px] font-medium text-ink">Why {total == null ? 'this score' : `${total}/100`}?</p>
        {calculation ? (
          <ol className="mt-1.5 space-y-1">
            {calculation.steps.map((step, i) => (
              <li key={`${step.label}-${i}`} className="grid grid-cols-[1fr_auto] gap-x-3 text-[11px]">
                <span className="text-ink">{step.label}</span>
                <span className="font-mono text-ink">{step.value}</span>
                <span className="col-span-2 text-[10px] text-stone">{step.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-[11px] text-stone">
            This analysis was saved before the calculation trace was recorded. Re-analyze to see how the rows combine into the total.
          </p>
        )}
        {decisionAdjustments.length > 0 && (
          <div className="mt-2 rounded-md border border-line/60 bg-bone-raised/40 p-2">
            <p className="text-[11px] font-medium text-ink">Decision guards applied</p>
            <ul className="mt-0.5 space-y-0.5">
              {decisionAdjustments.map((a) => (
                <li key={a} className="text-[10px] text-graphite">{a}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {modelRows.length > 0 && (
        <RowGroup
          title="Opportunity model"
          subtitle={calculation?.modelSubtotal != null ? `Rows sum to ${calculation.modelSubtotal.toFixed(2)}/100 before adjustments.` : 'Weighted rows of the opportunity model.'}
          rows={modelRows}
          layout={layout}
        />
      )}
      {signalRows.length > 0 && (
        <RowGroup
          title="Signal check"
          subtitle={calculation?.signalCheckTotal != null && calculation.modelWeight != null
            ? `Deterministic text signals, ${calculation.signalCheckTotal}/100 — blended at ${Math.round((1 - calculation.modelWeight) * 100)}% into the total.`
            : 'Deterministic text signals. Not added on top of the total.'}
          rows={signalRows}
          layout={layout}
        />
      )}
      {noStoredEvidence && (
        <p className="text-[10px] text-stone">Source quotes were not stored for this analysis. Re-analyze to attach them.</p>
      )}
    </div>
  )
}

function RowGroup({
  title,
  subtitle,
  rows,
  layout,
}: {
  title: string
  subtitle: string
  rows: DisplayDimension[]
  layout: 'list' | 'grid'
}) {
  return (
    <section aria-label={title}>
      <p className="text-[11px] font-medium text-ink">{title}</p>
      <p className="text-[10px] text-stone">{subtitle}</p>
      <div className={cn('mt-2', layout === 'grid' ? 'grid gap-3 sm:grid-cols-2' : 'space-y-2.5')}>
        {rows.map((dim, i) => (
          <DimensionRow key={`${dim.key}-${dim.label}-${i}`} dim={dim} boxed={layout === 'grid'} />
        ))}
      </div>
    </section>
  )
}

function DimensionRow({ dim, boxed }: { dim: DisplayDimension; boxed: boolean }) {
  const pct = dim.points != null && dim.max ? Math.round(Math.max(0, Math.min(100, (dim.points / dim.max) * 100))) : 0
  const quotes = dim.evidence.filter((e) => e.kind === 'quote')
  const signals = dim.evidence.filter((e) => e.kind === 'signal')
  const inference = dim.evidence.find((e) => e.kind === 'inference')

  return (
    <div className={cn('space-y-1', boxed && 'rounded-lg border border-line/50 bg-bone p-3')}>
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-ink">
          {dim.label}
          {quotes.length === 0 && inference && (
            <span title={inference.text} className="rounded-sm bg-line/50 px-1 py-px text-[9px] uppercase tracking-wide text-stone">
              Inferred
            </span>
          )}
        </span>
        <span className="font-mono text-stone">
          {dim.unavailable || dim.points == null || dim.max == null
            ? 'Unavailable'
            : `${dim.points.toFixed(1)}/${dim.max.toFixed(0)}`}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line/50"
        role="meter"
        aria-label={`${dim.label} ${pct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn(
            'h-full rounded-full',
            pct >= 70 ? 'bg-status-success' : pct >= 40 ? 'bg-orange' : 'bg-status-warning',
          )}
          style={{ width: `${pct > 0 ? Math.max(pct, 4) : 0}%` }}
        />
      </div>
      {dim.note && <p className="text-[10px] text-stone">{dim.note}</p>}
      {quotes.map((q) => (
        <blockquote key={q.text} className="border-l-2 border-line pl-2 text-[10px] italic text-graphite">
          “{q.text}”
        </blockquote>
      ))}
      {quotes.length === 0 && inference && (
        <p className="text-[10px] text-stone">{inference.text}.</p>
      )}
      {signals.length > 0 && (
        <p className="text-[10px] text-stone">Detected: {signals.map((s) => s.text).join(' · ')}</p>
      )}
    </div>
  )
}
