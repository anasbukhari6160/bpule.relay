'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Shield, ExternalLink, CheckCircle2, AlertTriangle, ArrowRight, Bell, Check } from 'lucide-react'
import { cn } from 'cn'
import type { TargetProgressView, ActivityType } from '@/lib/domain/types'
import { normalizeAssignedProfiles, type AssignedProfilesModel } from '@/lib/relay/assigned-profiles'

const ACTIVE_IDENTITY_STORAGE_KEY = 'scout:active-identity-assignment-id'

function readStoredActiveIdentity(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_IDENTITY_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredActiveIdentity(assignmentId: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_IDENTITY_STORAGE_KEY, assignmentId)
  } catch {
    // Best-effort only — a rep can still switch identities within the
    // session even if persistence fails (e.g. private browsing).
  }
}

const CHANNEL_STYLE: Record<string, { bg: string; text: string; glyph: string }> = {
  linkedin: { bg: 'bg-[#0a66c2]/10', text: 'text-[#0a66c2]', glyph: 'in' },
  email: { bg: 'bg-[#d97706]/10', text: 'text-[#d97706]', glyph: '@' },
  upwork: { bg: 'bg-[#14a800]/10', text: 'text-[#14a800]', glyph: 'U' },
}

function channelStyle(channel: string) {
  return CHANNEL_STYLE[channel] ?? { bg: 'bg-graphite/10', text: 'text-graphite', glyph: '•' }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-status-success/10 text-status-success',
    on_track: 'bg-cobalt/10 text-cobalt',
    at_risk: 'bg-status-warning/10 text-status-warning',
    missed: 'bg-status-danger/10 text-status-danger',
  }
  const labels: Record<string, string> = {
    completed: 'Complete',
    on_track: 'On Track',
    at_risk: 'At Risk',
    missed: 'Missed',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', styles[status] ?? 'bg-stone/20 text-slate')}>
      {labels[status] ?? status}
    </span>
  )
}

function activityLabel(t: ActivityType): string {
  const map: Record<ActivityType, string> = { dm: 'DMs', email: 'Emails', connection_request: 'Connections', followup: 'Follow-ups', application: 'Applications', proposal: 'Proposals', prospect_extracted: 'Prospects captured', other: 'Other' }
  return map[t] ?? t
}

