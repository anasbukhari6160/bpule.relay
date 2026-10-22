import { describe, it, expect } from 'vitest'
import { HAS_AI_PROVIDER } from './helpers/needs-ai'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { buildRevenueStrategy, sourceFromCanonical } from '@/lib/relay/revenue-strategy'
import { BRIAN_MACCABA_BIOMARKER_RAW } from './fixtures/hardening-regression-brian-maccaba-biomarker'

/**
 * Hardening regression fixture — Brian Maccaba / Bio-marker.ai.
 *
 * Brian is CEO of a cancer-AI product company. His current role says "Hybrid"
 * with no stated office location. His historical experience includes UK, Israel,
 * Ireland, US in PAST roles. There is NO evidence Bio-marker.ai needs external
 * software development or restricts vendors by geography.
 *
 * Previously scored INELIGIBLE with fabricated "Hybrid role requires presence in
 * UK, Israel" — historical locations from a 2010-2012 consulting role were
 * misattributed as the current engagement's office location.
 */
describe('Hardening regression — Brian Maccaba / Bio-marker.ai', () => {
  let intel: Awaited<ReturnType<typeof produceCanonicalIntelligence>>['intelligence']

  it('runs', async () => {
    const result = await produceCanonicalIntelligence(BRIAN_MACCABA_BIOMARKER_RAW, {})
    intel = result.intelligence
  })

  it('resolves remote eligibility to NOT_APPLICABLE, not INELIGIBLE', () => {
    expect(intel.remoteEligibility.eligibility).toBe('NOT_APPLICABLE')
    expect(intel.remoteEligibility.workplaceType).toBe('HYBRID')
    expect(intel.remoteEligibility.reason.toLowerCase()).not.toMatch(/uk.*israel|israel.*uk/i)
    expect(intel.remoteEligibility.reason.toLowerCase()).not.toMatch(/requires presence|not compatible/i)
  })

  it('does not fabricate a UK/Israel office location from historical experience', () => {
    const evidence = JSON.stringify(intel.remoteEligibility.evidence ?? []).toLowerCase()
    expect(evidence).not.toMatch(/uk.*israel|israel.*uk/i)
    expect(evidence).not.toMatch(/office location detected: uk/i)
  })

  it.skipIf(!HAS_AI_PROVIDER)('preserves correct person/company identity from the profile header', () => {
    expect(intel.intelligence.person.fullName).toBe('Brian Maccaba')
    expect(intel.intelligence.person.title?.toLowerCase()).toContain('ceo')
    expect(intel.intelligence.person.title?.toLowerCase()).toContain('bio-marker.ai')
    expect(intel.intelligence.company.name?.toLowerCase()).toContain('bio-marker.ai')
  })

  it('identifies the current Hybrid employment correctly', () => {
    expect(intel.remoteEligibility.workplaceType).toBe('HYBRID')
  })

  it('classifies relationship as POTENTIAL_BUYER (product company, not recruiter)', () => {
    expect(intel.intelligence.relationship).toBe('POTENTIAL_BUYER')
  })

  it('produces no fake buyer signals from the profile', () => {
    expect(intel.intelligence.opportunity.signals).not.toContain('hiring')
    expect(intel.intelligence.opportunity.signals).not.toContain('growth_signal')
    expect(intel.intelligence.opportunity.signals).not.toContain('explicit_ask')
  })

  it('keeps buyer intent UNKNOWN for a product company with no buying signal', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(strategy.assessment.intent).not.toBe('MEDIUM')
  })

  it('does not use person location as vendor eligibility', () => {
    // Brian is in Portugal; that must not appear as a remote barrier.
    const reason = intel.remoteEligibility.reason.toLowerCase()
    expect(reason).not.toMatch(/portugal/i)
  })

  it('renders a consistent canonical interpretation', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    // Score must not be in "Strong opportunity" / "Worth pursuing" territory.
    expect(intel.canonicalScore).toBeLessThan(55)
    expect(intel.remoteEligibility.eligibility).toBe('NOT_APPLICABLE')
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    // CONNECT_WITHOUT_NOTE or OBSERVE — not CONTACT_NOW.
    expect(['CONNECT_OR_OBSERVE', 'SKIP']).toContain(strategy.contact.action)
  })

  it('treats Hybrid-alone as non-blocking for a service-buyer relationship', () => {
    // "Hybrid" in Brian's own employment != vendor restriction.
    expect(intel.remoteEligibility.eligibility).not.toBe('INELIGIBLE')
    expect(intel.remoteEligibility.eligibility).not.toBe('ELIGIBLE')
  })
})
