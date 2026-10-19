'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Archive, ArchiveRestore, Trash2, UserPlus, Pencil, ExternalLink, X, AlertCircle, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogActions } from '@/components/ui/dialog'
import { cn } from 'cn'
import { EmptyNote, Initials, Panel, Pill } from '@/components/dashboard/kit'
import type { RevenueIdentity, RevenueIdentityChannel, IdentityAssignment, Rep } from '@/lib/domain/types'

interface IdentityForm {
  profileId: string
  identityName: string
  slug: string
  slugTouched: boolean
  title: string
  positioning: string
  profileUrl: string
  skills: string
  industries: string
  technologies: string
  channel: RevenueIdentityChannel
  proposalPositioning: string
  assignRepId: string
}

interface ProfileOption {
  id: string
  fullName: string | null
  displayName: string | null
  currentRole: string | null
  headline?: string | null
  positioning: string | null
  primarySkills: string[]
  technologies: string[]
  industries: string[]
}

const INITIAL_FORM: IdentityForm = {
  profileId: '',
  identityName: '',
  slug: '',
  slugTouched: false,
  title: '',
  positioning: '',
  profileUrl: '',
  skills: '',
  industries: '',
  technologies: '',
  channel: 'linkedin',
  proposalPositioning: '',
  assignRepId: '',
}

const CHANNEL_META: Record<string, { label: string; short: string; cls: string }> = {
  linkedin: { label: 'LinkedIn', short: 'in', cls: 'bg-cobalt/10 text-cobalt' },
  email: { label: 'Email', short: '@', cls: 'bg-orange/10 text-orange' },
  upwork: { label: 'Upwork', short: 'U', cls: 'bg-status-success/10 text-status-success' },
  other: { label: 'Other', short: '•', cls: 'bg-bone text-graphite' },
}

function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]+/).map((t) => t.trim()).filter(Boolean))].slice(0, 20)
}

function serializeTags(tags: string[] | string | null | undefined): string {
  if (!tags) return ''
  if (typeof tags === 'string') return tags
  if (!Array.isArray(tags)) return ''
  return tags.join(', ')
}

function slugify(name: string, channel: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base ? `${base}-${channel}` : ''
}

function profileName(p: ProfileOption): string {
  return p.fullName ?? p.displayName ?? 'Unnamed profile'
}

