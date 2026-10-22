import { describe, expect, it } from 'vitest'
import { runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'
import { featuresFromPacket } from '@/lib/scoring-v4/opportunity-features'
import { buildSenderCapabilityProfile, smoothRate, HISTORY_MIN_SAMPLE } from '@/lib/scoring-v4/sender-capability-profile'
import { orgCapabilityMatch, rankSendersV2 } from '@/lib/scoring-v4/sender-ranker'
import type { SenderProfile } from '@/lib/relay/sender-routing-engine'

const REF = new Date('2026-10-20T00:00:00Z')

const sender = (id: string, skills: string[], proof: SenderProfile['proof'] = [], extra: Partial<SenderProfile> = {}): SenderProfile => ({
  id, name: id, role: 'Engineer', platform: 'linkedin', skills, industries: [], proof, holders: [{ repId: 'rep-1', name: 'Rep' }], accessibleToRep: true, ...extra,
})

const aiSaas = li({
  name: 'Priya Natarajan', headline: 'Co-founder & CTO at Lumen Health | AI triage for clinics', location: 'Toronto', degree: '2nd',
  about: ['Lumen Health is an AI SaaS for clinics. Stack: React, Node, Postgres, AWS, LLM pipelines.'],
  posts: [{ age: '3d', text: 'We are looking for an agency to build our React patient portal and a RAG pipeline on AWS. Budget approved. DM me.' }],
  experience: [{ title: 'Co-founder & CTO', company: 'Lumen Health', range: 'Feb 2024 - Present · 2 yrs 9 mos' }],
})

describe('SenderCapabilityProfile (Phase 5) and sender ranker v2 (Phase 12/13/20)', () => {
  it('expresses a sender in capability families and keeps proof separate from skills', () => {
    const p = buildSenderCapabilityProfile(sender('madiha', ['React', 'Next.js', 'Node', 'AWS', 'LLM'], [
      { text: 'Built a RAG pipeline for a healthtech client', tags: ['rag', 'aws'], strong: true, verified: true },
    ]))
    expect(p.capabilities).toContain('web_frontend')
    expect(p.capabilities).toContain('ai_ml')
    expect(p.provenCapabilities).toContain('ai_ml')
    expect(p.verifiedCapabilities).toContain('ai_ml')
    expect(p.verifiedCapabilities).not.toContain('web_frontend')
  })

  it('smooths historical rates toward the prior and marks small samples unreliable (Phase 21)', () => {
    const oneWin = smoothRate(1, 1, 0.12)
    expect(oneWin.rate).toBeLessThan(0.25)
    expect(oneWin.reliable).toBe(false)
    const many = smoothRate(8, HISTORY_MIN_SAMPLE + 10, 0.12)
    expect(many.reliable).toBe(true)
    expect(many.rate).toBeGreaterThan(0.25)
  })

  it('ranks the sender whose verified proof covers the requested capabilities first, explains why, and reports org match separately', async () => {
    const packet = await runOffline(aiSaas, { model: { relationship: 'BUYER', buyerRequestProbability: 0.9, fit: 'STRONG', access: 'DIRECT' }, referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const senders = [
      buildSenderCapabilityProfile(sender('aneeb', ['React', 'Node', 'AWS'], [{ text: 'Shipped a React portal on AWS for a clinic chain', tags: ['react', 'aws'], strong: true, verified: true }])),
      buildSenderCapabilityProfile(sender('madiha', ['React', 'AWS', 'LLM', 'RAG', 'Python'], [{ text: 'RAG pipeline and React portal for a healthtech SaaS', tags: ['rag', 'react', 'aws'], strong: true, verified: true }])),
      buildSenderCapabilityProfile(sender('hassan', ['Flutter', 'Firebase'], [])),
    ]
    const r = rankSendersV2(f, senders, 'aneeb')
    expect(r.rankings[0].identityId).toBe('madiha')
    expect(r.rankings[0].proofMatch).toBe('VERIFIED')
    expect(r.rankings[0].reasons.join(' ')).toMatch(/Covers requested/)
    expect(r.rankings[2].identityId).toBe('hassan')
    expect(r.rankings[2].risks.join(' ')).toMatch(/No coverage/)
    expect(r.currentSenderId).toBe('aneeb')
    expect(r.mismatchDelta).toBeGreaterThan(0)
    const org = orgCapabilityMatch(f)
    expect(org.match).toBeGreaterThan(80)
  })

  it('is deterministic and independent of the opportunity score', async () => {
    const packet = await runOffline(aiSaas, { referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const senders = [buildSenderCapabilityProfile(sender('a', ['React'])), buildSenderCapabilityProfile(sender('b', ['React', 'AWS']))]
    const r1 = rankSendersV2(f, senders)
    const r2 = rankSendersV2({ ...f, intent: { ...f.intent, level: 'UNKNOWN', verifiedRequest: false } }, senders)
    expect(r1.rankings.map((x) => [x.identityId, x.match])).toEqual(r2.rankings.map((x) => [x.identityId, x.match]))
  })

  it('history never beats proof', async () => {
    const packet = await runOffline(aiSaas, { referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const proven = buildSenderCapabilityProfile(sender('proof', ['React', 'AWS', 'RAG'], [{ text: 'RAG on AWS with a React front end', tags: ['rag', 'aws', 'react'], strong: true, verified: true }]))
    const lucky = buildSenderCapabilityProfile(sender('lucky', ['React'], [], { historicalOutcomes: { leadsContacted: 40, replies: 30, meetings: 10 } }))
    const r = rankSendersV2(f, [proven, lucky])
    expect(r.rankings[0].identityId).toBe('proof')
  })
})
