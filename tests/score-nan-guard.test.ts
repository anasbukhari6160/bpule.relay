import { describe, it, expect } from 'vitest'
import { runOffline, type SimulatedModel } from './helpers/score-source'
import { hardenProviderResult, NORMALIZED_ANSWER_CONFIDENCE_CAP, type V3ProviderResult } from '@/lib/intelligence-v3/decision/decision-provider'

// Latent NaN path: a provider result with an enum value the score tables do
// not know (e.g. fit "HIGH") used to reach scoring unvalidated and come out
// as NaN. The scoring boundary now re-validates every answer, fails closed
// to safe defaults, caps confidence, and records the replacement.

const BUYER = `Maya Lindqvist
Founder & CEO at Northwind Analytics
Stockholm, Sweden

Posts
Maya Lindqvist • 3d •
We are looking for an agency to rebuild our customer onboarding in Next.js. Budget approved at $45,000, kickoff in January. DM me if you have done this before.`

const VALID: SimulatedModel = { relationship: 'BUYER', buyerRequestProbability: 0.9, externalNeedProbability: 0.85, needOwner: 'SELF_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT', messageEligible: 0.9 }

function invalid(overrides: Record<string, unknown>): SimulatedModel {
  return { ...VALID, ...overrides } as unknown as SimulatedModel
}

describe('score NaN hard guard', () => {
  it.each([
    ['invalid fit enum', { fit: 'HIGH' }, 'fit'],
    ['invalid timing enum', { timing: 'STRONG' }, 'timing'],
    ['invalid access enum', { access: 'OPEN' }, 'access'],
    ['invalid buyer/relationship enum', { relationship: 'SELLER' }, 'relationship'],
    ['non-finite probability', { buyerRequestProbability: Number.NaN }, 'buyerRequestProbability'],
  ])('%s: finite score, capped confidence, normalization recorded', async (_label, overrides, field) => {
    const packet = await runOffline(BUYER, { model: invalid(overrides) })
    expect(Number.isFinite(packet.score)).toBe(true)
    expect(packet.score).toBeGreaterThanOrEqual(0)
    expect(packet.score).toBeLessThanOrEqual(100)
    expect(Number.isFinite(packet.confidence)).toBe(true)
    expect(packet.confidence).toBeLessThanOrEqual(NORMALIZED_ANSWER_CONFIDENCE_CAP)
    expect(packet.decisionAdjustments.some((a) => a.includes('normalized') && a.includes(field))).toBe(true)
    expect(typeof packet.action).toBe('string')
    expect(typeof packet.qualification).toBe('string')
  })

  it('valid answers are untouched: no normalization note and the same score as before the guard', async () => {
    const packet = await runOffline(BUYER, { model: VALID })
    expect(Number.isFinite(packet.score)).toBe(true)
    expect(packet.decisionAdjustments.some((a) => a.includes('normalized'))).toBe(false)
    expect(packet.decisionAdjustments.some((a) => a.includes('Score guard'))).toBe(false)
    const again = await runOffline(BUYER, { model: VALID })
    expect(again.score).toBe(packet.score)
    expect(again.confidence).toBe(packet.confidence)
  })

  it('hardenProviderResult returns the same object when nothing needs changing', () => {
    const result: V3ProviderResult = { answers: { ...VALID } as V3ProviderResult['answers'], providerId: 'p', modelVersion: 'm', latencyMs: 1, confidence: 0.8 }
    expect(hardenProviderResult(result)).toBe(result)
  })

  it('hardenProviderResult clamps a non-finite confidence to 0', () => {
    const result: V3ProviderResult = { answers: { ...VALID } as V3ProviderResult['answers'], providerId: 'p', modelVersion: 'm', latencyMs: 1, confidence: Number.POSITIVE_INFINITY }
    expect(hardenProviderResult(result).confidence).toBe(0)
  })
})
