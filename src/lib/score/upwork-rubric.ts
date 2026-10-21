/**
 * Upwork job qualification — legacy adapter over the canonical scorer.
 *
 * `computeUpworkScore` keeps its old signature and 0–10 / verdict shape for
 * every existing caller, but the number now comes from the canonical
 * 0–100 `scoreUpworkJob` (src/lib/upwork/score.ts): nine bounded dimensions
 * read from the raw paste, projected onto /10 with the same band-aligned
 * display table LinkedIn uses. Still pure arithmetic — no model is consulted.
 *
 * Verdicts follow the canonical bands:
 *   STRONG / WORTH_PURSUING (55+)  → apply
 *   MAYBE (35–54)                  → apply_if_connects
 *   LOW / SKIP (<35)               → skip
 */

import type { ScoreBreakdownItem, UpworkJobVerdict } from '@/lib/domain/types'
import { scoreUpworkJob, type UpworkJobScore } from '@/lib/upwork/score'

export interface UpworkScoreResult {
  total: number
  verdict: UpworkJobVerdict
  breakdown: ScoreBreakdownItem[]
  /** Canonical 0–100 score and its full explanation. */
  canonical: UpworkJobScore
  /** False when no job was analyzed — the UI must show no score or action. */
  hasJob: boolean
}

export function computeUpworkScore(input: {
  budgetMin: number | null
  budgetMax: number | null
  hourlyRateMin: number | null
  hourlyRateMax: number | null
  proposalCount: number | null
  requiredSkills: string[]
  urgencySignal: string | null
  description: string
  rawInput?: string | null
  title?: string | null
  orgCapabilities?: string[]
  orgProofTags?: string[]
}): UpworkScoreResult {
  // No analyzed job → no score. A blank form must never show a default score
  // or an apply action (QA BUG-11-01).
  const hasJob = Boolean(
    input.rawInput?.trim() || input.title?.trim() || input.description?.trim()
    || input.budgetMin != null || input.budgetMax != null
    || input.hourlyRateMin != null || input.hourlyRateMax != null,
  )
  const canonical = scoreUpworkJob({
    rawText: input.rawInput && input.rawInput.trim().length >= 40 ? input.rawInput : null,
    overrides: {
      hourlyRateMin: input.hourlyRateMin,
      hourlyRateMax: input.hourlyRateMax,
      fixedBudget: input.hourlyRateMin == null && input.hourlyRateMax == null ? (input.budgetMax ?? input.budgetMin) : null,
      proposalCount: input.proposalCount,
      skills: input.requiredSkills,
      description: input.description,
      title: input.title ?? null,
    },
    orgCapabilities: input.orgCapabilities,
    orgProofTags: input.orgProofTags,
  })
  const breakdown: ScoreBreakdownItem[] = canonical.dimensions.map((d) => ({
    category: d.key,
    label: d.label,
    points: Math.round(d.contribution * 10) / 10,
    max: Math.round(d.weight * 100),
    note: d.note,
  }))
  return { total: canonical.display, verdict: canonical.verdict, breakdown, canonical, hasJob }
}
