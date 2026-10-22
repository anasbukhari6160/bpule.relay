/**
 * Routing v1 ↔ v2 comparison (shadow) — what the semantic router would change.
 */
import { describe, expect, it } from 'vitest'
import { runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'
import { featuresFromPacket } from '@/lib/scoring-v4/opportunity-features'
import { buildSenderCapabilityProfile } from '@/lib/scoring-v4/sender-capability-profile'
import { compareRouting } from '@/lib/scoring-v4/routing-compare'
import type { SenderProfile } from '@/lib/relay/sender-routing-engine'

const REF = new Date('2026-10-20T00:00:00Z')

const sender = (id: string, skills: string[], extra: Partial<SenderProfile> = {}): SenderProfile => ({
  id, name: id, role: 'Engineer', platform: 'linkedin', skills, industries: [], proof: [], holders: [{ repId: 'rep-1', name: 'Rep' }], accessibleToRep: true, ...extra,
})

const aiSaas = li({
  name: 'Priya Natarajan', headline: 'Co-founder & CTO at Lumen Health | AI triage for clinics', location: 'Toronto', degree: '2nd',
  about: ['Lumen Health is an AI SaaS for clinics. Stack: React, Node, Postgres, AWS, LLM pipelines.'],
  posts: [{ age: '3d', text: 'We are looking for an agency to build our React patient portal and a RAG pipeline on AWS. Budget approved. DM me.' }],
  experience: [{ title: 'Co-founder & CTO', company: 'Lumen Health', range: 'Feb 2024 - Present · 2 yrs 9 mos' }],
})

describe('routing v1 ↔ v2 comparison', () => {
  it('reports when v2 would pick a different sender than v1', async () => {
    const packet = await runOffline(aiSaas, { model: { relationship: 'BUYER', buyerRequestProbability: 0.9, fit: 'STRONG', access: 'DIRECT' }, referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const senders = [
      buildSenderCapabilityProfile(sender('aneeb', ['React', 'Node', 'AWS'], {
        proof: [{ text: 'React portal on AWS for a clinic chain', tags: ['react', 'aws'], strong: true, verified: true }],
      })),
      buildSenderCapabilityProfile(sender('madiha', ['React', 'AWS', 'LLM', 'RAG', 'Python'], {
        proof: [{ text: 'RAG pipeline and React portal for a healthtech SaaS', tags: ['rag', 'react', 'aws'], strong: true, verified: true }],
      })),
    ]

    const comparison = compareRouting({ features: f, senders, currentSenderId: 'aneeb', v1: { senderId: 'aneeb', score: 40 } })

    expect(comparison.v2.bestSenderId).toBe('madiha')
    expect(comparison.difference.senderChanged).toBe(true)
    expect(comparison.difference.delta).toBeGreaterThan(0)
    expect(comparison.proofUsed.strength).toBe('VERIFIED')
    expect(comparison.eligibility.accessible).toBe(true)
  })

  it('never lets an inaccessible identity displace the production sender', async () => {
    const packet = await runOffline(aiSaas, { referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const senders = [
      buildSenderCapabilityProfile(sender('madiha', ['React', 'AWS', 'LLM', 'RAG'], {
        accessibleToRep: false,
        holders: [{ repId: 'rep-2', name: 'Other' }],
        proof: [{ text: 'RAG pipeline for a healthtech SaaS', tags: ['rag', 'aws', 'react'], strong: true, verified: true }],
      })),
    ]

    const comparison = compareRouting({ features: f, senders, currentSenderId: 'aneeb' })

    expect(comparison.eligibility.accessible).toBe(false)
    expect(comparison.eligibility.note).toMatch(/not accessible/)
    expect(comparison.confidence).toBe('LOW')
  })

  it('agrees with v1 when both pick the same sender', async () => {
    const packet = await runOffline(aiSaas, { referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const senders = [buildSenderCapabilityProfile(sender('madiha', ['React', 'AWS', 'LLM', 'RAG'], { proof: [{ text: 'RAG pipeline and React portal', tags: ['rag', 'aws', 'react'], strong: true, verified: true }] }))]

    const comparison = compareRouting({ features: f, senders, currentSenderId: null, v1: { senderId: 'madiha', score: 88 } })

    expect(comparison.difference.senderChanged).toBe(false)
    expect(comparison.difference.reason).toMatch(/agrees/)
  })
})
