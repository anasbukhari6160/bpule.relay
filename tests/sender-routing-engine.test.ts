/**
 * Sender Routing Engine Tests
 *
 * Validates the unified rankSendersForLead() function:
 * - Deterministic ranking
 * - Skill overlap scoring
 * - Proof relevance scoring
 * - Industry match bonus
 * - Best vs current sender mismatch
 * - Confidence from evidence richness
 */

import { describe, it, expect } from 'vitest'
import { rankSendersForLead, ROUTING_VERSION, type SenderProfile, type RoutingLeadContext } from '@/lib/relay/sender-routing-engine'

function makeSender(overrides: Partial<SenderProfile> = {}): SenderProfile {
  return {
    id: 'sender_default',
    name: 'Default Sender',
    role: 'Full-stack Developer',
    platform: 'linkedin',
    skills: ['react', 'node.js', 'typescript'],
    industries: ['saas', 'fintech'],
    proof: [],
    holders: [{ repId: 'rep_1', name: 'Rep One' }],
    accessibleToRep: true,
    ...overrides,
  }
}

function makeLead(overrides: Partial<RoutingLeadContext> = {}): RoutingLeadContext {
  return {
    capabilities: ['react', 'node.js', 'typescript'],
    industries: ['saas'],
    buyerRequestProbability: 0.7,
    fitLevel: 'STRONG',
    rawTerms: ['Acme Corp', 'CTO'],
    platform: 'linkedin',
    ...overrides,
  }
}

