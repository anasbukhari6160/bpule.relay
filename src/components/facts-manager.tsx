'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Plus, X, Eye } from 'lucide-react'
import type { Fact } from '@/lib/domain/types'

/** Internal bookkeeping fields never shown in the normal proof UI (QA BUG-08-02). */
const INTERNAL_FACT_KEYS = new Set(['fetch_status', 'raw', 'internal', 'debug', 'metadata'])

/**
 * Render a fact value as human-readable proof, never a raw JSON blob. If the
 * stored value is JSON, show each field in plain language; internal fields are
 * hidden unless the admin opens details.
 */
function FactValue({ value, isAdmin }: { value: string; isAdmin: boolean }) {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return <>{value}</>
    }
    const entries: Array<[string, unknown]> = Array.isArray(parsed)
      ? parsed.map((v, i) => [String(i), v])
      : Object.entries(parsed as Record<string, unknown>)
    const visible = entries.filter(([k]) => isAdmin || !INTERNAL_FACT_KEYS.has(k))
    if (visible.length === 0) return <>{value}</>
    return (
      <div className="mt-1 space-y-1.5">
        {visible.map(([k, v]) => (
          <div key={k}>
            <p className="text-[11px] font-medium text-ink">
              {k === 'permission_to_name_publicly'
                ? 'Permission to name publicly'
                : k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
            </p>
            <p className="text-sm text-slate">
              {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
            </p>
          </div>
        ))}
      </div>
    )
  }
  return <>{value}</>
}

export function FactsManager({
  initialFacts,
  isAdmin,
}: {
  initialFacts: Fact[]
  isAdmin: boolean
}) {
  const [facts, setFacts] = useState<Fact[]>(initialFacts)
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [factType, setFactType] = useState('credential')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !value.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), value: value.trim(), factType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save fact.')
      setFacts((f) => [...f, data.fact].sort((a, b) => a.label.localeCompare(b.label)))
      setLabel('')
      setValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fact.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/facts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to delete fact.')
      }
      setFacts((f) => f.filter((fact) => fact.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete fact.')
    } finally {
      setBusy(false)
    }
  }

  const factsByType = facts.reduce<Record<string, Fact[]>>((acc, f) => {
    const type = f.factType ?? 'uncategorized'
    if (!acc[type]) acc[type] = []
    acc[type].push(f)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!isAdmin ? (
        <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-bone/30 px-4 py-3">
          <Eye className="mt-0.5 size-4 shrink-0 text-slate" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">Read-only</p>
            <p className="text-xs text-slate">Facts are edited by admins only. Reps and sourcers can view them.</p>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <section className="reveal-up rounded-2xl border border-line/60 bg-bg-bone-raised p-6">
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-orange" aria-hidden="true" />
            <h2 className="text-heading text-base text-ink">Add a fact</h2>
          </div>
          <form onSubmit={save} className="mt-4 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fact-label">Label</Label>
              <Input
                id="fact-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Years shipping"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fact-value">Value (exactly as a model may quote it)</Label>
              <Textarea
                id="fact-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={2}
                placeholder="e.g. first plan in 10 days"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fact-type">Type</Label>
              <Select id="fact-type" value={factType} onChange={(e) => setFactType(e.target.value)}>
                <option value="credential">credential</option>
                <option value="price">price</option>
                <option value="case">case</option>
                <option value="process">process</option>
                <option value="industry:saas">industry:...</option>
                <option value="play:...">play:...</option>
              </Select>
            </div>
            <div>
              <Button
                variant="orange"
                type="submit"
                disabled={busy || !label.trim() || !value.trim()}
                loading={busy}
              >
                Add fact
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="space-y-6">
        {facts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line py-10 text-center">
            <p className="text-sm text-slate">No facts yet.</p>
          </div>
        ) : (
          Object.entries(factsByType).map(([type, typeFacts]) => (
            <div key={type} className="reveal-up space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-label">{type}</Badge>
                <span className="text-mono-medium text-xs text-slate">{typeFacts.length}</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-line/60 bg-bg-bone-raised">
                <ul className="divide-y divide-line/50">
                  {typeFacts.map((f, i) => (
                    <li
                      key={f.id}
                      className="slide-in-right flex items-start justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-bone/20"
                      style={{ animationDelay: `${0.03 + i * 0.02}s` }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{f.label}</p>
                        <div className="mt-0.5 text-sm text-slate"><FactValue value={f.value} isAdmin={isAdmin} /></div>
                      </div>
                      {isAdmin ? (
                        <button
                          onClick={() => remove(f.id)}
                          disabled={busy}
                          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate transition-colors hover:bg-status-danger/8 hover:text-status-danger disabled:opacity-50"
                          aria-label={`Delete ${f.label}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : (
                        <Eye className="mt-1 size-3.5 shrink-0 text-line" aria-hidden="true" />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
