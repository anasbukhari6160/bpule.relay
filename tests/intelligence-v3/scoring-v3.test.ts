/**
 * Scoring V3.2 — canonical score invariants, asserted on SOURCE TEXT.
 *
 * The scorer credits nothing it cannot verify in the source, so every case
 * here is a profile, not a bare decision object:
 * - seven bounded additive dimensions, no multipliers
 * - buyer intent only from the canonical decision
 * - sender data never enters the score
 * - closed episodes are SKIP, never resurrected
 * - timing and intent stay separate
 */

import { describe, it, expect } from 'vitest'
import { scoreEpisode } from '@/lib/intelligence-v3/scoring/score-v3'
import { V3_SCORING_WEIGHTS } from '@/lib/intelligence-v3/config'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveBuyerIntentFromSource } from '@/lib/intelligence-v3/buyer-intent'
import type { V3OpportunityEpisode } from '@/lib/intelligence-v3/types'
import { scoreSourceForTest, runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'

const BUYER = li({
  name: 'Priya Raman', headline: 'CTO at Ledgerline | Payments infrastructure', location: 'Austin, Texas, United States', degree: '1st', connections: '500+ connections',
  about: ['Ledgerline is a payments startup. We are a team of 14 engineers on Node.js, React and PostgreSQL on AWS.'],
  posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React and TypeScript. Budget approved: $40,000. Start within 3 weeks. DM me with examples of similar work.' }],
  experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
})

const FOUNDER = li({
  name: 'Elena Marsh', headline: 'Founder & CEO at Quillstack | AI contract review', location: 'Manchester, England, United Kingdom', degree: '2nd', connections: '3,000+ connections',
  about: ['Quillstack helps small legal teams review contracts using LLMs. We are building on Next.js, Python and Postgres on AWS, and we just raised a £1.2M seed round.'],
  posts: [{ age: '2d', text: 'We just shipped clause-level redlining. 40 firms use it every day.' }],
  experience: [{ title: 'Founder & CEO', company: 'Quillstack', range: 'Jan 2024 - Present · 1 yr 10 mos' }],
})

const SELLER = li({
  name: 'Adil Mahmood', headline: 'Co-founder & Director, Code Graphers | Custom Software Development', location: 'Lahore, Pakistan', degree: '2nd', connections: '3,000+ connections',
  about: ['We build scalable software solutions for businesses. Services: Web Development, Mobile Application Development, SaaS Development.'],
  posts: [{ age: '2d', text: 'If you are looking for a reliable development partner for your next React project, our team has capacity. Let\'s talk.' }],
  experience: [{ title: 'Co-founder & Director', company: 'Code Graphers', range: 'Jan 2018 - Present · 7 yrs 10 mos' }],
})

const STALE_BUYER = BUYER.replace('3d •', '8mo •').replace('posted this • 3d', 'posted this • 8mo')

const MODEL_BUYER = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'DIRECT' as const }

