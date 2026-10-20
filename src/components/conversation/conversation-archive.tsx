'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, MessagesSquare, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import type { ArchiveLane, ArchiveThread } from '@/lib/conversation/archive'
import { cn } from 'cn'

const LANES: Array<{ key: 'all' | ArchiveLane; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'reply', label: 'Needs a reply' },
  { key: 'followup', label: 'Follow-up due' },
  { key: 'waiting', label: 'Waiting on them' },
  { key: 'open', label: 'Started' },
  { key: 'closed', label: 'Closed' },
]

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  followed_up: 'Followed up',
  replied: 'They replied',
  won: 'Won',
  lost: 'Lost',
  no: 'Closed',
  dead: 'Closed',
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export function ConversationArchive({ threads, failed }: { threads: ArchiveThread[]; failed: boolean }) {
  const [lane, setLane] = useState<'all' | ArchiveLane>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: threads.length }
    for (const thread of threads) next[thread.lane] = (next[thread.lane] ?? 0) + 1
    return next
  }, [threads])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return threads.filter((thread) => {
      if (lane !== 'all' && thread.lane !== lane) return false
      if (!q) return true
      const hay = [thread.contactName, thread.company, thread.lastText, thread.status, thread.source].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [threads, lane, query])

  if (failed) {
    return <p className="text-[13px] text-status-danger">The archive could not be loaded. Refresh to try again.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, company, or a line from the thread"
            className="h-10 pl-9"
            aria-label="Search conversations"
          />
        </div>
        <p className="shrink-0 text-[12px] text-stone">{visible.length} of {threads.length}</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {LANES.map((item) => {
          const count = counts[item.key] ?? 0
          const active = lane === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setLane(item.key)}
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                active ? 'border-ink bg-ink text-on-solid' : 'border-line bg-bone text-graphite hover:text-ink',
              )}
            >
              {item.label} <span className={active ? 'text-on-solid/70' : 'text-stone'}>{count}</span>
            </button>
          )
        })}
      </div>

      {threads.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No conversations yet"
          description="A thread appears here after you send a message or save an inbound note."
          action={<Link href="/inbound" className="text-[13px] font-medium text-orange">Log an inbound message</Link>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing in this view"
          description="Clear the search or pick another filter."
          size="compact"
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bone-raised/20">
          {visible.map((thread) => (
            <li key={thread.leadId}>
              <Link
                href={`/leads/${thread.leadId}?tab=conversation`}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-bone-raised/60"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cobalt/10 text-[13px] font-semibold text-cobalt">
                  {(thread.contactName ?? thread.company).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-[13px] font-medium text-ink">{thread.contactName ?? 'Unnamed'}</p>
                    <p className="truncate text-[12px] text-graphite">{thread.company}</p>
                    <span className="ml-auto shrink-0 text-[11px] text-stone">{timeAgo(thread.lastAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-graphite">
                    <span className="text-stone">{thread.lastFrom === 'me' ? 'You: ' : 'Them: '}</span>
                    {thread.lastText}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <LanePill lane={thread.lane} />
                    <span className="rounded-full bg-bone px-1.5 py-px text-[10px] text-stone">{STATUS_LABEL[thread.status] ?? thread.status}</span>
                    {thread.direction === 'inbound' && (
                      <span className="rounded-full bg-orange/10 px-1.5 py-px text-[10px] text-orange">Inbound</span>
                    )}
                    {thread.stageLabel && (
                      <span className="rounded-full bg-cobalt/10 px-1.5 py-px text-[10px] text-cobalt">{thread.stageLabel}</span>
                    )}
                    <span className="text-[10px] text-stone">{thread.turnCount} {thread.turnCount === 1 ? 'turn' : 'turns'}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <RecordSearch />
    </div>
  )
}

function LanePill({ lane }: { lane: ArchiveLane }) {
  const label = LANES.find((item) => item.key === lane)?.label ?? lane
  const tone = lane === 'reply' || lane === 'followup' ? 'text-orange bg-orange/10' : 'text-graphite bg-bone'
  return <span className={cn('rounded-full px-1.5 py-px text-[10px]', tone)}>{label}</span>
}

type EntityType = 'all' | 'lead' | 'proof' | 'upwork' | 'conversation' | 'identity' | 'studio'

const STATUS_OPTIONS: Record<EntityType, string[]> = {
  all: [],
  lead: ['new', 'contacted', 'followed_up', 'replied', 'won', 'lost', 'no', 'dead'],
  proof: [],
  upwork: ['new', 'drafted', 'applied', 'replied', 'no', 'dead'],
  conversation: ['new', 'contacted', 'replied', 'won', 'lost'],
  identity: ['active', 'archived'],
  studio: ['draft', 'ready', 'posted', 'rejected'],
}

function RecordSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [entity, setEntity] = useState<EntityType>('all')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Array<{ entityType: string; id: string; title: string; subtitle: string; status: string | null; href?: string }>>([])
  const [searched, setSearched] = useState(false)

  async function search() {
    const trimmed = query.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const params = new URLSearchParams({ q: trimmed })
      if (entity !== 'all') params.set('entity', entity)
      if (status) params.append('status', status)
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

  return (
    <section className="rounded-2xl border border-line bg-bone/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[13px] font-medium text-ink">Search leads, jobs, and proof</span>
        <span className="text-[12px] text-stone">{open ? 'Hide' : 'Open'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void search() }}
              placeholder="Company, job, identity, or proof"
              className="h-10"
              aria-label="Search the record"
            />
            <Select value={entity} onChange={(event) => { setEntity(event.target.value as EntityType); setStatus('') }} className="sm:w-40" aria-label="Record type">
              <option value="all">All types</option>
              <option value="lead">Leads</option>
              <option value="upwork">Jobs</option>
              <option value="conversation">Conversations</option>
              <option value="identity">Identities</option>
              <option value="proof">Proof</option>
              <option value="studio">Studio</option>
            </Select>
            <Select value={status} onChange={(event) => setStatus(event.target.value)} disabled={STATUS_OPTIONS[entity].length === 0} className="sm:w-36" aria-label="Status">
              <option value="">Any status</option>
              {STATUS_OPTIONS[entity].map((option) => (
                <option key={option} value={option}>{STATUS_LABEL[option] ?? option}</option>
              ))}
            </Select>
            <Button variant="orange" onClick={() => void search()} loading={loading} disabled={!query.trim()}>
              Search
            </Button>
          </div>
          {error && (
            <p className="flex items-center gap-2 text-[13px] text-status-danger">
              <AlertCircle className="size-3.5" /> {error}
            </p>
          )}
          {searched && !loading && (
            results.length === 0 ? (
              <p className="text-[13px] text-stone">No records matched.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                {results.map((result) => (
                  <li key={result.entityType + result.id}>
                    <Link href={result.href ?? (result.entityType === 'upwork' ? `/upwork/${result.id}` : `/leads/${result.id}`)} className="block px-3 py-2.5 hover:bg-bone">
                      <p className="truncate text-[13px] font-medium text-ink">{result.title}</p>
                      <p className="truncate text-[12px] text-stone">{result.entityType}{result.subtitle ? ` · ${result.subtitle}` : ''}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </section>
  )
}
