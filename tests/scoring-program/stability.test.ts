/**
 * Stability (Phase 38): same source + same versions → identical canonical
 * score, qualification and action across 10 runs; small model jitter never
 * flips qualification or action except at a documented band boundary.
 */
import { describe, it, expect } from 'vitest'
import { runOffline } from '../helpers/score-source'
import { GOLDEN_SET } from '../golden/fixtures'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

const REF = new Date('2026-10-20T00:00:00Z')
const SAMPLE_IDS = ['buyer-agency-react-budget-deadline', 'founder-active-saas-strong-fit', 'recruiter-agency-hiring-for-clients', 'candidate-open-to-work', 'agency-competitor-react-shop', 'de-buyer-agentur-gesucht', 'cold-passive-executive', 'buyer-stale-request-six-months']

describe('determinism', () => {
  for (const id of SAMPLE_IDS) {
    it(`${id}: 10 runs are identical`, async () => {
      const f = GOLDEN_SET.find((x) => x.id === id)!
      const runs = await Promise.all(Array.from({ length: 10 }, () => runOffline(f.rawText, { model: f.model ?? null, referenceDate: REF })))
      const scores = new Set(runs.map((r) => r.score))
      const quals = new Set(runs.map((r) => r.qualification))
      const actions = new Set(runs.map((r) => r.recommendedAction?.action))
      const intents = new Set(runs.map((r) => r.buyerIntent?.buyerIntentLevel))
      expect(scores.size).toBe(1)
      expect(quals.size).toBe(1)
      expect(actions.size).toBe(1)
      expect(intents.size).toBe(1)
      // Dimension contributions identical too.
      const dims = new Set(runs.map((r) => JSON.stringify(r.dimensions.map((d) => [d.key, d.contribution]))))
      expect(dims.size).toBe(1)
    })
  }
})

describe('model jitter', () => {
  it('±0.1 on the model probabilities moves the score by at most 3 points and never flips a verified buyer out of its band', async () => {
    const f = GOLDEN_SET.find((x) => x.id === 'buyer-agency-react-budget-deadline')!
    const base = f.model!
    const variants = [-0.1, -0.05, 0, 0.05, 0.1].map((d) => ({ ...base, buyerRequestProbability: Math.min(1, Math.max(0, (base.buyerRequestProbability ?? 0.9) + d)), externalNeedProbability: Math.min(1, Math.max(0, (base.externalNeedProbability ?? 0.85) + d)) }))
    const runs = await Promise.all(variants.map((m) => runOffline(f.rawText, { model: m, referenceDate: REF })))
    const scores = runs.map((r) => r.score)
    expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(3)
    expect(new Set(runs.map((r) => qualifyCanonicalScore(r.score).qualification)).size).toBe(1)
    expect(new Set(runs.map((r) => r.recommendedAction?.action)).size).toBe(1)
  })

  it('model fit/timing/access jitter on a founder profile keeps intent UNKNOWN and action stable', async () => {
    const f = GOLDEN_SET.find((x) => x.id === 'founder-active-saas-strong-fit')!
    const variants = [
      { ...f.model!, fit: 'MEDIUM' as const }, { ...f.model!, fit: 'EXCELLENT' as const },
      { ...f.model!, timing: 'URGENT' as const }, { ...f.model!, timing: 'WEAK' as const },
      { ...f.model!, access: 'DIRECT' as const }, { ...f.model!, access: 'NONE' as const },
    ]
    const runs = await Promise.all(variants.map((m) => runOffline(f.rawText, { model: m, referenceDate: REF })))
    expect(new Set(runs.map((r) => r.buyerIntent?.buyerIntentLevel))).toEqual(new Set(['UNKNOWN']))
    const scores = runs.map((r) => r.score)
    expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(12)
    for (const r of runs) expect(['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE']).toContain(r.recommendedAction?.action)
  })

  it('the model claiming BUYER on a seller never moves the seller into a buyer band', async () => {
    const f = GOLDEN_SET.find((x) => x.id === 'agency-competitor-react-shop')!
    const runs = await Promise.all([0.2, 0.5, 0.7, 0.95].map((p) => runOffline(f.rawText, { model: { ...f.model!, relationship: 'BUYER', buyerRequestProbability: p, externalNeedProbability: p }, referenceDate: REF })))
    for (const r of runs) {
      expect(r.buyerIntent?.buyerIntentLevel).toBe('UNKNOWN')
      expect(['SKIP', 'LOW', 'MAYBE']).toContain(qualifyCanonicalScore(r.score).qualification)
    }
  })
})
