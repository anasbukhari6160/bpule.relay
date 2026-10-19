'use client'

import { useEffect, useState } from 'react'

interface Candidate { id: string; fullName: string | null; displayName: string | null; currentRole: string | null }

/**
 * Safe duplicate merge: selected profile (B) → this profile (A).
 * Always a dry-run first; executes only after explicit confirmation.
 */
export function MergeTool({ targetProfileId, targetName, onMerged }: { targetProfileId: string; targetName: string; onMerged: () => void }) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [sourceId, setSourceId] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [confirmText, setConfirmText] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/profile-intelligence/profiles?limit=200')
      .then((r) => r.json())
      .then((d) => setCandidates((d.profiles ?? []).filter((p: Candidate) => p.id !== targetProfileId)))
      .catch(() => setCandidates([]))
  }, [open, targetProfileId])

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/profile-intelligence/profiles/merge', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceProfileId: sourceId, targetProfileId, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw Object.assign(new Error(data.error ?? 'Merge failed.'), { details: data.details })
    return data
  }

  const runPreview = async () => {
    setBusy(true); setError(null); setPreview(null); setConfirmText(''); setAck(false)
    try { setPreview(await call({ mode: 'preview' })) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const execute = async () => {
    setBusy(true); setError(null)
    try {
      const r = await call({ mode: 'execute', previewToken: preview.previewToken, acknowledgeIdentityRisk: ack })
      setDone(r.result); setPreview(null); onMerged()
    } catch (e) {
      setError((e as Error).message)
      const d = (e as Error & { details?: any }).details
      if (d?.previewToken) setPreview(d)
    }
    setBusy(false)
  }

  const sourceName: string = preview?.identity?.source?.name ?? ''
  const moved = preview ? Object.entries(preview.report.counts_before as Record<string, { source: number }>).filter(([, v]) => v.source > 0) : []
  const canExecute = preview && confirmText.trim() === sourceName.trim() && (preview.identity.likelySamePerson || ack)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] text-graphite hover:text-orange" data-testid="merge-open">
        Merge a duplicate profile into this one…
      </button>
    )
  }

  return (
    <section data-testid="merge-tool" className="rounded-xl border border-line bg-bone-raised overflow-hidden px-5 py-5 sm:px-6">
      <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Merge duplicate → {targetName}</p>
      <p className="mt-1 text-[11px] text-graphite">
        Moves every lead, message, assignment, proof and source from the duplicate to this profile in one transaction, removes exact duplicates, then archives the duplicate. This profile&apos;s ID never changes. Nothing happens until you confirm the dry-run.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPreview(null) }}
          className="rounded border border-orange/20 bg-transparent px-2 py-1 text-[12px] text-ink" aria-label="Duplicate profile">
          <option value="">Select duplicate profile…</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName ?? c.displayName ?? c.id}{c.currentRole ? ` — ${c.currentRole}` : ''}</option>)}
        </select>
        <button onClick={runPreview} disabled={!sourceId || busy} className="rounded border border-orange/30 px-3 py-1 text-[12px] text-orange disabled:opacity-50">
          {busy && !preview ? 'Running dry-run…' : 'Dry-run'}
        </button>
        <button onClick={() => setOpen(false)} className="text-[11px] text-graphite">Cancel</button>
      </div>

      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}

      {preview && (
        <div className="mt-4 space-y-3 text-[11px]" data-testid="merge-preview">
          <p className={preview.identity.likelySamePerson ? 'text-success' : 'text-warning'}>
            Identity match {preview.identity.score}% — {preview.identity.signals.join('; ') || 'no shared signals'}
            {preview.identity.warning && <> · {preview.identity.warning}</>}
          </p>
          <table className="w-full text-left">
            <thead><tr className="text-graphite"><th className="py-1">Reference</th><th>Moving from duplicate</th><th>Already on this profile</th></tr></thead>
            <tbody>
              {moved.map(([k, v]) => (
                <tr key={k} className="border-t border-orange/5 text-ink">
                  <td className="py-1">{k}</td><td>{v.source}</td><td>{(preview.report.counts_before[k] as { target: number }).target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-graphite">
            Duplicates removed: {preview.report.removed_duplicates.length} ({preview.report.removed_duplicates.map((d: any) => d.table).join(', ') || 'none'}) · Empty fields filled: {Object.keys(preview.report.merged_fields).join(', ') || 'none'}
          </p>
          {!preview.identity.likelySamePerson && (
            <label className="flex items-center gap-2 text-warning">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I confirm these are the same person.
            </label>
          )}
          <label className="block text-graphite">
            Type <span className="font-medium text-ink">{sourceName}</span> to confirm:
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Confirm duplicate name"
              className="ml-2 rounded border border-orange/20 bg-transparent px-2 py-0.5 text-[12px] text-ink" />
          </label>
          <button onClick={execute} disabled={!canExecute || busy} data-testid="merge-execute"
            className="rounded bg-orange px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">
            {busy ? 'Merging…' : 'Merge and archive duplicate'}
          </button>
        </div>
      )}

      {done && (
        <p className="mt-3 text-[12px] text-success" data-testid="merge-done">
          Merged. Duplicate archived; audit record {String(done.merge_log_id).slice(0, 8)} saved.
        </p>
      )}
    </section>
  )
}
