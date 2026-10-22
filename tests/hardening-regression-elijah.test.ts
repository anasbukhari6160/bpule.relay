import { describe, it, expect } from 'vitest'
import { HAS_AI_PROVIDER } from './helpers/needs-ai'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { buildRevenueStrategy, sourceFromCanonical } from '@/lib/relay/revenue-strategy'
import { ELIJAH_GUTMAN_HARTFORD_AI_RAW } from './fixtures/hardening-regression-elijah-gutman-hartford'

/**
 * Hardening regression fixture — Elijah Gutman / Hartford AI Partners.
 *
 * Elijah runs Hartford AI Partners, a consultancy selling AI implementation,
 * custom automations, AI agents, AI training, and IT consulting. This is
 * CAPABILITY OVERLAP with BPulse, NOT buyer intent.
 *
 * Source contains NO evidence Hartford AI Partners currently needs external
 * software delivery. There is partnership/ecosystem relevance (adjacent AI
 * operator, prior offshore engineering management) but no buying signal.
 *
 * Key invariants:
 * - CAPABILITY OVERLAP ≠ BUYER FIT
 * - SELLING AI IMPLEMENTATION ≠ NEEDING AI IMPLEMENTATION
 * - Technical sophistication ≠ buyer intent
 * - Partner organization's COO opening ≠ Hartford AI Partners hiring
 * - Offshore contractor history (past) ≠ current need
 * - Hybrid/Remote employment ≠ vendor restriction
 */
describe('Hardening regression — Elijah Gutman / Hartford AI Partners', () => {
  let intel: Awaited<ReturnType<typeof produceCanonicalIntelligence>>['intelligence']

  it('runs', async () => {
    const result = await produceCanonicalIntelligence(ELIJAH_GUTMAN_HARTFORD_AI_RAW, {})
    intel = result.intelligence
  })

  it('classifies the consultancy as a service-provider / potential partner', () => {
    // Hartford AI Partners SELLS AI implementation — it is a service provider,
    // not a buyer. Relationship must reflect partnership, not buyer demand.
    expect(intel.intelligence.relationship).toBe('POTENTIAL_PARTNER')
  })

  it('resolves buyer intent to UNKNOWN — no evidence of buying our services', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    // Capability overlap must NOT inflate buyer intent.
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(strategy.assessment.intent).not.toBe('MEDIUM')
    expect(strategy.assessment.intent).not.toBe('HIGH')
  })

  it('keeps service-buyer fit LOW while acknowledging partnership relevance', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    // He is not buying our delivery services.
    expect(strategy.assessment.fit).toBe('LOW')
  })

  it('does not fabricate a hiring signal from a partner org COO post', () => {
    // "one of our partner organizations is looking for a COO" — that is a
    // THIRD-PARTY opportunity, not Hartford AI Partners hiring engineers.
    expect(intel.intelligence.opportunity.signals).not.toContain('hiring')
    const hiringSignals = intel.intelligence.content.hiringSignals.join(' ').toLowerCase()
    expect(hiringSignals).not.toMatch(/hartford.*coo|coo.*hartford/i)
  })

  it('does not create current need from offshore contractor history', () => {
    // "Previously directed offshore engineering contractors" is past tense,
    // under Refana (2020-2023). It must not produce a hiring/need signal.
    expect(intel.intelligence.opportunity.signals).not.toContain('hiring')
    expect(intel.intelligence.opportunity.signals).not.toContain('hiring_pressure')
    const signals = intel.intelligence.opportunity.signals.join(' ').toLowerCase()
    expect(signals).not.toMatch(/offshore|contractor/i)
  })

  it('resolves remote eligibility to NOT_APPLICABLE', () => {
    // No engagement with geography relevant. Remote/Hybrid employment data
    // must not contaminate vendor eligibility.
    expect(intel.remoteEligibility.eligibility).toBe('NOT_APPLICABLE')
    expect(intel.remoteEligibility.reason.toLowerCase()).not.toMatch(/us.*israel|ireland|uk/i)
  })

  it.skipIf(!HAS_AI_PROVIDER)('preserves correct person/company identity', () => {
    expect(intel.intelligence.person.fullName).toBe('Elijah Gutman')
    expect(intel.intelligence.person.title?.toLowerCase()).toContain('ceo')
    expect(intel.intelligence.person.title?.toLowerCase()).toContain('hartford ai partners')
    expect(intel.intelligence.company.name?.toLowerCase()).toContain('hartford ai partners')
  })

  it('does not use employment Remote/Hybrid as vendor restriction', () => {
    // Elijah's own Remote/Hybrid status is employment data, not a vendor
    // delivery requirement. It must not appear as a remote barrier.
    const reason = intel.remoteEligibility.reason.toLowerCase()
    expect(reason).not.toMatch(/requires presence|not compatible|hybrid role.*presence/i)
  })

  it('renders a consistent interpretation: known entity, no buyer opportunity', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    // High confidence in WHO he is, UNKNOWN on whether he buys.
    expect(intel.intelligence.relationship).toBe('POTENTIAL_PARTNER')
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(intel.remoteEligibility.eligibility).toBe('NOT_APPLICABLE')
    // No buying signal → no message recommended.
    expect(strategy.contact.messageRecommended).toBe(false)
  })

  it('does not manufacture intent to justify connection', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    // Even if CONNECT action is chosen, it must not inflate intent to justify it.
    expect(strategy.assessment.intent).not.toBe('MEDIUM')
    expect(strategy.assessment.intent).not.toBe('HIGH')
  })

  it('keeps canonical score out of buyer-opportunity territory', () => {
    // No buying signal → score must not suggest a real opportunity.
    expect(intel.canonicalScore).toBeLessThan(55)
  })
})
