'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FileUp, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from 'cn'

export default function ImportPage() {
  const [csv, setCsv] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    imported: number
    duplicates: number
    invalid: number
    total: number
    results: Array<{ row: number; status: string; reason?: string; leadId?: string }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const imported = result?.imported ?? 0
  const duplicates = result?.duplicates ?? 0
  const invalid = result?.invalid ?? 0

  async function upload() {
    if (!csv.trim()) {
      setError('Paste CSV content first.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, fileName: 'paste.csv' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed.')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Bulk Intake / CSV Import</p>
        <h1 className="mt-2 text-[30px] leading-[1.05] tracking-[-0.03em] text-[color:var(--console-text)]">Import lead rows with validation gates.</h1>
        <p className="mt-2 max-w-2xl text-[13px] text-[color:var(--console-mute)]">
          Relay validates required fields, checks duplicates, and writes only safe rows.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ImportSignal label="Imported" value={imported} />
          <ImportSignal label="Duplicates" value={duplicates} />
          <ImportSignal label="Invalid" value={invalid} />
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="reveal-up stagger-1 srf-proof px-4 py-4 sm:px-5">
        <Textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={`company,contactName,contactTitle,url,signalType,signalEvidence,verbatimQuote,tags\nAcme Corp,Jane Doe,CTO,https://example.com/acme,1,Hiring 3 senior engineers,We need help shipping faster,"react,node"\nBeta Inc,John Smith,CEO,,3,Raised a $2M seed round,Looking for a delivery partner,"python,django"`}
          rows={12}
          className="max-h-[28rem] overflow-y-auto font-mono text-[13px]"
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-stone">
            Required: company, signalType (1-7), signalEvidence.
          </span>
          <Button variant="orange" onClick={() => void upload()} loading={loading}>
            <FileUp className="mr-1.5 size-3.5" />
            {loading ? 'Importing...' : 'Import rows'}
          </Button>
        </div>
      </section>

      {result ? (
        <section className="reveal-up stagger-2 rounded border border-line/60 bg-bone-raised p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ImportStat label="Imported" value={result.imported} icon={<CheckCircle2 className="size-4" />} tone="good" />
            <ImportStat label="Duplicates" value={result.duplicates} icon={<AlertTriangle className="size-4" />} tone="warn" />
            <ImportStat label="Invalid" value={result.invalid} icon={<XCircle className="size-4" />} tone="bad" />
            <ImportStat label="Total rows" value={result.total} tone="default" />
          </div>

          {result.results.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line/60 text-left">
                    <th className="pb-2.5 pr-4 text-label">Row</th>
                    <th className="pb-2.5 pr-4 text-label">Status</th>
                    <th className="pb-2.5 text-label">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.row} className="border-b border-line/30 transition-colors hover:bg-bone/20">
                      <td className="py-2.5 pr-4 text-mono-medium text-xs text-ink">{r.row}</td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                            r.status === 'imported'
                              ? 'bg-status-success/8 text-status-success'
                              : r.status === 'duplicate'
                                ? 'bg-status-warning/8 text-status-warning'
                                : 'bg-status-danger/8 text-status-danger',
                          )}
                        >
                          {r.status === 'imported' ? <CheckCircle2 className="size-3" /> : null}
                          {r.status === 'duplicate' ? <AlertTriangle className="size-3" /> : null}
                          {r.status === 'invalid' ? <XCircle className="size-3" /> : null}
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-xs text-stone">
                        {r.reason ?? (r.leadId ? `Lead ${r.leadId}` : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function ImportSignal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">{label}</p>
      <p className="mt-1 text-[20px] font-medium text-[color:var(--console-text)]">{value}</p>
    </div>
  )
}

function ImportStat({ label, value, icon, tone = 'default' }: { label: string; value: number; icon?: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'default' }) {
  const valueColor = {
    good: 'text-status-success',
    warn: 'text-status-warning',
    bad: 'text-status-danger',
    default: 'text-ink',
  }[tone]

  return (
    <div className="rounded-xl bg-bone/40 px-4 py-3">
      <div className="flex items-center gap-1.5">
        {icon && <span className={cn('opacity-60', valueColor)}>{icon}</span>}
        <span className="text-label">{label}</span>
      </div>
      <p className={cn('mt-1 text-mono-medium text-2xl font-medium tracking-tight', valueColor)}>{value}</p>
    </div>
  )
}
