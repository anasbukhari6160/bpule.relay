'use client'

/**
 * Admin Training Data (Phases 4, 23, 34).
 *
 * One row per unique opportunity: the raw source, what Relay decided, what
 * each candidate engine would decide, evidence, messages, outcome, human
 * feedback and existing labels — and a form to record a human label with
 * ranges rather than exact numbers. Rows are ordered by review priority
 * (active learning). Nothing here recomputes a production score.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { cn } from 'cn'
import { DashHeader, EmptyNote, Panel, Pill, StatTile, type Tone } from '@/components/dashboard/kit'
import { LABEL_QUICK_ENUMS, type TrainingRow, type TrainingQueueSummary } from '@/lib/admin/training-data'

interface Response {
  since: string
  summary: TrainingQueueSummary
  rows: TrainingRow[]
  ranges: Array<{ id: string; min: number; max: number; label: string }>
  enums: Record<string, readonly string[]>
  engines: { all: string[]; production: string; shadow: string[] }
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'unlabelled', label: 'Unlabelled' },
  { key: 'labelled', label: 'Labelled' },
  { key: 'disagree', label: 'Engines disagree' },
  { key: 'lowConfidence', label: 'Low confidence' },
  { key: 'highValue', label: 'High value' },
  { key: 'outcome', label: 'Has outcome' },
  { key: 'feedback', label: 'Has feedback' },
]

const QUAL_TONE: Record<string, Tone> = { STRONG: 'success', WORTH_PURSUING: 'success', MAYBE: 'orange', LOW: 'neutral', SKIP: 'neutral' }

export function TrainingDataCenter() {
  const [days, setDays] = useState(90)
  const [active, setActive] = useState<Set<string>>(new Set(['unlabelled']))
  const [mode, setMode] = useState<'quick' | 'detailed' | 'pairwise'>('quick')
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [pairIndex, setPairIndex] = useState(0)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ days: String(days) })
    for (const k of active) params.set(k, '1')
    try {
      const res = await fetch(`/api/admin/training-data?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setData(json as Response)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [days, active])

  useEffect(() => { void load() }, [load])
  const toggle = (k: string) => setActive((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const s = data?.summary

  return (
    <div className="space-y-5">
      <DashHeader
        eyebrow="Admin"
        title="Training data"
        subtitle={s ? `${s.uniqueOpportunities} unique opportunities from ${s.rawRecords} records · ${s.labelled} labelled · production engine ${data?.engines.production}` : 'Human ground truth for the scoring program'}
        actions={
          <div className="flex items-center gap-2">
            {[30, 90, 180, 365].map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={cn('rounded-full px-2.5 py-1 text-[11px]', d === days ? 'bg-ink text-bone' : 'border border-line text-graphite hover:bg-bone-raised')}>{d}d</button>
            ))}
            <button type="button" onClick={() => { setLoading(true); void load() }} className="rounded-full border border-line p-1.5 text-graphite hover:bg-bone-raised" aria-label="Refresh"><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /></button>
          </div>
        }
      />
      {error && <EmptyNote>{error}</EmptyNote>}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Raw records" value={s.rawRecords} />
          <StatTile label="Unique opportunities" value={s.uniqueOpportunities} />
          <StatTile label="Labelled" value={s.labelled} tone={s.labelled > 0 ? 'success' : 'neutral'} />
          <StatTile label="Unlabelled" value={s.unlabelled} />
          <StatTile label="With outcome" value={s.withOutcome} />
          <StatTile label="With feedback" value={s.withFeedback} />
        </div>
      )}
      {s && Object.keys(s.priorityReasons).length > 0 && (
        <Panel title="Review priority" subtitle="Why rows are at the top of the queue (active learning)">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(s.priorityReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Pill key={k} tone="neutral">{k} · {v}</Pill>)}
          </div>
        </Panel>
      )}
      <Panel title="Label mode" subtitle="Quick labels take under 15 seconds. Pairwise labels train a ranker directly.">
        <div className="flex flex-wrap gap-1.5">
          {([['quick', 'Quick label'], ['detailed', 'Detailed label'], ['pairwise', 'Pairwise ranking']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)} data-testid={`mode-${k}`} className={cn('rounded-full px-3 py-1 text-[11px]', mode === k ? 'bg-ink text-bone' : 'border border-line text-graphite hover:bg-bone-raised')}>{label}</button>
          ))}
        </div>
      </Panel>
      {mode === 'pairwise' && data && (
        <PairwisePanel rows={data.rows} index={pairIndex} onIndex={setPairIndex} onSaved={() => { void load() }} />
      )}
      {mode !== 'pairwise' && (
      <Panel title="Opportunities" subtitle="Ordered by review priority. Open a row to compare production with the candidate engines and record a label.">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => toggle(f.key)} className={cn('rounded-full px-2.5 py-1 text-[11px]', active.has(f.key) ? 'bg-cobalt text-bone' : 'border border-line text-graphite hover:bg-bone-raised')}>{f.label}</button>
          ))}
        </div>
        {!loading && data && data.rows.length === 0 && <EmptyNote>No opportunities match these filters.</EmptyNote>}
        <div className="divide-y divide-line/60">
          {(data?.rows ?? []).map((r) => (
            <Row key={r.opportunityKey} row={r} open={openKey === r.opportunityKey} onToggle={() => setOpenKey(openKey === r.opportunityKey ? null : r.opportunityKey)} ranges={data!.ranges} enums={data!.enums} mode={mode} onLabelled={() => { void load() }} />
          ))}
        </div>
      </Panel>
      )}
    </div>
  )
}

function Row({ row: r, open, onToggle, ranges, enums, mode, onLabelled }: { row: TrainingRow; open: boolean; onToggle: () => void; ranges: Response['ranges']; enums: Response['enums']; mode: 'quick' | 'detailed'; onLabelled: () => void }) {
  const p = r.production
  return (
    <div className="py-2" data-testid="training-row">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span className="w-10 shrink-0 text-center text-[15px] font-semibold text-ink">{p.display ?? '—'}<span className="text-[10px] font-normal text-stone">/10</span></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-ink">{r.company ?? r.contactName ?? r.opportunityKey.slice(0, 8)}</span>
            {p.qualification && <Pill tone={QUAL_TONE[p.qualification] ?? 'neutral'}>{p.qualification.replaceAll('_', ' ').toLowerCase()}</Pill>}
            {p.relationshipRole && <Pill tone="neutral">{p.relationshipRole.toLowerCase().replaceAll('_', ' ')}</Pill>}
            {p.buyerIntent && <Pill tone="neutral">intent {p.buyerIntent.toLowerCase()}</Pill>}
            {r.labels.length > 0 && <Pill tone="success">{r.labels.length} label{r.labels.length > 1 ? 's' : ''}</Pill>}
            {r.representations.length > 1 && <Pill tone="cobalt">{r.representations.length} records</Pill>}
            <Pill tone={r.priority.score >= 40 ? 'orange' : 'neutral'}>priority {r.priority.score}</Pill>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-graphite">
            {p.action ?? '—'} · {r.priority.reasons.join(', ') || 'routine'} · {r.candidates.map((c) => `${c.engine} ${c.score}`).join(' · ')} · {new Date(r.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span className="text-stone">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
      </button>
      {open && (
        <div className="mt-2 grid gap-3 rounded-lg bg-bone-raised/30 p-3 lg:grid-cols-2">
          <div className="space-y-3">
            <Section title="Raw source">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bone p-2 text-[11px] text-ink">{r.rawSource}</pre>
            </Section>
            <Section title="Production vs candidates">
              <table className="w-full text-[11px]">
                <thead><tr className="text-left text-stone"><th className="pr-2">Engine</th><th className="pr-2">Score</th><th className="pr-2">Band</th><th className="pr-2">Action</th><th className="pr-2">Account</th><th className="pr-2">Intent</th><th>Conf</th></tr></thead>
                <tbody>
                  <tr className="font-medium text-ink"><td className="pr-2">production (v3)</td><td className="pr-2">{p.score ?? '—'}</td><td className="pr-2">{p.qualification ?? '—'}</td><td className="pr-2">{p.action ?? '—'}</td><td className="pr-2">{p.commercialPotential ?? '—'}</td><td className="pr-2">{p.buyerIntent ?? '—'}</td><td>{p.confidence ?? '—'}</td></tr>
                  {r.candidates.map((c) => (
                    <tr key={c.engine} className="text-graphite"><td className="pr-2">{c.engine}</td><td className="pr-2">{c.score}</td><td className="pr-2">{c.qualification}</td><td className="pr-2">{c.action}</td><td className="pr-2">{c.accountValue}</td><td className="pr-2">{c.intentValue}</td><td>{c.confidence}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-stone">fit {p.fit ?? '—'} · authority {p.authority ?? '—'} · timing {p.timing ?? '—'} · access {p.access ?? '—'} · sender {p.currentSenderId?.slice(0, 8) ?? '—'} → best {p.bestSenderId?.slice(0, 8) ?? '—'} ({p.bestSenderMatch ?? '—'}%) · {p.versions?.scoringVersion ?? ''}{p.stale ? ' (old)' : ''}</p>
              {r.features && <p className="mt-1 text-[10px] text-stone">features: fit {r.features.fit.level} (needs {r.features.fit.needs.join(', ') || '—'}; stack {r.features.fit.stack.join(', ') || '—'}) · maturity {r.features.accountValue.companyMaturity} · build {r.features.accountValue.buildIntensity} · complexity {r.features.accountValue.technicalComplexity}</p>}
            </Section>
            <Section title="Evidence">
              {p.reasons.length > 0 && <ul className="list-disc pl-4 text-[11px] text-ink">{p.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {p.watchOut.length > 0 && <ul className="list-disc pl-4 text-[11px] text-orange">{p.watchOut.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {r.evidence.quotes.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-graphite">{r.evidence.quotes.map((q, i) => <li key={i}>“{q.quote}”{q.verbatim ? '' : ' (paraphrase)'}</li>)}</ul>}
              {r.evidence.rejected.length > 0 && <details className="mt-1 text-[11px]"><summary className="cursor-pointer text-stone">{r.evidence.rejected.length} rejected signals</summary><ul className="mt-1 space-y-0.5 text-graphite">{r.evidence.rejected.map((x, i) => <li key={i}><span className="text-stone">{x.signal}</span> “{x.sourceLine}” — {x.reason}</li>)}</ul></details>}
            </Section>
            <Section title="Messages & outcome">
              <p className="text-[11px] text-graphite">{r.messages.sent} sent · {r.messages.drafts} drafts · {r.messages.inbound} inbound · {r.outcome.connectionAccepted ? 'connection accepted · ' : ''}{r.outcome.replied ? 'replied · ' : ''}{r.outcome.meeting ? 'meeting · ' : ''}{r.outcome.won ? 'won · ' : ''}{r.outcome.lost ? 'lost · ' : ''}status {r.outcome.status ?? '—'}</p>
              {r.messages.firstSentPreview && <p className="mt-1 rounded bg-bone p-2 text-[11px] text-ink">{r.messages.firstSentPreview}</p>}
              {r.feedback.length > 0 && <ul className="mt-1 text-[11px] text-graphite">{r.feedback.map((f, i) => <li key={i}>{f.type}{f.note ? ` — ${f.note}` : ''}</li>)}</ul>}
              {r.primary.kind === 'lead' && <Link href={`/leads/${r.primary.id}`} className="text-[11px] text-cobalt hover:underline">Open lead</Link>}
            </Section>
          </div>
          <div className="space-y-3">
            {r.labels.length > 0 && (
              <Section title="Existing labels">
                <ul className="space-y-1 text-[11px] text-graphite">
                  {r.labels.map((l) => <li key={l.id}>{new Date(l.createdAt).toLocaleDateString()} · {l.labelVersion} · role {l.relationshipRole ?? '—'} · intent {l.buyerIntent ?? '—'} · range {l.expectedScoreMin ?? '—'}–{l.expectedScoreMax ?? '—'} · action {l.expectedAction ?? '—'} · fit {l.fit ?? '—'} · conf {l.labelerConfidence ?? '—'}{l.reason ? ` — ${l.reason}` : ''}</li>)}
                </ul>
              </Section>
            )}
            {mode === 'quick'
              ? <QuickLabelForm row={r} onSaved={onLabelled} />
              : <LabelForm row={r} ranges={ranges} enums={enums} onSaved={onLabelled} />}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[9px] uppercase tracking-wide text-stone">{title}</p>
      {children}
    </div>
  )
}

function LabelForm({ row, ranges, enums, onSaved }: { row: TrainingRow; ranges: Response['ranges']; enums: Response['enums']; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const fields = useMemo(() => [
    ['relationshipRole', 'Relationship role'], ['buyerIntent', 'Buyer intent'], ['commercialPotential', 'Commercial potential'], ['fit', 'Fit'],
    ['authority', 'Authority'], ['timing', 'Timing'], ['access', 'Access'], ['expectedAction', 'Expected action'], ['labelerConfidence', 'Your confidence'],
  ] as const, [])

  const submit = async () => {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/training-data/labels', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          opportunityKey: row.opportunityKey,
          leadId: row.primary.kind === 'lead' ? row.primary.id : null,
          capturedProspectId: row.primary.kind === 'prospect' ? row.primary.id : null,
          decisionRunId: row.production.decisionRunId,
          ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)),
          observed: { score: row.production.score, qualification: row.production.qualification, action: row.production.action, buyerIntent: row.production.buyerIntent, relationshipRole: row.production.relationshipRole, versions: row.production.versions, candidates: row.candidates.map((c) => ({ engine: c.engine, version: c.version, score: c.score })) },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setMsg('Label saved.'); setForm({}); onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  return (
    <Section title="Record a label (ranges, not exact scores)">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <label className="col-span-2 flex flex-col gap-0.5"><span className="text-stone">Expected score range</span>
          <select value={form.expectedRangeId ?? ''} onChange={(e) => set('expectedRangeId', e.target.value)} className="rounded border border-line bg-bone px-2 py-1 text-ink" data-testid="label-range">
            <option value="">—</option>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        {fields.map(([k, label]) => (
          <label key={k} className="flex flex-col gap-0.5"><span className="text-stone">{label}</span>
            <select value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="rounded border border-line bg-bone px-2 py-1 text-ink">
              <option value="">—</option>
              {(enums[k] ?? []).map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ').toLowerCase()}</option>)}
            </select>
          </label>
        ))}
        <label className="col-span-2 flex flex-col gap-0.5"><span className="text-stone">Best sender profile id (optional)</span>
          <input value={form.bestSenderProfileId ?? ''} onChange={(e) => set('bestSenderProfileId', e.target.value)} className="rounded border border-line bg-bone px-2 py-1 text-ink" placeholder="profile uuid" />
        </label>
        <label className="col-span-2 flex flex-col gap-0.5"><span className="text-stone">Reason / evidence</span>
          <textarea value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} rows={3} className="rounded border border-line bg-bone px-2 py-1 text-ink" placeholder="Which lines in the source justify this label?" />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-full bg-ink px-3 py-1 text-[11px] text-bone disabled:opacity-50" data-testid="label-submit">{saving ? 'Saving…' : 'Save label'}</button>
        {msg && <span className="text-[11px] text-graphite">{msg}</span>}
      </div>
    </Section>
  )
}

function observedPayload(row: TrainingRow) {
  return {
    score: row.production.score, qualification: row.production.qualification, action: row.production.action,
    buyerIntent: row.production.buyerIntent, relationshipRole: row.production.relationshipRole,
    versions: row.production.versions,
    candidates: row.candidates.map((c) => ({ engine: c.engine, version: c.version, score: c.score })),
  }
}

const selectCls = 'rounded border border-line bg-bone px-2 py-1 text-ink'

/** Quick label (Phase F): five glanceable answers, under 15 seconds per lead. */
function QuickLabelForm({ row, onSaved }: { row: TrainingRow; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/training-data/labels', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'quick',
          opportunityKey: row.opportunityKey,
          leadId: row.primary.kind === 'lead' ? row.primary.id : null,
          capturedProspectId: row.primary.kind === 'prospect' ? row.primary.id : null,
          decisionRunId: row.production.decisionRunId,
          ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)),
          observed: observedPayload(row),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setMsg('Saved — next one.'); setForm({}); onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  const opts = (list: readonly string[]) => list.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ').toLowerCase()}</option>)

  return (
    <Section title="Quick label (under 15 seconds)">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <label className="flex flex-col gap-0.5"><span className="text-stone">Prospect quality</span>
          <select value={form.prospectQuality ?? ''} onChange={(e) => set('prospectQuality', e.target.value)} className={selectCls} data-testid="quick-quality">
            <option value="">—</option>{opts(LABEL_QUICK_ENUMS.prospectQuality)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-stone">Likely opportunity</span>
          <select value={form.likelyOpportunity ?? ''} onChange={(e) => set('likelyOpportunity', e.target.value)} className={selectCls} data-testid="quick-opportunity">
            <option value="">—</option>{opts(LABEL_QUICK_ENUMS.likelyOpportunity)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-stone">Best action</span>
          <select value={form.quickAction ?? ''} onChange={(e) => set('quickAction', e.target.value)} className={selectCls} data-testid="quick-action">
            <option value="">—</option>{opts(LABEL_QUICK_ENUMS.quickAction)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-stone">Decision correct?</span>
          <select value={form.decisionCorrect ?? ''} onChange={(e) => set('decisionCorrect', e.target.value)} className={selectCls} data-testid="quick-decision">
            <option value="">—</option>{opts(LABEL_QUICK_ENUMS.decisionCorrect)}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-0.5"><span className="text-stone">Best sender profile id (optional)</span>
          <input value={form.bestSenderProfileId ?? ''} onChange={(e) => set('bestSenderProfileId', e.target.value)} className={selectCls} placeholder="profile uuid" />
        </label>
        <label className="col-span-2 flex flex-col gap-0.5"><span className="text-stone">Note (optional)</span>
          <textarea value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} rows={2} className={selectCls} placeholder="One line, only if it changes the call." />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-full bg-ink px-3 py-1 text-[11px] text-bone disabled:opacity-50" data-testid="quick-submit">{saving ? 'Saving…' : 'Save quick label'}</button>
        {msg && <span className="text-[11px] text-graphite">{msg}</span>}
      </div>
    </Section>
  )
}

/** Pairwise review: "which should BD work first?" — direct learning-to-rank supervision. */
function PairwisePanel({ rows, index, onIndex, onSaved }: { rows: TrainingRow[]; index: number; onIndex: (i: number) => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const a = rows[index]
  const b = rows[index + 1]

  const submit = async (winner: 'A' | 'B' | 'TIE') => {
    if (!a || !b) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/training-data/pairwise', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opportunityKeyA: a.opportunityKey, opportunityKeyB: b.opportunityKey, winner }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setMsg(`Saved ${winner}.`)
      onIndex(Math.min(index + 1, Math.max(0, rows.length - 2)))
      onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  if (!a || !b) return <EmptyNote>Need at least two opportunities to compare.</EmptyNote>

  const card = (row: TrainingRow, tag: string) => {
    const p = row.production
    return (
      <div className="rounded-lg bg-bone-raised/40 p-3">
        <div className="mb-1 flex items-center gap-2">
          <Pill tone="cobalt">{tag}</Pill>
          <span className="text-[13px] font-medium text-ink">{row.company ?? row.contactName ?? row.opportunityKey.slice(0, 8)}</span>
          <Pill tone={QUAL_TONE[p.qualification ?? ''] ?? 'neutral'}>{p.qualification?.replaceAll('_', ' ').toLowerCase()}</Pill>
          <span className="text-[11px] text-stone">{p.score ?? '—'}/100 · {p.action ?? '—'}</span>
        </div>
        <p className="line-clamp-4 whitespace-pre-wrap text-[11px] text-graphite">{row.rawSource}</p>
      </div>
    )
  }

  return (
    <Panel title={`Pairwise · ${index + 1} of ${Math.max(1, rows.length - 1)}`} subtitle="Which should BD work first? Pairwise beats invented scores.">
      <div className="grid gap-3 lg:grid-cols-2">
        {card(a, 'A')}
        {card(b, 'B')}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void submit('A')} className="rounded-full bg-ink px-3 py-1 text-[11px] text-bone disabled:opacity-50" data-testid="pairwise-a">Work A first</button>
        <button type="button" disabled={saving} onClick={() => void submit('B')} className="rounded-full bg-ink px-3 py-1 text-[11px] text-bone disabled:opacity-50" data-testid="pairwise-b">Work B first</button>
        <button type="button" disabled={saving} onClick={() => void submit('TIE')} className="rounded-full border border-line px-3 py-1 text-[11px] text-graphite hover:bg-bone-raised" data-testid="pairwise-tie">Tie / unsure</button>
        <button type="button" onClick={() => onIndex(Math.max(0, index - 1))} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-graphite hover:bg-bone-raised">Prev</button>
        <button type="button" onClick={() => onIndex(Math.min(index + 1, Math.max(0, rows.length - 2)))} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-graphite hover:bg-bone-raised">Next</button>
        {msg && <span className="text-[11px] text-graphite">{msg}</span>}
      </div>
    </Panel>
  )
}
