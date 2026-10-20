/**
 * Model failure / fallback (Phase 35): timeout, invalid JSON, provider down,
 * partial extraction. The fallback preserves verified facts, never invents
 * buyer intent, still reports commercial potential, and says LOW confidence.
 * Nothing defaults to a flat 2/10 or a fake 50.
 */
import { describe, it, expect } from 'vitest'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import type { V3DecisionProvider } from '@/lib/intelligence-v3/decision/decision-provider'
import { li } from '../golden/builder'

const BUYER = li({
  name: 'Priya Raman', headline: 'CTO at Ledgerline | Payments', location: 'Austin, Texas, United States', degree: '2nd', connections: '500+ connections',
  about: ['Ledgerline is a payments startup. Team of 14 on Node.js, React and PostgreSQL.'],
  posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React. Budget approved: $40,000. Start within 3 weeks. DM me.' }],
  experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
})
const FOUNDER = li({
  name: 'Elena Marsh', headline: 'Founder & CEO at Quillstack | AI contract review', location: 'Manchester, England, United Kingdom', degree: '2nd', connections: '3,000+ connections',
  about: ['Quillstack helps small legal teams review contracts using LLMs. We are building on Next.js, Python and Postgres on AWS, and we just raised a £1.2M seed round.'],
  posts: [{ age: '2d', text: 'We just shipped clause-level redlining. 40 firms use it every day.' }],
  experience: [{ title: 'Founder & CEO', company: 'Quillstack', range: 'Jan 2024 - Present · 1 yr 10 mos' }],
})

const failing = (kind: 'throw' | 'timeout' | 'garbage'): V3DecisionProvider => ({
  id: `failing_${kind}`,
  modelVersion: 'x',
  isAvailable: () => true,
  decide: async () => {
    if (kind === 'throw') throw new Error('provider down')
    if (kind === 'timeout') throw new Error('timeout after 10000ms')
    // garbage: a provider that returned unparseable JSON would throw in parsing
    throw new SyntaxError('Unexpected token < in JSON at position 0')
  },
})

describe('deterministic fallback', () => {
  for (const kind of ['throw', 'timeout', 'garbage'] as const) {
    it(`${kind}: verified buyer request is preserved, confidence is not HIGH, packet is marked fallback`, async () => {
      const r = await produceV3Intelligence(BUYER, { decisionProvider: failing(kind) })
      const p = r.v3Packet!
      expect(p.fallbackUsed).toBe(true)
      expect(p.decisionProvider).toBe('deterministic_fallback')
      expect(p.buyerIntent?.verifiedBuyerRequest).toBe(true)
      expect(['MEDIUM', 'HIGH']).toContain(p.buyerIntent?.buyerIntentLevel)
      expect(p.buyerIntent?.verifiedBudget).toBe(true)
      expect(p.score).toBeGreaterThanOrEqual(55)
      expect(p.confidenceDetail?.label).not.toBe('HIGH')
      expect(p.score).not.toBe(50)
    })

    it(`${kind}: founder with no request gets UNKNOWN intent, real commercial potential, LOW/MEDIUM confidence`, async () => {
      const r = await produceV3Intelligence(FOUNDER, { decisionProvider: failing(kind) })
      const p = r.v3Packet!
      expect(p.fallbackUsed).toBe(true)
      expect(p.buyerIntent?.buyerIntentLevel).toBe('UNKNOWN')
      expect(['MEDIUM', 'HIGH', 'VERY_HIGH']).toContain(p.resolved?.commercialPotential)
      expect(p.score).toBeGreaterThan(20)
      expect(p.score).toBeLessThan(75)
      expect(['LOW', 'MEDIUM']).toContain(p.confidenceDetail?.label)
      expect(p.recommendedAction?.action).not.toBe('CONTACT_NOW')
    })
  }

  it('deterministicOnly runs with zero model calls and produces the same facts as the fallback', async () => {
    const a = await produceV3Intelligence(BUYER, { deterministicOnly: true })
    const b = await produceV3Intelligence(BUYER, { decisionProvider: failing('throw') })
    expect(a.v3Packet?.score).toBe(b.v3Packet?.score)
    expect(a.v3Packet?.buyerIntent?.buyerIntentLevel).toBe(b.v3Packet?.buyerIntent?.buyerIntentLevel)
  })

  it('partial extraction: no events from the model → deterministic events still carry the verified request', async () => {
    const r = await produceV3Intelligence(BUYER, { events: [], decisionProvider: failing('throw') })
    const p = r.v3Packet!
    expect(p.eventSource).toBe('deterministic')
    const selected = p.episodes.find((e) => e.id === p.selectedEpisodeId)
    expect(['AGENCY_REQUEST', 'PROJECT_REQUEST', 'FREELANCE_REQUEST', 'VENDOR_EVALUATION']).toContain(selected?.anchorEvent.eventType)
  })

  it('the fallback never produces a buyer from a seller', async () => {
    const seller = li({
      name: 'Adil Mahmood', headline: 'Co-founder & Director, Code Graphers | Custom Software Development', location: 'Lahore, Pakistan', degree: '2nd', connections: '3,000+ connections',
      about: ['We build scalable software solutions for businesses. Services: Web Development, Mobile Application Development, SaaS Development.'],
      posts: [{ age: '2d', text: 'If you are looking for a reliable development partner for your next React project, our team has capacity. Let\'s talk.' }],
      experience: [{ title: 'Co-founder & Director', company: 'Code Graphers', range: 'Jan 2018 - Present · 7 yrs 10 mos' }],
    })
    const r = await produceV3Intelligence(seller, { decisionProvider: failing('throw') })
    expect(r.v3Packet?.buyerIntent?.buyerIntentLevel).toBe('UNKNOWN')
    expect(r.v3Packet?.buyerIntent?.relationshipRole).toBe('SELLER')
    expect(r.v3Packet?.score).toBeLessThan(45)
  })
})
