'use client'

/**
 * Admin Dataset Center — browse, filter, export, and manage the
 * intelligence dataset. Every analysis run is a permanent, versioned sample.
 * Events are append-only. Training requires explicit approval.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Filter } from 'lucide-react'
import { cn } from 'cn'
import { DashHeader, Panel, StatTile, EmptyNote, Pill } from '@/components/dashboard/kit'
import type { DatasetMetrics, ExportFormat, ExportMode, PrivacyMode } from '@/lib/dataset/types'

interface SampleRow {
  id: string
  platform: string
  version: number
  funnelStage: string
  qualification: string | null
  canonicalScore: number | null
  displayScore: number | null
  confidence: number | null
  recommendedAction: string | null
  finalOutcome: string | null
  labelStatus: string
  labelSource: string | null
  trainingApproved: boolean
  trainingEligible: boolean
  needsReview: boolean
  captureFailures: unknown[]
  createdAt: string
  messageStage: string | null
}

const PLATFORMS = [
  { key: '', label: 'All' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'upwork', label: 'Upwork' },
]

const LABEL_STATUSES = [
  { key: '', label: 'All labels' },
  { key: 'AI_ONLY', label: 'AI only' },
  { key: 'HUMAN_REVIEWED', label: 'Reviewed' },
  { key: 'HUMAN_CORRECTED', label: 'Corrected' },
  { key: 'OUTCOME_VERIFIED', label: 'Verified' },
]

export function DatasetCenter() {
  const [metrics, setMetrics] = useState<DatasetMetrics | null>(null)
  const [samples, setSamples] = useState<SampleRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [platform, setPlatform] = useState('')
  const [labelStatus, setLabelStatus] = useState('')
  const [needsReview, setNeedsReview] = useState(false)
  const [captureHealth, setCaptureHealth] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (platform) params.set('platform', platform)
      if (labelStatus) params.set('label_status', labelStatus)
      if (needsReview) params.set('needs_review', 'true')
      params.set('limit', '50')

      const [metricsRes, samplesRes] = await Promise.all([
        fetch('/api/dataset/metrics'),
        fetch(`/api/dataset/samples?${params}`),
      ])

      if (!metricsRes.ok) throw new Error('Failed to load metrics')
      if (!samplesRes.ok) throw new Error('Failed to load samples')

      setMetrics(await metricsRes.json())
      const data = await samplesRes.json()
      setSamples(data.samples ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [platform, labelStatus, needsReview])

  useEffect(() => { void load() }, [load])

  const [exportInfo, setExportInfo] = useState<string | null>(null)

  const exportData = useCallback(async (mode: ExportMode, format: ExportFormat, privacy: PrivacyMode) => {
    const params = new URLSearchParams({ mode, format, privacy })
    if (platform) params.set('platform', platform)
    params.set('confirm', 'true')
    setExportInfo(`Exporting ${mode}...`)
    const res = await fetch(`/api/dataset/export?${params}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setExportInfo(null)
      alert(err.error ?? 'Export failed')
      return
    }
    const count = res.headers.get('X-Sample-Count') ?? '?'
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relay_dataset_${mode.toLowerCase()}_${Date.now()}.${format === 'jsonl' ? 'jsonl' : format}`
    a.click()
    URL.revokeObjectURL(url)
    setExportInfo(`Downloaded ${count} samples as ${format}`)
    setTimeout(() => setExportInfo(null), 4000)
  }, [platform])

  const m = metrics

  return (
    <div className="space-y-5">
      <DashHeader
        eyebrow="Training Funnel"
        title="Intelligence Dataset"
        subtitle={`${total} versioned samples. Events are append-only. Training requires explicit approval. ${exportInfo ?? ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportData('FULL_AUDIT', 'jsonl', 'REDACTED')} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-bone">
              <Download className="h-3.5 w-3.5" /> Full Audit
            </button>
            <button onClick={() => exportData('TRAINING', 'jsonl', 'REDACTED')} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-bone">
              <Download className="h-3.5 w-3.5" /> Training
            </button>
            <button onClick={() => exportData('MESSAGE_PREFERENCE', 'jsonl', 'REDACTED')} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-bone">
              <Download className="h-3.5 w-3.5" /> Messages
            </button>
          </div>
        }
      />

      {/* Metrics */}
      {m && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile label="Total" value={String(m.totalSamples)} />
          <StatTile label="LinkedIn" value={String(m.linkedinSamples)} />
          <StatTile label="Upwork" value={String(m.upworkSamples)} />
          <StatTile label="Training Approved" value={String(m.trainingApproved)} tone="success" />
          <StatTile label="Needs Review" value={String(m.needsReview)} tone={m.needsReview > 0 ? 'orange' : 'neutral'} />
          <StatTile label="Capture Failures" value={String(m.captureFailures)} tone={m.captureFailures > 0 ? 'orange' : 'neutral'} />
          <StatTile label="Msg Pairs" value={String(m.messagePreferencePairs)} />
        </div>
      )}

      {/* Filters */}
      <Panel title="Samples" subtitle={`Showing ${samples.length} of ${total}`}
        action={<button onClick={load} className="text-[12px] text-graphite hover:text-ink">Refresh</button>}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-stone" />
            {PLATFORMS.map(p => (
              <button key={p.key} onClick={() => setPlatform(p.key)}
                className={cn('rounded-md px-2 py-1 text-[11px]',
                  platform === p.key ? 'bg-ink text-bone' : 'border border-line hover:bg-bone')}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={labelStatus} onChange={e => setLabelStatus(e.target.value)}
            className="rounded-md border border-line px-2 py-1 text-[11px]">
            {LABEL_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={needsReview} onChange={e => setNeedsReview(e.target.checked)} className="rounded border-line" />
            Needs review
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={captureHealth} onChange={e => setCaptureHealth(e.target.checked)} className="rounded border-line" />
            Has failures
          </label>
        </div>

        {loading ? (
          <EmptyNote>Loading samples…</EmptyNote>
        ) : error ? (
          <EmptyNote>{error}</EmptyNote>
        ) : samples.length === 0 ? (
          <EmptyNote>No matching samples. Analyze a lead to create one.</EmptyNote>
        ) : (
          <div className="divide-y divide-line">
            {samples.filter(s => !captureHealth || (Array.isArray(s.captureFailures) && s.captureFailures.length > 0)).map(s => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-ink">{s.platform} v{s.version}</span>
                    <Pill tone={labelTone(s.labelStatus, s.trainingApproved)}>{s.trainingApproved ? 'APPROVED' : s.labelStatus}</Pill>
                    {s.needsReview && <Pill tone="orange">Review</Pill>}
                    {s.trainingEligible && <Pill tone="success">Train</Pill>}
                    {Array.isArray(s.captureFailures) && s.captureFailures.length > 0 && (
                      <Pill tone="orange">{s.captureFailures.length} fail{s.captureFailures.length > 1 ? 's' : ''}</Pill>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-stone">
                    {s.funnelStage} · {s.qualification ?? 'unqualified'}
                    {s.canonicalScore !== null && s.canonicalScore !== undefined && ` · ${s.canonicalScore}/100`}
                    {s.displayScore != null && ` · ${s.displayScore}/10`}
                    {s.confidence != null && ` · ${(s.confidence * 100).toFixed(0)}%`}
                    {s.recommendedAction && ` · ${s.recommendedAction}`}
                    {s.finalOutcome && ` · ${s.finalOutcome}`}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-stone">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function labelTone(status?: string, approved?: boolean): 'success' | 'orange' | 'neutral' {
  if (approved) return 'success'
  if (status === 'HUMAN_REVIEWED' || status === 'OUTCOME_VERIFIED') return 'success'
  if (status === 'HUMAN_CORRECTED') return 'orange'
  return 'neutral'
}
