/**
 * Human Labeling V2: quick labels are glanceable and validated; pairwise
 * preferences are the ranker's supervision.
 */
import { describe, expect, it } from 'vitest'
import { validateQuickLabel, validatePairwiseLabel } from '@/lib/admin/training-data'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

describe('quick labels (Phase F)', () => {
  it('accepts a five-field glanceable label', () => {
    const r = validateQuickLabel({
      opportunityKey: KEY_A,
      prospectQuality: 'GOOD',
      likelyOpportunity: 'MAYBE',
      quickAction: 'CONNECT',
      decisionCorrect: 'NO',
      reason: 'wrong band',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.label.prospectQuality).toBe('GOOD')
      expect(r.label.quickAction).toBe('CONNECT')
      expect(r.label.decisionCorrect).toBe('NO')
    }
  })

  it('requires at least one answer', () => {
    const r = validateQuickLabel({ opportunityKey: KEY_A })
    expect(r.ok).toBe(false)
  })

  it('rejects an enum outside the allowed set', () => {
    const r = validateQuickLabel({ opportunityKey: KEY_A, prospectQuality: 'AMAZING' })
    expect(r.ok).toBe(false)
  })

  it('rejects a malformed opportunity key', () => {
    expect(validateQuickLabel({ opportunityKey: 'nope', prospectQuality: 'GOOD' }).ok).toBe(false)
  })
})

describe('pairwise labels (Phase F)', () => {
  it('accepts A, B and TIE', () => {
    for (const winner of ['A', 'B', 'TIE'] as const) {
      const r = validatePairwiseLabel({ opportunityKeyA: KEY_A, opportunityKeyB: KEY_B, winner })
      expect(r.ok).toBe(true)
    }
  })

  it('rejects the same opportunity twice', () => {
    const r = validatePairwiseLabel({ opportunityKeyA: KEY_A, opportunityKeyB: KEY_A, winner: 'A' })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown winner', () => {
    const r = validatePairwiseLabel({ opportunityKeyA: KEY_A, opportunityKeyB: KEY_B, winner: 'C' })
    expect(r.ok).toBe(false)
  })
})
