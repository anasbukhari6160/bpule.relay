import { describe, expect, it } from 'vitest'
import { HAS_AI_PROVIDER } from './helpers/needs-ai'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { buildRevenueStrategy, sourceFromCanonical, describeVerdictForDisplay, describeMessagingPolicy } from '@/lib/relay/revenue-strategy'
import { AVIGAIL_EISENSTADT_AE_DESIGN_RAW } from './fixtures/hardening-regressions/avigail-eisenstadt-ae-design'

/**
 * Hardening regression fixture — Avigail Eisenstadt / AE Design Group.
 *
 * Avigail is an interior designer / EMT nonprofit COO — there is NO
 * software-buying need anywhere in evidence. The correct result (no
 * fabricated opportunity, UNKNOWN intent, no message recommended) was
 * ALREADY correct before this hardening pass and must not regress.
 *
 * The bug being tested here is purely a labeling bug: remote eligibility
 * must read NOT_APPLICABLE ("No employment or location-constrained
 * engagement opportunity detected"), not UNCLEAR/"unclear" — because there
 * is no employment/location-constrained opportunity in evidence AT ALL.
 * UNCLEAR is reserved for when a real opportunity exists but geography is
 * simply missing.
 *
 * DO NOT special-case "Avigail" / "AE Design Group" in application code.
 */
describe('Hardening regression — Avigail Eisenstadt / AE Design Group', () => {
  let intel: Awaited<ReturnType<typeof produceCanonicalIntelligence>>['intelligence']

  it('runs', async () => {
    const result = await produceCanonicalIntelligence(AVIGAIL_EISENSTADT_AE_DESIGN_RAW, {})
    intel = result.intelligence
  })

  it('remote eligibility is NOT_APPLICABLE, not UNKNOWN/UNCLEAR, with a reason referencing no employment/location-constrained opportunity', () => {
    expect(intel.remoteEligibility.eligibility).toBe('NOT_APPLICABLE')
    expect(intel.remoteEligibility.reason.toLowerCase()).toMatch(/no employment|no.*location-constrained/i)
  })

  it('never renders the word "unclear" for this NOT_APPLICABLE result', () => {
    expect(intel.remoteEligibility.reason.toLowerCase()).not.toMatch(/unclear/)
    const watchOutJoined = intel.scoreBreakdown.watchOut.join(' ').toLowerCase()
    expect(watchOutJoined).not.toMatch(/remote eligibility unclear/i)
  })

  it('intent stays UNKNOWN — no fabricated software-buying opportunity', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.assessment.intent).toBe('UNKNOWN')
  })

  it.skipIf(!HAS_AI_PROVIDER)('no message recommended stays true', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.contact.messageRecommended).toBe(false)
  })

  it('qualification can be low/skip, but verdict-vs-action reconciliation never produces a bare contradictory "skip" headline', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    const display = describeVerdictForDisplay(intel.qualification, strategy.contact.action, describeMessagingPolicy(strategy.messagingPolicy))
    if (strategy.contact.action === 'SKIP') {
      // SKIP action + skip qualification is a legitimate, non-contradictory pairing.
      expect(display.headline.toLowerCase()).toMatch(/skip/)
    } else {
      // A non-SKIP action must never be described with a bare "Probably skip" headline.
      expect(display.headline).not.toBe('Probably skip')
    }
  })

  it('if a Revenue Identity availability string appears, it does not imply an opportunity exists', () => {
    const identityReason = intel.scoreBreakdown.reasons.find((r) => /revenue identity/i.test(r))
    if (identityReason) {
      expect(identityReason.toLowerCase()).not.toMatch(/for this opportunity/i)
    }
  })

  it('does not increase score/intent relative to the already-correct baseline (no software need in evidence)', () => {
    expect(intel.intelligence.opportunity.signals).toHaveLength(0)
    expect(intel.qualification).not.toBe('strong')
    expect(intel.qualification).not.toBe('worth_pursuing')
  })
})
