/**
 * Versioning and cache correctness (Phases 32-33, 39). 20+ cases.
 */
import { describe, it, expect } from 'vitest'
import { buildV3ReuseKey } from '@/lib/intelligence-v3/decision-reuse'
import { currentVersions, isPacketCurrent, opportunityVersionTag, SCORING_VERSION, SOURCE_FACTS_VERSION, BUYER_INTENT_VERSION, ATTRIBUTION_VERSION } from '@/lib/intelligence-v3/versions'
import { produceV3Intelligence, v3PacketToCanonical, buildMinimalV2Canonical, recomputePacketFromStored } from '@/lib/intelligence-v3/bridge'
import { isClientCanonicalStillValid } from '@/lib/intelligence-v2/orchestrator'
import { getLeadDisplayScore } from '@/lib/scoring/display-score'
import { qualifyCanonicalScore, toStoredQualification } from '@/lib/scoring/qualification'
import { runOffline, stubProvider } from '../helpers/score-source'
import { li } from '../golden/builder'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'

const TEXT = li({
  name: 'Priya Raman', headline: 'CTO at Ledgerline | Payments', location: 'Austin, Texas, United States', degree: '2nd', connections: '500+ connections',
  about: ['Ledgerline is a payments startup. Team of 14 on Node.js, React and PostgreSQL.'],
  posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React. Budget approved: $40,000. Start within 3 weeks. DM me.' }],
  experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
})
const MODEL = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const }

describe('reuse key', () => {
  it('is deterministic and whitespace-insensitive', () => {
    expect(buildV3ReuseKey({ rawText: TEXT })).toBe(buildV3ReuseKey({ rawText: TEXT }))
    expect(buildV3ReuseKey({ rawText: TEXT })).toBe(buildV3ReuseKey({ rawText: TEXT.replace(/\n/g, '\r\n') + '\n\n' }))
  })
  it('changes with the source text', () => {
    expect(buildV3ReuseKey({ rawText: TEXT })).not.toBe(buildV3ReuseKey({ rawText: TEXT + '\nNew post: budget doubled.' }))
  })
  it('is sender-independent: profile and capabilities do not change it', () => {
    const k = buildV3ReuseKey({ rawText: TEXT })
    expect(buildV3ReuseKey({ rawText: TEXT, profileId: 'p1' })).toBe(k)
    expect(buildV3ReuseKey({ rawText: TEXT, senderCapabilities: ['react'] })).toBe(k)
    expect(buildV3ReuseKey({ rawText: TEXT, profileIntelligenceVersion: 'v9' })).toBe(k)
  })
  it('changes with the org capability vocabulary (fit input)', () => {
    expect(buildV3ReuseKey({ rawText: TEXT, orgCapabilities: ['flutter'] })).not.toBe(buildV3ReuseKey({ rawText: TEXT }))
  })
  it('includes every opportunity version', () => {
    const tag = opportunityVersionTag()
    expect(tag).toContain(SCORING_VERSION)
    expect(tag).toContain(SOURCE_FACTS_VERSION)
    expect(tag).toContain(BUYER_INTENT_VERSION)
    expect(tag).toContain(ATTRIBUTION_VERSION)
  })
})

describe('packet versions', () => {
  it('every packet carries all layer versions and analyzedAt', async () => {
    const p = await runOffline(TEXT, { model: MODEL })
    expect(p.versions).toMatchObject({ scoringVersion: SCORING_VERSION, sourceFactsVersion: SOURCE_FACTS_VERSION, buyerIntentVersion: BUYER_INTENT_VERSION, attributionVersion: ATTRIBUTION_VERSION })
    expect(p.versions?.routingVersion).toMatch(/^routing_v/)
    expect(p.versions?.actionPolicyVersion).toMatch(/^action_policy_v/)
    expect(p.versions?.displayVersion).toMatch(/^display_v/)
    expect(p.versions?.modelVersion).toBeTruthy()
    expect(Date.parse(p.versions!.analyzedAt)).not.toBeNaN()
  })
  it('isPacketCurrent rejects older or missing versions', () => {
    expect(isPacketCurrent(undefined)).toBe(false)
    expect(isPacketCurrent({})).toBe(false)
    expect(isPacketCurrent(currentVersions({ routingVersion: 'routing_v1', modelVersion: 'x' }))).toBe(true)
    expect(isPacketCurrent({ ...currentVersions({ routingVersion: 'routing_v1', modelVersion: 'x' }), scoringVersion: 'relay_decision_v3.1.0' })).toBe(false)
    expect(isPacketCurrent({ ...currentVersions({ routingVersion: 'routing_v1', modelVersion: 'x' }), buyerIntentVersion: 'buyer_intent_v1' })).toBe(false)
  })
})

