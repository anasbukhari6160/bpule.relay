/**
 * Canonical qualification + display policy.
 *
 * ONE function turns a 0-100 opportunity score into a qualification band,
 * and ONE function turns score + band into the /10 display number. Every
 * surface (analysis, lead detail, pipeline, dashboard, admin, inbox,
 * analytics) consumes these; no surface keeps its own thresholds.
 *
 * Bands (calibrated against the golden set — see docs/SCORING_INVARIANTS.md):
 *   75-100  STRONG           8-10   explicit, verified buyer with fit and access
 *   55-74   WORTH_PURSUING   6-7    verified request or strong commercial potential
 *   35-54   MAYBE            4-5    plausible, needs research or a soft touch
 *   15-34   LOW              2-3    weak fit or non-buyer role
 *   0-14    SKIP             1      no commercial reason to act
 *
 * Within-band resolution: the /10 value steps inside each band so a 36 and a
 * 53 do not both read as "5". A /10 value never spans two qualifications,
 * so a 5/10 on one screen and "worth pursuing" on another cannot happen.
 */

import { DISPLAY_VERSION } from '@/lib/intelligence-v3/versions'

export type CanonicalQualification = 'STRONG' | 'WORTH_PURSUING' | 'MAYBE' | 'LOW' | 'SKIP'
/** Lower-case form used by the persisted canonical blob and the leads table. */
export type StoredQualification = 'strong' | 'worth_pursuing' | 'maybe' | 'low' | 'skip'

export interface QualificationBand {
  qualification: CanonicalQualification
  min: number
  max: number
  label: string
  /** Short human headline for chips and cards. */
  headline: string
}

export const QUALIFICATION_BANDS: readonly QualificationBand[] = [
  { qualification: 'STRONG', min: 75, max: 100, label: 'Strong opportunity', headline: 'Strong' },
  { qualification: 'WORTH_PURSUING', min: 55, max: 74, label: 'Worth pursuing', headline: 'Worth pursuing' },
  { qualification: 'MAYBE', min: 35, max: 54, label: 'Maybe — needs more signal', headline: 'Maybe' },
  { qualification: 'LOW', min: 15, max: 34, label: 'Weak fit', headline: 'Low' },
  { qualification: 'SKIP', min: 0, max: 14, label: 'Not a fit', headline: 'Skip' },
] as const

export { DISPLAY_VERSION }

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

/** THE qualification function. */
export function qualifyCanonicalScore(score: number): QualificationBand {
  const s = clampScore(score)
  return QUALIFICATION_BANDS.find((b) => s >= b.min && s <= b.max) ?? QUALIFICATION_BANDS[QUALIFICATION_BANDS.length - 1]
}

export function toStoredQualification(q: CanonicalQualification | string | null | undefined): StoredQualification {
  switch ((q ?? '').toString().toUpperCase()) {
    case 'STRONG': return 'strong'
    case 'WORTH_PURSUING': return 'worth_pursuing'
    case 'MAYBE': return 'maybe'
    case 'LOW': return 'low'
    case 'SKIP':
    case 'INELIGIBLE': return 'skip'
    default: return 'maybe'
  }
}

export function fromStoredQualification(q: string | null | undefined): CanonicalQualification | null {
  switch ((q ?? '').toString().toLowerCase()) {
    case 'strong': return 'STRONG'
    case 'worth_pursuing': return 'WORTH_PURSUING'
    case 'maybe': return 'MAYBE'
    case 'low': return 'LOW'
    case 'skip': return 'SKIP'
    default: return null
  }
}

/** Human label for either casing. */
export function qualificationLabel(q: string | null | undefined): string {
  const canonical = fromStoredQualification(q) ?? (QUALIFICATION_BANDS.find((b) => b.qualification === q)?.qualification ?? null)
  return QUALIFICATION_BANDS.find((b) => b.qualification === canonical)?.label ?? 'Unscored'
}

export function qualificationHeadline(q: string | null | undefined): string {
  const canonical = fromStoredQualification(q) ?? (QUALIFICATION_BANDS.find((b) => b.qualification === q)?.qualification ?? null)
  return QUALIFICATION_BANDS.find((b) => b.qualification === canonical)?.headline ?? '—'
}

/**
 * THE /10 display mapping. Monotonic in the canonical score, aligned with the
 * bands, with within-band resolution. Internal canonical stays 0-100.
 */
export function displayScoreForCanonical(score: number): number {
  const s = clampScore(score)
  if (s >= 92) return 10
  if (s >= 83) return 9
  if (s >= 75) return 8
  if (s >= 65) return 7
  if (s >= 55) return 6
  if (s >= 45) return 5
  if (s >= 35) return 4
  if (s >= 25) return 3
  if (s >= 15) return 2
  return 1
}

/** The qualification a /10 value belongs to — used to prove the two never disagree. */
export function qualificationForDisplayValue(value: number): CanonicalQualification {
  if (value >= 8) return 'STRONG'
  if (value >= 6) return 'WORTH_PURSUING'
  if (value >= 4) return 'MAYBE'
  if (value >= 2) return 'LOW'
  return 'SKIP'
}

/** Verdict column mapping — one place, includes LOW. */
export function verdictForQualification(q: CanonicalQualification | StoredQualification | string | null | undefined): 'send' | 'research_more' | 'skip' {
  const c = fromStoredQualification(q) ?? (q as CanonicalQualification)
  if (c === 'STRONG' || c === 'WORTH_PURSUING') return 'send'
  if (c === 'MAYBE') return 'research_more'
  return 'skip'
}

/** Priority tier for queues and dashboards — one place, aligned with bands. */
export function priorityForCanonicalScore(score: number | null | undefined): 'urgent' | 'high' | 'medium' | 'low' {
  if (score == null) return 'low'
  const q = qualifyCanonicalScore(score).qualification
  if (q === 'STRONG') return 'urgent'
  if (q === 'WORTH_PURSUING') return 'high'
  if (q === 'MAYBE') return 'medium'
  return 'low'
}
