/**
 * Upwork golden fixture builder. Composes a realistic Upwork job paste from
 * parts so 100+ fixtures stay readable. Every fixture is synthetic.
 */
import type { CanonicalQualification } from '@/lib/scoring/qualification'
import type { UpworkJobVerdict } from '@/lib/domain/types'

export type UpworkCategory =
  | 'high_budget' | 'low_budget' | 'hourly' | 'fixed_price' | 'multiline_rate' | 'strong_client' | 'new_client'
  | 'high_competition' | 'low_competition' | 'strong_fit' | 'weak_fit' | 'urgent' | 'long_term' | 'short_term'
  | 'screening_heavy' | 'suspicious' | 'incomplete' | 'multilingual' | 'monthly' | 'edge'

export interface UpworkExpectation {
  rateType?: 'hourly' | 'fixed' | 'monthly' | 'unknown'
  hourlyMin?: number | null
  hourlyMax?: number | null
  fixedBudget?: number | null
  monthlyBudget?: number | null
  proposalsRange?: [number, number] | null
  connects?: number | null
  paymentVerified?: boolean | null
  totalSpentMin?: number
  hireRate?: number | null
  skillsInclude?: string[]
  skillsExclude?: string[]
  screeningCount?: number
  startUrgency?: 'asap' | 'soon' | 'scheduled' | 'ongoing' | 'none'
  suspicious?: boolean
  durationMonthsMin?: number
  durationMonthsMax?: number
  weeklyHours?: number | null
  experience?: 'entry' | 'intermediate' | 'expert' | null
  language?: string
  scoreRange?: [number, number]
  qualification?: CanonicalQualification[]
  verdict?: UpworkJobVerdict[]
  multiline?: boolean
}

export interface UpworkFixture {
  id: string
  category: UpworkCategory
  notes: string
  rawText: string
  expect: UpworkExpectation
}

export interface JobParts {
  title: string
  posted?: string
  /** Rate block exactly as it would appear (multi-line allowed). */
  rate?: string
  experience?: string
  duration?: string
  hours?: string
  description: string
  skills?: string[]
  questions?: string[]
  proposals?: string
  connects?: number
  client?: {
    verified?: boolean | 'unverified'
    spent?: string
    hireRate?: number
    jobsPosted?: number
    openJobs?: number
    hires?: number
    rating?: number
    reviews?: number
    avgPaid?: number
    hours?: number
    memberSince?: string
    location?: string
  }
  /** Raw extra lines appended verbatim. */
  extra?: string[]
  omitClientSection?: boolean
}

export function job(p: JobParts): string {
  const lines: string[] = []
  lines.push(p.title)
  lines.push(`Posted ${p.posted ?? '3 hours ago'}`)
  lines.push('Worldwide')
  lines.push('')
  lines.push(p.description.trim())
  lines.push('')
  if (p.rate) lines.push(p.rate)
  if (p.experience) lines.push(p.experience)
  if (p.duration) lines.push(p.duration)
  if (p.hours) lines.push(p.hours)
  lines.push('')
  if (p.skills?.length) { lines.push('Skills and Expertise'); lines.push(...p.skills) ; lines.push('') }
  if (p.questions?.length) {
    lines.push('Screening questions')
    lines.push('You will be asked to answer the following questions when submitting a proposal:')
    p.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`))
    lines.push('')
  }
  lines.push('Activity on this job')
  if (p.proposals) lines.push(`Proposals: ${p.proposals}`)
  lines.push('Last viewed by client: 1 hour ago')
  lines.push('Interviewing: 0')
  lines.push('Invites sent: 0')
  lines.push('')
  if (!p.omitClientSection) {
    const c = p.client ?? {}
    lines.push('About the client')
    if (c.verified === true) lines.push('Payment method verified')
    else if (c.verified === 'unverified') lines.push('Payment method unverified')
    if (c.rating != null) lines.push(`${c.rating.toFixed(1)} of 5 stars (${c.reviews ?? 3} reviews)`)
    if (c.location) { lines.push(c.location); lines.push('10:42 AM') }
    if (c.jobsPosted != null) lines.push(`${c.jobsPosted} jobs posted`)
    if (c.hireRate != null) lines.push(`${c.hireRate}% hire rate, ${c.openJobs ?? 1} open job`)
    if (c.spent) lines.push(`${c.spent} total spent`)
    if (c.hires != null) lines.push(`${c.hires} hires, 1 active`)
    if (c.avgPaid != null) lines.push(`$${c.avgPaid.toFixed(2)}/hr avg hourly rate paid`)
    if (c.hours != null) lines.push(`${c.hours.toLocaleString()} hours`)
    if (c.memberSince) lines.push(`Member since ${c.memberSince}`)
    lines.push('')
  }
  if (p.connects != null) lines.push(`Required Connects to submit a proposal: ${p.connects}`)
  lines.push('Available Connects: 140')
  if (p.extra?.length) lines.push(...p.extra)
  return lines.join('\n')
}

export const DEV_DESCRIPTION = `We run a B2B SaaS for property managers and need a senior engineer to rebuild our tenant portal.
Current stack is React, Node and PostgreSQL on AWS. Deliverables:
- New React front end with our design system
- REST API changes in Node for the payments flow (Stripe)
- Migration scripts for PostgreSQL
Timeline: first milestone within 3 weeks. Please share two similar projects you shipped.`

export const SKILLS_WEB = ['React', 'Node.js', 'PostgreSQL', 'AWS', 'TypeScript']
export const CLIENT_STRONG = { verified: true as const, spent: '$48K', hireRate: 82, jobsPosted: 31, openJobs: 2, hires: 26, rating: 4.9, reviews: 21, avgPaid: 38.5, hours: 2140, memberSince: 'Mar 4, 2019', location: 'Austin, United States' }
export const CLIENT_NEW = { verified: true as const, location: 'Berlin, Germany', memberSince: 'Oct 2, 2026' }