describe('reuse semantics', () => {
  it('a current cached packet is reused without a model call', async () => {
    const first = await runOffline(TEXT, { model: MODEL })
    let decided = 0
    const provider = stubProvider(MODEL)
    const counting = { ...provider, decide: async (ctx: Parameters<typeof provider.decide>[0]) => { decided++; return provider.decide(ctx) } }
    const second = await produceV3Intelligence(TEXT, { decisionProvider: counting, reuseIfUnchanged: async () => first })
    expect(decided).toBe(0)
    expect(second.v3Packet?.score).toBe(first.score)
    expect(second.v3Packet?.decisionRunId).toBe(first.decisionRunId)
  })
  it('a stale cached packet (old versions) is NOT reused', async () => {
    const first = await runOffline(TEXT, { model: MODEL })
    const stale: V3LeadDecisionPacket = { ...first, versions: { ...first.versions!, scoringVersion: 'relay_decision_v3.1.0' } }
    let decided = 0
    const provider = stubProvider(MODEL)
    const counting = { ...provider, decide: async (ctx: Parameters<typeof provider.decide>[0]) => { decided++; return provider.decide(ctx) } }
    await produceV3Intelligence(TEXT, { decisionProvider: counting, reuseIfUnchanged: async () => stale })
    expect(decided).toBe(1)
  })
  it('a packet without versions (pre-program) is NOT reused', async () => {
    const first = await runOffline(TEXT, { model: MODEL })
    const legacy = { ...first, versions: undefined } as V3LeadDecisionPacket
    let decided = 0
    const provider = stubProvider(MODEL)
    const counting = { ...provider, decide: async (ctx: Parameters<typeof provider.decide>[0]) => { decided++; return provider.decide(ctx) } }
    await produceV3Intelligence(TEXT, { decisionProvider: counting, reuseIfUnchanged: async () => legacy })
    expect(decided).toBe(1)
  })
  it('forceReanalyze skips reuse', async () => {
    const first = await runOffline(TEXT, { model: MODEL })
    let asked = false
    await produceV3Intelligence(TEXT, { decisionProvider: stubProvider(MODEL), forceReanalyze: true, reuseIfUnchanged: async () => { asked = true; return first } })
    expect(asked).toBe(false)
  })
})

describe('save / reopen consistency (Phase 39)', () => {
  it('canonical, display, qualification, intent, action and versions survive the canonical blob round trip', async () => {
    const packet = await runOffline(TEXT, { model: MODEL })
    const canonical = v3PacketToCanonical(packet, buildMinimalV2Canonical(TEXT))
    const stored = JSON.parse(JSON.stringify(canonical)) as typeof canonical & { v3DecisionPacket: V3LeadDecisionPacket }
    expect(stored.canonicalScore).toBe(packet.score)
    expect(stored.qualification).toBe(toStoredQualification(qualifyCanonicalScore(packet.score).qualification))
    expect(stored.v3DecisionPacket.buyerIntent?.buyerIntentLevel).toBe(packet.buyerIntent?.buyerIntentLevel)
    expect(stored.v3DecisionPacket.recommendedAction?.action).toBe(packet.recommendedAction?.action)
    expect(stored.v3DecisionPacket.resolved).toEqual(packet.resolved)
    expect(stored.v3DecisionPacket.versions).toEqual(packet.versions)
    // Lead row → display
    const display = getLeadDisplayScore({ canonicalScore: stored.canonicalScore, canonicalIntelligence: stored })
    expect(display.qualification).toBe(qualifyCanonicalScore(packet.score).qualification)
  })

  it('replaying a stored decision on the server reproduces the same score (no model call)', async () => {
    const packet = await runOffline(TEXT, { model: MODEL })
    const replayed = await recomputePacketFromStored(TEXT, packet)
    expect(replayed.score).toBe(packet.score)
    expect(replayed.qualification).toBe(packet.qualification)
    expect(replayed.buyerIntent?.buyerIntentLevel).toBe(packet.buyerIntent?.buyerIntentLevel)
    expect(replayed.recommendedAction?.action).toBe(packet.recommendedAction?.action)
  })

  it('a client cannot raise its own score: replay ignores tampered score fields', async () => {
    const packet = await runOffline(TEXT.replace('We are looking for an external software development agency', 'We shipped a new dashboard'), { model: { ...MODEL, buyerRequestProbability: 0.2, relationship: 'UNKNOWN' } })
    const tampered: V3LeadDecisionPacket = { ...packet, score: 99, qualification: 'STRONG' }
    const replayed = await recomputePacketFromStored(tampered.sourceFacts ? TEXT.replace('We are looking for an external software development agency', 'We shipped a new dashboard') : TEXT, tampered)
    expect(replayed.score).toBe(packet.score)
    expect(replayed.score).toBeLessThan(99)
  })

  it('"Try another angle" reuse accepts a current V3 canonical for the same text and rejects a stale one', async () => {
    const packet = await runOffline(TEXT, { model: MODEL })
    const canonical = v3PacketToCanonical(packet, buildMinimalV2Canonical(TEXT))
    expect(isClientCanonicalStillValid(canonical, TEXT, false)).toBe(true)
    expect(isClientCanonicalStillValid(canonical, TEXT + '\nAnother line.', false)).toBe(false)
    expect(isClientCanonicalStillValid(canonical, TEXT, true)).toBe(false)
    const stale = v3PacketToCanonical({ ...packet, versions: { ...packet.versions!, scoringVersion: 'relay_decision_v3.1.0' } }, buildMinimalV2Canonical(TEXT))
    expect(isClientCanonicalStillValid(stale, TEXT, false)).toBe(false)
  })
})
