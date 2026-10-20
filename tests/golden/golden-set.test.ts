/**
 * Golden set — every frozen fixture through the production pipeline, offline.
 *
 * One test per fixture so a regression names the profile class it broke.
 * Expectations are ranges and sets (see tests/golden/types.ts). Distribution
 * health is asserted at the end over the DISTINCT profiles (the adversarial
 * attacks are clones of one base profile and are reported separately).
 */
import { describe, it, expect } from 'vitest'
import { GOLDEN_SET } from './fixtures'
import { ATTACK_COUNT } from './fixtures-adversarial'
import { runOffline } from '../helpers/score-source'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'

const REF = new Date('2026-10-20T00:00:00Z')
const results = new Map<string, V3LeadDecisionPacket>()

async function packetFor(id: string): Promise<V3LeadDecisionPacket> {
  const cached = results.get(id)
  if (cached) return cached
  const f = GOLDEN_SET.find((x) => x.id === id)!
  const p = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: REF })
  results.set(id, p)
  return p
}

describe('golden set — inventory', () => {
  it('has at least 200 fixtures and 100 adversarial attacks', () => {
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(200)
    expect(ATTACK_COUNT).toBeGreaterThanOrEqual(100)
    expect(GOLDEN_SET.filter((f) => f.category === 'multilingual').length).toBeGreaterThanOrEqual(15)
  })
})

describe('golden set — per fixture', () => {
  for (const f of GOLDEN_SET) {
    it(`${f.category} :: ${f.id}`, async () => {
      const packet = await packetFor(f.id)
      const errors: string[] = []
      const q = qualifyCanonicalScore(packet.score).qualification
      const intent = packet.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN'
      const cp = packet.resolved?.commercialPotential ?? 'LOW'
      const action = packet.recommendedAction?.action ?? packet.action
      const role = packet.buyerIntent?.relationshipRole ?? 'UNKNOWN'
      const e = f.expect
      if (e.scoreRange && (packet.score < e.scoreRange[0] || packet.score > e.scoreRange[1])) errors.push(`score ${packet.score} ∉ [${e.scoreRange}]`)
      if (e.qualification && !e.qualification.includes(q)) errors.push(`qualification ${q} ∉ ${e.qualification.join('|')}`)
      if (e.buyerIntent && !e.buyerIntent.includes(intent as never)) errors.push(`intent ${intent} ∉ ${e.buyerIntent.join('|')}`)
      if (e.commercialPotential && !e.commercialPotential.includes(cp)) errors.push(`cp ${cp} ∉ ${e.commercialPotential.join('|')}`)
      if (e.action && !e.action.includes(action as never)) errors.push(`action ${action} ∉ ${e.action.join('|')}`)
      if (e.relationshipRole && !e.relationshipRole.includes(role)) errors.push(`role ${role} ∉ ${e.relationshipRole.join('|')}`)
      if (e.currentIndustry !== undefined && (packet.orgContext?.currentIndustry ?? null) !== e.currentIndustry) errors.push(`industry ${packet.orgContext?.currentIndustry} ≠ ${e.currentIndustry}`)
      if (e.notIndustry && (packet.orgContext?.currentIndustry ?? null) === e.notIndustry) errors.push(`industry must not be ${e.notIndustry}`)
      if (e.verifiedBudget !== undefined && Boolean(packet.buyerIntent?.verifiedBudget) !== e.verifiedBudget) errors.push(`verifiedBudget ${packet.buyerIntent?.verifiedBudget} ≠ ${e.verifiedBudget}`)
      if (e.verifiedHiring !== undefined && Boolean(packet.buyerIntent?.verifiedHiringNeed) !== e.verifiedHiring) errors.push(`verifiedHiring ${packet.buyerIntent?.verifiedHiringNeed} ≠ ${e.verifiedHiring}`)
      if (e.confidence && !e.confidence.includes(packet.confidenceDetail?.label ?? 'LOW')) errors.push(`confidence ${packet.confidenceDetail?.label} ∉ ${e.confidence.join('|')}`)
      const credited = [...packet.reasons, ...packet.dimensions.flatMap((d) => (d.evidence ?? []).filter((x) => x.kind !== 'inference').map((x) => x.text))].join(' | ')
      for (const phrase of f.mustNotCredit ?? []) if (credited.includes(phrase)) errors.push(`credited forbidden "${phrase}"`)
      // Structural invariants every packet must satisfy.
      if (packet.qualification !== 'INELIGIBLE' && qualifyCanonicalScore(packet.score).qualification !== packet.qualification && !(packet.qualification === 'SKIP' && packet.label === 'Closed episode')) errors.push(`stored qualification ${packet.qualification} disagrees with score ${packet.score}`)
      if (!packet.versions) errors.push('packet has no versions')
      if (!packet.sourceFacts) errors.push('packet has no sourceFacts summary')
      expect(errors, `${f.id}: ${errors.join('; ')}\n${f.notes}`).toEqual([])
    })
  }
})

describe('golden set — distribution health (distinct profiles)', () => {
  it('no single display value or qualification dominates; buyers rank above founders above non-buyers', async () => {
    const distinct = GOLDEN_SET.filter((f) => !f.id.startsWith('attack-'))
    const packets = await Promise.all(distinct.map((f) => packetFor(f.id)))
    const n = packets.length
    const displayCounts = new Map<number, number>()
    const qualCounts = new Map<string, number>()
    for (const p of packets) {
      const d = displayScoreForCanonical(p.score)
      displayCounts.set(d, (displayCounts.get(d) ?? 0) + 1)
      const q = qualifyCanonicalScore(p.score).qualification
      qualCounts.set(q, (qualCounts.get(q) ?? 0) + 1)
    }
    for (const [d, c] of displayCounts) expect(c / n, `display ${d}/10 is ${Math.round((c / n) * 100)}% of distinct fixtures`).toBeLessThanOrEqual(0.3)
    for (const [q, c] of qualCounts) expect(c / n, `qualification ${q} is ${Math.round((c / n) * 100)}% of distinct fixtures`).toBeLessThanOrEqual(0.45)

    const mean = (cat: (f: typeof distinct[number]) => boolean) => {
      const sel = distinct.filter(cat).map((f) => results.get(f.id)!.score)
      return sel.reduce((a, b) => a + b, 0) / Math.max(1, sel.length)
    }
    const buyers = mean((f) => f.category === 'explicit_buyer' || f.category === 'explicit_contractor' || f.category === 'company_requesting_agency' || f.category === 'upwork_style_buyer')
    const founders = mean((f) => f.category === 'active_builder' || f.category === 'technical_founder' || f.category === 'funded_startup' || f.category === 'many_posts' || f.category === 'no_posts')
    const sellers = mean((f) => f.category === 'service_provider' || f.category === 'competitor' || f.category === 'consultant' || f.category === 'agency' && false)
    const nonBuyers = mean((f) => f.category === 'recruiter' || f.category === 'candidate' || f.category === 'job_seeker')
    expect(buyers).toBeGreaterThan(founders + 10)
    expect(founders).toBeGreaterThan(sellers)
    expect(sellers).toBeGreaterThanOrEqual(nonBuyers - 2)
  })
})
