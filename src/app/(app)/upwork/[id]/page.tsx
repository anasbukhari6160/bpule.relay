import { notFound } from 'next/navigation'
import { createScoutStore } from '@/lib/store'
import { PageHeader } from '@/components/ui/page-header'
import { computeUpworkScore } from '@/lib/score/upwork-rubric'
import { matchProfilesToJob } from '@/lib/upwork/score'
import { loadSenderProfiles } from '@/lib/relay/routing-context'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'
import type { RoutingResult } from '@/lib/relay/sender-routing-engine'
import { MessageCircle, Tag, FileText } from 'lucide-react'
import { cn } from 'cn'
import { upworkStageLabel } from '@/lib/upwork/pipeline'
import { UpworkJobActions } from '@/components/upwork-job-actions'
import { UpworkJobTimeline } from '@/components/upwork-job-timeline'
import { UpworkCommunication } from '@/components/upwork-communication'

export const dynamic = 'force-dynamic'

const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  apply: { bg: 'bg-status-success/10', text: 'text-status-success', label: 'Apply' },
  apply_if_connects: { bg: 'bg-status-warning/10', text: 'text-status-warning', label: 'If Connects' },
  skip: { bg: 'bg-bone', text: 'text-slate', label: 'Skip' },
}

export default async function UpworkJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const store = await createScoutStore()
  const job = await store.getUpworkJob(id)
  if (!job) notFound()

  const profiles = await store.listProfiles()

  const score = computeUpworkScore({
    budgetMin: job.budgetMin,
    budgetMax: job.budgetMax,
    hourlyRateMin: job.hourlyRateMin,
    hourlyRateMax: job.hourlyRateMax,
    proposalCount: job.proposalCount,
    requiredSkills: job.requiredSkills,
    urgencySignal: job.urgencySignal,
    description: job.description,
    rawInput: job.rawInput,
    title: job.title,
  })

  // Profile match is a separate ranking: it never changes the job score.
  let profileMatch: RoutingResult | null = null
  try {
    const auth = await getAuthContext()
    if (auth) {
      const senders = await loadSenderProfiles(createServiceSupabase(), auth.orgId, auth.repId)
      if (senders.length) profileMatch = matchProfilesToJob(score.canonical.facts, senders, null)
    }
  } catch { profileMatch = null }

  const verdict = score.verdict ? VERDICT_STYLE[score.verdict] : VERDICT_STYLE.skip
  // Read the canonical job facts for honest display: a source proposal range
  // is shown verbatim, and missing Connects stays unknown (QA BUG-11-02/03).
  const jobFacts = (job.jobFacts ?? null) as {
    proposals?: { count: number | null; range?: [number, number] | null; evidence?: string | null }
    connects?: number | null
    rate?: { type?: string; fixedBudget?: number | null }
  } | null
  const proposalLabel = jobFacts?.proposals?.evidence
    ?? (job.proposalCount !== null
      ? (jobFacts?.proposals?.range ? `~${job.proposalCount} estimated` : `${job.proposalCount} proposals`)
      : null)
  const connectsLabel = jobFacts?.connects != null
    ? `${jobFacts.connects} Connects`
    : (job.connectsCost ? `${job.connectsCost} Connects` : 'Connects not stated')
  const facts = [
    payLabel(job),
    job.experienceLevel,
    job.duration,
    job.weeklyHours,
    job.engagementType,
    proposalLabel,
    connectsLabel,
    job.messages.length > 0 ? `${job.messages.length} message${job.messages.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={job.title}
        description={`${facts.join(' · ')} · ${score.total} / 10 (${score.canonical.score}/100) · ${upworkStageLabel(job.status)}`}
        action={<span className={cn('rounded-full px-2.5 py-1 text-[12px] font-medium', verdict.bg, verdict.text)}>{verdict.label}</span>}
      />

      <section className="rounded-2xl border border-line bg-bone-raised/30 p-4 sm:p-5">
        <p className="text-[13px] text-graphite">
          {jobFacts?.connects != null
            ? `Spend ${jobFacts.connects} Connects only if you are sending this proposal.`
            : job.connectsCost
              ? `Spend ${job.connectsCost} Connects only if you are sending this proposal.`
              : 'Connects cost not stated — confirm it on Upwork before applying.'}
        </p>

        {(score.canonical.reasons.length > 0 || score.canonical.watchOut.length > 0) && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="upwork-why">
            {score.canonical.reasons.length > 0 && (
              <ul className="space-y-0.5 text-[12px] text-ink">{score.canonical.reasons.map((r) => <li key={r}>+ {r}</li>)}</ul>
            )}
            {score.canonical.watchOut.length > 0 && (
              <ul className="space-y-0.5 text-[12px] text-status-warning">{score.canonical.watchOut.map((r) => <li key={r}>! {r}</li>)}</ul>
            )}
          </div>
        )}

        {profileMatch && profileMatch.rankings.length > 0 && (
          <div className="mt-4 rounded border border-line bg-bone px-4 py-3" data-testid="upwork-profile-match">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-stone">Profile match (separate from the job score)</p>
            <ul className="mt-2 space-y-1">
              {profileMatch.rankings.slice(0, 4).map((r, i) => (
                <li key={r.senderId} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate text-ink">{i + 1}. {r.name ?? 'Unnamed'}{r.reasons[0] ? <span className="text-graphite"> · {r.reasons[0]}</span> : null}</span>
                  <span className={cn('shrink-0 font-mono font-medium', r.profileMatch >= 70 ? 'text-status-success' : r.profileMatch >= 40 ? 'text-orange' : 'text-stone')}>{r.profileMatch}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Breakdown */}
        <div className="mt-6 grid gap-2 border-t border-line pt-5 sm:grid-cols-2">
          {score.breakdown.map((item) => {
            const frac = item.max > 0 ? item.points / item.max : 0
            return (
              <div key={item.category + item.label} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">{item.label}</span>
                    <span className="font-mono text-xs text-slate">
                      {item.points}/{item.max}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-bone">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        frac >= 1 ? 'bg-status-success' : frac > 0 ? 'bg-orange' : 'bg-line',
                      )}
                      style={{ width: `${Math.max(frac * 100, frac > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <UpworkJobTimeline job={job} />

      <section className="space-y-4 rounded-2xl border border-line bg-bone-raised/30 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <FileText className="size-3.5 text-cobalt" />
          Proposal
        </h2>
        <UpworkJobActions
          jobId={id}
          jobTitle={job.title}
          jobScore={job.score}
          profiles={profiles}
          matchedProofs={[]}
        />
      </section>

      <section className="rounded-2xl border border-line bg-bone-raised/30 p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-ink">Job post</h2>
        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-ink/80">{job.description}</p>
      </section>

      {/* Urgency + Skills side by side */}
      <div className="reveal-up stagger-3 grid gap-4 sm:grid-cols-2">
        {job.urgencySignal ? (
           <div className="rounded border border-line bg-bone-raised p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <MessageCircle className="size-3.5 text-status-warning" />
              Urgency signal
            </h2>
            <p className="mt-2 text-sm text-ink/80">{job.urgencySignal}</p>
          </div>
        ) : null}

        {job.requiredSkills.length > 0 ? (
           <div className="rounded border border-line bg-bone-raised p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <Tag className="size-3.5 text-slate" />
              Required skills
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.requiredSkills.map((s) => (
                <span
                  key={s}
                  className="rounded-lg bg-bone px-2.5 py-1 font-mono text-xs text-ink"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {job.applicationRequirements.length > 0 && (
        <section className="rounded-2xl border border-line bg-bone-raised/30 p-4 sm:p-5">
          <h2 className="text-[15px] font-medium text-ink">What they ask for</h2>
          <ul className="mt-3 space-y-1.5 text-[13px] text-graphite">
            {job.applicationRequirements.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {job.screeningQuestions.length > 0 && (
        <section className="rounded-2xl border border-line bg-bone-raised/30 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <MessageCircle className="size-3.5 text-cobalt" />
            Screening questions
          </h2>
          <ul className="mt-3 space-y-2">
            {job.screeningQuestions.map((q, i) => (
              <li key={q} className="rounded-xl bg-paper px-3 py-2 text-[13px] text-graphite">
                <span className="font-medium text-ink">Q{i + 1}.</span> {q}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-stone">Answer these in the proposal. Generate includes them.</p>
        </section>
      )}

      <UpworkCommunication jobId={id} job={job} />

    </div>
  )
}

function payLabel(job: {
  budgetMin: number | null
  budgetMax: number | null
  hourlyRateMin: number | null
  hourlyRateMax: number | null
}): string | null {
  if (job.hourlyRateMin && job.hourlyRateMax) {
    return job.hourlyRateMin === job.hourlyRateMax
      ? `$${job.hourlyRateMin}/hr`
      : `$${job.hourlyRateMin}–$${job.hourlyRateMax}/hr`
  }
  if (job.budgetMin && job.budgetMax) {
    return job.budgetMin === job.budgetMax
      ? `$${job.budgetMin.toLocaleString()} fixed`
      : `$${job.budgetMin.toLocaleString()}–$${job.budgetMax.toLocaleString()} fixed`
  }
  if (job.budgetMin) return `$${job.budgetMin.toLocaleString()} fixed`
  if (job.budgetMax) return `Up to $${job.budgetMax.toLocaleString()}`
  return null
}
