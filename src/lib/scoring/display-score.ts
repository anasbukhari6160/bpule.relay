/**
 * Display mapping for the canonical score.
 *
 * V3 qualification is the authoritative 0-10 display:
 *   strong → 9, worth_pursuing → 7, maybe → 5, skip → 2.
 * The rows under a breakdown are the dimensions inside that total.
 * They are not a second score, and overlapping groups are not added again.
 */

const CANONICAL_DIMENSION_KEYS = new Set([
  'buyerRequest',
  'commercialPotential',
  'externalNeed',
  'fit',
  'timing',
  'access',
  'proofRelevance',
  'evidenceQuality',
])

export interface DisplayScoreInput {
  intelligenceVersion?: string | null
  qualification?: string | null
  canonicalScore?: number | null
}

export function displayScoreFromCanonical(input: DisplayScoreInput | null): number | null {
  if (!input || input.canonicalScore == null || Number.isNaN(input.canonicalScore)) return null
  if (input.intelligenceVersion?.startsWith('relay_decision_v3')) {
    if (input.qualification === 'strong') return 9
    if (input.qualification === 'worth_pursuing') return 7
    if (input.qualification === 'maybe') return 5
    if (input.qualification === 'skip') return 2
  }
  return Math.round(input.canonicalScore / 10)
}

export interface DisplayDimension {
  key: string
  label: string
  points: number | null
  max: number | null
  note: string
  unavailable: boolean
  /** False for auxiliary groups that must not be added onto the canonical total. */
  inTotal: boolean
}

export function normalizeScoreDimensions(raw: unknown): DisplayDimension[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const d = (item ?? {}) as Record<string, unknown>
    const key = typeof d.key === 'string' ? d.key : ''
    const label = String(d.label ?? d.key ?? 'Score')
    const note = d.note != null ? String(d.note) : ''
    const inTotal = key ? CANONICAL_DIMENSION_KEYS.has(key) : true
    const points = typeof d.points === 'number' && Number.isFinite(d.points) ? d.points : null
    const max = typeof d.max === 'number' && Number.isFinite(d.max) ? d.max : null
    if (points != null && max != null && max > 0) {
      return { key, label, points, max, note, unavailable: false, inTotal }
    }
    const contribution = typeof d.contribution === 'number' && Number.isFinite(d.contribution) ? d.contribution : null
    const weight = typeof d.weight === 'number' && Number.isFinite(d.weight) ? d.weight : null
    if (contribution != null && weight != null && weight > 0) {
      return { key, label, points: contribution, max: weight * 100, note, unavailable: false, inTotal }
    }
    return { key, label, points: null, max: null, note, unavailable: true, inTotal }
  })
}

export function scoreExplanation(input: {
  displayScore: number | null
  canonicalScore: number | null
  qualification: string | null
}): string {
  const display = input.displayScore == null ? '—' : `${input.displayScore}/10`
  const total = input.canonicalScore == null ? '—' : `${Math.round(input.canonicalScore)}/100`
  const qualification = input.qualification?.replaceAll('_', ' ') || 'unqualified'
  return `Display score ${display} follows the ${qualification} qualification. Canonical total is ${total}. The rows are the dimensions inside that total. Fit, buying intent, and confidence stay separate, and a strong fit does not raise buying intent.`
}
