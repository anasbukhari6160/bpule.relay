'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Step } from '@/components/wizard-step'
import { readSse } from '@/lib/sse/client'
import { notifyError } from '@/lib/ui/notify'
import { cn } from 'cn'
import type { UpworkJob } from '@/lib/domain/types'
import { computeUpworkScore } from '@/lib/score/upwork-rubric'

interface FormState {
  title: string
  description: string
  budgetMin: string
  budgetMax: string
  hourlyRateMin: string
  hourlyRateMax: string
  proposalCount: string
  connectsCost: string
  requiredSkills: string
  urgencySignal: string
  rawInput: string
  tags: string[]
}

const INITIAL: FormState = {
  title: '',
  description: '',
  budgetMin: '',
  budgetMax: '',
  hourlyRateMin: '',
  hourlyRateMax: '',
  proposalCount: '',
  connectsCost: '',
  requiredSkills: '',
  urgencySignal: '',
  rawInput: '',
  tags: [],
}

function verdictCall(verdict: UpworkJob['verdict']): string {
  if (verdict === 'apply') return 'Worth the Connects. Draft and apply.'
  if (verdict === 'apply_if_connects') return 'Decent, but only if Connects are not scarce this week.'
  return 'Not worth the spend. Skip it.'
}

export default function NewUpworkJobPage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(INITIAL)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rawRef = useRef<HTMLTextAreaElement | null>(null)

  const score = useMemo(() => {
    return computeUpworkScore({
      budgetMin: form.budgetMin ? Number(form.budgetMin) : null,
      budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
      hourlyRateMin: form.hourlyRateMin ? Number(form.hourlyRateMin) : null,
      hourlyRateMax: form.hourlyRateMax ? Number(form.hourlyRateMax) : null,
      proposalCount: form.proposalCount ? Number(form.proposalCount) : null,
      requiredSkills: form.requiredSkills.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean),
      urgencySignal: form.urgencySignal.trim() || null,
      description: form.description,
    })
  }, [form])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function extract() {
    const raw = form.rawInput.trim()
    if (!raw || raw.length < 24) {
      const message = 'Paste a real job post (at least a few sentences).'
      setError(message)
      notifyError(message, 'Check the paste')
      rawRef.current?.focus()
      return
    }
    setExtracting(true)
    setError(null)
    setForm((f) => ({ ...f, tags: [] }))
    try {
      const res = await fetch('/api/upwork/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: raw }),
      })

      type ExtractEvent =
        | { type: 'status'; message: string }
        | { type: 'done'; extracted: Partial<FormState> & { tags: string[] }; demoMode: boolean }
        | { type: 'error'; message: string }

      await readSse<ExtractEvent>(res, {
        onEvent(event) {
          if (event.type === 'error') {
            setError(event.message)
            notifyError(event.message)
            return
          }
          if (event.type === 'done') {
            const ex = event.extracted
            setForm((f) => ({
              ...f,
              title: ex.title?.trim() || f.title,
              description: ex.description?.trim() || f.description,
              budgetMin: String(ex.budgetMin ?? f.budgetMin),
              budgetMax: String(ex.budgetMax ?? f.budgetMax),
              hourlyRateMin: String(ex.hourlyRateMin ?? f.hourlyRateMin),
              hourlyRateMax: String(ex.hourlyRateMax ?? f.hourlyRateMax),
              proposalCount: String(ex.proposalCount ?? f.proposalCount),
              connectsCost: String(ex.connectsCost ?? f.connectsCost),
              requiredSkills: Array.isArray(ex.requiredSkills) ? ex.requiredSkills.join(', ') : f.requiredSkills,
              urgencySignal: ex.urgencySignal?.trim() ?? f.urgencySignal,
              tags: ex.tags ?? [],
            }))
          }
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed.')
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    if (!form.title.trim() || !form.description.trim()) {
      const message = 'Title and description are required.'
      setError(message)
      notifyError(message, 'Check the job')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/upwork/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          budgetMin: form.budgetMin ? Number(form.budgetMin) : null,
          budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
          hourlyRateMin: form.hourlyRateMin ? Number(form.hourlyRateMin) : null,
          hourlyRateMax: form.hourlyRateMax ? Number(form.hourlyRateMax) : null,
          proposalCount: form.proposalCount ? Math.round(Number(form.proposalCount)) : null,
          connectsCost: form.connectsCost ? Math.round(Number(form.connectsCost)) : 0,
          requiredSkills: form.requiredSkills.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          urgencySignal: form.urgencySignal.trim() || null,
          rawInput: form.rawInput.trim() || null,
          tags: form.tags,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save job.')
      router.push(`/upwork/${data.job.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job.')
    } finally {
      setSaving(false)
    }
  }

  const connectsPreview = form.connectsCost ? Number(form.connectsCost) : 0
  const proposalsPreview = form.proposalCount ? Number(form.proposalCount) : 0

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="srf-console px-5 py-5 sm:px-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-stone">Intake / Upwork Opportunity</p>
        <h1 className="mt-2 text-[22px] font-medium text-ink">
          Qualify job posts before spending Connects.
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-graphite">
          Relay extracts budget and urgency, scores the job with rubric math, and keeps the apply decision explicit.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <UpworkSignal label="Current score" value={`${score.total}/10`} />
          <UpworkSignal label="Connects cost" value={String(connectsPreview)} />
          <UpworkSignal label="Observed proposals" value={proposalsPreview > 0 ? String(proposalsPreview) : 'Unknown'} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/upwork/new" className="inline-flex items-center gap-1.5 rounded border border-orange/30 bg-orange/10 px-3 py-1.5 text-[12px] font-medium text-orange">
             New job
           </Link>
           <Link href="/leads" className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-[12px] font-medium text-graphite hover:text-ink">
             Back to leads
           </Link>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-5">
      <Step n={1} title="Paste the job post" hint="Title, description, budget, and any skills listed.">
          <Textarea
            ref={rawRef}
            value={form.rawInput}
            onChange={(e) => set('rawInput', e.target.value)}
            placeholder="Paste the full Upwork job post..."
            rows={8}
            className="max-h-[28rem] overflow-y-auto font-mono text-[13px]"
          />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate">Cmd / Ctrl + Enter to extract</span>
          <Button variant="orange" size="lg" onClick={() => void extract()} loading={extracting}>
            {extracting ? 'Extracting' : 'Extract'}
          </Button>
        </div>
      </Step>

      <Step n={2} title="Check the fields" hint="Fix anything the extractor got wrong.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="title">Job title</Label>
            <Input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="description">Description summary</Label>
            <Textarea id="description" value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budgetMin">Fixed budget min (USD)</Label>
            <Input id="budgetMin" type="number" value={form.budgetMin} onChange={(e) => set('budgetMin', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budgetMax">Fixed budget max (USD)</Label>
            <Input id="budgetMax" type="number" value={form.budgetMax} onChange={(e) => set('budgetMax', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hourlyMin">Hourly rate min (USD)</Label>
            <Input id="hourlyMin" type="number" value={form.hourlyRateMin} onChange={(e) => set('hourlyRateMin', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hourlyMax">Hourly rate max (USD)</Label>
            <Input id="hourlyMax" type="number" value={form.hourlyRateMax} onChange={(e) => set('hourlyRateMax', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="proposals">Existing proposals</Label>
            <Input id="proposals" type="number" value={form.proposalCount} onChange={(e) => set('proposalCount', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="connects">Estimated Connects cost</Label>
            <Input id="connects" type="number" value={form.connectsCost} onChange={(e) => set('connectsCost', e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="skills">Required skills (comma separated)</Label>
            <Input id="skills" value={form.requiredSkills} onChange={(e) => set('requiredSkills', e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="urgency">Urgency / takeover signal</Label>
            <Input id="urgency" value={form.urgencySignal} onChange={(e) => set('urgencySignal', e.target.value)} placeholder='e.g. "previous developer left"' />
          </div>
        </div>
      </Step>

      <Step n={3} title="Score and save" hint="Pure arithmetic, never a model call." last>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-4xl font-medium text-ink">{score.total}</span>
              <span className="text-sm text-slate">/ 10</span>
            </div>
            <p className="mt-1 text-sm font-medium text-ink">{score.verdict.replace(/_/g, ' ')}</p>
            <p className="mt-0.5 max-w-xs text-sm leading-relaxed text-ink">{verdictCall(score.verdict)}</p>
            {score.total >= 3 && score.total < 6 ? (
              <p className="mt-1 text-xs text-status-warning">
                Only apply if you are not low on Connects this week.
              </p>
            ) : null}
          </div>
          <ul className="w-full space-y-2 sm:max-w-sm">
            {score.breakdown.map((item) => {
              const frac = item.max > 0 ? item.points / item.max : 0
              return (
                <li key={item.category + item.label} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate">{item.label}</span>
                    <span className="font-mono text-xs text-ink">{item.points}/{item.max}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-bone">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        frac >= 1 ? 'bg-status-success' : frac > 0 ? 'bg-orange' : 'bg-line',
                      )}
                      style={{ width: `${Math.max(frac * 100, frac > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="mt-6 flex items-center justify-end border-t border-line pt-5">
          <Button
            variant="orange"
            size="lg"
            onClick={() => void save()}
            disabled={saving || extracting || !form.title.trim()}
            loading={saving}
          >
            {saving ? 'Saving' : 'Save job'}
          </Button>
        </div>
      </Step>
      </div>
    </div>
  )
}

function UpworkSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">{label}</p>
      <p className="mt-1 text-[14px] font-medium text-ink">{value}</p>
    </div>
  )
}
