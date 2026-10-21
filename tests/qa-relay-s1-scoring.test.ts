/**
 * QA RELAY — Sections 8-14 S1 scoring regressions.
 *
 * Fixtures are reconstructed from the 21 Oct QA report (synthetic, no real
 * person's data). These lock the deterministic source reading as the buyer
 * authority: an explicit prospect-owned request is never erased by a low
 * model score, a terminal do-not-contact state overrides historical intent,
 * seller grammar is never a buyer request, and explicit dates are read.
 */
import { describe, expect, it } from 'vitest'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveVerifiedBuyerIntent } from '@/lib/intelligence-v3/buyer-intent'
import { extractExplicitDates } from '@/lib/intelligence-v3/source-facts'
import { deriveRecommendedAction } from '@/lib/intelligence-v3/action/recommended-action'

const HANNAH = `Hannah Blake
· 2nd

CEO at NorthPeak Logistics

Chicago, Illinois, United States

About
I lead operations at NorthPeak Logistics.

We need a software development agency to rebuild our TMS. We have $45,000 approved for the project and plan to start in November 2026. The build should take about 8 weeks.

Contact info`

const EMMA = `Emma Collins
· 1st

Founder at BrightPath Education

Austin, Texas, United States

About
I'm the founder of BrightPath Education.

We're looking for a SaaS development agency to build our student platform. $35,000 budget approved. Start in November. 8 week project.

Contact info`

const ETHAN = `Ethan Cole
· 3rd

Head of Engineering at CloudNine Systems

July 2026
Looking for an agency to help migrate our infrastructure. Budget is available.

October 2026
We selected a partner and the project is complete. Please do not contact us with agency offers.`

const DANIEL = `Daniel Brooks
· 1st

Freelance Full Stack Developer

I'm a freelance developer. Contact me if your company needs a developer.
Looking for React and Node projects.`

const OLIVIA = `Olivia Bennett
· 2nd

Product Manager at FinEdge

About
Looking for a development team to help build our new dashboard. Budget approved for Q4.`

/** The model adversarially scores every clear buyer at 0.2 (QA report). */
const LOW_MODEL = { modelBuyerProbability: 0.2, modelExternalNeedProbability: 0.2, modelRelationship: 'BUYER' }

function intentFor(raw: string) {
  const facts = readSourceFacts(raw)
  return { facts, intent: resolveVerifiedBuyerIntent(facts.buyer, LOW_MODEL) }
}

function actionFor(raw: string) {
  const { facts, intent } = intentFor(raw)
  return deriveRecommendedAction({
    opportunity: {
      score: 60,
      qualification: 'MAYBE',
      buyerIntentLevel: intent.buyerIntentLevel,
      verifiedBuyerRequest: intent.verifiedBuyerRequest,
      relationshipRole: intent.relationshipRole,
      access: 'CONNECTION',
      buyerTiming: 'CURRENT',
      activityRecency: 'RECENT',
      commercialPotential: 'MEDIUM',
      episodeClosed: intent.terminalState !== null,
    },
    confidence: { label: 'HIGH', researchMore: false },
    channel: 'linkedin',
  })
}

describe('QA BUG-PRO-021 / BUG-14-03 — explicit buyer is never LOW/SKIP/UNKNOWN', () => {
  it('Hannah: explicit request + approved budget + start date + CEO is HIGH BUYER', () => {
    const { facts, intent } = intentFor(HANNAH)
    expect(facts.buyer.externalServiceRequest?.line).toContain('software development agency')
    expect(facts.buyer.statedBudget?.approved).toBe(true)
    expect(intent.verifiedBuyerRequest).toBe(true)
    expect(intent.buyerIntentLevel).toBe('HIGH')
    expect(intent.relationshipRole).toBe('BUYER')
    expect(intent.verifiedBudget).toBe(true)
    const action = actionFor(HANNAH)
    expect(['CLOSE', 'SKIP', 'OBSERVE']).not.toContain(action.action)
    expect(action.messageEligible).toBe(true)
  })

  it('Emma: explicit SaaS agency request is HIGH BUYER, not RESEARCH_MORE', () => {
    const { intent } = intentFor(EMMA)
    expect(intent.verifiedBuyerRequest).toBe(true)
    expect(intent.buyerIntentLevel).toBe('HIGH')
    expect(intent.relationshipRole).toBe('BUYER')
    expect(actionFor(EMMA).action).not.toBe('RESEARCH_MORE')
  })

  it('Olivia: a genuine buyer request still reads as a buyer', () => {
    const { intent } = intentFor(OLIVIA)
    expect(intent.verifiedBuyerRequest).toBe(true)
    expect(intent.buyerIntentLevel).toBe('HIGH')
  })
})

describe('QA BUG-PRO-022 — terminal do-not-contact overrides historical intent', () => {
  it('Ethan: July buyer + October closure is not contacted', () => {
    const { facts, intent } = intentFor(ETHAN)
    expect(facts.terminalState?.kind).toBe('DO_NOT_CONTACT')
    expect(intent.verifiedBuyerRequest).toBe(false)
    expect(intent.buyerIntentLevel).toBe('UNKNOWN')
    const action = actionFor(ETHAN)
    expect(action.action).toBe('CLOSE')
    expect(action.messageEligible).toBe(false)
  })

  it('a reopened buyer after a closure is still a buyer', () => {
    const reopened = ETHAN + '\n\nNovember 2026\nWe are now looking for a new agency for phase two.'
    const { intent } = intentFor(reopened)
    expect(intent.verifiedBuyerRequest).toBe(true)
    expect(intent.buyerIntentLevel).toBe('HIGH')
  })
})

describe('QA BUG-14-02 — seller grammar is never a buyer request', () => {
  it('Daniel: freelancer service offer is SELLER/CANDIDATE, not a buyer', () => {
    const { facts, intent } = intentFor(DANIEL)
    expect(facts.sellerActivity).toBe(true)
    expect(intent.verifiedBuyerRequest).toBe(false)
    expect(['SELLER', 'CANDIDATE']).toContain(intent.relationshipRole)
    expect(actionFor(DANIEL).messageEligible).toBe(false)
  })
})

describe('QA BUG-PRO-023 — explicit dates are read', () => {
  it('Hannah: November 2026 start date and 8-week duration are parsed', () => {
    const dates = extractExplicitDates(HANNAH)
    expect(dates.buyerStartDate).toMatch(/november/i)
    expect(dates.durationDays).toBe(56)
  })

  it('Emma: November start date is parsed', () => {
    const dates = extractExplicitDates(EMMA)
    expect(dates.buyerStartDate).toMatch(/november/i)
  })

  it('Ethan: both absolute activity dates are parsed', () => {
    const dates = extractExplicitDates(ETHAN)
    expect(dates.lines.length).toBeGreaterThanOrEqual(2)
  })

  it('the source facts carry the terminal state and explicit dates', () => {
    const facts = readSourceFacts(ETHAN)
    expect(facts.terminalState?.kind).toBe('DO_NOT_CONTACT')
    expect(facts.explicitDates.activityDate).toMatch(/october/i)
  })
})
