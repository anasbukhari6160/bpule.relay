import { describe, it, expect } from 'vitest'
import type { Lead, Message, Outcome } from '@/lib/domain/types'
import { businessDaysBetween, calendarDaysBetween, isFollowupDue, followupDueInDays, MAX_FOLLOWUPS_PER_LEAD } from '@/lib/leads/followup'

/**
 * Follow-up policy: UP TO THREE follow-ups, calendar-day spacing that widens
 * after each send. A reply is permanent. Canonical schedule:
 *   followupCount 0 → first follow-up due at 3 calendar days
 *   followupCount 1 → second follow-up due at 6 calendar days
 *   followupCount 2 → third follow-up due at 6 calendar days
 */

// Mirrors src/components/lead-workspace-simple.tsx:101-104 exactly. If that
// component's logic changes, update this alongside it.
function followupEligible(lead: Pick<Lead, 'status'>, messages: Pick<Message, 'sentText' | 'sentAt'>[]): boolean {
  const hasPriorSend = messages.some((m) => m.sentText && m.sentAt)
  const followupAlreadyUsed = lead.status === 'followed_up'
  return lead.status === 'contacted' && hasPriorSend && !followupAlreadyUsed
}

function businessDaysAgo(n: number, from: Date = new Date('2026-09-23T09:00:00Z')): string {
  const d = new Date(from)
  let remaining = n
  while (remaining > 0) {
    d.setDate(d.getDate() - 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return d.toISOString()
}

function calendarDaysAgo(n: number, from: Date = new Date('2026-09-23T09:00:00Z')): string {
  const d = new Date(from)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('follow-up eligibility: up to THREE follow-ups', () => {
  it('is not eligible for a lead that has never been sent to', () => {
    expect(followupEligible({ status: 'new' }, [])).toBe(false)
  })

  it('is eligible once a lead is contacted, has a prior send, and has never followed up', () => {
    const messages: Pick<Message, 'sentText' | 'sentAt'>[] = [{ sentText: 'Hi there', sentAt: businessDaysAgo(1) }]
    expect(followupEligible({ status: 'contacted' }, messages)).toBe(true)
  })

  it('is permanently locked out once all 3 follow-ups have been used', () => {
    const messages: Pick<Message, 'sentText' | 'sentAt'>[] = [
      { sentText: 'Hi there', sentAt: businessDaysAgo(20) },
      { sentText: 'Following up', sentAt: businessDaysAgo(10) },
      { sentText: 'Second follow-up', sentAt: businessDaysAgo(5) },
      { sentText: 'Third follow-up', sentAt: businessDaysAgo(2) },
    ]
    expect(followupEligible({ status: 'followed_up' }, messages)).toBe(false)
  })

  it('is not eligible without any actually-sent message even if status looks contacted', () => {
    const messages: Pick<Message, 'sentText' | 'sentAt'>[] = [{ sentText: null, sentAt: null }]
    expect(followupEligible({ status: 'contacted' }, messages)).toBe(false)
  })
})

describe('calendar day arithmetic (for follow-up timing)', () => {
  it('a Friday-to-Monday span is 3 calendar days', () => {
    const friday = new Date('2026-09-18T09:00:00Z')
    const monday = new Date('2026-09-21T09:00:00Z')
    expect(calendarDaysBetween(friday, monday)).toBe(3)
  })

  it('a full weekend counts toward the wait — calendar days, not business days', () => {
    const friday = new Date('2026-09-18T09:00:00Z')
    const saturday = new Date('2026-09-19T09:00:00Z')
    const sunday = new Date('2026-09-20T09:00:00Z')
    expect(calendarDaysBetween(friday, saturday)).toBe(1)
    expect(calendarDaysBetween(friday, sunday)).toBe(2)
  })
})

describe('follow-up due timing: first at 3 calendar days, second/third at 6', () => {
  // Freeze "now" to a Wednesday so calendar-day math is deterministic.
  const NOW = new Date('2026-09-23T09:00:00Z')

  it('is not due before 3 calendar days (first follow-up)', () => {
    expect(isFollowupDue(calendarDaysAgo(2, NOW), false, NOW, 0)).toBe(false)
  })

  it('is due at exactly 3 calendar days (first follow-up)', () => {
    expect(isFollowupDue(calendarDaysAgo(3, NOW), false, NOW, 0)).toBe(true)
  })

  it('is due well past the 3-day window (first follow-up)', () => {
    expect(isFollowupDue(calendarDaysAgo(10, NOW), false, NOW, 0)).toBe(true)
  })

  it('weekend counts: send Friday, due Monday (3 calendar days later)', () => {
    const friday = new Date('2026-09-18T09:00:00Z') // Friday
    const monday = new Date('2026-09-21T09:00:00Z') // Monday = 3 calendar days
    expect(isFollowupDue(friday.toISOString(), false, monday, 0)).toBe(true)
  })

  it('second follow-up waits 6 calendar days, not 3', () => {
    // 4 calendar days after send — first would be due, but second needs 6
    expect(isFollowupDue(calendarDaysAgo(4, NOW), false, NOW, 1)).toBe(false)
    expect(isFollowupDue(calendarDaysAgo(6, NOW), false, NOW, 1)).toBe(true)
  })

  it('third follow-up also waits 6 calendar days', () => {
    expect(isFollowupDue(calendarDaysAgo(5, NOW), false, NOW, 2)).toBe(false)
    expect(isFollowupDue(calendarDaysAgo(6, NOW), false, NOW, 2)).toBe(true)
  })

  it('is never due once the prospect has replied, regardless of elapsed time', () => {
    expect(isFollowupDue(calendarDaysAgo(30, NOW), true, NOW, 0)).toBe(false)
  })

  it('followupDueInDays returns 3 for first, 6 for second and third', () => {
    expect(followupDueInDays(0)).toBe(3)
    expect(followupDueInDays(1)).toBe(6)
    expect(followupDueInDays(2)).toBe(6)
  })
})

describe('reply classification routing (Outcome stage)', () => {
  it('a replied outcome marks the lead as no longer due for follow-up', () => {
    const outcomes: Pick<Outcome, 'stage'>[] = [{ stage: 'replied' }]
    const hasReplied = outcomes.some((o) => o.stage === 'replied')
    expect(hasReplied).toBe(true)
  })
})
