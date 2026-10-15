'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pause, Play, Target, Users, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { activityLabel, formatDefaultPack } from '@/lib/accountability/default-targets'
import { buildTeamTargetOverview } from '@/lib/accountability/target-overview'
import type { DailyTarget, RevenueIdentity, Rep, ActivityType, IdentityAssignment } from '@/lib/domain/types'

const ACTIVITY_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'email', label: 'Emails' },
  { value: 'connection_request', label: 'Connections' },
  { value: 'dm', label: 'DMs' },
  { value: 'followup', label: 'Follow-ups' },
  { value: 'application', label: 'Applications' },
  { value: 'proposal', label: 'Proposals' },
  { value: 'other', label: 'Other' },
]

interface TargetsPayload {
  targets?: DailyTarget[]
  identities?: RevenueIdentity[]
  assignments?: IdentityAssignment[]
  reps?: Rep[]
  error?: string
}

export function TargetsManager() {
  const [targets, setTargets] = useState<DailyTarget[]>([])
  const [identities, setIdentities] = useState<RevenueIdentity[]>([])
  const [reps, setReps] = useState<Rep[]>([])
  const [assignments, setAssignments] = useState<IdentityAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [form, setForm] = useState({
    revenueIdentityId: '',
    repId: '',
    activityType: 'dm' as ActivityType,
    targetCount: 30,
    assignIfNeeded: true,
  })
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/targets', { cache: 'no-store' })
    const data = (await res.json().catch(() => ({}))) as TargetsPayload
    if (!res.ok) throw new Error(data.error ?? 'Failed to load targets.')
    setTargets(data.targets ?? [])
    setIdentities(data.identities ?? [])
    setAssignments(data.assignments ?? [])
    setReps(data.reps ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
      load()
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load targets.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load])

  const identityById = useMemo(() => new Map(identities.map((i) => [i.id, i])), [identities])
  const repsById = useMemo(() => new Map(reps.map((r) => [r.id, r])), [reps])
  const overview = useMemo(() => buildTeamTargetOverview({ reps, identities, assignments, targets }), [reps, identities, assignments, targets])

  const selectedIdentity = identityById.get(form.revenueIdentityId)
  const assignedRepsForIdentity = form.revenueIdentityId
    ? assignments.filter((a) => a.revenueIdentityId === form.revenueIdentityId)
    : []
  const packPreview = selectedIdentity ? formatDefaultPack(selectedIdentity.channel) : null
  const canAssignPack = Boolean(form.repId && form.revenueIdentityId)

  function selectIdentity(revenueIdentityId: string) {
    const nextAssignments = assignments.filter((a) => a.revenueIdentityId === revenueIdentityId)
    setForm((prev) => ({
      ...prev,
      revenueIdentityId,
      repId: nextAssignments.length === 1 ? nextAssignments[0].repId : '',
    }))
  }

  async function assignDailyPack() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/targets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repId: form.repId, revenueIdentityId: form.revenueIdentityId, assignIfNeeded: form.assignIfNeeded }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to assign daily pack.')
      await load(); setShowForm(false)
      setForm({ revenueIdentityId: '', repId: '', activityType: 'dm', targetCount: 30, assignIfNeeded: true })
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to assign daily pack.') }
    finally { setSaving(false) }
  }

  async function createSingleTarget() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/targets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repId: form.repId, revenueIdentityId: form.revenueIdentityId, activityType: form.activityType, targetCount: form.targetCount, assignIfNeeded: form.assignIfNeeded }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save target.')
      await load(); setShowForm(false); setShowAdvanced(false)
      setForm({ revenueIdentityId: '', repId: '', activityType: 'dm', targetCount: 30, assignIfNeeded: true })
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save target.') }
    finally { setSaving(false) }
  }

  async function backfillMissing() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backfillMissing: true }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to apply standard packs.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to apply standard packs.') }
    finally { setSaving(false) }
  }

  async function patchTarget(id: string, patches: { targetCount?: number; active?: boolean }) {
    setError(null)
    const res = await fetch(`/api/admin/targets/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patches) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Update failed'); return }
    const updated = data.target as DailyTarget
    setTargets((prev) => prev.map((t) => (t.id === id ? updated : t)))
  }

  async function deleteTarget(id: string) {
    setError(null)
    const res = await fetch(`/api/admin/targets/${id}`, { method: 'DELETE' })
    if (!res.ok) { setError('Delete failed'); return }
    setTargets((prev) => prev.filter((t) => t.id !== id))
  }

  if (loading) return <div className="text-sm text-graphite">Loading targets…</div>

  const visibleIdentities = identities.filter((i) => i.status !== 'archived')
  const orphanTargets = targets.filter((t) => !identityById.has(t.revenueIdentityId))

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange">Admin / Targets</p>
          <h1 className="mt-1 text-[26px] font-medium tracking-[-0.02em] text-ink">Daily Targets</h1>
          <p className="mt-1 max-w-lg text-[13px] text-graphite">Assign daily activity targets to your team. Each person gets a standard pack per identity.</p>
        </div>
        <div className="flex gap-2">
          {overview.missingPacks > 0 && (
            <Button onClick={() => void backfillMissing()} size="sm" variant="outline" disabled={saving}>
              <CheckCircle2 className="size-3.5 mr-1.5" />
              Auto-fill {overview.missingPacks} missing
            </Button>
          )}
          <Button onClick={() => setShowForm(!showForm)} size="sm" variant="orange">
            <Plus className="size-3.5 mr-1.5" />
            Add target
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not complete that</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-orange/20 bg-orange/5 px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light">People covered</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{overview.peopleCovered}</p>
        </div>
        <div className="rounded border border-cobalt/20 bg-cobalt/5 px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-cobalt">Active targets</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{overview.activeTargets}</p>
        </div>
        <div className="rounded border border-line px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-stone">Actions / day</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{overview.totalActionsPerDay}</p>
        </div>
        <div className="rounded border border-status-warning/30 bg-status-warning/5 px-4 py-3">
          <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-status-warning">Missing packs</p>
          <p className="mt-1 text-[22px] font-medium text-ink">{overview.missingPacks}</p>
          {overview.missingPacks > 0 && (
            <p className="mt-1 text-[11px] text-status-warning flex items-center gap-1"><AlertTriangle className="size-3" />Action needed</p>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <section className="rounded-lg border border-line bg-bone-raised p-5 space-y-4">
          <div>
            <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Assign daily pack</p>
            <p className="mt-1 text-[13px] text-graphite">Pick the identity and the person who will run it.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="target-identity">Revenue identity</Label>
              <Select id="target-identity" value={form.revenueIdentityId} onChange={(e) => selectIdentity(e.target.value)}>
                <option value="">Select identity…</option>
                {visibleIdentities.map((identity) => (
                  <option key={identity.id} value={identity.id}>{identity.identityName} · {identity.channel}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="target-rep">Rep</Label>
              <Select id="target-rep" value={form.repId} onChange={(e) => setForm({ ...form, repId: e.target.value })} disabled={!form.revenueIdentityId}>
                <option value="">{form.revenueIdentityId ? 'Select rep…' : 'Pick an identity first'}</option>
                {(form.assignIfNeeded ? reps : assignedRepsForIdentity.map((a) => repsById.get(a.repId)).filter(Boolean) as Rep[]).map((rep) => (
                  <option key={rep.id} value={rep.id}>{rep.name}{assignedRepsForIdentity.some((a) => a.repId === rep.id) ? '' : ' · will assign'}</option>
                ))}
              </Select>
            </div>
          </div>
          {packPreview && (
            <p className="rounded border border-orange/20 bg-orange/5 px-3 py-2 text-[13px] text-ink">Standard pack: {packPreview}</p>
          )}
          <label className="flex items-center gap-2 text-[12px] text-graphite">
            <input type="checkbox" className="size-3.5" checked={form.assignIfNeeded} onChange={(e) => setForm({ ...form, assignIfNeeded: e.target.checked })} />
            <span>Assign the identity to this rep if needed</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={() => void assignDailyPack()} disabled={saving || !canAssignPack}>
              {saving ? 'Saving' : 'Assign daily pack'}
            </Button>
          </div>
          <button type="button" onClick={() => setShowAdvanced((p) => !p)} className="text-[12px] font-medium text-graphite hover:text-ink">
            {showAdvanced ? 'Hide' : 'Add single activity instead'}
          </button>
          {showAdvanced && (
            <div className="grid gap-4 sm:grid-cols-2 border-t border-line pt-4">
              <div>
                <Label htmlFor="target-activity">Activity</Label>
                <Select id="target-activity" value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value as ActivityType })}>
                  {ACTIVITY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </Select>
              </div>
              <div>
                <Label htmlFor="target-count">Daily count</Label>
                <Input id="target-count" type="number" min={1} value={form.targetCount} onChange={(e) => setForm({ ...form, targetCount: Number.parseInt(e.target.value, 10) || 0 })} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button onClick={() => void createSingleTarget()} disabled={saving || !canAssignPack || form.targetCount <= 0} variant="outline">
                  Save activity
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Team overview */}
      {overview.people.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-16 text-center">
          <Target className="mx-auto mb-3 size-8 text-stone" />
          <p className="text-[15px] font-medium text-ink">No targets assigned yet</p>
          <p className="mt-1 text-[13px] text-graphite">Click "Add target" to assign a daily pack to someone.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Team visibility</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview.people.map((person) => (
              <article key={person.repId} className="rounded-lg border border-line bg-bone-raised overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <Users className="size-3.5 text-stone" />
                    <p className="text-[14px] font-medium text-ink">{person.repName}</p>
                  </div>
                  <span className={cn('text-[11px] font-medium', person.packComplete ? 'text-status-success' : 'text-status-warning')}>
                    {person.totalActionsPerDay}/day
                  </span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {person.lanes.map((lane) => (
                    <div key={`${person.repId}-${lane.identityId}`}>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-medium text-ink">{lane.identityName}</span>
                        <span className="text-graphite">{lane.actionsPerDay} actions</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {lane.activities.map((activity) => {
                          const draft = draftCounts[activity.id] ?? activity.targetCount
                          const dirty = draft !== activity.targetCount
                          return (
                            <div key={activity.id} className="flex items-center gap-1 rounded border border-line bg-bone px-2 py-0.5">
                              <span className={cn('text-[10px]', activity.active ? 'text-ink' : 'text-stone')}>{activityLabel(activity.activityType)}</span>
                              <Input type="number" min={1} className="h-6 w-12 text-[10px]" value={draft}
                                onChange={(e) => setDraftCounts((prev) => ({ ...prev, [activity.id]: Number.parseInt(e.target.value, 10) || 0 }))}
                                onBlur={() => { if (!dirty || draft <= 0) return; void patchTarget(activity.id, { targetCount: draft }).then(() => setDraftCounts((p) => { const n = { ...p }; delete n[activity.id]; return n })) }}
                              />
                              <button onClick={() => void patchTarget(activity.id, { active: !activity.active })} className="rounded p-0.5 text-stone hover:text-ink" title={activity.active ? 'Pause' : 'Resume'}>
                                {activity.active ? <Pause className="size-3" /> : <Play className="size-3" />}
                              </button>
                              <button onClick={() => void deleteTarget(activity.id)} className="rounded p-0.5 text-stone hover:text-status-danger" title="Delete">
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          )
                        })}
                        {lane.missing.map((m) => (
                          <span key={m.activityType} className="rounded border border-dashed border-status-warning/30 bg-status-warning/5 px-2 py-0.5 text-[10px] text-status-warning">
                            Missing {activityLabel(m.activityType).toLowerCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {orphanTargets.length > 0 && (
        <article className="rounded-lg border border-dashed border-status-danger/30 bg-status-danger/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-[14px] font-medium text-ink">Unmatched targets ({orphanTargets.length})</p>
            <p className="text-[12px] text-graphite">Saved but the identity record is missing.</p>
          </div>
          <ul className="divide-y divide-line/60">
            {orphanTargets.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">{activityLabel(t.activityType)}</p>
                  <p className="text-[12px] text-graphite">{t.targetCount}/day · {repsById.get(t.repId)?.name ?? 'Unknown'}</p>
                </div>
                <button onClick={() => void deleteTarget(t.id)} className="rounded p-1 text-stone hover:text-status-danger"><Trash2 className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </article>
      )}
    </div>
  )
}
