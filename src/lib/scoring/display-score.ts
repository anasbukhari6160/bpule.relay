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

export type DisplayEvidenceKind = 'quote' | 'signal' | 'inference'

export interface DisplayEvidence {
  text: string
  kind: DisplayEvidenceKind
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
  /** model = rows that sum to the model subtotal; signals = deterministic check blended into the total */
  group: 'model' | 'signals'
  /** Source quotes / detected signals behind the row. Empty for results stored before evidence existed. */
  evidence: DisplayEvidence[]
}

function normalizeEvidence(raw: unknown): DisplayEvidence[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const e = (item ?? {}) as Record<string, unknown>
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    const kind = e.kind === 'quote' || e.kind === 'signal' || e.kind === 'inference' ? e.kind : null
    return text && kind ? [{ text, kind }] : []
  })
}

export function normalizeScoreDimensions(raw: unknown): DisplayDimension[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const d = (item ?? {}) as Record<string, unknown>
    const key = typeof d.key === 'string' ? d.key : ''
    const label = String(d.label ?? d.key ?? 'Score')
    const note = d.note != null ? String(d.note) : ''
    const inTotal = key ? CANONICAL_DIMENSION_KEYS.has(key) : true
    const group: DisplayDimension['group'] = d.group === 'model' || d.group === 'signals'
      ? d.group
      : inTotal ? 'model' : 'signals'
    const evidence = normalizeEvidence(d.evidence)
    const base = { key, label, note, inTotal, group, evidence }
    const points = typeof d.points === 'number' && Number.isFinite(d.points) ? d.points : null
    const max = typeof d.max === 'number' && Number.isFinite(d.max) ? d.max : null
    if (points != null && max != null && max > 0) {
      return { ...base, points, max, unavailable: false }
    }
    const contribution = typeof d.contribution === 'number' && Number.isFinite(d.contribution) ? d.contribution : null
    const weight = typeof d.weight === 'number' && Number.isFinite(d.weight) ? d.weight : null
    if (contribution != null && weight != null && weight > 0) {
      return { ...base, points: contribution, max: weight * 100, unavailable: false }
    }
    return { ...base, points: null, max: null, unavailable: true }
  })
}

export interface DisplayScoreCalculation {
  modelSubtotal: number | null
  modelScore: number | null
  signalCheckTotal: number | null
  modelWeight: number | null
  finalScore: number | null
  steps: Array<{ label: string; value: string; detail: string }>
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The serialized aggregation trace, or null for results stored before it existed. */
export function normalizeScoreCalculation(raw: unknown): DisplayScoreCalculation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const steps = Array.isArray(c.steps)
    ? c.steps.flatMap((step) => {
        const st = (step ?? {}) as Record<string, unknown>
        return typeof st.label === 'string'
          ? [{ label: st.label, value: String(st.value ?? ''), detail: String(st.detail ?? '') }]
          : []
      })
    : []
  if (steps.length === 0) return null
  return {
    modelSubtotal: finite(c.modelSubtotal),
    modelScore: finite(c.modelScore),
    signalCheckTotal: finite(c.signalCheckTotal),
    modelWeight: finite(c.modelWeight),
    finalScore: finite(c.finalScore),
    steps,
  }
}

export function scoreExplanation(input: {
  displayScore: number | null
  canonicalScore: number | null
  qualification: string | null
}): string {
  const display = input.displayScore == null ? '—' : `${input.displayScore}/10`
  const total = input.canonicalScore == null ? '—' : `${Math.round(input.canonicalScore)}/100`
  const qualification = input.qualification?.replaceAll('_', ' ') || 'unqualified'
  return `Display score ${display} follows the ${qualification} qualification. Canonical total is ${total}. Fit, buying intent, and confidence stay separate, and a strong fit does not raise buying intent.`
}