describe('V3.2 Scoring Engine', () => {
  describe('formula shape', () => {
    it('weights sum to 1 and every dimension is bounded 0-1', () => {
      const sum = Object.values(V3_SCORING_WEIGHTS).reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(0.001)
      const out = scoreSourceForTest(BUYER, MODEL_BUYER)
      expect(out.dimensions).toHaveLength(7)
      for (const d of out.dimensions) {
        expect(d.raw).toBeGreaterThanOrEqual(0)
        expect(d.raw).toBeLessThanOrEqual(1)
        expect(d.contribution).toBeCloseTo(d.raw * d.weight * 100, 5)
      }
    })

    it('score is the rounded sum of the dimensions — no multipliers, no blend', () => {
      const out = scoreSourceForTest(BUYER, MODEL_BUYER)
      const subtotal = out.dimensions.reduce((s, d) => s + d.contribution, 0)
      expect(out.score).toBe(Math.round(Math.max(0, Math.min(100, subtotal))))
      expect(out.calculation?.statusMultiplier).toBe(1)
      expect(out.calculation?.relationshipMultiplier).toBe(1)
      expect(out.calculation?.signalCheckTotal).toBeNull()
    })

    it('a score never changes when sender capabilities or proof relevance are passed', () => {
      const facts = readSourceFacts(BUYER)
      const intent = resolveBuyerIntentFromSource(BUYER, { modelBuyerProbability: 0.9, modelExternalNeedProbability: 0.85, modelRelationship: 'BUYER' })
      const episode: V3OpportunityEpisode = {
        id: 'ep', anchorEvent: { id: 'e', eventType: 'AGENCY_REQUEST', personId: null, organizationId: null, organizationName: 'Ledgerline', occurredAt: null, channel: null, requestedCapability: [], targetAudience: 'PUBLIC', explicitness: 'EXPLICIT', applyInstructions: [], evidenceRefs: [], polarity: 'ACTIVE' },
        organizationId: null, organizationName: 'Ledgerline', needOwnerPersonId: null, needOwnerType: 'ORGANIZATION_NEED', explicitRequest: true, requestedCapabilities: [], applicationChannels: [], evidenceRefs: [], eventRefs: [], status: 'CURRENT', detectedAt: new Date().toISOString(), lastActivityAt: null, ageDays: 3,
      }
      const decision = { ...MODEL_BUYER, needOwnerType: 'ORGANIZATION_NEED' as const, messageEligible: 0.8, providerConfidence: 0.8 }
      const base = scoreEpisode({ episode, decision, sourceFacts: facts, buyerIntent: intent })
      const withSender = scoreEpisode({ episode, decision, sourceFacts: facts, buyerIntent: intent, senderCapabilities: ['react', 'node', 'aws'], proofRelevance: 1.0, evidenceQuality: 1.0 })
      expect(withSender.score).toBe(base.score)
      expect(withSender.dimensions.map((d) => d.contribution)).toEqual(base.dimensions.map((d) => d.contribution))
    })
  })

  describe('buyer intent comes only from the canonical decision', () => {
    it('verified request + agreeing model → HIGH intent, buyerIntent raw ≥ 0.9', () => {
      const out = scoreSourceForTest(BUYER, MODEL_BUYER)
      const bi = out.dimensions.find((d) => d.key === 'buyerIntent')!
      expect(bi.raw).toBeGreaterThanOrEqual(0.9)
      expect(out.reasons).toContain('Explicit buyer request detected (verified)')
      expect(out.score).toBeGreaterThanOrEqual(70)
      expect(['STRONG', 'WORTH_PURSUING']).toContain(out.qualification)
    })

    it('model says BUYER 0.9 on a founder with no request → UNKNOWN, capped, not STRONG', () => {
      const out = scoreSourceForTest(FOUNDER, MODEL_BUYER)
      const bi = out.dimensions.find((d) => d.key === 'buyerIntent')!
      expect(bi.raw).toBeLessThanOrEqual(0.35)
      expect(out.reasons).not.toContain('Explicit buyer request detected (verified)')
      expect(out.qualification).not.toBe('STRONG')
      expect(out.watchOut.join(' ')).toMatch(/not credited|disagree/i)
    })

    it('seller marketing never earns buyer credit even when the model claims it', () => {
      const out = scoreSourceForTest(SELLER, MODEL_BUYER)
      const bi = out.dimensions.find((d) => d.key === 'buyerIntent')!
      expect(bi.raw).toBeLessThanOrEqual(0.2)
      expect(out.score).toBeLessThan(45)
    })
  })

  describe('timing is separate from intent', () => {
    it('stale verified request scores lower than a fresh one but keeps its intent', () => {
      const fresh = scoreSourceForTest(BUYER, MODEL_BUYER)
      const stale = scoreSourceForTest(STALE_BUYER, { ...MODEL_BUYER, timing: 'STALE' })
      expect(stale.score).toBeLessThan(fresh.score)
      expect(stale.score).toBeGreaterThan(40)
      // Intent stays verified HIGH; its credit decays with the request's age.
      expect(stale.resolved?.timing.buyerTiming).toBe('WEAK')
      const bi = stale.dimensions.find((d) => d.key === 'buyerIntent')!
      expect(bi.raw).toBeGreaterThanOrEqual(0.5)
      expect(bi.raw).toBeLessThan(fresh.dimensions.find((d) => d.key === 'buyerIntent')!.raw)
      expect(bi.note).toMatch(/verified/i)
      expect(stale.watchOut.join(' ')).toMatch(/stale|days old/i)
    })

    it('a fresh post without a request never creates buyer timing', () => {
      const out = scoreSourceForTest(FOUNDER, { ...MODEL_BUYER, buyerRequestProbability: 0.2, relationship: 'UNKNOWN', timing: 'URGENT' })
      expect(out.resolved?.timing.buyerTiming).toBe('NONE')
      expect(out.resolved?.timing.activityRecency).toBe('FRESH')
      expect(out.resolved?.timing.urgencyRejected).toBe(true)
    })
  })

  describe('access is one authority', () => {
    it('1st-degree in the source is DIRECT even if the model says NONE', () => {
      const out = scoreSourceForTest(BUYER, { ...MODEL_BUYER, access: 'NONE' })
      expect(out.resolved?.access.level).toBe('DIRECT')
      expect(out.resolved?.access.overrode).toBe(true)
    })

    it('model DIRECT without any contact route in the source is capped to CONNECTION', () => {
      const noChrome = 'Sam Lee\nFounder at Quietwave\n\nAbout\nWe ship audio tools for podcasters.'
      const out = scoreSourceForTest(noChrome, { ...MODEL_BUYER, buyerRequestProbability: 0.2, relationship: 'UNKNOWN', access: 'DIRECT' })
      expect(out.resolved?.access.level).toBe('CONNECTION')
    })
  })

  describe('closed episodes', () => {
    it('age alone never closes an episode — a 2-year-old request is STALE, intent stays on record', async () => {
      const packet = await runOffline(STALE_BUYER.replace('8mo •', '2y •').replace('posted this • 8mo', 'posted this • 2y'), { model: { ...MODEL_BUYER, timing: 'STALE' } })
      const selected = packet.episodes.find((e) => e.id === packet.selectedEpisodeId)
      expect(selected?.status).toBe('STALE')
      expect(packet.buyerIntent?.verifiedBuyerRequest).toBe(true)
      expect(packet.score).toBeLessThan(75)
      expect(['WAIT', 'RESEARCH_MORE', 'CONNECT_WITHOUT_NOTE', 'CONNECT_WITH_NOTE']).toContain(packet.recommendedAction?.action)
    })

    it('a negated episode is SKIP with buyer and timing credit withdrawn', () => {
      const facts = readSourceFacts(BUYER)
      const intent = resolveBuyerIntentFromSource(BUYER, { modelBuyerProbability: 0.9 })
      const episode: V3OpportunityEpisode = {
        id: 'ep', anchorEvent: { id: 'e', eventType: 'AGENCY_REQUEST', personId: null, organizationId: null, organizationName: 'Ledgerline', occurredAt: null, channel: null, requestedCapability: [], targetAudience: 'PUBLIC', explicitness: 'EXPLICIT', applyInstructions: [], evidenceRefs: [], polarity: 'NEGATED' },
        organizationId: null, organizationName: 'Ledgerline', needOwnerPersonId: null, needOwnerType: 'ORGANIZATION_NEED', explicitRequest: true, requestedCapabilities: [], applicationChannels: [], evidenceRefs: [], eventRefs: [], status: 'CLOSED', detectedAt: new Date().toISOString(), lastActivityAt: null, ageDays: 3,
      }
      const out = scoreEpisode({ episode, decision: { ...MODEL_BUYER, needOwnerType: 'ORGANIZATION_NEED', messageEligible: 0.8, providerConfidence: 0.8 }, rawText: BUYER, sourceFacts: facts, buyerIntent: intent })
      expect(out.qualification).toBe('SKIP')
      expect(out.dimensions.find((d) => d.key === 'buyerIntent')!.raw).toBe(0)
      expect(out.dimensions.find((d) => d.key === 'timing')!.raw).toBeLessThanOrEqual(0.15)
    })
  })

  describe('ranking relations', () => {
    it('explicit buyer > active founder > seller > candidate', async () => {
      const buyer = (await runOffline(BUYER, { model: MODEL_BUYER })).score
      const founder = (await runOffline(FOUNDER, { model: { ...MODEL_BUYER, relationship: 'UNKNOWN', buyerRequestProbability: 0.2 } })).score
      const seller = (await runOffline(SELLER, { model: { ...MODEL_BUYER, relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.2 } })).score
      const candidate = (await runOffline('Pavel Novak\nSenior Developer | Open to work\n\nAbout\nI am open to new contract or full-time opportunities.', { model: { ...MODEL_BUYER, relationship: 'CANDIDATE', buyerRequestProbability: 0.1 } })).score
      expect(buyer).toBeGreaterThan(founder)
      expect(founder).toBeGreaterThan(seller)
      expect(seller).toBeGreaterThanOrEqual(candidate)
    })
  })
})
