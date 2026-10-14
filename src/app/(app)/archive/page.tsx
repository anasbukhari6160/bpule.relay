'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Search, FileText, Briefcase, Award, AlertCircle, MessageCircle, Shield, LibraryBig } from 'lucide-react'

type EntityType = 'all' | 'lead' | 'proof' | 'upwork' | 'conversation' | 'identity' | 'studio'

const ENTITY_LABEL: Record<EntityType, string> = {
  all: 'All records',
  lead: 'Leads',
  proof: 'Proof',
  upwork: 'Jobs',
  conversation: 'Conversations',
  identity: 'Revenue identities',
  studio: 'Studio library',
}

const STATUS_OPTIONS: Record<EntityType, string[]> = {
  all: ['new', 'contacted', 'followed_up', 'replied', 'no', 'dead', 'drafted', 'applied', 'qualifying', 'interested', 'meeting', 'proposal', 'negotiation', 'won', 'lost', 'active', 'archived', 'draft', 'ready', 'posted', 'rejected'],
  lead: ['new', 'contacted', 'followed_up', 'replied', 'no', 'dead'],
  proof: [],
  upwork: ['new', 'drafted', 'applied', 'replied', 'no', 'dead'],
  conversation: ['new', 'contacted', 'replied', 'qualifying', 'interested', 'meeting', 'proposal', 'negotiation', 'won', 'lost'],
  identity: ['active', 'archived'],
  studio: ['draft', 'ready', 'posted', 'rejected'],
}

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  lead: <FileText className="size-4" />,
  proof: <Award className="size-4" />,
  upwork: <Briefcase className="size-4" />,
  conversation: <MessageCircle className="size-4" />,
  identity: <Shield className="size-4" />,
  studio: <LibraryBig className="size-4" />,
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [entity, setEntity] = useState<EntityType>('all')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<
    Array<{
      entityType: string
      id: string
      title: string
      subtitle: string
      status: string | null
      createdAt: string
      href?: string
    }>
  >([])
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const lastFiltersRef = useRef<{ entity: EntityType; status: string }>({
    entity: 'all',
    status: '',
  })

  const resultLabel = hasSearched ? `${results.length}` : '—'
  const scopeLabel = ENTITY_LABEL[entity]
  const statusLabel = status || 'Any'
  const statusOptions = useMemo(() => STATUS_OPTIONS[entity], [entity])

  useEffect(() => {
    if (!status) return
    if (!statusOptions.includes(status)) setStatus('')
  }, [status, statusOptions])

  useEffect(() => {
    if (!hasSearched || !query.trim()) return
    const prev = lastFiltersRef.current
    if (prev.entity === entity && prev.status === status) return
    lastFiltersRef.current = { entity, status }
    void search()
  }, [entity, status, hasSearched, query])

  async function search() {
    const trimmed = query.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setHasSearched(true)
    lastFiltersRef.current = { entity, status }
    try {
      const params = new URLSearchParams()
      params.set('q', trimmed)
      if (entity !== 'all') params.set('entity', entity)
      if (status) params.set('status', status)
      const res = await fetch(`/api/search?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Search failed.')
      setResults(data.results ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  function clearSearch() {
    setQuery('')
    setEntity('all')
    setStatus('')
    setResults([])
    setError(null)
    setHasSearched(false)
    setLoading(false)
    lastFiltersRef.current = { entity: 'all', status: '' }
  }

  function resultHref(result: { entityType: string; id: string; href?: string }) {
    if (result.href) return result.href
    if (result.entityType === 'lead') return `/leads/${result.id}`
    if (result.entityType === 'upwork') return `/upwork/${result.id}`
    if (result.entityType === 'conversation') return `/leads/${result.id}`
    if (result.entityType === 'identity') return '/admin/revenue-identities'
    if (result.entityType === 'studio') return '/content'
    return '/profiles'
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Archive / Evidence Retrieval</p>
        <h1 className="mt-2 text-[30px] leading-[1.05] tracking-[-0.03em] text-[color:var(--console-text)]">
          Search the operating record.
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-[color:var(--console-mute)]">
          Find leads, jobs, conversations, proof traces, identities, and studio entries before deciding the next human action.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ArchiveSignal label="Results" value={resultLabel} />
          <ArchiveSignal label="Scope" value={scopeLabel} />
          <ArchiveSignal label="Status filter" value={statusLabel} />
        </div>
      </section>

      <div className="reveal-up stagger-1 srf-proof space-y-4 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2 text-slate">
          <Search className="size-4" />
          <span className="font-mono text-xs uppercase tracking-widest">Search</span>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="query" className="sr-only">Search query</Label>
            <Input
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search()
              }}
              placeholder="company, conversation detail, identity, draft..."
              className="h-11"
            />
          </div>
          <div className="flex gap-3">
            <div className="sm:w-40">
              <Label htmlFor="entity" className="sr-only">Type</Label>
              <Select id="entity" value={entity} onChange={(e) => setEntity(e.target.value as EntityType)}>
                <option value="all">All types</option>
                <option value="lead">Leads</option>
                <option value="upwork">Jobs</option>
                <option value="conversation">Conversations</option>
                <option value="identity">Revenue identities</option>
                <option value="proof">Proof</option>
                <option value="studio">Studio library</option>
              </Select>
            </div>
            <div className="sm:w-36">
              <Label htmlFor="status" className="sr-only">Status</Label>
              <Select id="status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={statusOptions.length === 0}>
                <option value="">Any</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate">Press Enter to search. Filters auto-apply after first search.</span>
          <div className="flex items-center gap-2">
            {(hasSearched || query || entity !== 'all' || status) ? (
              <Button variant="outline" onClick={clearSearch} disabled={loading}>
                Clear
              </Button>
            ) : null}
            <Button variant="orange" onClick={() => void search()} loading={loading} disabled={!query.trim()}>
              <Search className="mr-1.5 size-3.5" />
              {loading ? 'Searching...' : 'Search'}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="reveal-up flex items-center gap-2 rounded-xl bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {hasSearched && !loading ? (
        <section className="reveal-up stagger-2 space-y-3">
          <p className="font-mono text-xs text-slate">
            {results.length} result{results.length === 1 ? '' : 's'} for &ldquo;{query.trim()}&rdquo;
          </p>

          {results.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              <ul className="divide-y divide-line">
                {results.map((r, i) => (
                  <li
                    key={r.entityType + r.id}
                    className="slide-in-right"
                    style={{ animationDelay: `${0.03 + i * 0.03}s` }}
                  >
                    <Link
                      href={resultHref(r)}
                      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bone/40"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bone text-slate">
                        {ENTITY_ICONS[r.entityType] ?? <FileText className="size-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink transition-colors group-hover:text-orange">
                            {r.title}
                          </span>
                          {r.status && (
                            <span className="shrink-0 rounded-md bg-bone px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate">
                              {r.status}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate">{r.subtitle}</p>
                      </div>

                      <span className="shrink-0 rounded-md bg-orange/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-orange">
                        {r.entityType}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="srf-dossier py-10 text-center">
              <p className="text-sm text-slate">No matches for &ldquo;{query.trim()}&rdquo; in {scopeLabel.toLowerCase()}.</p>
              <p className="mt-1 text-xs text-slate">Try a broader term, remove status filters, or clear search.</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

function ArchiveSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">{label}</p>
      <p className="mt-1 text-[14px] font-medium capitalize text-[color:var(--console-text)]">{value}</p>
    </div>
  )
}
