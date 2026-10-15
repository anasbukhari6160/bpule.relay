'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { EnrichmentProposal, ProposedChange, Decision } from '@/lib/profile-intelligence/enrichment'

const ACCEPTED = '.pdf,.docx,.doc,.txt,.md,.markdown,.csv,.xlsx,.xls'
const MAX_FILES = 20

type Phase = 'pick' | 'uploading' | 'extracting' | 'review' | 'applying' | 'done' | 'error'

interface RunState {
  id: string
  status: string
  proposal: (EnrichmentProposal & { failedSources?: Array<{ filename: string; error: string | null }>; alreadyImported?: Array<{ filename: string }> }) | null
  audit?: { upload?: { already_imported?: Array<{ filename: string }>; rejected?: Array<{ filename: string; reason: string }> } } | null
  error_message?: string | null
}

const SECTION_ORDER = [
  { key: 'add', title: 'Fields to add', hint: 'Empty on the profile today.' },
  { key: 'enrich', title: 'Fields to enrich', hint: 'Richer, compatible values.' },
  { key: 'conflicts', title: 'Conflicts requiring review', hint: 'Existing value is kept unless you approve the new one. Both are preserved with provenance.' },
  { key: 'preserved', title: 'Preserved — higher authority', hint: 'Existing data outranks this source. Kept unless you explicitly approve.' },
  { key: 'experience', title: 'Role history to append', hint: 'Chronology — old roles are never erased.' },
  { key: 'project', title: 'Projects to append / enrich', hint: 'Existing project fields are only filled when empty.' },
  { key: 'proof', title: 'Proof to append', hint: 'New proof starts unverified.' },
  { key: 'review', title: 'Reviews to append', hint: '' },
  { key: 'unknown', title: 'Unknown — not imported by default', hint: 'Low confidence, other people in the source, or unclear ownership.' },
  { key: 'duplicates', title: 'Duplicates ignored', hint: 'Already on the profile. Recorded as corroborating provenance only.' },
] as const

function sectionOf(c: ProposedChange): (typeof SECTION_ORDER)[number]['key'] {
  if (c.classification === 'DUPLICATE') return 'duplicates'
  if (c.classification === 'UNKNOWN') return 'unknown'
  if (c.classification === 'CONFLICT') return 'conflicts'
  if (c.preservedByAuthority) return 'preserved'
  if (c.kind === 'experience' || c.kind === 'project' || c.kind === 'proof' || c.kind === 'review') return c.kind
  return c.classification === 'UPDATE' ? 'enrich' : 'add'
}