describe('Sender Routing Engine', () => {
  describe('basic ranking', () => {
    it('ranks a single sender correctly', () => {
      const lead = makeLead()
      const senders = [makeSender({ id: 's1', name: 'Alice' })]

      const result = rankSendersForLead(lead, senders, null)

      expect(result.rankings).toHaveLength(1)
      expect(result.rankings[0].senderId).toBe('s1')
      expect(result.rankings[0].profileMatch).toBeGreaterThan(0)
      expect(result.routingVersion).toBe(ROUTING_VERSION)
    })

    it('ranks multiple senders by match score', () => {
      const lead = makeLead()
      const senders = [
        makeSender({ id: 's1', name: 'No Match', skills: ['c++', 'embedded'] }),
        makeSender({ id: 's2', name: 'Partial', skills: ['react'] }),
        makeSender({ id: 's3', name: 'Strong', skills: ['react', 'node.js', 'typescript', 'nextjs'] }),
      ]

      const result = rankSendersForLead(lead, senders, null)

      expect(result.rankings[0].senderId).toBe('s3')
      expect(result.rankings[1].senderId).toBe('s2')
      expect(result.rankings[2].senderId).toBe('s1')
    })

    it('includes current sender tracking', () => {
      const lead = makeLead()
      const senders = [
        makeSender({ id: 's1', name: 'Best', skills: ['react', 'node.js', 'typescript'] }),
        makeSender({ id: 's2', name: 'Current', skills: ['react'] }),
      ]

      const result = rankSendersForLead(lead, senders, 's2')

      expect(result.currentSenderId).toBe('s2')
      expect(result.bestSenderId).toBe('s1')
      expect(result.currentSenderRank).toBe(2)
      expect(result.currentSenderMatch).toBeLessThan(result.bestSenderMatch!)
      expect(result.mismatchDelta).toBeGreaterThan(0)
    })
  })

  describe('skill overlap scoring', () => {
    it('scores higher for more matching skills', () => {
      const lead = makeLead()
      const low = makeSender({ id: 'low', skills: ['react'] })
      const high = makeSender({ id: 'high', skills: ['react', 'node.js', 'typescript', 'nextjs', 'aws'] })

      const result = rankSendersForLead(lead, [low, high], null)

      const lowRank = result.rankings.find(r => r.senderId === 'low')!
      const highRank = result.rankings.find(r => r.senderId === 'high')!

      expect(highRank.profileMatch).toBeGreaterThan(lowRank.profileMatch)
    })

    it('produces zero match for no overlap', () => {
      const lead = makeLead({ capabilities: ['rust', 'golang'], rawTerms: ['Systems Inc'], industries: [] })
      const sender = makeSender({ skills: ['react', 'node.js'], industries: [] })

      const result = rankSendersForLead(lead, [sender], null)

      expect(result.rankings[0].profileMatch).toBe(0)
      expect(result.rankings[0].risks).toContain('No matching skills, proof, or industries')
    })
  })

  describe('proof relevance', () => {
    it('scores proof cards higher than self-declared skills alone', () => {
      const lead = makeLead()
      const noProof = makeSender({ id: 'no_proof', skills: ['react'] })
      const withProof = makeSender({
        id: 'with_proof',
        skills: ['react'],
        proof: [{
          text: 'Built a React + Node.js SaaS platform for a fintech client',
          tags: ['react', 'node.js', 'saas'],
          strong: true,
          verified: true,
        }],
      })

      const result = rankSendersForLead(lead, [noProof, withProof], null)

      const proofRank = result.rankings.find(r => r.senderId === 'with_proof')!
      const noProofRank = result.rankings.find(r => r.senderId === 'no_proof')!

      expect(proofRank.profileMatch).toBeGreaterThan(noProofRank.profileMatch)
      expect(proofRank.reasons.some(r => r.includes('proof'))).toBe(true)
    })
  })

  describe('industry match', () => {
    it('adds bonus for matching industries', () => {
      const lead = makeLead({ industries: ['saas', 'fintech'] })
      const noIndustry = makeSender({ id: 'no_ind', industries: [] })
      const withIndustry = makeSender({ id: 'with_ind', industries: ['saas', 'fintech', 'healthtech'] })

      const result = rankSendersForLead(lead, [noIndustry, withIndustry], null)

      const industryRank = result.rankings.find(r => r.senderId === 'with_ind')!
      const noIndustryRank = result.rankings.find(r => r.senderId === 'no_ind')!

      expect(industryRank.profileMatch).toBeGreaterThan(noIndustryRank.profileMatch)
    })
  })

  describe('platform filtering', () => {
    it('filters senders by platform when specified', () => {
      const lead = makeLead({ platform: 'upwork' })
      const linkedin = makeSender({ id: 'li', platform: 'linkedin' })
      const upwork = makeSender({ id: 'uw', platform: 'upwork' })

      const result = rankSendersForLead(lead, [linkedin, upwork], null)

      expect(result.rankings).toHaveLength(1)
      expect(result.rankings[0].senderId).toBe('uw')
    })

    it('does not filter when platform is null', () => {
      const lead = makeLead({ platform: undefined })
      const s1 = makeSender({ id: 's1', platform: 'linkedin' })
      const s2 = makeSender({ id: 's2', platform: 'upwork' })

      const result = rankSendersForLead(lead, [s1, s2], null)

      expect(result.rankings).toHaveLength(2)
    })
  })

  describe('invariants', () => {
    it('returns routing version', () => {
      const lead = makeLead()
      const senders = [makeSender()]
      const result = rankSendersForLead(lead, senders, null)
      expect(result.routingVersion).toBe(ROUTING_VERSION)
    })

    it('never exceeds 100 match score', () => {
      const lead = makeLead()
      const sender = makeSender({
        skills: ['react', 'node.js', 'typescript', 'nextjs', 'aws', 'python', 'go', 'rust'],
        proof: [
          { text: 'React Node.js TypeScript SaaS platform', tags: ['react', 'node.js'], strong: true, verified: true },
          { text: 'Built AI product with Python', tags: ['python', 'ai'], strong: true, verified: true },
        ],
        industries: ['saas', 'fintech', 'healthtech', 'edtech'],
      })

      const result = rankSendersForLead(lead, [sender], null)

      expect(result.rankings[0].profileMatch).toBeLessThanOrEqual(100)
    })

    it('changing opportunity score does NOT change sender ranking', () => {
      // Opportunity score and sender routing must be independent
      const senders = [
        makeSender({ id: 's1', skills: ['react', 'node.js'] }),
        makeSender({ id: 's2', skills: ['python'] }),
      ]

      const lowOpp = makeLead({ buyerRequestProbability: 0.2 })
      const highOpp = makeLead({ buyerRequestProbability: 0.9 })

      const resultLow = rankSendersForLead(lowOpp, senders, null)
      const resultHigh = rankSendersForLead(highOpp, senders, null)

      expect(resultLow.rankings.map(r => r.senderId)).toEqual(resultHigh.rankings.map(r => r.senderId))
      expect(resultLow.rankings.map(r => r.profileMatch)).toEqual(resultHigh.rankings.map(r => r.profileMatch))
    })

    it('same source → stable result (deterministic)', () => {
      const lead = makeLead()
      const senders = [
        makeSender({ id: 'a', skills: ['react', 'node.js'] }),
        makeSender({ id: 'b', skills: ['python'] }),
        makeSender({ id: 'c', skills: ['typescript', 'react', 'nextjs'] }),
      ]

      const r1 = rankSendersForLead(lead, senders, null)
      const r2 = rankSendersForLead(lead, senders, null)

      expect(r1.rankings).toEqual(r2.rankings)
    })
  })
})
