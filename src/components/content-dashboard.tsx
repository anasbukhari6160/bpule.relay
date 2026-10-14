'use client'

import Link from 'next/link'
import { Plus, PenLine, ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import { StudioBrand } from '@/components/studio-brand'
import type { ContentPersona, ContentProfile, TopicCluster, ContentDraft, ContentHistoryEntry } from '@/lib/domain/types'
import type { DailyStatus } from '@/app/(app)/content/page'

interface PersonaWithExtras extends ContentPersona {
  topicClusters: TopicCluster[]
  drafts: ContentDraft[]
  recentPosts: ContentHistoryEntry[]
  dailyStatus: DailyStatus
  contentProfile: ContentProfile | null
}

const DAILY_STATUS_LABEL: Record<DailyStatus, string> = {
  asked: 'Question ready',
  drafted: 'Drafted today',
  posted: 'Posted today',
  none: 'Nothing surfaced today',
}

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function ContentDashboard({ personas }: { personas: PersonaWithExtras[] }) {
  const totalDrafts = personas.reduce((sum, p) => sum + p.drafts.filter((d) => d.status === 'draft' || d.status === 'ready').length, 0)
  const totalSubjects = personas.reduce((sum, p) => sum + p.topicClusters.filter((c) => c.clusterName.trim()).length, 0)

  const postedLast14Days = personas.flatMap((p) => p.recentPosts)
  const withOutcome = postedLast14Days.filter((h) => h.ledToRealOutcome).length

  const readyByPersona = new Map(
    personas.map((p) => [p.id, p.drafts.filter((d) => d.status === 'draft' || d.status === 'ready').length]),
  )

  const sortedPersonas = [...personas].sort((a, b) => (readyByPersona.get(b.id) ?? 0) - (readyByPersona.get(a.id) ?? 0))

  const displayName = personas.length > 0 ? personas[0].displayName : 'there'
  const greeting = getTimeBasedGreeting()

  return (
    <div className="space-y-5">
      <header className="srf-sheet mark-corners relative px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-2">
            <StudioBrand />
            {personas.length > 0 && (
              <p className="text-[15px] text-graphite">
                {personas.length === 1
                  ? `${greeting}, ${displayName}.`
                  : `${greeting}, ${displayName}. You have ${personas.length} personas.`}
              </p>
            )}
          </div>
          {personas.length > 0 && (
            <Link
              href="/content/new"
              className="group inline-flex items-center gap-2 rounded border border-line px-4 py-2.5 text-sm font-medium text-ink transition-all hover:bg-bone active:scale-[0.97]"
            >
              <Plus className="size-4 transition-transform duration-300 group-hover:rotate-90" aria-hidden="true" />
              New persona
            </Link>
          )}
        </div>
        {personas.length > 0 && (totalSubjects > 0 || totalDrafts > 0 || postedLast14Days.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-graphite">
            {totalSubjects > 0 && <span className="rounded bg-cobalt/10 px-2 py-0.5 text-[11px] text-cobalt-dark">{totalSubjects} subjects</span>}
            {totalDrafts > 0 && <span className="rounded bg-orange/10 px-2 py-0.5 text-[11px] text-orange-dark">{totalDrafts} drafts waiting</span>}
            {postedLast14Days.length > 0 && <span className="rounded bg-status-success/10 px-2 py-0.5 text-[11px] text-status-success">{postedLast14Days.length} posted · {withOutcome} outcomes</span>}
          </div>
        )}
      </header>

      {/* ── Empty state ── */}
      {personas.length === 0 && (
        <section className="srf-dossier p-10 text-center">
          <div className="mx-auto max-w-sm space-y-4">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-cobalt/[0.07]">
              <PenLine className="size-5 text-cobalt" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <p className="text-heading text-lg text-ink">No personas yet</p>
              <p className="text-sm leading-relaxed text-graphite">
                Paste a profile or a few real past posts. Studio asks a few quick questions tailored to your field, then you are ready to draft.
              </p>
            </div>
            <Link
              href="/content/new"
              className="inline-flex items-center gap-2 rounded bg-solid px-5 py-2.5 text-sm font-medium text-on-solid transition-all hover:bg-solid/90"
            >
              Create your first persona
            </Link>
          </div>
        </section>
      )}

      {/* ── Persona list ── */}
      {personas.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-heading text-base text-ink">Your personas</h2>
          </div>
          {sortedPersonas.map((persona) => {
            const readyDrafts = persona.drafts.filter((d) => d.status === 'draft' || d.status === 'ready').length
            const namedClusters = persona.topicClusters.filter((c) => c.clusterName.trim().length > 0)
            const subjects = namedClusters.slice(0, 3)
            const needsSetup = namedClusters.length === 0
            const hasWaiting = readyDrafts > 0

            return (
              <article
                key={persona.id}
                className={cn(
                  'overflow-hidden rounded transition-shadow',
                  hasWaiting
                    ? 'border-2 border-cobalt/30 bg-bone-raised shadow-cobalt hover:shadow-md'
                    : needsSetup
                      ? 'border border-dashed border-line bg-bone/30'
                      : 'border border-line/60 bg-bone-raised hover:shadow-sm',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-xl',
                      hasWaiting ? 'bg-gradient-to-br from-studio/15 to-studio/5' : 'bg-bone',
                    )}>
                      <PenLine className={cn('size-[18px]', hasWaiting ? 'text-cobalt' : 'text-graphite')} aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-heading text-[15px] text-ink">{persona.displayName}</h3>
                      <p className="text-xs text-graphite">
                        {[
                          `${namedClusters.length} subject${namedClusters.length === 1 ? '' : 's'}`,
                          persona.platforms.join(', '),
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasWaiting ? (
                      <span className="rounded-full bg-cobalt px-2.5 py-1 text-mono-medium text-[10px] text-on-accent">
                        {readyDrafts} draft{readyDrafts === 1 ? '' : 's'} waiting
                      </span>
                    ) : (
                      <span className={cn(
                        'rounded-full px-2.5 py-1 text-mono-medium text-[10px]',
                        persona.dailyStatus === 'posted' ? 'bg-status-success/10 text-status-success' : 'bg-bone text-graphite',
                      )}>
                        {DAILY_STATUS_LABEL[persona.dailyStatus]}
                      </span>
                    )}
                    {needsSetup ? (
                      <Link
                        href={`/content/${persona.id}`}
                        className="group inline-flex items-center gap-1.5 rounded bg-solid px-4 py-2 text-sm font-medium text-on-solid transition-all hover:bg-solid/90 active:scale-[0.97]"
                      >
                        Finish setup
                        <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <Link
                        href={`/content/${persona.id}`}
                        className={cn(
                          'group inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all active:scale-[0.97]',
                          hasWaiting
                            ? 'bg-solid text-on-solid hover:bg-solid/90'
                            : 'border border-line text-ink hover:bg-bone',
                        )}
                      >
                        Open
                        <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </div>

                {subjects.length > 0 && (
                  <div className="border-t border-line/40 px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {subjects.map((s) => (
                        <span key={s.id} className="rounded-lg bg-bone/60 px-2 py-0.5 text-[11px] text-ink-soft">
                          {s.clusterName}
                        </span>
                      ))}
                      {namedClusters.length > 3 && (
                        <span className="rounded-lg bg-bone/60 px-2 py-0.5 text-[11px] text-graphite">
                          +{namedClusters.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {needsSetup && (
                  <div className="border-t border-line/40 px-5 py-3">
                    <p className="text-xs text-graphite">
                      No subjects yet — answer the first question to get started.
                    </p>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
