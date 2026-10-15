import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createScoutStore } from '@/lib/store'
import { computeUpworkScore } from '@/lib/score/upwork-rubric'
import { MessageCircle, DollarSign, Users, Tag, FileText } from 'lucide-react'
import { cn } from 'cn'
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
  })

  const verdict = score.verdict ? VERDICT_STYLE[score.verdict] : VERDICT_STYLE.skip

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="rounded-xl border border-line bg-bone-raised/30 px-5 py-5 sm:px-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em text-stone">Opportunity / Job Dossier</p>
        <h1 className="mt-2 text-[22px] font-medium text-ink">{job.title}</h1>
        <p className="mt-2 text-[13px] text-graphite">
          Relay prepared a score and proposal lane. You decide whether to apply and when to spend Connects.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <HeroMetric label="Verdict" value={<span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', verdict.bg, verdict.text)}>{verdict.label}</span>} />
          <HeroMetric label="Score" value={<span className="text-[18px] font-medium text-ink">{score.total} / 10</span>} />
          <HeroMetric label="Connects" value={<span className="text-[18px] font-medium text-ink">{job.connectsCost}</span>} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
           <Link href="/upwork" className="inline-flex items-center gap-1.5 rounded border border-orange/30 bg-orange/10 px-3 py-1.5 text-[12px] font-medium text-orange">
             Back to job lanes
           </Link>
           <Link href="/leads" className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-[12px] font-medium text-graphite hover:text-ink">
             Return to leads
           </Link>
         </div>

         <div className="mt-4 flex items-center gap-3 text-[12px] text-graphite">
          <span>{job.messages.length} message{job.messages.length === 1 ? '' : 's'} logged</span>
          <span>·</span>
          <span>{job.proposalCount !== null ? `${job.proposalCount} proposals observed` : 'proposal count unknown'}</span>
        </div>

      </header>

      <section className="reveal-up space-y-2">
        <p className="text-mono-medium text-[10px] uppercase tracking-[0.14em] text-stone">Opportunity Snapshot</p>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate">
          {job.budgetMin && job.budgetMax ? (
            <span className="flex items-center gap-1">
              <DollarSign className="size-3.5" />
              ${job.budgetMin}–${job.budgetMax} fixed
            </span>
          ) : job.hourlyRateMin && job.hourlyRateMax ? (
            <span className="flex items-center gap-1">
              <DollarSign className="size-3.5" />
              ${job.hourlyRateMin}–${job.hourlyRateMax}/hr
            </span>
          ) : (
            <span>Budget not stated</span>
          )}
          <span className="text-line">·</span>
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {job.proposalCount !== null ? `${job.proposalCount} proposals` : 'proposals unknown'}
          </span>
        </div>
      </section>

      {/* Score card */}
      <section className="reveal-up stagger-1 rounded border border-line bg-bone-raised p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <div className="relative flex size-16 items-center justify-center">
              <ScoreRing score={score.total} max={10} size={64} />
            </div>
            <div>
              <p className="text-sm text-slate">Score</p>
              <p className="font-mono text-2xl font-medium text-ink">
                {score.total} <span className="text-sm text-slate">/ 10</span>
              </p>
            </div>
          </div>
          {job.messages.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-slate">
              <MessageCircle className="size-4" />
              {job.messages.length} message{job.messages.length === 1 ? '' : 's'}
            </div>
          )}
        </div>

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

      {/* Description */}
      <section className="reveal-up stagger-2 rounded border border-line bg-bone-raised p-6">
        <h2 className="text-sm font-medium text-ink">Description</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{job.description}</p>
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

      {/* Status + Timeline */}
      <UpworkJobTimeline job={job} />

      {/* Client Communication */}
      <UpworkCommunication jobId={id} job={job} />

      {/* Screening Questions */}
      {job.screeningQuestions.length > 0 && (
        <section className="reveal-up stagger-4 rounded border border-line bg-bone-raised p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <MessageCircle className="size-3.5 text-cobalt" />
            Screening Questions
          </h2>
          <ul className="mt-3 space-y-2">
            {job.screeningQuestions.map((q, i) => (
              <li key={i} className="rounded-lg bg-bone px-3 py-2 text-[13px] text-graphite">
                <span className="font-medium text-ink">Q{i + 1}:</span> {q}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-stone">
            These MUST be answered in your proposal. The AI generator includes them automatically.
          </p>
        </section>
      )}

      {/* Proposal actions */}
      <section className="reveal-up stagger-5 space-y-4 rounded border border-line bg-bone-raised p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
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
    </div>
  )
}

function HeroMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-orange/20 bg-orange/5 px-3 py-2">
      <p className="text-mono-medium text-[9px] uppercase tracking-[0.14em] text-orange-light/80">{label}</p>
      <div className="mt-1">{value}</div>
    </div>
  )
}

function ScoreRing({ score, size = 64, max = 10 }: { score: number; size?: number; max?: number }) {
  const pct = Math.min(Math.max(score, 0) / max, 1)
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const color =
    pct >= 0.7
      ? 'var(--status-success)'
      : pct >= 0.4
        ? 'var(--status-warning)'
        : 'var(--graphite)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-base font-medium text-ink">{score}</span>
      </div>
    </div>
  )
}
