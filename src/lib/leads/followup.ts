/**
 * Follow-up policy: UP TO THREE follow-ups, with calendar-day spacing that
 * widens after each send. A lead that has already received 3 follow-ups
 * (followupCount >= 3) is permanently locked out — there is no fourth
 * follow-up, ever.
 *
 * Canonical schedule (calendar days since last outbound send):
 *   followupCount 0 → first follow-up due at 3 days
 *   followupCount 1 → second follow-up due at 6 days
 *   followupCount 2 → third follow-up due at 6 days
 *
 * Calendar days (not business days) — weekends count. The rep experiences
 * "3 days" as three days on a wall calendar, not "3 working days".
 */

/** Calendar days required before the next follow-up is due, indexed by followupCount. */
const FOLLOWUP_DUE_CALENDAR_DAYS: Record<number, number> = {
  0: 3,
  1: 6,
  2: 6,
}

/** Maximum follow-ups per lead. */
export const MAX_FOLLOWUPS_PER_LEAD = 3

/** Number of whole calendar days between two instants, floor-rounded. */
export function calendarDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

/** Number of whole business days (Mon-Fri) between two instants, floor-rounded. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0
  let count = 0
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)

  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1)
    const day = cursor.getDay() // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) count += 1
  }
  return count
}

/** Calendar days required before the next follow-up is due, given how many have already been sent. */
export function followupDueInDays(followupCount: number): number {
  if (followupCount < 0) return FOLLOWUP_DUE_CALENDAR_DAYS[0]
  return FOLLOWUP_DUE_CALENDAR_DAYS[followupCount] ?? FOLLOWUP_DUE_CALENDAR_DAYS[2]
}

export function isFollowupDue(sentAt: string, hasReplied: boolean, now: Date = new Date(), followupCount = 0): boolean {
  if (hasReplied) return false
  return calendarDaysBetween(new Date(sentAt), now) >= followupDueInDays(followupCount)
}

/**
 * Lead archival: how many follow-ups a lead may receive before it is
 * eligible for the daily archival sweep. Same cap as the follow-up-sending
 * gate (followup-engine.ts) — a lead is only archive-eligible once ALL 3
 * follow-ups have actually been used, not merely due.
 */
export const ARCHIVE_ELIGIBLE_FOLLOWUP_COUNT = 3

/**
 * How many PLAIN calendar days (not business days) must have passed since
 * the last outbound send, with no reply, before a lead is archive-eligible.
 * Deliberately calendar days, not business days: this is a housekeeping
 * sweep (is this lead definitely cold enough to tidy away), not an
 * outreach-timing decision like the 5-business-day follow-up-due window
 * above — weekends passing should count toward "this has gone quiet."
 */
export const ARCHIVE_ELIGIBLE_DAYS_SINCE_LAST_SEND = 3

/**
 * Pure archive-eligibility check (approved design): a lead becomes
 * archive-eligible when BOTH hold:
 *   1. All 3 follow-ups have been sent (followupCount >= 3)
 *   2. At least 3 full calendar days have passed since the last outbound
 *      send, with no reply received since.
 *
 * Extracted as a pure function (plain data in, plain boolean out) so it is
 * unit-testable without mocking Supabase — mirrors how
 * buildCommandCenterFromActivity / buildMyDayFromActivity in
 * src/lib/relay/dashboard-loader.ts were pulled out for the same reason.
 *
 * `lastSendAt` is the sent_at of the most recent non-reply outbound message;
 * pass null when there has never been an outbound send (never eligible).
 * `hasRepliedSinceLastSend` must be true whenever the lead's status is
 * 'replied', or a reply-type message exists after lastSendAt — a reply
 * blocks archival even if both counters would otherwise qualify, because a
 * reply means the lead is active again.
 */
export function isArchiveEligible(input: {
  followupCount: number
  lastSendAt: string | null
  hasRepliedSinceLastSend: boolean
  now?: Date
}): boolean {
  const { followupCount, lastSendAt, hasRepliedSinceLastSend, now = new Date() } = input
  if (hasRepliedSinceLastSend) return false
  if (followupCount < ARCHIVE_ELIGIBLE_FOLLOWUP_COUNT) return false
  if (!lastSendAt) return false

  const last = new Date(lastSendAt)
  const elapsedMs = now.getTime() - last.getTime()
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000)
  return elapsedDays >= ARCHIVE_ELIGIBLE_DAYS_SINCE_LAST_SEND
}
