import { describe, expect, it } from 'vitest'
import { GOLDEN_SET } from '../golden/fixtures'
import { runOffline } from '../helpers/score-source'
import { featuresFromPacket, type OpportunityFeatures } from '@/lib/scoring-v4/opportunity-features'
import { ENGINES, ENGINE_IDS, productionEngineId, shadowEngineIds } from '@/lib/scoring-v4/engines/registry'
import { applyGuards, GUARD_CEILINGS } from '@/lib/scoring-v4/engines/guards'
import { scoreCalibratedV4 } from '@/lib/scoring-v4/engines/calibrated-v4'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'

const REF = new Date('2026-10-20T00:00:00Z')

async function featuresFor(id: string): Promise<{ f: OpportunityFeatures; v3: number }> {
  const fx = GOLDEN_SET.find((x) => x.id === id)
  if (!fx) throw new Error(`fixture ${id} missing`)
  const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
  return { f: featuresFromPacket(packet, fx.rawText)!, v3: packet.score }
}

describe('candidate engines (Phase 14) — shared contract', () => {
  it('every engine returns a bounded score, a band that matches it, and a confidence in [0,1]', async () => {
    const samples = GOLDEN_SET.filter((x) => !x.id.startsWith('attack-')).slice(0, 25)
    for (const fx of samples) {
      const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
      const f = featuresFromPacket(packet, fx.rawText)!
      for (const id of ENGINE_IDS) {
        const c = ENGINES[id].score(f, { v3Score: packet.score })
        expect(c.engine).toBe(id)
        expect(c.score).toBeGreaterThanOrEqual(0)
        expect(c.score).toBeLessThanOrEqual(100)
        expect(Number.isInteger(c.score)).toBe(true)
        expect(c.qualification).toBe(qualifyCanonicalScore(c.score).qualification)
        expect(c.confidence).toBeGreaterThanOrEqual(0)
        expect(c.confidence).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic: the same features give the same score ten times', async () => {
    const { f } = await featuresFor('buyer-agency-react-budget-deadline')
    for (const id of ENGINE_IDS) {
      const first = ENGINES[id].score(f, { v3Score: 80 }).score
      for (let i = 0; i < 10; i++) expect(ENGINES[id].score(f, { v3Score: 80 }).score).toBe(first)
    }
  })

  it('never lets a candidate seeking work past LOW or a software-services seller past MAYBE', async () => {
    const sellers = GOLDEN_SET.filter((x) => ['service_provider', 'competitor', 'agency', 'recruiter', 'candidate', 'job_seeker'].includes(x.category))
    expect(sellers.length).toBeGreaterThan(5)
    for (const fx of sellers) {
      const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
      const f = featuresFromPacket(packet, fx.rawText)!
      if (f.intent.verifiedRequest) continue
      for (const id of ENGINE_IDS) {
        const c = ENGINES[id].score(f, { v3Score: packet.score })
        if (f.relationshipRole === 'CANDIDATE') expect(c.score).toBeLessThanOrEqual(GUARD_CEILINGS.candidate)
        if (f.relationshipRole === 'RECRUITER' || (f.relationshipRole === 'SELLER' && f.supply.softwareServicesSeller)) expect(c.score).toBeLessThanOrEqual(GUARD_CEILINGS.supplySide)
      }
    }
  })

  it('keeps a verified current request with budget visible (never LOW/SKIP)', async () => {
    const { f } = await featuresFor('buyer-agency-react-budget-deadline')
    expect(f.intent.verifiedRequest).toBe(true)
    for (const id of ENGINE_IDS) {
      const c = ENGINES[id].score(f, { v3Score: 85 })
      expect(c.score).toBeGreaterThanOrEqual(GUARD_CEILINGS.verifiedBuyerFloor)
    }
  })

  it('no planted line raises any engine above the clone median (attack resistance)', async () => {
    const clones = GOLDEN_SET.filter((x) => x.id.startsWith('attack-'))
    expect(clones.length).toBeGreaterThan(100)
    const rows = await Promise.all(clones.map(async (fx) => {
      const packet = await runOffline(fx.rawText, { model: fx.model ?? null, referenceDate: REF })
      return { id: fx.id, f: featuresFromPacket(packet, fx.rawText)!, v3: packet.score }
    }))
    for (const id of ENGINE_IDS) {
      const scored = rows.map((r) => ({ id: r.id, s: ENGINES[id].score(r.f, { v3Score: r.v3 }).score }))
      const sorted = scored.map((x) => x.s).sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      // A planted buyer/budget/urgency line must never lift the score by a
      // band's width. Genuine own-team hiring lines ("we are hiring 10")
      // legitimately raise account value a little, so the tolerance is 10.
      const raised = scored.filter((x) => x.s > median + 10)
      expect(raised, `${id}: planted lines raised ${raised.map((x) => x.id).join(', ')} above median ${median}`).toHaveLength(0)
      // Downward moves come from SourceFacts re-reading the role from one
      // planted line (seller / candidate phrasing) — a known V3 reader
      // sensitivity recorded in the program report, not hidden here.
      const lowered = scored.filter((x) => x.s < median - 3)
      expect(lowered.length).toBeLessThanOrEqual(30)
    }
  })
})

describe('calibrated_v4 (Phase 9): unknown intent is not medium', () => {
  it('separates a high-value unknown-intent founder from a generic builder through account value, not intent', async () => {
    const strong = await featuresFor('founder-funded-startup-hiring')
    const stale = await featuresFor('founder-stale-no-activity-two-years')
    const a = scoreCalibratedV4(strong.f), b = scoreCalibratedV4(stale.f)
    expect(a.intentValue).toBe(0)
    expect(b.intentValue).toBe(0)
    expect(a.accountValue).toBeGreaterThan(b.accountValue)
    expect(a.score).toBeGreaterThan(b.score + 10)
  })

  it('ranks an explicit buyer above the best unknown-intent founder', async () => {
    const buyer = await featuresFor('buyer-agency-react-budget-deadline')
    const founder = await featuresFor('founder-funded-startup-hiring')
    expect(scoreCalibratedV4(buyer.f).score).toBeGreaterThan(scoreCalibratedV4(founder.f).score)
  })

  it('guards are visible in the trace, never hidden', async () => {
    const seller = GOLDEN_SET.find((x) => x.category === 'competitor')!
    const packet = await runOffline(seller.rawText, { model: seller.model ?? null, referenceDate: REF })
    const f = featuresFromPacket(packet, seller.rawText)!
    const forced = { ...f, episodeClosed: true }
    const g = applyGuards(90, forced)
    expect(g.score).toBeLessThanOrEqual(GUARD_CEILINGS.closed)
    expect(g.guards[0]).toMatch(/closed episode/)
  })
})

describe('engine registry + feature flag (Phase 33)', () => {
  it('defaults to v3 and ignores unknown engines', () => {
    expect(productionEngineId({})).toBe('v3')
    expect(productionEngineId({ SCORING_ENGINE: 'nope' })).toBe('v3')
    expect(productionEngineId({ SCORING_ENGINE: 'calibrated_v4' })).toBe('calibrated_v4')
  })
  it('shadow engines exclude the production engine and unknown ids', () => {
    expect(shadowEngineIds({ SCORING_SHADOW_ENGINES: 'calibrated_v4, ordinal_logit,bogus,v3' })).toEqual(['calibrated_v4', 'ordinal_logit'])
    expect(shadowEngineIds({ SCORING_ENGINE: 'calibrated_v4', SCORING_SHADOW_ENGINES: 'calibrated_v4,knn_features' })).toEqual(['knn_features'])
    expect(shadowEngineIds({})).toEqual([])
  })
})