export function AssignedProfilesView() {
  const [data, setData] = useState<AssignedProfilesModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/rep/today')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load'))))
      .then((d) => setData(normalizeAssignedProfiles(d)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [])

  // to the first assigned identity — so a rep with only one identity never
  // sees an "unset" state, and a rep with several always has a clear answer
  // to "which one am I working as right now."
  useEffect(() => {
    if (!data || data.assignedIdentities.length === 0) return
    const stored = readStoredActiveIdentity()
    const validIds = new Set(data.assignedIdentities.map((ai) => ai.assignmentId))
    if (stored && validIds.has(stored)) {
      setActiveAssignmentId(stored)
    } else {
      const fallback = data.assignedIdentities[0].assignmentId
      setActiveAssignmentId(fallback)
      writeStoredActiveIdentity(fallback)
    }
  }, [data])

  function selectIdentity(assignmentId: string) {
    setActiveAssignmentId(assignmentId)
    writeStoredActiveIdentity(assignmentId)
  }

  if (loading) return <div className="text-sm text-slate">Loading your assignments…</div>
  if (error) return <div className="text-sm text-status-danger">{error}</div>
  if (!data) return null

  const completionPct = data.totalTarget > 0
    ? Math.min(100, Math.round((data.totalCompleted / data.totalTarget) * 100))
    : 100
  const urgentTargets = data.assignedIdentities
    .flatMap((ai) => (ai.targets ?? []).map((target) => ({ identityName: ai.identity.identityName, target })))
    .filter((row) => row.target.status === 'at_risk' || row.target.status === 'missed')

  const nextAction =
    urgentTargets[0]?.target.status === 'missed'
      ? 'Recover missed targets first. Relay can reprioritize your queue on Today.'
      : urgentTargets.length > 0
        ? 'You have targets at risk. Clear those before adding new work.'
        : 'You are on track. Keep executing from Today and close remaining actions.'

  return (
    <div className="space-y-5">
      <section className="srf-console srf-console-edge overflow-hidden px-5 py-5 sm:px-6">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-orange-light">Execution / Assigned Identities</p>
        <h2 className="mt-2 text-[24px] leading-[1.08] tracking-[-0.03em] text-[color:var(--console-text)]">
          {data.repName}, work from assigned identities only.
        </h2>
        <p className="mt-2 text-[13px] text-[color:var(--console-mute)]">{nextAction}</p>

        {data.assignedIdentities.length > 0 ? (
          <div className="mt-4 rounded-lg border border-orange/25 bg-orange/5 px-4 py-3">
            <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">Working as</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.assignedIdentities.map((ai) => {
                const style = channelStyle(ai.identity.channel)
                const isActive = ai.assignmentId === activeAssignmentId
                return (
                  <button
                    key={ai.assignmentId}
                    type="button"
                    onClick={() => selectIdentity(ai.assignmentId)}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                      isActive
                        ? 'border-orange bg-orange text-on-accent shadow-sm'
                        : 'border-line/40 bg-[color:var(--console-bg,transparent)] text-[color:var(--console-mute)] hover:border-orange/40 hover:text-[color:var(--console-text)]',
                    )}
                  >
                    <span className={cn('flex size-5 items-center justify-center rounded-full text-[9px] font-semibold',
                      isActive ? 'bg-white/20 text-on-accent' : cn(style.bg, style.text))}
                    >
                      {style.glyph}
                    </span>
                    {ai.identity.identityName}
                    {isActive ? <Check className="size-3.5" aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Metric label="Overall" value={<StatusBadge status={data.overallStatus} />} />
          <Metric label="Target" value={<span className="text-[20px] font-medium text-[color:var(--console-text)]">{data.totalTarget}</span>} />
          <Metric label="Completed" value={<span className="text-[20px] font-medium text-[color:var(--console-text)]">{data.totalCompleted}</span>} />
          <Metric
            label="Remaining"
            value={
              <span
                className={cn(
                  'text-[20px] font-medium',
                  data.totalRemaining > 0 ? 'text-orange-light' : 'text-status-success',
                )}
              >
                {data.totalRemaining}
              </span>
            }
          />
        </div>
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded bg-line/30">
            <div
              className={cn(
                'h-full rounded transition-all',
                completionPct >= 100 ? 'bg-status-success' : 'bg-orange',
              )}
              style={{ width: `${Math.max(4, completionPct)}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-[color:var(--console-mute)]">{completionPct}% complete</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded border border-orange/30 bg-orange/10 px-3 py-1.5 text-[12px] font-medium text-[color:var(--console-text)]"
          >
            Open Relay Today
            <ArrowRight className="size-3.5" />
          </Link>
          <Link
            href="/settings#send-budget"
            className="inline-flex items-center gap-1.5 rounded border border-line/30 px-3 py-1.5 text-[12px] font-medium text-[color:var(--console-mute)] hover:text-[color:var(--console-text)]"
          >
            Check usage budget
          </Link>
        </div>
      </section>

      {data.notifications.length > 0 ? (
        <section className="srf-proof px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <Bell className="size-3.5 text-orange" />
            Recent accountability signals
          </div>
          <ul className="mt-2 space-y-1">
            {data.notifications.slice(0, 3).map((note) => (
              <li key={note.id} className="text-[12px] text-graphite">
                {note.title}: {note.body}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Identity Lanes</p>
          <span className="text-[12px] text-graphite">{data.assignedIdentities.length} assigned</span>
        </div>
      {data.assignedIdentities.map((ai) => {
        const isActive = ai.assignmentId === activeAssignmentId
        return (
        <article
          key={ai.assignmentId}
          className={cn(
            'overflow-hidden rounded border bg-bone-raised transition-shadow',
            isActive ? 'border-orange shadow-[0_0_0_1px_var(--orange)]' : 'border-line',
          )}
        >
          <button
            type="button"
            onClick={() => selectIdentity(ai.assignmentId)}
            className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-bone"
          >
            <div className={cn('flex size-9 items-center justify-center rounded text-xs font-medium',
              ai.identity.channel === 'linkedin' ? 'bg-[#0a66c2]/10 text-[#0a66c2]' :
              ai.identity.channel === 'email' ? 'bg-[#d97706]/10 text-[#d97706]' :
              ai.identity.channel === 'upwork' ? 'bg-[#14a800]/10 text-[#14a800]' : 'bg-graphite/10 text-graphite'
            )}>
              {ai.identity.channel === 'linkedin' ? 'in' : ai.identity.channel === 'email' ? '@' : ai.identity.channel === 'upwork' ? 'U' : '•'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{ai.identity.identityName}</span>
                <span className="text-xs uppercase tracking-wide text-slate">{ai.identity.channel}</span>
                {isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-medium text-orange">
                    <Check className="size-2.5" aria-hidden="true" />
                    Working as
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate">{ai.identity.title || 'No title set'}</p>
            </div>
            {ai.identity.profileUrl && (
              <a
                href={ai.identity.profileUrl}
                target="_blank"
                rel="noopener"
                onClick={(e) => e.stopPropagation()}
                className="rounded p-1.5 text-slate hover:text-ink"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </button>
          {ai.targets.length > 0 ? (
            <div className="divide-y divide-line/50">
              {ai.targets.map((t: TargetProgressView) => (
                <div key={t.targetId} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink">{activityLabel(t.activityType)}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-mono-medium text-graphite">{t.completedCount} / {t.targetCount}</span>
                      <div className="h-1.5 flex-1 rounded-full bg-line overflow-hidden max-w-32">
                        <div
                          className={cn('h-full rounded-full',
                            t.status === 'completed' ? 'bg-status-success' :
                            t.status === 'at_risk' ? 'bg-status-warning' : 'bg-orange'
                          )}
                          style={{ width: `${Math.min(Math.round((t.completedCount / t.targetCount) * 100), 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <span className={cn('text-mono-medium text-sm font-medium',
                    t.remaining > 0 ? 'text-orange' : 'text-status-success'
                  )}>
                    {t.remaining > 0 ? `${t.remaining} left` : <CheckCircle2 className="size-4" />}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-3 text-xs text-slate">No targets set for this identity today.</div>
          )}
        </article>
        )
      })}
      </section>

      {data.assignedIdentities.length === 0 && (
        <section className="rounded-xl border border-dashed border-line py-12 text-center">
          <Shield className="mx-auto size-8 text-slate mb-3" />
          <p className="text-sm font-medium text-ink mb-1">No profiles assigned</p>
          <p className="text-xs text-slate max-w-xs mx-auto">An admin hasn&apos;t assigned any revenue identities to you yet. Assigned identities will appear here with your daily targets.</p>
        </section>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">{label}</p>
      <div className="mt-1">{value}</div>
    </div>
  )
}