export function RevenueIdentityManager() {
  const searchParams = useSearchParams()
  const [identities, setIdentities] = useState<RevenueIdentity[]>([])
  const [reps, setReps] = useState<Rep[]>([])
  const [assignments, setAssignments] = useState<IdentityAssignment[]>([])
  const [profiles, setProfiles] = useState<ProfileOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<IdentityForm | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [assignDialog, setAssignDialog] = useState<string | null>(null)
  const [selectedRep, setSelectedRep] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const formRef = useRef<HTMLDivElement>(null)
  const handledFromProfile = useRef(false)

  const loadData = useCallback(async () => {
    try {
      const [idRes, repRes, asgnRes, profRes] = await Promise.all([
        fetch('/api/admin/revenue-identities'),
        fetch('/api/reps'),
        fetch('/api/admin/assignments'),
        fetch('/api/profile-intelligence/profiles?limit=200'),
      ])
      const idData = await idRes.json()
      if (!idRes.ok) throw new Error(idData.error ?? 'Failed to load identities')
      const repData = await repRes.json().catch(() => ({}))
      const asgnData = await asgnRes.json().catch(() => ({}))
      const profData = await profRes.json().catch(() => ({}))
      setIdentities(idData.identities ?? [])
      setReps(repData.reps ?? [])
      setAssignments(asgnData.assignments ?? [])
      setProfiles(profData.profiles ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  const repById = useMemo(() => new Map(reps.map((r) => [r.id, r])), [reps])

  const fillFromProfile = useCallback((prev: IdentityForm, profileId: string): IdentityForm => {
    const p = profiles.find((x) => x.id === profileId)
    if (!p) return { ...prev, profileId }
    const name = profileName(p)
    return {
      ...prev,
      profileId,
      identityName: prev.identityName || name,
      slug: prev.slugTouched ? prev.slug : slugify(prev.identityName || name, prev.channel),
      title: prev.title || p.currentRole || p.headline || '',
      positioning: prev.positioning || p.positioning || '',
      skills: prev.skills || serializeTags(p.primarySkills),
      technologies: prev.technologies || serializeTags(p.technologies),
      industries: prev.industries || serializeTags(p.industries),
    }
  }, [profiles])

  function openCreate(profileId?: string) {
    const base = { ...INITIAL_FORM }
    setForm(profileId ? fillFromProfile(base, profileId) : base)
    setEditId(null)
    setError(null)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // Arriving from a profile ("Create sending identity") opens a prefilled form.
  useEffect(() => {
    const fromProfile = searchParams.get('fromProfile')
    if (!fromProfile || handledFromProfile.current || loading || profiles.length === 0) return
    handledFromProfile.current = true
    openCreate(fromProfile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, profiles])

  function openEdit(id: string) {
    const ri = identities.find((r) => r.id === id)
    if (!ri) return
    setForm({
      profileId: ri.profileId ?? '',
      identityName: ri.identityName,
      slug: ri.slug,
      slugTouched: true,
      title: ri.title ?? '',
      positioning: ri.positioning ?? '',
      profileUrl: ri.profileUrl ?? '',
      skills: serializeTags(ri.skills),
      industries: serializeTags(ri.industries),
      technologies: serializeTags(ri.technologies),
      channel: ri.channel,
      proposalPositioning: ri.proposalPositioning ?? '',
      assignRepId: '',
    })
    setEditId(id)
    setError(null)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function closeForm() {
    setForm(null)
    setEditId(null)
  }

  async function saveForm() {
    if (!form) return
    const slug = form.slug.trim() || slugify(form.identityName, form.channel)
    if (!form.identityName.trim() || !slug) {
      setError('Give the identity a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const url = editId ? `/api/admin/revenue-identities/${editId}` : '/api/admin/revenue-identities'
      const res = await fetch(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityName: form.identityName.trim(),
          slug,
          title: form.title.trim() || null,
          positioning: form.positioning.trim() || null,
          profileUrl: form.profileUrl.trim() || null,
          skills: parseTags(form.skills),
          industries: parseTags(form.industries),
          technologies: parseTags(form.technologies),
          channel: form.channel,
          proposalPositioning: form.proposalPositioning.trim() || null,
          profileId: form.profileId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      const newId = (data.identity?.id as string | undefined) ?? editId
      if (!editId && newId && form.assignRepId) {
        const asg = await fetch(`/api/admin/revenue-identities/${newId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repId: form.assignRepId }),
        })
        if (!asg.ok) {
          const d = await asg.json().catch(() => ({}))
          setError(`Identity created, but assigning failed: ${d.error ?? 'unknown error'}`)
        }
      }
      closeForm()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function setIdentityStatus(id: string, next: 'active' | 'archived') {
    const res = await fetch(`/api/admin/revenue-identities/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Update failed'); return }
    await loadData()
  }

  async function deleteIdentity() {
    if (!pendingDelete) return
    const res = await fetch(`/api/admin/revenue-identities/${pendingDelete}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Delete failed') }
    setPendingDelete(null)
    await loadData()
  }

  async function assignRep() {
    if (!assignDialog || !selectedRep) return
    const res = await fetch(`/api/admin/revenue-identities/${assignDialog}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repId: selectedRep }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Assign failed') }
    setAssignDialog(null)
    setSelectedRep('')
    await loadData()
  }

  async function unassignRep(identityId: string, repId: string) {
    const res = await fetch(`/api/admin/revenue-identities/${identityId}/assign?repId=${encodeURIComponent(repId)}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Unassign failed') }
    await loadData()
  }

  if (loading) {
    return <div className="h-[280px] animate-pulse rounded-xl border border-line bg-bone-raised" aria-busy="true" aria-label="Loading identities" />
  }

  const activeCount = identities.filter((i) => i.status !== 'archived').length
  const archivedCount = identities.length - activeCount
  const q = query.trim().toLowerCase()
  const visible = identities.filter((ri) => {
    if (status === 'active' ? ri.status === 'archived' : ri.status !== 'archived') return false
    if (!q) return true
    const linked = ri.profileId ? profileById.get(ri.profileId) : undefined
    return [ri.identityName, ri.title, ri.channel, linked ? profileName(linked) : ''].join(' ').toLowerCase().includes(q)
  })
  const unlinkedProfiles = profiles.filter((p) => !identities.some((i) => i.profileId === p.id && i.status !== 'archived'))

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Could not complete that</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {form && (
        <div ref={formRef}>
          <Panel
            title={editId ? 'Edit sending identity' : 'New sending identity'}
            subtitle="How a rep shows up in outreach. Start from a profile to reuse its experience and skills."
            action={<button type="button" onClick={closeForm} className="rounded p-1 text-stone hover:text-ink" aria-label="Close"><X className="size-4" /></button>}
          >
            <div className="space-y-5">
              <div className="rounded-lg border border-line/70 bg-bone p-3">
                <Label htmlFor="ri-profile">Built from profile</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    id="ri-profile"
                    className="min-w-[220px] flex-1"
                    value={form.profileId}
                    onChange={(e) => setForm(editId ? { ...form, profileId: e.target.value } : fillFromProfile(form, e.target.value))}
                  >
                    <option value="">No profile — enter details by hand</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{profileName(p)}{p.currentRole ? ` · ${p.currentRole}` : ''}</option>
                    ))}
                  </Select>
                  <Link href="/profile-intelligence" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-cobalt hover:underline">
                    <Upload className="size-3.5" aria-hidden="true" />Person not listed? Add them from a CV
                  </Link>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ri-name">Name reps send as</Label>
                  <Input
                    id="ri-name"
                    value={form.identityName}
                    onChange={(e) => setForm({ ...form, identityName: e.target.value, slug: form.slugTouched ? form.slug : slugify(e.target.value, form.channel) })}
                    placeholder="e.g. Mehak Ali"
                  />
                </div>
                <div>
                  <Label htmlFor="ri-channel">Channel</Label>
                  <Select
                    id="ri-channel"
                    value={form.channel}
                    onChange={(e) => {
                      const channel = e.target.value as RevenueIdentityChannel
                      setForm({ ...form, channel, slug: form.slugTouched ? form.slug : slugify(form.identityName, channel) })
                    }}
                  >
                    <option value="linkedin">LinkedIn</option>
                    <option value="email">Email</option>
                    <option value="upwork">Upwork</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ri-title">Title</Label>
                  <Input id="ri-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Senior Engineer" />
                </div>
                <div>
                  <Label htmlFor="ri-url">Profile URL</Label>
                  <Input id="ri-url" value={form.profileUrl} onChange={(e) => setForm({ ...form, profileUrl: e.target.value })} placeholder="https://linkedin.com/in/…" />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="ri-positioning">Positioning</Label>
                  <Textarea id="ri-positioning" value={form.positioning} onChange={(e) => setForm({ ...form, positioning: e.target.value })} rows={2} placeholder="What this identity is known for…" />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="ri-skills">Skills (comma-separated)</Label>
                  <Input id="ri-skills" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="React, Node.js, AWS" />
                </div>
                {!editId && (
                  <div className="sm:col-span-2">
                    <Label htmlFor="ri-assign">Assign to (optional)</Label>
                    <Select id="ri-assign" value={form.assignRepId} onChange={(e) => setForm({ ...form, assignRepId: e.target.value })}>
                      <option value="">Assign later</option>
                      {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                    <p className="mt-1 text-[11px] text-stone">Assigning also gives that person the standard daily pack for this channel.</p>
                  </div>
                )}
              </div>

              <details className="group">
                <summary className="cursor-pointer list-none text-[12px] font-medium text-graphite hover:text-ink marker:hidden">More details (industries, technologies, proposals, slug)</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ri-industries">Industries</Label>
                    <Input id="ri-industries" value={form.industries} onChange={(e) => setForm({ ...form, industries: e.target.value })} placeholder="SaaS, FinTech" />
                  </div>
                  <div>
                    <Label htmlFor="ri-tech">Technologies</Label>
                    <Input id="ri-tech" value={form.technologies} onChange={(e) => setForm({ ...form, technologies: e.target.value })} placeholder="Next.js, Firebase" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ri-proposal">Proposal positioning</Label>
                    <Textarea id="ri-proposal" value={form.proposalPositioning} onChange={(e) => setForm({ ...form, proposalPositioning: e.target.value })} rows={2} />
                  </div>
                  <div>
                    <Label htmlFor="ri-slug">Slug</Label>
                    <Input id="ri-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'), slugTouched: true })} placeholder="mehak-linkedin" />
                  </div>
                </div>
              </details>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeForm}>Cancel</Button>
                <Button onClick={() => void saveForm()} disabled={saving}>
                  {saving ? 'Saving…' : editId ? 'Save changes' : 'Create identity'}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {!form && unlinkedProfiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line bg-bone-raised px-4 py-3 text-[12px] text-graphite">
          <span className="font-medium text-ink">{unlinkedProfiles.length} {unlinkedProfiles.length === 1 ? 'profile has' : 'profiles have'} no sending identity yet:</span>
          {unlinkedProfiles.slice(0, 4).map((p) => (
            <button key={p.id} type="button" onClick={() => openCreate(p.id)} className="inline-flex items-center gap-1 rounded-full border border-line bg-bone px-2.5 py-0.5 text-[11px] text-ink hover:border-orange/40">
              <Plus className="size-3" aria-hidden="true" />{profileName(p)}
            </button>
          ))}
          {unlinkedProfiles.length > 4 && <span className="text-stone">+{unlinkedProfiles.length - 4} more</span>}
        </div>
      )}

      <section className="rounded-xl border border-line bg-bone-raised" aria-label="Sending identities">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search identities"
              aria-label="Search identities"
              className="h-8 w-full rounded-md border border-line bg-bone pl-8 pr-3 text-[12px] text-ink placeholder:text-stone focus:border-orange/50 focus:outline-none"
            />
          </div>
          <div className="inline-flex rounded-lg border border-line bg-bone p-0.5" role="group" aria-label="Status">
            {(['active', 'archived'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={cn('rounded-md px-3 py-1 text-[12px] font-medium', status === s ? 'bg-bone-raised text-ink shadow-sm' : 'text-stone hover:text-ink')}
              >
                {s === 'active' ? `Active ${activeCount}` : `Archived ${archivedCount}`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="orange" onClick={() => openCreate()}>
            <Plus className="size-3.5" /> New identity
          </Button>
        </header>

        {visible.length === 0 ? (
          <EmptyNote>
            {identities.length === 0
              ? 'No sending identities yet. Create one from a profile so reps have someone to send as.'
              : status === 'archived' ? 'No archived identities.' : 'No identities match.'}
          </EmptyNote>
        ) : (
          <ul className="divide-y divide-line/70">
            {visible.map((ri) => {
              const meta = CHANNEL_META[ri.channel] ?? CHANNEL_META.other
              const linked = ri.profileId ? profileById.get(ri.profileId) : undefined
              const riAssignments = assignments.filter((a) => a.revenueIdentityId === ri.id)
              return (
                <li key={ri.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5 lg:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                  <span className={cn('flex size-8 items-center justify-center rounded-lg text-[11px] font-semibold', meta.cls)} title={meta.label}>{meta.short}</span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      <span className="truncate">{ri.identityName}</span>
                      {ri.profileUrl && (
                        <a href={ri.profileUrl} target="_blank" rel="noopener noreferrer" className="text-stone hover:text-cobalt" aria-label={`Open ${ri.identityName}'s public profile`}>
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-stone">{[ri.title, meta.label].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-0.5 lg:order-last">
                    <IconButton label="Edit" onClick={() => openEdit(ri.id)}><Pencil className="size-3.5" /></IconButton>
                    {ri.status === 'archived' ? (
                      <IconButton label="Restore" onClick={() => void setIdentityStatus(ri.id, 'active')}><ArchiveRestore className="size-3.5" /></IconButton>
                    ) : (
                      <>
                        <IconButton label="Assign to someone" onClick={() => setAssignDialog(ri.id)}><UserPlus className="size-3.5" /></IconButton>
                        <IconButton label="Archive" onClick={() => void setIdentityStatus(ri.id, 'archived')}><Archive className="size-3.5" /></IconButton>
                      </>
                    )}
                    <IconButton label="Delete" danger onClick={() => setPendingDelete(ri.id)}><Trash2 className="size-3.5" /></IconButton>
                  </div>
                  <div className="col-span-2 col-start-2 min-w-0 text-[12px] lg:col-span-1 lg:col-start-auto">
                    {linked ? (
                      <Link href={`/profile-intelligence/${linked.id}`} className="inline-flex max-w-full items-center gap-1.5 text-ink hover:underline">
                        <Initials name={profileName(linked)} size="sm" />
                        <span className="truncate">{profileName(linked)}</span>
                      </Link>
                    ) : (
                      <span className="text-stone">No linked profile</span>
                    )}
                  </div>
                  <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-center gap-1 lg:col-span-1 lg:col-start-auto">
                    {riAssignments.length === 0 ? (
                      <Pill tone="warning">Nobody assigned</Pill>
                    ) : riAssignments.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-bone py-0.5 pl-2 pr-1 text-[11px] text-ink">
                        {repById.get(a.repId)?.name ?? 'Former teammate'}
                        <button type="button" onClick={() => void unassignRep(ri.id, a.repId)} className="rounded-full p-0.5 text-stone hover:bg-bone-raised hover:text-status-danger" aria-label={`Remove ${repById.get(a.repId)?.name ?? 'person'}`}>
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {pendingDelete && (
        <Dialog open onClose={() => setPendingDelete(null)} title="Delete identity">
          <div className="space-y-3 p-5">
            <p className="text-sm text-graphite">This permanently removes the sending identity and its assignments. Archive it instead if you may need it again.</p>
          </div>
          <DialogActions>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void deleteIdentity()}>Delete</Button>
          </DialogActions>
        </Dialog>
      )}

      {assignDialog && (
        <Dialog open onClose={() => setAssignDialog(null)} title="Assign to someone">
          <div className="space-y-3 p-5">
            <p className="text-[12px] text-graphite">
              They also get the standard daily pack for this channel: 30 connections, 30 DMs and 30 follow-ups on LinkedIn; 30 emails and 25 follow-ups on Email; or 10 applications and 10 proposals on Upwork. Existing numbers are kept.
            </p>
            <Select value={selectedRep} onChange={(e) => setSelectedRep(e.target.value)} aria-label="Person">
              <option value="">Select a person…</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </div>
          <DialogActions>
            <Button variant="outline" onClick={() => setAssignDialog(null)}>Cancel</Button>
            <Button onClick={() => void assignRep()} disabled={!selectedRep}>Assign</Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  )
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('rounded-md p-1.5 text-stone hover:bg-bone', danger ? 'hover:text-status-danger' : 'hover:text-ink')}
    >
      {children}
    </button>
  )
}
