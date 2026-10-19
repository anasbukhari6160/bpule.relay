'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pause, Play, Target, Users, CheckCircle2, AlertTriangle, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { activityLabel, formatDefaultPack } from '@/lib/accountability/default-targets'
import { buildTeamTargetOverview } from '@/lib/accountability/target-overview'
import { DEFAULT_WEIGHTS } from '@/lib/performance/execution-score'
import { DashHeader, Initials, Panel, Pill, StatTile } from '@/components/dashboard/kit'
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
    const res = await fetch(`/api/admin/targets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patches) })
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

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading targets">
        <div className="h-16 w-72 animate-pulse rounded-lg bg-bone" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[88px] animate-pulse rounded-xl border border-line bg-bone-raised" />)}
        </div>
        <div className="h-[280px] animate-pulse rounded-xl border border-line bg-bone-raised" />
      </div>
    )
  }

  const visibleIdentities = identities.filter((i) => i.status !== 'archived')
  const orphanTargets = targets.filter((t) => !identityById.has(t.revenueIdentityId))

  return (
    <div className="space-y-6">
      <DashHeader
        eyebrow="Admin · Targets"
        title="Daily targets"
        subtitle="What each person should do per day, for each identity they send as. Edit a number and it saves when you leave the field."
        actions={
          <>
            {overview.missingPacks > 0 && (
              <Button onClick={() => void backfillMissing()} size="sm" variant="outline" disabled={saving}>
                <CheckCircle2 className="size-3.5" />
                Fill {overview.missingPacks} missing
              </Button>
            )}
            <Button onClick={() => setShowForm(!showForm)} size="sm" variant="orange">
              <Plus className="size-3.5" />
              Assign daily pack
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not complete that</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="People covered" value={overview.peopleCovered} icon={<Users className="size-3.5" />} tone="cobalt" />
        <StatTile label="Actions per day" value={overview.totalActionsPerDay} icon={<Target className="size-3.5" />} tone="orange" sub="Across the whole team" />
        <StatTile label="Active targets" value={overview.activeTargets} sub={`${overview.identityLanes} identity lanes`} />
        <StatTile label="Missing packs" value={overview.missingPacks} tone={overview.missingPacks > 0 ? 'warning' : 'success'} icon={<AlertTriangle className="size-3.5" />} sub={overview.missingPacks > 0 ? 'Someone has no standard pack' : 'Everyone is covered'} />
      </div>

      {showForm && (
        <Panel title="Assign a daily pack" subtitle="Pick the identity, then the person who will run it." action={<button type="button" onClick={() => setShowForm(false)} className="rounded p-1 text-stone hover:text-ink" aria-label="Close"><X className="size-4" /></button>}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="target-identity">Identity</Label>
                <Select id="target-identity" value={form.revenueIdentityId} onChange={(e) => selectIdentity(e.target.value)}>
                  <option value="">Select identity…</option>
                  {visibleIdentities.map((identity) => (
                    <option key={identity.id} value={identity.id}>{identity.identityName} · {identity.channel}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="target-rep">Person</Label>
                <Select id="target-rep" value={form.repId} onChange={(e) => setForm({ ...form, repId: e.target.value })} disabled={!form.revenueIdentityId}>
                  <option value="">{form.revenueIdentityId ? 'Select person…' : 'Pick an identity first'}</option>
                  {(form.assignIfNeeded ? reps : assignedRepsForIdentity.map((a) => repsById.get(a.repId)).filter(Boolean) as Rep[]).map((rep) => (
                    <option key={rep.id} value={rep.id}>{rep.name}{assignedRepsForIdentity.some((a) => a.repId === rep.id) ? '' : ' · will assign'}</option>
                  ))}
                </Select>
              </div>
            </div>
            {packPreview && (
              <p className="rounded-lg border border-orange/20 bg-orange/5 px-3 py-2 text-[13px] text-ink">Standard pack: {packPreview}</p>
            )}
            <label className="flex items-center gap-2 text-[12px] text-graphite">
              <input type="checkbox" className="size-3.5" checked={form.assignIfNeeded} onChange={(e) => setForm({ ...form, assignIfNeeded: e.target.checked })} />
              <span>Also give this person the identity if they don&apos;t have it</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void assignDailyPack()} disabled={saving || !canAssignPack}>
                {saving ? 'Saving…' : 'Assign standard pack'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <button type="button" onClick={() => setShowAdvanced((p) => !p)} className="ml-auto text-[12px] font-medium text-graphite hover:text-ink">
                {showAdvanced ? 'Hide custom target' : 'Set one custom target instead'}
              </button>
            </div>
            {showAdvanced && (
              <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-[1fr_140px_auto] sm:items-end">
                <div>
                  <Label htmlFor="target-activity">Activity</Label>
                  <Select id="target-activity" value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value as ActivityType })}>
                    {ACTIVITY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="target-count">Per day</Label>
                  <Input id="target-count" type="number" min={1} value={form.targetCount} onChange={(e) => setForm({ ...form, targetCount: Number.parseInt(e.target.value, 10) || 0 })} />
                </div>
                <Button onClick={() => void createSingleTarget()} disabled={saving || !canAssignPack || form.targetCount <= 0} variant="outline">
                  Save target
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Team targets" subtitle="One row per identity a person sends as" flush>
        {overview.people.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Target className="mx-auto mb-3 size-7 text-stone" aria-hidden="true" />
            <p className="text-[14px] font-medium text-ink">No targets assigned yet</p>
            <p className="mt-1 text-[12px] text-graphite">Use “Assign daily pack” to give someone a standard day.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {overview.people.map((person) => (
              <li key={person.repId} className="px-4 py-4 sm:px-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <Initials name={person.repName} tone={person.packComplete ? 'cobalt' : 'warning'} />
                  <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{person.repName}</p>
                  <span className="text-[13px] font-medium tabular-nums text-ink">{person.totalActionsPerDay}<span className="text-[11px] font-normal text-stone"> / day</span></span>
                  {!person.packComplete && <Pill tone="warning">incomplete</Pill>}
                </div>
                <div className="space-y-2 sm:pl-10">
                  {person.lanes.map((lane) => (
                    <div key={`${person.repId}-${lane.identityId}`} className="grid gap-2 rounded-lg border border-line/70 bg-bone/60 p-2.5 sm:grid-cols-[180px_1fr] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-ink">{lane.identityName}</p>
                        <p className="text-[11px] text-stone">{lane.channel} · {lane.actionsPerDay}/day</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lane.activities.map((activity) => {
                          const draft = draftCounts[activity.id] ?? activity.targetCount
                          const dirty = draft !== activity.targetCount
                          return (
                            <div key={activity.id} className={cn('flex items-center gap-1.5 rounded-md border bg-bone-raised py-1 pl-2.5 pr-1', activity.active ? 'border-line' : 'border-dashed border-line opacity-60')}>
                              <label htmlFor={`t-${activity.id}`} className="text-[11px] text-graphite">{activityLabel(activity.activityType)}</label>
                              <input
                                id={`t-${activity.id}`}
                                type="number"
                                min={1}
                                className="h-6 w-12 rounded border border-line bg-bone px-1.5 text-right text-[12px] tabular-nums text-ink focus:border-orange/50 focus:outline-none"
                                value={draft}
                                onChange={(e) => setDraftCounts((prev) => ({ ...prev, [activity.id]: Number.parseInt(e.target.value, 10) || 0 }))}
                                onBlur={() => { if (!dirty || draft <= 0) return; void patchTarget(activity.id, { targetCount: draft }).then(() => setDraftCounts((p) => { const n = { ...p }; delete n[activity.id]; return n })) }}
                              />
                              <button type="button" onClick={() => void patchTarget(activity.id, { active: !activity.active })} className="rounded p-1 text-stone hover:bg-bone hover:text-ink" title={activity.active ? 'Pause' : 'Resume'} aria-label={activity.active ? 'Pause target' : 'Resume target'}>
                                {activity.active ? <Pause className="size-3" /> : <Play className="size-3" />}
                              </button>
                              <button type="button" onClick={() => void deleteTarget(activity.id)} className="rounded p-1 text-stone hover:bg-bone hover:text-status-danger" title="Delete" aria-label="Delete target">
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          )
                        })}
                        {lane.missing.map((m) => (
                          <span key={m.activityType} className="flex items-center rounded-md border border-dashed border-status-warning/40 bg-status-warning/5 px-2.5 py-1 text-[11px] text-status-warning">
                            Missing · {activityLabel(m.activityType)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {orphanTargets.length > 0 && (
        <Panel title={`Unmatched targets (${orphanTargets.length})`} subtitle="Saved, but their identity was deleted. Safe to remove." flush>
          <ul className="divide-y divide-line/70">
            {orphanTargets.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-2.5 sm:px-5">
                <p className="text-[12px] text-graphite"><span className="font-medium text-ink">{activityLabel(t.activityType)}</span> · {t.targetCount}/day · {repsById.get(t.repId)?.name ?? 'Unknown'}</p>
                <button type="button" onClick={() => void deleteTarget(t.id)} className="rounded p-1 text-stone hover:text-status-danger" aria-label="Delete target"><Trash2 className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <details className="group rounded-xl border border-line bg-bone-raised">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[13px] font-medium text-ink marker:hidden">
          <ChevronRight className="size-3.5 text-stone transition-transform group-open:rotate-90" aria-hidden="true" />
          Advanced: how execution health is scored
        </summary>
        <PerformanceConfigSection />
      </details>
    </div>
  )
}

function PerformanceConfigSection() {
  const [weights, setWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS)
  const [replySla, setReplySla] = useState(2)
  const [followupSla, setFollowupSla] = useState(24)
  const [capRatio, setCapRatio] = useState(1.25)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/admin/performance/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.weights) setWeights(data.weights)
        if (data.replyUrgentHours) setReplySla(data.replyUrgentHours)
        if (data.followupOverdueHours) setFollowupSla(data.followupOverdueHours)
        if (data.capRatio) setCapRatio(data.capRatio)
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setFailed(false)
    try {
      const res = await fetch('/api/admin/performance/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weights,
          sla: { replyUrgentHours: replySla, followupOverdueHours: followupSla, capRatio },
        }),
      })
      setSaved(res.ok)
      setFailed(!res.ok)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-line">
      <p className="px-5 pt-3 text-[12px] text-graphite">Weights set how much each action counts toward a person’s health score. SLAs set when a reply or follow-up counts as late.</p>
      <div className="p-5 space-y-4">
        {/* Action Weights */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(weights).map(([key, val]) => (
            <label key={key} className="flex items-center gap-2 rounded border border-line bg-bone px-3 py-2">
              <span className="flex-1 truncate text-[11px] text-ink">{key.replace(/_/g, ' ')}</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={val}
                onChange={(e) => setWeights((p) => ({ ...p, [key]: Number.parseFloat(e.target.value) || 0 }))}
                className="h-6 w-14 rounded border border-line bg-bone-raised px-2 text-[11px] text-ink"
              />
            </label>
          ))}
        </div>

        {/* SLA Thresholds */}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded border border-line bg-bone px-3 py-2">
            <span className="flex-1 text-[11px] text-ink">Reply SLA (hours)</span>
            <input type="number" min={1} value={replySla} onChange={(e) => setReplySla(Number.parseInt(e.target.value, 10) || 2)} className="h-6 w-14 rounded border border-line bg-bone-raised px-2 text-[11px] text-ink" />
          </label>
          <label className="flex items-center gap-2 rounded border border-line bg-bone px-3 py-2">
            <span className="flex-1 text-[11px] text-ink">Follow-up SLA (hours)</span>
            <input type="number" min={1} value={followupSla} onChange={(e) => setFollowupSla(Number.parseInt(e.target.value, 10) || 24)} className="h-6 w-14 rounded border border-line bg-bone-raised px-2 text-[11px] text-ink" />
          </label>
          <label className="flex items-center gap-2 rounded border border-line bg-bone px-3 py-2">
            <span className="flex-1 text-[11px] text-ink">Completion cap</span>
            <input type="number" min={1} step={0.05} value={capRatio} onChange={(e) => setCapRatio(Number.parseFloat(e.target.value) || 1.25)} className="h-6 w-14 rounded border border-line bg-bone-raised px-2 text-[11px] text-ink" />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} size="sm" variant="orange" disabled={saving}>
            {saving ? 'Saving…' : 'Save config'}
          </Button>
          {saved && <span className="text-[12px] text-status-success">Saved.</span>}
          {failed && <span className="text-[12px] text-status-danger">Could not save. Try again.</span>}
        </div>
      </div>
    </div>
  )
}
