import { describe, expect, it } from 'vitest'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { buildRevenueStrategy, sourceFromCanonical, describeVerdictForDisplay, describeMessagingPolicy } from '@/lib/relay/revenue-strategy'
import { classifyBusinessModel } from '@/lib/intelligence-v2/subject-attribution'
import { evaluateConnectionNote } from '@/lib/prospect/connection-note'
import { VED_KULKARNI_MERGET_RAW } from './fixtures/hardening-regression-ved-kulkarni-merget'

/**
 * Hardening regression fixture — Ved Kulkarni / Merget
 * (product-execution vs. service-buyer-intent regression).
 *
 * Ved is a founder actively BUILDING and VALIDATING his own product
 * (Merget): talking to founders/engineering leaders about their workflow,
 * describing customer discovery that validates the problem Merget solves,
 * pre-launch, inviting early access. This is PRODUCT EXECUTION and
 * VALIDATION evidence, not a signal that Merget needs external engineering
 * help or that Ved is currently buying software delivery.
 *
 * Root-caused failures:
 * 1. classifyBusinessModel had no PRODUCT_MODEL_PATTERNS match for "we're
 *    building [long descriptive phrase] infrastructure" (only recognized
 *    "product/platform/app/SaaS/service/tool/solution", not
 *    "infrastructure", and required the noun immediately after the verb
 *    with no gap for descriptive words in between) — so Ved's own-product
 *    description was invisible to classification, leaving businessModel
 *    UNKNOWN and relationship defaulting to POTENTIAL_BUYER.
 * 2. Even once PRODUCT was detected, deriveRelationship only recognized
 *    BD/partnership-outreach language (OWN_PRODUCT_SALES_BD_PATTERNS) as
 *    evidence of "founder selling own product, not buying delivery" — it
 *    had no pattern family for the pre-launch/customer-discovery/
 *    validation stage, which is an equally common and equally non-buyer
 *    founder activity.
 * 3. The NOT_APPLICABLE remote-eligibility override spread the pre-override
 *    workplaceType/remoteScope/evidence fields through instead of resetting
 *    them, so a fabricated "explicit ask for external project help"
 *    evidence string (pattern-matched on generic engineering vocabulary)
 *    survived into the canonical result even though eligibility correctly
 *    read NOT_APPLICABLE — exactly the kind of stale non-semantic metadata
 *    that must never reach strategy/message grounding.
 * 4. decideContact's non-buyer "has genuine identity or activity" gate
 *    required BOTH (name or title) AND a successfully-parsed company name,
 *    so a real, clearly-identified person (name + title) whose company
 *    failed to parse out of an unusual title format ("Founder & CEO ·
 *    Merget") fell through to a manufactured SKIP/"not a credible contact"
 *    result — overcorrecting exactly the failure mode the user explicitly
 *    warned against.
 *
 * DO NOT special-case "Ved", "Kulkarni", "Merget", or any wording from this
 * profile anywhere in application code, and do not tune his numeric score.
 * Fixes derived from this fixture must be general semantic fixes (product-
 * model pattern coverage, pre-launch/validation relationship classification,
 * full eligibility-object reset on override, identity-signal robustness to
 * partial extraction), verified by running this fixture, not fixes that
 * pattern-match this text.
 */
