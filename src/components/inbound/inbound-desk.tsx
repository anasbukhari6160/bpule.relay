'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notifyError } from '@/lib/ui/notify'
import type { InboundIntelligence, LeadSource } from '@/lib/domain/types'
import type { InboundQueueItem } from '@/lib/conversation/archive'
import { cn } from 'cn'

const SOURCES: Array<{ value: LeadSource; label: string }> = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'upwork', label: 'Upwork' },
  { value: 'email', label: 'Email' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' },
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

export function InboundDesk({ queue, failed }: { queue: InboundQueueItem[]; failed: boolean }) {
  const router = useRouter()
  const firstOpen = queue.find((item) => item.needsReply) ?? queue[0] ?? null
  const [composing, setComposing] = useState(queue.length === 0)
  const [selectedId, setSelectedId] = useState<string | null>(firstOpen?.leadId ?? null)
  const selected = queue.find((item) => item.leadId === selectedId) ?? null
  const waiting = queue.filter((item) => item.needsReply).length

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-2xl border border-line bg-bone-raised/20">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <p className="text-[12px] font-medium text-ink">
            Inbox <span className="text-stone">{queue.length}</span>
          </p>
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="text-[12px] font-medium text-orange"
          >
            New message
          </button>
        </div>
        {failed ? (
          <p className="px-3 py-4 text-[12px] text-status-danger">Inbound messages could not be loaded.</p>
        ) : queue.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-stone">Nothing saved yet. Paste the first message on the right.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {queue.map((item) => {
              const active = !composing && item.leadId === selected?.leadId
              return (
                <li key={item.leadId}>
                  <button
                    type="button"
                    onClick={() => { setSelectedId(item.leadId); setComposing(false) }}
                    className={cn('block w-full px-3 py-2.5 text-left', active ? 'bg-bone-raised' : 'hover:bg-bone/60')}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">{item.contactName ?? item.company}</span>
                      {item.needsReply && <span className="size-1.5 shrink-0 rounded-full bg-orange" aria-label="Needs a reply" />}
                      <span className="ml-auto shrink-0 text-[11px] text-stone">{timeAgo(item.lastAt)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-stone">{item.company} · {item.source ?? 'inbound'}</span>
                    <span className="mt-1 block truncate text-[12px] text-graphite">{item.preview}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {waiting > 0 && (
          <p className="border-t border-line px-3 py-2 text-[11px] text-orange">{waiting} waiting on a reply</p>
        )}
      </aside>

      {composing || !selected ? (
        <Intake onSaved={(id) => { setSelectedId(id); setComposing(false); router.refresh() }} />
      ) : (
        <SavedMessage item={selected} onCompose={() => setComposing(true)} />
      )}
    </div>
  )
}

function SavedMessage({ item, onCompose }: { item: InboundQueueItem; onCompose: () => void }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-bone-raised/20 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-stone">{item.source ?? 'Inbound'} · {STATUS_LABEL[item.status] ?? item.status}</p>
          <h2 className="mt-1 text-[18px] font-medium text-ink">{item.contactName ?? 'Unnamed'} <span className="text-graphite">at {item.company}</span></h2>
        </div>
        {item.needsReply ? (
          <span className="rounded-full bg-orange/10 px-2 py-1 text-[11px] font-medium text-orange">Needs a reply</span>
        ) : (
          <span className="rounded-full bg-bone px-2 py-1 text-[11px] text-stone">Handled</span>
        )}
      </div>
      <blockquote className="whitespace-pre-wrap rounded-xl border border-line bg-paper px-4 py-3 text-[14px] leading-relaxed text-ink">
        {item.message}
      </blockquote>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/leads/${item.leadId}?tab=conversation`}
          className="inline-flex h-9 items-center rounded-lg bg-orange px-4 text-[13px] font-medium text-on-accent hover:bg-orange-dark"
        >
          {item.needsReply ? 'Reply in the conversation' : 'Open conversation'}
        </Link>
        <Button variant="outline" onClick={onCompose}>Log another message</Button>
      </div>
    </section>
  )
}

interface AnalysisInputSnapshot {
  message: string
  source: LeadSource
  context: string
}

function snapshotKey(snapshot: AnalysisInputSnapshot): string {
  return JSON.stringify(snapshot)
}

export function Intake({ onSaved }: { onSaved: (leadId: string) => void }) {
  const [message, setMessage] = useState('')
  const [source, setSource] = useState<LeadSource>('linkedin')
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactTitle, setContactTitle] = useState('')
  const [url, setUrl] = useState('')
  const [context, setContext] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intelligence, setIntelligence] = useState<InboundIntelligence | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const latestInput = useRef<AnalysisInputSnapshot>({ message: '', source: 'linkedin', context: '' })
  const completedAnalysisKey = useRef<string | null>(null)
  const requestToken = useRef(0)
  const activeAnalysis = useRef<AbortController | null>(null)
  const activeSave = useRef<AbortController | null>(null)
  const saveInFlight = useRef(false)
  const saveIdempotencyKey = useRef<string | null>(null)
  const manuallyEdited = useRef({ company: false, contactName: false, contactTitle: false, url: false })

  const canAnalyze = message.trim().length > 0 && !analyzing && !saving
  const saveBlocked = useMemo(() => !company.trim(), [company])

  function invalidateAnalysis(next: AnalysisInputSnapshot, clearManualIdentity: boolean) {
    if (snapshotKey(next) === snapshotKey(latestInput.current)) return
    latestInput.current = next
    requestToken.current += 1
    activeAnalysis.current?.abort()
    activeAnalysis.current = null
    activeSave.current?.abort()
    activeSave.current = null
    completedAnalysisKey.current = null
    saveIdempotencyKey.current = null
    setAnalyzing(false)
    setSaving(false)
    setIntelligence(null)
    setSavedId(null)
    setError(null)

    if (clearManualIdentity) {
      manuallyEdited.current = { company: false, contactName: false, contactTitle: false, url: false }
      setCompany('')
      setContactName('')
      setContactTitle('')
      setUrl('')
      return
    }
    if (!manuallyEdited.current.company) setCompany('')
    if (!manuallyEdited.current.contactName) setContactName('')
    if (!manuallyEdited.current.contactTitle) setContactTitle('')
    if (!manuallyEdited.current.url) setUrl('')
  }

  function changeMessage(value: string) {
    if (saveInFlight.current) return
    invalidateAnalysis({ ...latestInput.current, message: value.trim() }, true)
    setMessage(value)
  }

  function changeSource(value: LeadSource) {
    if (saveInFlight.current) return
    invalidateAnalysis({ ...latestInput.current, source: value }, false)
    setSource(value)
  }

  function changeContext(value: string) {
    if (saveInFlight.current) return
    invalidateAnalysis({ ...latestInput.current, context: value.trim() }, false)
    setContext(value)
  }

  async function analyze() {
    if (!message.trim()) {
      setError('Paste the message first.')
      return
    }
    const inputSnapshot = { ...latestInput.current, message: message.trim(), context: context.trim() }
    latestInput.current = inputSnapshot
    const inputKey = snapshotKey(inputSnapshot)
    const thisRequest = ++requestToken.current
    activeAnalysis.current?.abort()
    const controller = new AbortController()
    activeAnalysis.current = controller
    setAnalyzing(true)
    setError(null)
    setIntelligence(null)
    setSavedId(null)
    try {
      const res = await fetch('/api/inbound/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: inputSnapshot.message,
          source: inputSnapshot.source,
          company: company.trim() || null,
          contactName: contactName.trim() || null,
          contactTitle: contactTitle.trim() || null,
          url: url.trim() || null,
          context: inputSnapshot.context || null,
        }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (thisRequest !== requestToken.current) return
      if (snapshotKey(latestInput.current) !== inputKey) return
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed.')
      completedAnalysisKey.current = inputKey
      saveIdempotencyKey.current = crypto.randomUUID()
      setIntelligence(data.intelligence)
      if (!manuallyEdited.current.company) setCompany(data.extracted?.company || '')
      if (!manuallyEdited.current.contactName) setContactName(data.extracted?.contactName || '')
      if (!manuallyEdited.current.contactTitle) setContactTitle(data.extracted?.contactTitle || '')
      if (!manuallyEdited.current.url) setUrl(data.extracted?.url || '')
    } catch (err) {
      if (thisRequest !== requestToken.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      const notice = err instanceof Error ? err.message : 'Analysis failed.'
      setError(notice)
      notifyError(notice)
    } finally {
      if (thisRequest === requestToken.current) {
        activeAnalysis.current = null
        setAnalyzing(false)
      }
    }
  }

  async function save() {
    if (saveInFlight.current) return
    if (!intelligence) return
    if (!company.trim()) {
      setError('Add the company before saving. The lead needs a name you can find later.')
      return
    }
    const currentInputKey = snapshotKey(latestInput.current)
    if (completedAnalysisKey.current !== currentInputKey) {
      setError('The message inputs changed since the last analysis. Analyze again before saving.')
      return
    }
    const idempotencyKey = saveIdempotencyKey.current ?? crypto.randomUUID()
    saveIdempotencyKey.current = idempotencyKey
    const controller = new AbortController()
    saveInFlight.current = true
    activeSave.current = controller
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/inbound/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: company.trim(),
          contactName: contactName.trim() || null,
          contactTitle: contactTitle.trim() || null,
          url: url.trim() || null,
          message: latestInput.current.message,
          source: latestInput.current.source,
          context: latestInput.current.context || null,
          assignedProfileId: intelligence.recommendedIdentity?.id ?? null,
          idempotencyKey,
        }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (completedAnalysisKey.current !== currentInputKey || snapshotKey(latestInput.current) !== currentInputKey) return
      if (!res.ok) throw new Error(data.error ?? 'Failed to save the lead.')
      setSavedId(data.lead.id)
      onSaved(data.lead.id)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const notice = err instanceof Error ? err.message : 'Failed to save the lead.'
      setError(notice)
      notifyError(notice, 'Lead was not created')
    } finally {
      if (activeSave.current === controller) {
        saveInFlight.current = false
        activeSave.current = null
        setSaving(false)
      }
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-bone-raised/20 p-4 sm:p-5">
      <div>
        <h2 className="text-[16px] font-medium text-ink">Log a message that came in</h2>
        <p className="mt-1 text-[13px] text-graphite">Paste what they wrote. Relay reads the ask, then you save it as a lead and reply.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SOURCES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => changeSource(item.value)}
            disabled={saving}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px]',
              source === item.value ? 'border-ink bg-ink text-on-solid' : 'border-line text-graphite hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={(event) => changeMessage(event.target.value)}
        placeholder="Paste their message"
        aria-label="Their message"
        disabled={saving}
        className="min-h-[140px] w-full resize-y rounded-xl border border-line bg-paper p-3 text-[14px] text-ink placeholder:text-stone/60 focus:border-orange focus:outline-none"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" value={company} disabled={saving} onChange={(value) => { manuallyEdited.current.company = true; setCompany(value) }} placeholder="Who they work for" />
        <Field label="Name" value={contactName} disabled={saving} onChange={(value) => { manuallyEdited.current.contactName = true; setContactName(value) }} placeholder="Who wrote" />
        <Field label="Role" value={contactTitle} disabled={saving} onChange={(value) => { manuallyEdited.current.contactTitle = true; setContactTitle(value) }} placeholder="Their title" />
        <Field label="Link" value={url} disabled={saving} onChange={(value) => { manuallyEdited.current.url = true; setUrl(value) }} placeholder="Profile or post URL" />
      </div>

      <button type="button" onClick={() => setShowContext((value) => !value)} disabled={saving} className="text-[12px] text-stone hover:text-ink">
        {showContext ? 'Hide extra context' : 'Add profile or job context'}
      </button>
      {showContext && (
        <textarea
          value={context}
          onChange={(event) => changeContext(event.target.value)}
          placeholder="Anything else that should travel with this message"
          aria-label="Extra context"
          disabled={saving}
          className="min-h-[80px] w-full resize-y rounded-xl border border-line bg-paper p-3 text-[14px] text-ink placeholder:text-stone/60 focus:border-orange focus:outline-none"
        />
      )}

      {error && (
        <p className="flex items-start gap-2 text-[13px] text-status-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      <Button variant="orange" onClick={() => void analyze()} disabled={!canAnalyze} loading={analyzing}>
        {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {analyzing ? 'Reading the message' : 'Read the message'}
      </Button>

      {intelligence && (
        <div className="space-y-4 border-t border-line pt-4">
          <div className="rounded-xl border border-orange/30 bg-orange/5 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-orange">Do this next</p>
            <p className="mt-1 text-[14px] text-ink">{nextStep(intelligence.recommendedAction)}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="They want" value={intelligence.wants} />
            <Stat label="Intent" value={intelligence.intent} />
            <Stat label="Fit" value={`${intelligence.fitScore}% · ${intelligence.opportunityQuality}`} />
          </div>
          {intelligence.recommendedIdentity && (
            <p className="text-[13px] text-graphite">
              Send as <span className="font-medium text-ink">{intelligence.recommendedIdentity.label ?? intelligence.recommendedIdentity.platform}</span>
              {intelligence.identityFitReason ? ` — ${intelligence.identityFitReason}` : ''}
            </p>
          )}
          {intelligence.missingInfo.length > 0 && (
            <ul className="space-y-1 text-[13px] text-graphite">
              {intelligence.missingInfo.map((info) => (
                <li key={info}>Still missing: {info}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {savedId ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[13px] text-status-success">
                  <CheckCircle2 className="size-4" /> Saved
                </span>
                <Link href={`/leads/${savedId}?tab=conversation`} className="inline-flex h-9 items-center rounded-lg bg-orange px-4 text-[13px] font-medium text-on-accent">
                  <MessageCircle className="mr-1.5 size-4" /> Reply
                </Link>
              </>
            ) : (
              <Button onClick={() => void save()} loading={saving} disabled={saveBlocked || saving}>
                Save as a lead
              </Button>
            )}
            {saveBlocked && !savedId && <span className="text-[12px] text-stone">Add a company to save.</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function Field({ label, value, onChange, placeholder, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] text-stone">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] text-ink placeholder:text-stone/60 focus:border-orange focus:outline-none"
      />
    </label>
  )
}

function nextStep(action: string): string {
  if (action === 'reply') return 'Reply in the conversation. They already wrote to you.'
  if (action === 'research_more') return 'Look this up before you reply. It does not read as a request to buy.'
  return action.replaceAll('_', ' ')
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-stone">{label}</p>
      <p className="mt-0.5 text-[13px] capitalize text-ink">{value}</p>
    </div>
  )
}
