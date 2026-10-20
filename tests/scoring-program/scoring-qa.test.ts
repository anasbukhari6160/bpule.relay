/**
 * Admin Scoring QA Center + monitor (Phases 29, 30, 43): projection of stored
 * decisions, filters, drift alerts. Pure functions, no database.
 */
import { describe, it, expect } from 'vitest'
import { applyQaFilters, buildScoringMonitor, projectDecisionRow, type QaDecisionRow } from '@/lib/admin/scoring-qa'
import { currentVersions, SCORING_VERSION } from '@/lib/intelligence-v3/versions'

function packet(over: Record<string, unknown> = {}) {
  return {
    version: 'relay_decision_v3',
    decisionRunId: 'v3run_test',
    score: 78,
    qualification: 'strong',
    action: 'CONTACT_NOW',
    confidence: 0.8,
    buyerIntent: { buyerIntentLevel: 'HIGH', relationshipRole: 'BUYER', contradictions: [] },
    resolved: { commercialPotential: 'HIGH', fit: 'STRONG', buyerTiming: 'CURRENT', access: 'DIRECT', activityRecency: 'FRESH' },
    confidenceDetail: { label: 'HIGH', reasons: [], researchMore: false },
    recommendedAction: { action: 'CONTACT_NOW' },
    versions: currentVersions({ routingVersion: 'routing_v1', modelVersion: 'stub' }),
    sourceFacts: { rejectedSignals: [{ signal: 'budget', value: '$50k', sourceLine: 'x', sourceSection: 'posts', actor: 'third_party', organization: null, temporalClass: 'CURRENT', reason: 'someone else said it' }] },
    eventSource: 'deterministic',
    fallbackUsed: false,
    ...over,
  }
}

const row = (id: string, over: Record<string, unknown> = {}, ci: Record<string, unknown> = {}): QaDecisionRow =>
  projectDecisionRow({ id, kind: 'lead', company: 'Acme', contactName: null, repId: 'r1', createdAt: '2026-10-19T00:00:00Z', canonicalScore: (ci.score as number) ?? 78, canonicalIntelligence: packet(ci), currentSenderId: 'p1', bestSenderId: 'p1', bestSenderMatch: 80, ...over })

describe('projectDecisionRow', () => {
  it('projects display and qualification from the canonical score, not from stored labels', () => {
    const r = row('a', {}, { score: 60, qualification: 'strong' })
    expect(r.canonicalScore).toBe(60)
    expect(r.displayScore).toBe(6)
    expect(r.qualification).toBe('WORTH_PURSUING')
    expect(r.storedQualification).toBe('strong')
    expect(r.rejectedSignals).toHaveLength(1)
    expect(r.stale).toBe(false)
  })
  it('flags packets from older versions as stale', () => {
    const r = row('b', {}, { versions: { ...currentVersions({ routingVersion: 'routing_v1', modelVersion: 'x' }), scoringVersion: 'relay_decision_v3.0.0' } })
    expect(r.stale).toBe(true)
  })
  it('tolerates a legacy packet with no V3 fields', () => {
    const r = projectDecisionRow({ id: 'c', kind: 'prospect', company: null, contactName: null, repId: null, createdAt: '2026-10-19T00:00:00Z', canonicalScore: 40, canonicalIntelligence: { qualification: 'maybe' }, currentSenderId: null })
    expect(r.qualification).toBe('MAYBE')
    expect(r.buyerIntent).toBeNull()
    expect(r.stale).toBe(true)
    expect(r.rejectedSignals).toEqual([])
  })
})

describe('applyQaFilters', () => {
  const rows = [
    row('buyer'),
    row('seller', {}, { score: 30, buyerIntent: { buyerIntentLevel: 'UNKNOWN', relationshipRole: 'SELLER', contradictions: [] } }),
    row('contra', {}, { score: 50, buyerIntent: { buyerIntentLevel: 'UNKNOWN', relationshipRole: 'UNKNOWN', contradictions: ['x'] }, confidenceDetail: { label: 'LOW', reasons: [], researchMore: true } }),
    row('mismatch', { bestSenderId: 'p2' }),
    row('fallback', {}, { fallbackUsed: true }),
  ]
  it('each filter isolates its population', () => {
    expect(applyQaFilters(rows, { seller: true }).map((r) => r.id)).toEqual(['seller'])
    expect(applyQaFilters(rows, { contradiction: true }).map((r) => r.id)).toEqual(['contra'])
    expect(applyQaFilters(rows, { lowConfidence: true }).map((r) => r.id)).toEqual(['contra'])
    expect(applyQaFilters(rows, { routingMismatch: true }).map((r) => r.id)).toEqual(['mismatch'])
    expect(applyQaFilters(rows, { fallback: true }).map((r) => r.id)).toEqual(['fallback'])
    expect(applyQaFilters(rows, { lowScore: true }).map((r) => r.id)).toEqual(['seller'])
    expect(applyQaFilters(rows, { highScore: true }).map((r) => r.id).sort()).toEqual(['buyer', 'fallback', 'mismatch'])
  })
})

describe('buildScoringMonitor', () => {
  it('computes rates and raises collapse / false-buyer alerts', () => {
    const rows: QaDecisionRow[] = []
    for (let i = 0; i < 30; i++) rows.push(row(`s${i}`, {}, { score: 60, buyerIntent: { buyerIntentLevel: 'UNKNOWN', relationshipRole: 'SELLER', contradictions: [] } }))
    const m = buildScoringMonitor(rows, [{ feedback_type: 'SCORE_TOO_HIGH' }, { feedback_type: 'SCORE_TOO_HIGH' }], '2026-10-01T00:00:00Z')
    expect(m.window.count).toBe(30)
    expect(m.scoringVersion).toBe(SCORING_VERSION)
    expect(m.rates.unknownIntent).toBe(1)
    expect(m.alerts.some((a) => a.level === 'critical' && /service providers/.test(a.message))).toBe(true)
    expect(m.alerts.some((a) => /display collapse/.test(a.message))).toBe(true)
    expect(m.feedback.SCORE_TOO_HIGH).toBe(2)
  })
  it('stays quiet on a healthy mixed window', () => {
    const rows: QaDecisionRow[] = []
    const scores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95]
    for (let i = 0; i < 30; i++) rows.push(row(`h${i}`, {}, { score: scores[i % scores.length], buyerIntent: { buyerIntentLevel: scores[i % 10] >= 70 ? 'HIGH' : 'UNKNOWN', relationshipRole: scores[i % 10] >= 70 ? 'BUYER' : 'BUILDER', contradictions: [] } }))
    const m = buildScoringMonitor(rows, [], '2026-10-01T00:00:00Z')
    expect(m.alerts.filter((a) => a.level === 'critical')).toEqual([])
    expect(Object.keys(m.qualificationHistogram).sort()).toEqual(['LOW', 'MAYBE', 'SKIP', 'STRONG', 'WORTH_PURSUING'])
  })
})
