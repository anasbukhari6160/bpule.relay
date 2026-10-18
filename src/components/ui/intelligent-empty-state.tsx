import { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from 'cn'
import { ClipboardList, ArrowRight } from 'lucide-react'

interface EmptyStateCondition {
  test: boolean
  icon?: ReactNode
  title: string
  description: string
  cta?: {
    label: string
    href: string
  }
  secondaryCta?: {
    label: string
    href: string
  }
}

interface IntelligentEmptyStateProps {
  conditions: EmptyStateCondition[]
  fallback?: EmptyStateCondition
}

/**
 * Intelligent empty states — derive the most useful message from system state.
 * No AI. Pure conditional logic over existing queue data.
 *
 * Usage: pass conditions in priority order. First matching condition wins.
 */
export function IntelligentEmptyState({ conditions, fallback }: IntelligentEmptyStateProps) {
  const match = conditions.find((c) => c.test)
  const state = match ?? fallback ?? {
    icon: <ClipboardList className="mx-auto size-8 text-stone" />,
    title: 'Nothing here yet',
    description: 'This view will populate as you add work.',
  }

  const cta = 'cta' in state ? state.cta : undefined
  const secondaryCta = 'secondaryCta' in state ? state.secondaryCta : undefined

  return (
    <div className="rounded-lg border border-dashed border-line bg-bone-raised/40 p-6 text-center">
      {state.icon ?? <ClipboardList className="mx-auto size-8 text-stone" />}
      <p className="mt-3 text-[14px] font-medium text-ink">{state.title}</p>
      <p className="mt-1 max-w-xs mx-auto text-[13px] text-graphite">{state.description}</p>
      {(cta || secondaryCta) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {cta && (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-2 rounded-md bg-orange px-3 py-2 text-[12px] font-medium text-on-accent hover:bg-orange-dark"
            >
              {cta.label}
              <ArrowRight className="size-3.5" />
            </Link>
          )}
          {secondaryCta && (
            <Link
              href={secondaryCta.href}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[12px] font-medium text-ink hover:bg-bone"
            >
              {secondaryCta.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Derive empty state for the rep home based on queue contents.
 */
export function repHomeEmptyState(params: {
  hasReplies: boolean
  hasFollowUps: boolean
  hasProspects: boolean
  hasUpworkJobs: boolean
  hasReferrals: boolean
}): EmptyStateCondition[] {
  const { hasReplies, hasFollowUps, hasProspects, hasUpworkJobs, hasReferrals } = params

  return [
    {
      test: !hasReplies && !hasFollowUps && !hasProspects && !hasUpworkJobs && !hasReferrals,
      title: 'You\'re caught up for today',
      description: 'Nothing needs your attention right now. Check back tomorrow or add new prospects.',
      cta: { label: 'Add a prospect', href: '/prospect' },
      secondaryCta: { label: 'Browse Upwork jobs', href: '/upwork/new' },
    },
    {
      test: !hasReplies && hasFollowUps && !hasProspects,
      title: 'Nothing needs a reply',
      description: 'No inbound messages waiting. Follow-ups are due for your existing conversations.',
      cta: { label: 'Send follow-ups', href: '/leads?filter=followup' },
    },
    {
      test: !hasReplies && !hasFollowUps && hasProspects,
      title: 'Caught up with replies',
      description: 'No replies or follow-ups due. Review new prospects to keep your pipeline full.',
      cta: { label: 'Review prospects', href: '/leads' },
    },
    {
      test: !hasReplies && !hasFollowUps && !hasProspects && hasUpworkJobs,
      title: 'No LinkedIn activity due',
      description: 'Your LinkedIn queue is clear. Upwork jobs are ready to review.',
      cta: { label: 'Review Upwork jobs', href: '/upwork' },
    },
    {
      test: hasReferrals && !hasReplies,
      title: 'Referrals waiting for you',
      description: 'A colleague referred leads to you. No replies due, but check your referrals.',
      cta: { label: 'View referrals', href: '/leads?filter=referred' },
    },
  ]
}