describe('Hardening regression — Ved Kulkarni / Merget (product-execution vs. buyer-intent)', () => {
  let intel: Awaited<ReturnType<typeof produceCanonicalIntelligence>>['intelligence']

  it('runs', async () => {
    const result = await produceCanonicalIntelligence(VED_KULKARNI_MERGET_RAW, {})
    intel = result.intelligence
  })

  // ── Fix 1 (scoped): founder building/validating own product is recognized, not left UNKNOWN ──
  it('classifies Merget as a PRODUCT business from "we\'re building ... infrastructure" language', () => {
    expect(intel.intelligence.businessModel).toBe('PRODUCT')
  })

  it('classifies the relationship as a non-buyer (NETWORKING) — active product building/validation is not buyer evidence', () => {
    expect(intel.intelligence.relationship).toBe('NETWORKING')
  })

  it('service-buyer intent stays UNKNOWN — customer discovery/pre-launch activity is not a buying need', () => {
    const reading = intel.intelligence.commercialReading
    expect(reading?.serviceBuyerIntent).toBe('UNKNOWN')
    expect(reading?.serviceBuyerIntent).not.toBe('HIGH')
    expect(reading?.externalEngineeringNeed).toBe('NONE_DETECTED')
    expect(reading?.immediateBuyerNeed).toBe(false)
    expect(reading?.buyerTiming).toBe('UNKNOWN')
    expect(reading?.buyerTiming).not.toBe('IMMEDIATE')
    expect(reading?.productMomentum).toBe('HIGH')
    expect(reading?.customerDiscovery).toBe('SUPPORTED')
    expect(reading?.preLaunchActivity).toBe('SUPPORTED')
    expect(reading?.technicalRelevance).toBe('HIGH')
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(strategy.assessment.intent).not.toBe('HIGH')
  })

  it('buyer fit is LOW, explicitly labeled not-a-buyer', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.assessment.fit).toBe('LOW')
    expect(strategy.assessment.fitWhy.toLowerCase()).toMatch(/not.*(?:software-delivery )?buyer/)
  })

  // ── Fix 2: immediacy must be opportunity-scoped — pre-launch product activity != buyer procurement timing ──
  it('does not report immediate buyer-need timing from pre-launch/customer-discovery activity', () => {
    expect(intel.intelligence.opportunity.urgency).toBe('unknown')
    const reasonsJoined = intel.scoreBreakdown.reasons.join(' ').toLowerCase()
    expect(reasonsJoined).not.toMatch(/immediate need detected/)
    expect(reasonsJoined).not.toMatch(/immediate timing signal/)
  })

  // ── Fix 3: remote eligibility object is fully reset on NOT_APPLICABLE override — no stale evidence leaks through ──
  it('remote eligibility is NOT_APPLICABLE with no leftover fabricated evidence/reasoning from the pre-override assessment', () => {
    // eligibility/evidence/reason must be clean — workplaceType/remoteScope
    // may still reflect real detected-in-text reality as descriptive
    // metadata (see the Tammo Strunk fixture for the intentional precedent:
    // a genuinely-detected ONSITE workplaceType can coexist with
    // eligibility=NOT_APPLICABLE for a non-employment contact). What must
    // never happen is fabricated EVIDENCE surviving the override, since
    // evidence strings feed the outreach-facing evidence ledger directly.
    expect(intel.remoteEligibility.eligibility).toBe('NOT_APPLICABLE')
    expect(intel.remoteEligibility.evidence ?? []).toEqual([])
    const reason = intel.remoteEligibility.reason.toLowerCase()
    expect(reason).not.toMatch(/eligible from pakistan|no geographic restrictions/)
  })

  it('does not fabricate "explicit ask for external project help" evidence into the final canonical result', () => {
    const canonicalJson = JSON.stringify(intel).toLowerCase()
    expect(canonicalJson).not.toMatch(/explicit ask for external project help/)
  })

  // ── Fix 5: product momentum/pre-launch activity != company growth signal ──
  it('does not fabricate a growth_signal from pre-launch/customer-discovery activity alone', () => {
    expect(intel.intelligence.opportunity.signals).not.toContain('growth_signal')
  })

  // ── No SKIP overcorrection: a real person with real activity is a legitimate contact ──
  it('does not overcorrect to SKIP — a valid non-buyer relationship action is recommended for a clearly-identified active founder', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.contact.action).not.toBe('SKIP')
    expect(strategy.contact.action).toBe('CONNECT_OR_OBSERVE')
  })

  it('does not manufacture a "no credible contact" reason for a real, named, titled founder', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    expect(strategy.contact.why.toLowerCase()).not.toMatch(/no identity or activity evidence/)
  })

  // ── Verdict/action must not contradict ──
  it('verdict display does not render a bare contradictory "skip" alongside a valid connect/observe action', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    const display = describeVerdictForDisplay(intel.qualification, strategy.contact.action, describeMessagingPolicy(strategy.messagingPolicy))
    if (strategy.contact.action !== 'SKIP') {
      expect(display.headline.toLowerCase()).not.toBe('probably skip')
    }
  })

  // ── Fix 4: message claim safety — no unsupported generalized-pain claims ──
  it('does not recommend a message that diagnoses the prospect with roadmap strain/engineering capacity problems absent evidence', () => {
    const strategy = buildRevenueStrategy(sourceFromCanonical(intel, { channel: 'connection' }))
    // CONNECT_WITHOUT_NOTE carries no generated message at all — the correct
    // outcome here since there is no buyer need to pitch.
    expect(strategy.contact.messageRecommended).toBe(false)
    expect(strategy.messagingPolicy).not.toBe('CONNECT_WITH_NOTE')
    const grounded = [
      strategy.uiRationale,
      strategy.strongestEvidence ?? '',
      ...strategy.allowedNow,
      ...strategy.knownFacts,
    ].join(' ')
    expect(grounded).not.toMatch(/On-site requirement|Source URL:\s*other/i)
    expect(grounded.toLowerCase()).not.toMatch(/roadmap strain|shipping lag|engineering bottleneck|resource shortage|development capacity|scaling pain/)
    if (strategy.messagingPolicy === 'CONNECT_WITH_NOTE') {
      expect(strategy.contact.messageRecommended).toBe(true)
      expect(strategy.strongestEvidence).toBeTruthy()
    }
  })

  it('rejects a fluent note that invents shipping lag even when the wording is otherwise clean', () => {
    const result = evaluateConnectionNote({
      text: 'Merget looks close. When shipping starts lagging the roadmap, extra engineering capacity is usually the gap.',
      profile: null,
      prospectName: 'Ved Kulkarni',
      prospectCompany: 'Merget',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures[0]?.toLowerCase()).toMatch(/unsupported prospect pain/)
  })
})

/**
 * General regression coverage for Fix 4 (message claim safety) — a
 * plausible general business pattern must never be accepted as a
 * prospect-specific claim in a connection note, regardless of which
 * fixture/lead it's attached to.
 */
describe('Connection note quality gate — unsupported generalized-pain claims', () => {
  const REJECTED_CLAIMS = [
    'Growth phases tend to strain roadmaps.',
    'Scaling usually creates engineering bottlenecks.',
    'Teams at this stage often need more development capacity.',
    'Rapid growth can stretch engineering resources.',
  ]

  it.each(REJECTED_CLAIMS)('rejects "%s" as an unsupported generalized-pain claim', (claim) => {
    const result = evaluateConnectionNote({
      text: `Hi, ${claim} Happy to connect.`,
      profile: null,
      prospectName: 'Test Prospect',
      prospectCompany: 'Test Co',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.toLowerCase().includes('generalized pain'))).toBe(true)
  })

  it('does not flag a note with no generalized-pain claim', () => {
    const result = evaluateConnectionNote({
      text: 'Hi, saw your post about the new API rollout. Would be great to connect.',
      profile: null,
      prospectName: 'Test Prospect',
      prospectCompany: 'Test Co',
      matchedProof: [],
    })
    expect(result.failures.some((f) => f.toLowerCase().includes('generalized pain'))).toBe(false)
  })
})