const AUTH_LABEL: Record<string, string> = {
  human_verified: 'Human verified',
  trusted_source_fact: 'Trusted source',
  ai_extracted_fact: 'AI extracted',
  strong_inference: 'Strong inference',
  weak_inference: 'Weak inference',
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export function EnrichPanel({ profileId, onApplied, onClose }: { profileId: string; onApplied: () => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [files, setFiles] = useState<File[]>([])
  const [run, setRun] = useState<RunState | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const base = `/api/profile-intelligence/profiles/${profileId}/enrich`

  const startReview = useCallback((r: RunState) => {
    setRun(r)
    const d: Record<string, Decision> = {}
    for (const c of r.proposal?.changes ?? []) d[c.id] = c.defaultDecision
    setDecisions(d)
    setPhase(r.status === 'proposed' ? 'review' : 'error')
    if (r.status !== 'proposed') {
      const rejected = (r.audit?.upload?.rejected ?? []).map((f) => `${f.filename}: ${f.reason}`)
      setError([r.error_message ?? `Import ${r.status}.`, ...rejected].join(' · '))
    }
  }, [])

  const upload = useCallback(async () => {
    if (files.length === 0) return
    setPhase('uploading')
    setError(null)
    const form = new FormData()
    for (const f of files) form.append('files', f)
    try {
      const res = await fetch(base, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.')
      setRun(data.run)
      const total = data.sourceIds.length
      setProgress({ done: 0, total })
      setPhase('extracting')
      let done = 0
      for (let i = 0; i < 60; i++) {
        const step = await fetch(`${base}/${data.run.id}/process`, { method: 'POST' })
        const s = await step.json()
        if (!step.ok) throw new Error(s.error ?? 'Extraction failed.')
        if (s.done) { startReview(s.run); return }
        done = Math.min(total, done + 1)
        setProgress({ done, total })
      }
      throw new Error('Extraction is taking too long. Reopen this import from the history below.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
      setPhase('error')
    }
  }, [base, files, startReview])

  const apply = useCallback(async () => {
    if (!run) return
    setPhase('applying')
    setError(null)
    try {
      const res = await fetch(`${base}/${run.id}/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decisions }),
      })
      const data = await res.json()
      if (res.status === 409 && data.details?.run) {
        startReview(data.details.run)
        setError(data.error)
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Apply failed.')
      setResult(data)
      setPhase('done')
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed. No changes were made.')
      setPhase('review')
    }
  }, [base, decisions, onApplied, run, startReview])

  const choosePerson = useCallback(async (person: string | null) => {
    if (!run) return
    setError(null)
    try {
      const res = await fetch(`${base}/${run.id}/person`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not update the person.')
      startReview(data.run)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the person.')
    }
  }, [base, run, startReview])

  const discard = useCallback(async () => {
    if (run) await fetch(`${base}/${run.id}/discard`, { method: 'POST' }).catch(() => {})
    onClose()
  }, [base, onClose, run])

  const grouped = useMemo(() => {
    const g = new Map<string, ProposedChange[]>()
    for (const c of run?.proposal?.changes ?? []) {
      const k = sectionOf(c)
      g.set(k, [...(g.get(k) ?? []), c])
    }
    return g
  }, [run])

  const selectedCount = Object.entries(decisions).filter(([id, d]) => d === 'apply' && run?.proposal?.changes.find((c) => c.id === id)?.actionable).length
  const proposal = run?.proposal

  return (
    <section data-testid="enrich-panel" className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Add / Import Data</p>
          <p className="mt-1 text-[12px] text-[color:var(--console-mute)]">
            New sources are merged into this same profile. Nothing changes until you review and apply the diff.
          </p>
        </div>
        <button onClick={phase === 'review' ? discard : onClose} className="text-[11px] text-[color:var(--console-mute)] hover:text-orange">
          {phase === 'review' ? 'Discard' : 'Close'}
        </button>
      </div>

      {(phase === 'pick' || phase === 'uploading') && (
        <div className="mt-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); setFiles(Array.from(e.dataTransfer.files).slice(0, MAX_FILES)) }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-orange bg-orange/5' : 'border-orange/20 hover:border-orange/40'}`}
          >
            <input ref={inputRef} type="file" multiple accept={ACCEPTED} className="hidden" data-testid="enrich-file-input"
              onChange={(e) => e.target.files && setFiles(Array.from(e.target.files).slice(0, MAX_FILES))} />
            <p className="text-[13px] text-[color:var(--console-text)]">Select sources for this profile</p>
            <p className="mt-1 text-[11px] text-[color:var(--console-mute)]">PDF, DOCX, TXT, Markdown, CSV, XLSX · up to {MAX_FILES} files</p>
            {files.length > 0 && <p className="mt-2 text-[12px] font-medium text-orange">{files.length} file{files.length > 1 ? 's' : ''} selected</p>}
          </div>
          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <ul className="text-[11px] text-[color:var(--console-mute)]">
                {files.map((f) => <li key={f.name}>{f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)</li>)}
              </ul>
              <button onClick={upload} disabled={phase === 'uploading'}
                className="rounded bg-orange px-4 py-2 text-[12px] font-medium text-white hover:bg-orange/90 disabled:opacity-50">
                {phase === 'uploading' ? 'Uploading…' : 'Upload & extract'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'extracting' && (
        <p className="mt-4 text-[12px] text-[color:var(--console-text)]">
          Extracting… {progress.total > 0 ? `${progress.done} of ${progress.total} sources` : 'checking sources'}
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>}

      {(phase === 'review' || phase === 'applying') && proposal && (
        <div className="mt-4 space-y-4">
          <div data-testid="diff-summary" className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            {[
              ['To add', proposal.summary.fieldsToAdd],
              ['To enrich', proposal.summary.fieldsToEnrich],
              ['Conflicts', proposal.summary.conflictsRequiringReview],
              ['Preserved', proposal.summary.preservedByAuthority],
              ['Projects', proposal.summary.projectsToAppend],
              ['Proof', proposal.summary.proofsToAppend],
              ['Reviews', proposal.summary.reviewsToAppend],
              ['Duplicates', proposal.summary.duplicatesIgnored],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded border border-orange/10 px-2 py-1.5">
                <span className="text-[color:var(--console-mute)]">{label}</span>
                <span className="float-right font-medium text-[color:var(--console-text)]">{n as number}</span>
              </div>
            ))}
          </div>

          {(proposal.identity.otherPeople.length > 0 || proposal.identity.selectedPerson) && (
            <div data-testid="person-picker" className="rounded border border-orange/20 px-3 py-2 text-[11px]">
              <p className="text-[color:var(--console-text)]">
                {proposal.identity.selectedPerson
                  ? <>Importing data for <span className="font-medium">{proposal.identity.selectedPerson}</span> only.</>
                  : proposal.identity.matchedPeople.length > 0
                    ? <>Matched <span className="font-medium">{proposal.identity.matchedPeople.join(', ')}</span>. The source also mentions other people.</>
                    : 'This source describes several people. Which one is this profile?'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...new Set([...proposal.identity.matchedPeople, ...proposal.identity.otherPeople])].filter(Boolean).map((name) => (
                  <button key={name} onClick={() => choosePerson(name)} disabled={phase === 'applying'}
                    className={`rounded px-2 py-0.5 ${proposal.identity.selectedPerson === name ? 'bg-orange text-white' : 'border border-orange/30 text-orange hover:bg-orange/5'}`}>
                    {name}
                  </button>
                ))}
                {proposal.identity.selectedPerson && (
                  <button onClick={() => choosePerson(null)} className="px-2 py-0.5 text-[color:var(--console-mute)] hover:text-orange">Auto-match</button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-[color:var(--console-mute)]">Only the chosen person&apos;s facts, projects, proof and reviews are imported. Everyone else is ignored.</p>
            </div>
          )}

          {[...proposal.identity.warnings,
            ...(run?.audit?.upload?.already_imported ?? []).map((f) => `${f.filename}: already imported into this profile — skipped (no duplicate source).`),
            ...(run?.audit?.upload?.rejected ?? []).map((f) => `${f.filename}: ${f.reason}`),
            ...(proposal.failedSources ?? []).map((f) => `${f.filename}: extraction failed — ${f.error ?? 'unknown error'}`),
          ].map((w) => <p key={w} className="rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">{w}</p>)}

          {SECTION_ORDER.map((sec) => {
            const items = grouped.get(sec.key) ?? []
            if (items.length === 0) return null
            const collapsed = sec.key === 'duplicates'
            return (
              <details key={sec.key} open={!collapsed} data-testid={`diff-section-${sec.key}`} className="rounded border border-orange/10">
                <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-[color:var(--console-text)]">
                  {sec.title} <span className="text-[color:var(--console-mute)]">({items.length})</span>
                  {sec.hint && <span className="ml-2 font-normal text-[11px] text-[color:var(--console-mute)]">{sec.hint}</span>}
                </summary>
                <ul className="divide-y divide-orange/5">
                  {items.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 px-3 py-2" data-testid={`change-${c.field}`}>
                      <input type="checkbox" className="mt-0.5" aria-label={`Apply ${c.label}`}
                        disabled={!c.actionable || phase === 'applying'}
                        checked={decisions[c.id] === 'apply' && c.actionable}
                        onChange={(e) => setDecisions((d) => ({ ...d, [c.id]: e.target.checked ? 'apply' : 'skip' }))} />
                      <div className="min-w-0 flex-1 text-[11px]">
                        <p className="text-[color:var(--console-text)]">
                          <span className="font-medium">{c.label}</span>
                          <span className="ml-1.5 rounded bg-orange/5 px-1 text-[9px] uppercase tracking-wide text-orange/80">{c.classification.replace('_', ' ')}</span>
                        </p>
                        {c.kind === 'scalar' && c.existingValue != null ? (
                          <p className="mt-0.5 break-words text-[color:var(--console-mute)]">
                            <span className="line-through decoration-orange/30">{show(c.existingValue)}</span>
                            {c.existingAuthority && <span className="ml-1 text-[9px]">[{AUTH_LABEL[c.existingAuthority]}]</span>}
                            <span className="mx-1">→</span>
                            <span className="text-[color:var(--console-text)]">{show(c.incomingValue)}</span>
                          </p>
                        ) : (
                          <p className="mt-0.5 break-words text-[color:var(--console-text)]">{show(c.incomingValue)}</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-[color:var(--console-mute)]">
                          {c.reason} · {AUTH_LABEL[c.incomingAuthority]} · {c.provenance.map((p) => p.filename).join(', ')}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}

          {proposal.summary.derivedToRecompute.length > 0 && (
            <p className="text-[11px] text-[color:var(--console-mute)]">
              Will recompute: {proposal.summary.derivedToRecompute.join(', ')}. Leads, messages, assignments, revenue identity and runs are never modified.
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button onClick={discard} disabled={phase === 'applying'} className="text-[12px] text-[color:var(--console-mute)] hover:text-orange">Discard import</button>
            <button onClick={apply} disabled={phase === 'applying'} data-testid="enrich-apply"
              className="rounded bg-orange px-4 py-2 text-[12px] font-medium text-white hover:bg-orange/90 disabled:opacity-50">
              {phase === 'applying' ? 'Applying…' : selectedCount > 0 ? `Apply ${selectedCount} change${selectedCount === 1 ? '' : 's'}` : 'Record provenance only'}
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div data-testid="enrich-done" className="mt-4 space-y-1 text-[12px] text-[color:var(--console-text)]">
          <p className="font-medium text-success">Imported into this profile.</p>
          <p className="text-[11px] text-[color:var(--console-mute)]">
            {Object.entries(result.result?.counts ?? {}).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${String(k).replace(/_/g, ' ')}: ${n}`).join(' · ') || 'No new facts — provenance recorded.'}
          </p>
          <p className="text-[11px] text-[color:var(--console-mute)]">Profile ID unchanged · all leads, messages and assignments untouched.</p>
          <button onClick={onClose} className="mt-2 text-[11px] text-orange hover:underline">Close</button>
        </div>
      )}
    </section>
  )
}
