import { describe, expect, it } from 'vitest'
import { computePriority, validateLabel, LABEL_SCORE_RANGES } from '@/lib/admin/training-data'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'
import { QUALIFICATION_BANDS } from '@/lib/scoring/qualification'

const KEY = 'a'.repeat(64)

describe('opportunity key (Phase 3)', () => {
  it('collapses whitespace variants of the same paste and ignores nothing else', () => {
    const a = opportunityKey('Jane Doe\nFounder at Acme  \n\n\nWe build routing software for fleets.')
    const b = opportunityKey('Jane Doe\r\nFounder at Acme\n\nWe build routing software for fleets.')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(opportunityKey('Jane Doe\nFounder at Acme\n\nWe build routing software for ships.')).not.toBe(a)
  })
  it('returns null for sources too short to be an opportunity', () => {
    expect(opportunityKey('hi')).toBeNull()
    expect(opportunityKey(null)).toBeNull()
  })
})

describe('human labels (Phase 4)', () => {
  it('label ranges tile the band table without gaps', () => {
    const sorted = [...LABEL_SCORE_RANGES].sort((a, b) => a.min - b.min)
    expect(sorted[0].min).toBe(0)
    expect(sorted[sorted.length - 1].max).toBe(100)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].min).toBe(sorted[i - 1].max + 1)
    for (const b of QUALIFICATION_BANDS) expect(sorted.some((r) => r.min === b.min)).toBe(true)
  })

  it('accepts a range id and enum fields', () => {
    const v = validateLabel({ opportunityKey: KEY, expectedRangeId: 'wp_high', relationshipRole: 'BUYER', buyerIntent: 'HIGH', fit: 'STRONG', expectedAction: 'CONTACT_NOW', labelerConfidence: 'HIGH', reason: 'First-person ask with budget', evidenceLines: ['We are looking for an agency'] })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.label.expectedScoreMin).toBe(65)
      expect(v.label.expectedScoreMax).toBe(74)
      expect(v.label.evidenceLines).toHaveLength(1)
    }
  })

  it('rejects bad keys, bad enums, inverted ranges and empty labels', () => {
    expect(validateLabel({ opportunityKey: 'nope' }).ok).toBe(false)
    expect(validateLabel({ opportunityKey: KEY, relationshipRole: 'WIZARD' }).ok).toBe(false)
    expect(validateLabel({ opportunityKey: KEY, expectedScoreMin: 70, expectedScoreMax: 60 }).ok).toBe(false)
    expect(validateLabel({ opportunityKey: KEY, expectedScoreMin: 70, expectedScoreMax: 101 }).ok).toBe(false)
    expect(validateLabel({ opportunityKey: KEY }).ok).toBe(false)
    expect(validateLabel({ opportunityKey: KEY, expectedRangeId: 'not-a-range' }).ok).toBe(false)
  })
})

describe('active-learning priority (Phase 23)', () => {
  const base = {
    opportunityKey: KEY, primary: { kind: 'lead' as const, id: 'l1' }, representations: [{ kind: 'lead' as const, id: 'l1' }], platform: 'linkedin' as const, createdAt: '2026-10-20T00:00:00Z', repId: null,
    company: 'Acme', contactName: null, rawSource: 'x'.repeat(100), sourceLength: 100, language: 'en', sourceCompleteness: 80,
    production: { score: 60, display: 6, qualification: 'WORTH_PURSUING' as const, buyerIntent: 'UNKNOWN', relationshipRole: 'BUILDER', commercialPotential: 'HIGH', fit: 'MEDIUM', authority: 'FOUNDER', timing: 'NONE', access: 'CONNECTION', confidence: 'HIGH', action: 'CONNECT_WITH_NOTE', reasons: [], watchOut: [], contradictions: 0, fallbackUsed: false, stale: false, versions: null, decisionRunId: null, currentSenderId: null, bestSenderId: null, bestSenderMatch: null },
    evidence: { quotes: [], rejected: [] }, features: null, candidates: [], messages: { drafts: 0, sent: 0, inbound: 0, edited: 0, firstSentPreview: null },
    outcome: { connectionAccepted: false, replied: false, meeting: false, won: false, lost: false, status: null }, feedback: [], labels: [],
  }
  it('ranks engine disagreement, unexpected outcomes and feedback above routine rows', () => {
    const routine = computePriority(base)
    const disagree = computePriority({ ...base, candidates: [{ engine: 'calibrated_v4', version: 'x', score: 40, qualification: 'MAYBE', action: 'OBSERVE', confidence: 0.6, accountValue: 40, intentValue: 0, guards: [], reasons: [] }] })
    const surprise = computePriority({ ...base, production: { ...base.production, score: 20, qualification: 'LOW' }, outcome: { ...base.outcome, replied: true } })
    const labelled = computePriority({ ...base, labels: [{ id: 'x' } as never] })
    expect(disagree.score).toBeGreaterThan(routine.score)
    expect(disagree.reasons).toContain('engines disagree')
    expect(surprise.reasons).toContain('unexpected positive outcome')
    expect(surprise.score).toBeGreaterThan(disagree.score)
    expect(labelled.score).toBeLessThan(routine.score)
  })
  it('flags near-threshold scores', () => {
    const edge = computePriority({ ...base, production: { ...base.production, score: 56 } })
    expect(edge.reasons).toContain('near band edge')
  })
})
