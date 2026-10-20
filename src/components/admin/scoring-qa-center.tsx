'use client'

/**
 * Admin Scoring QA Center (Phases 29, 30, 31, 43).
 *
 * Inspect recent decisions under their stored versions: score, display,
 * qualification, buyer intent, role, dimensions, confidence, action, sender
 * match, rejected signals, human feedback and drift alerts.
 * Nothing here recomputes a score or calls a model.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { cn } from 'cn'
import { DashHeader, EmptyNote, Panel, Pill, StatTile, type Tone } from '@/components/dashboard/kit'
import { RejectedSignalInspector } from '@/components/scoring/rejected-signal-inspector'
import { ScoringFeedback } from '@/components/scoring/scoring-feedback'
import type { QaDecisionRow, ScoringMonitor } from '@/lib/admin/scoring-qa'

interface QaResponse { since: string; total: number; rows: QaDecisionRow[]; monitor: ScoringMonitor; feedback: Array<{ feedback_type: string; lead_id: string | null; captured_prospect_id: string | null; decision_run_id: string | null; created_at: string }> }

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'highScore', label: 'Strong / worth pursuing' },
  { key: 'lowScore', label: 'Low / skip' },
  { key: 'buyer', label: 'Buyers' },
  { key: 'seller', label: 'Service providers' },
  { key: 'recruiter', label: 'Recruiters' },
  { key: 'candidate', label: 'Candidates' },
  { key: 'lowConfidence', label: 'Low confidence' },
  { key: 'contradiction', label: 'Contradictions' },
  { key: 'routingMismatch', label: 'Sender mismatch' },
  { key: 'fallback', label: 'Fallback decisions' },
  { key: 'stale', label: 'Old versions' },
]

const QUAL_TONE: Record<string, Tone> = { STRONG: 'success', WORTH_PURSUING: 'success', MAYBE: 'orange', LOW: 'neutral', SKIP: 'neutral' }
const pct = (v: number) => `${Math.round(v * 100)}%`

export function ScoringQaCenter() {
  const [days, setDays] = useState(14)
  const [active, setActive] = useState<Set<string>>(new Set())
  const [data, setData] = useState<QaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ days: String(days) })
    for (const k of active) params.set(k, '1')
    try {
      const res = await fetch(`/api/admin/scoring-qa?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setData(json as QaResponse)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [days, active])

  useEffect(() => { void load() }, [load])
  const refresh = () => { setLoading(true); void load() }

  const toggle = (k: string) => setActive((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const m = data?.monitor
  const feedbackById = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of data?.feedback ?? []) {
      const id = f.lead_id ?? f.captured_prospect_id ?? f.decision_run_id
      if (id) map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [data])

  return (
    <div className="space-y-5">
      <DashHeader
        eyebrow="Admin"
        title="Scoring QA"
        subtitle={m ? `${m.window.count} decisions in the last ${days} days · ${m.scoringVersion}` : 'Recent decisions under their stored versions'}
        actions={
          <div className="flex items-center gap-2">
            {[7, 14, 30, 90].map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={cn('rounded-full px-2.5 py-1 text-[11px]', d === days ? 'bg-ink text-bone' : 'border border-line text-graphite hover:bg-bone-raised')}>{d}d</button>
            ))}
            <button type="button" onClick={refresh} className="rounded-full border border-line p-1.5 text-graphite hover:bg-bone-raised" aria-label="Refresh"><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /></button>
          </div>
        }
      />

      {error && <EmptyNote>{error}</EmptyNote>}

      {m && m.alerts.length > 0 && (
        <div className="space-y-1.5" data-testid="scoring-alerts">
          {m.alerts.map((a, i) => (
            <div key={i} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]', a.level === 'critical' ? 'border-status-danger/40 bg-status-danger/5 text-status-danger' : 'border-orange/40 bg-orange/5 text-orange')}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {m && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <StatTile label="Decisions" value={m.window.count} />
          <StatTile label="Unknown intent" value={pct(m.rates.unknownIntent)} tone={m.rates.unknownIntent > 0.6 ? 'warning' : 'neutral'} />
          <StatTile label="Contradictions" value={pct(m.rates.contradiction)} tone={m.rates.contradiction > 0.35 ? 'warning' : 'neutral'} />
          <StatTile label="Fallback" value={pct(m.rates.fallback)} tone={m.rates.fallback > 0.2 ? 'warning' : 'neutral'} />
          <StatTile label="Sender mismatch" value={pct(m.rates.routingMismatch)} />
          <StatTile label="Low confidence" value={pct(m.rates.lowConfidence)} />
          <StatTile label="Old versions" value={pct(m.rates.staleVersions)} tone={m.rates.staleVersions > 0.5 ? 'warning' : 'neutral'} />
        </div>
      )}

      {m && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Histogram title="Display score" data={m.displayHistogram} order={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']} suffix="/10" />
          <Histogram title="Qualification" data={m.qualificationHistogram} order={['STRONG', 'WORTH_PURSUING', 'MAYBE', 'LOW', 'SKIP']} />
          <Histogram title="Recommended action" data={m.actionHistogram} />
          <Histogram title="Buyer intent" data={m.intentHistogram} order={['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']} />
          <Histogram title="Relationship role" data={m.roleHistogram} order={['BUYER', 'BUILDER', 'SELLER', 'RECRUITER', 'CANDIDATE', 'UNKNOWN']} />
          <Histogram title="Human feedback" data={m.feedback} />
        </div>
      )}

      <Panel title="Decisions" subtitle="Filter, open a row, inspect why — and record feedback. Feedback never changes a score.">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => toggle(f.key)} className={cn('rounded-full px-2.5 py-1 text-[11px]', active.has(f.key) ? 'bg-cobalt text-bone' : 'border border-line text-graphite hover:bg-bone-raised')}>{f.label}</button>
          ))}
        </div>
        {!loading && data && data.rows.length === 0 && <EmptyNote>No decisions match these filters.</EmptyNote>}
        <div className="divide-y divide-line/60">
          {(data?.rows ?? []).map((r) => {
            const open = openId === r.id
            const mismatch = Boolean(r.bestSenderId && r.currentSenderId && r.bestSenderId !== r.currentSenderId)
            return (
              <div key={r.id} className="py-2" data-testid="qa-row">
                <button type="button" onClick={() => setOpenId(open ? null : r.id)} className="flex w-full items-center gap-3 text-left">
                  <span className="w-10 shrink-0 text-center text-[15px] font-semibold text-ink">{r.displayScore ?? '—'}<span className="text-[10px] font-normal text-stone">/10</span></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-ink">{r.company ?? r.contactName ?? r.id.slice(0, 8)}</span>
                      {r.qualification && <Pill tone={QUAL_TONE[r.qualification] ?? 'neutral'}>{r.qualification.replaceAll('_', ' ').toLowerCase()}</Pill>}
                      {r.relationshipRole && <Pill tone={r.relationshipRole === 'BUYER' || r.relationshipRole === 'BUYER_AND_SELLER' ? 'success' : r.relationshipRole === 'SELLER' || r.relationshipRole === 'RECRUITER' || r.relationshipRole === 'CANDIDATE' ? 'warning' : 'neutral'}>{r.relationshipRole.toLowerCase().replaceAll('_', ' ')}</Pill>}
                      {r.buyerIntent && <Pill tone="neutral">intent {r.buyerIntent.toLowerCase()}</Pill>}
                      {r.confidence && <Pill tone={r.confidence === 'LOW' ? 'warning' : 'neutral'}>conf {r.confidence.toLowerCase()}</Pill>}
                      {r.contradictions > 0 && <Pill tone="warning">{r.contradictions} contradiction{r.contradictions > 1 ? 's' : ''}</Pill>}
                      {r.fallbackUsed && <Pill tone="warning">fallback</Pill>}
                      {mismatch && <Pill tone="orange">sender mismatch</Pill>}
                      {r.stale && <Pill tone="neutral">old version</Pill>}
                      {feedbackById.get(r.id) ? <Pill tone="cobalt">{feedbackById.get(r.id)} feedback</Pill> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-graphite">
                      {r.action ?? '—'} · CP {r.commercialPotential ?? '—'} · fit {r.fit ?? '—'} · timing {r.timing ?? '—'} · access {r.access ?? '—'} · {r.kind} · {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-stone">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
                </button>
                {open && (
                  <div className="mt-2 space-y-3 rounded-lg bg-bone-raised/30 p-3">
                    <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                      <Field k="Canonical" v={r.canonicalScore === null ? '—' : `${r.canonicalScore}/100`} />
                      <Field k="Stored qualification" v={r.storedQualification ?? '—'} />
                      <Field k="Scoring version" v={r.versions?.scoringVersion ?? '—'} />
                      <Field k="Event source" v={r.eventSource ?? '—'} />
                      <Field k="Sender match" v={r.bestSenderMatch === null ? '—' : `${r.bestSenderMatch}%`} />
                      <Field k="Run" v={r.decisionRunId ?? '—'} />
                      <Field k="Source facts" v={r.versions?.sourceFactsVersion ?? '—'} />
                      <Field k="Routing" v={r.versions?.routingVersion ?? '—'} />
                    </div>
                    <RejectedSignalInspector signals={r.rejectedSignals} compact />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ScoringFeedback
                        leadId={r.kind === 'lead' ? r.id : null}
                        capturedProspectId={r.kind === 'prospect' ? r.id : null}
                        decisionRunId={r.decisionRunId}
                        observed={{ score: r.canonicalScore, displayScore: r.displayScore, qualification: r.qualification, action: r.action, buyerIntent: r.buyerIntent, relationshipRole: r.relationshipRole, versions: r.versions }}
                      />
                      {r.kind === 'lead' && <Link href={`/leads/${r.id}`} className="text-[11px] text-cobalt hover:underline">Open lead</Link>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-stone">{k}</p>
      <p className="truncate font-medium text-ink" title={v}>{v}</p>
    </div>
  )
}

function Histogram({ title, data, order, suffix = '' }: { title: string; data: Record<string, number>; order?: string[]; suffix?: string }) {
  const keys = order ? [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))] : Object.keys(data).sort((a, b) => data[b] - data[a])
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  const max = Math.max(1, ...Object.values(data))
  return (
    <Panel title={title} subtitle={total ? `${total} total` : undefined}>
      {keys.length === 0 ? <EmptyNote>No data yet.</EmptyNote> : (
        <ul className="space-y-1">
          {keys.map((k) => (
            <li key={k} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 shrink-0 truncate text-graphite" title={k}>{k.replaceAll('_', ' ').toLowerCase()}{suffix}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-bone-raised"><div className="h-full rounded-full bg-cobalt" style={{ width: `${(data[k] / max) * 100}%` }} /></div>
              <span className="w-14 shrink-0 text-right tabular-nums text-ink">{data[k]} <span className="text-stone">({total ? Math.round((data[k] / total) * 100) : 0}%)</span></span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
