/**
 * BUG-BUYER-001 — A consultant describing services they sell must not become
 * a HIGH-intent buyer from their own marketing content.
 *
 * Invariant: SERVICE_OFFERING must never become BUYER_REQUEST.
 * Asserted against the canonical buyer decision (resolveVerifiedBuyerIntent),
 * the only buyer-intent authority.
 */
import { describe, expect, it } from 'vitest'
import { resolveBuyerIntentFromSource } from '@/lib/intelligence-v3/buyer-intent'
import { computeCompositeScore } from '@/lib/scoring/composite-scorer'
import { extractSignals } from '@/lib/scoring/signal-extractor'

describe('BUG-BUYER-001 service offering is not buyer', () => {
  const CONSULTANT = `Sam Patel
Founder at Brightline Consulting
We help companies build scalable web applications.
Our team specializes in React, Node, and cloud architecture.
Client work includes MVPs, redesigns, and team augmentation.
We offer end-to-end development services for startups and enterprises.
Hire us for your next project — we love solving hard problems.`

  it('canonical: seller text is SELLER, not a buyer request', () => {
    const r = resolveBuyerIntentFromSource(CONSULTANT, { signalCheck: { explicitAsk: true } })
    expect(r.verifiedBuyerRequest).toBe(false)
    expect(r.relationshipRole).toBe('SELLER')
    expect(r.buyerIntentLevel).toBe('UNKNOWN')
  })

  it('canonical: vendor-search claim on seller text is not verified', () => {
    const r = resolveBuyerIntentFromSource(CONSULTANT, { signalCheck: { seekingVendor: true } })
    expect(r.verifiedExternalNeed).toBe(false)
  })

  it('composite: seller profile does not get high buyer intent from own marketing', () => {
    const signals = extractSignals(CONSULTANT)
    const composite = computeCompositeScore({ signals, rawText: CONSULTANT })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(50)
    expect(composite.qualification).not.toBe('STRONG')
  })
})

describe('BUG-BUYER-002 founder advising clients about pricing', () => {
  const ADVISOR = `Maria Chen
Startup Advisor & Coach
I advise founders on pricing strategy, go-to-market, and fundraising.
My clients are early-stage SaaS companies.
Here's what I learned: pricing is about value, not cost.
Pro tip: start with a limited budget and iterate fast.
I mentor 12 founders and run a workshop on product launches.`

  it('canonical: advisor text is not a buyer request', () => {
    const r = resolveBuyerIntentFromSource(ADVISOR)
    expect(r.verifiedBuyerRequest).toBe(false)
    expect(r.verifiedBudget).toBe(false)
  })

  it('composite: advisor profile does not score as strong buyer', () => {
    const signals = extractSignals(ADVISOR)
    const composite = computeCompositeScore({ signals, rawText: ADVISOR })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(50)
  })
})

describe('BUG-BUYER-003 realized immediately is prose not event', () => {
  const NARRATIVE = `Jordan Park
CTO at Fieldnote Apps
I realized immediately that our monolith was killing us.
We needed to move fast — the market was shifting under our feet.
Within a week we had a plan, but budget was tight.
So we started looking for an agency to help with the migration.`

  it('canonical: a request told as past narrative is not current', () => {
    const r = resolveBuyerIntentFromSource(NARRATIVE)
    expect(r.verifiedBuyerRequest).toBe(false)
  })

  it('composite: narrative with prose timing scores below strong', () => {
    const signals = extractSignals(NARRATIVE)
    const composite = computeCompositeScore({ signals, rawText: NARRATIVE })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(70)
  })
})

describe('BUG-BUYER-004 limited budget historical experience', () => {
  const HISTORICAL = `Alex Rivera
Engineering Manager at Stripe
When I was at my last startup, we had a limited budget.
We realized immediately that outsourcing was the way to go.
Looking back, the launch was a success — but it was stressful.
Previously at a small agency, I learned to move fast.`

  it('canonical: historical budget and outsourcing are not verified', () => {
    const r = resolveBuyerIntentFromSource(HISTORICAL)
    expect(r.verifiedBudget).toBe(false)
    expect(r.verifiedBuyerRequest).toBe(false)
  })

  it('composite: historical content does not resurrect old opportunity', () => {
    const signals = extractSignals(HISTORICAL)
    const composite = computeCompositeScore({ signals, rawText: HISTORICAL })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(50)
  })
})

describe('BUG-BUYER-005 event/workshop launch is not buyer', () => {
  const WORKSHOP = `Priya Shah
Developer Advocate at Vercel
I'm launching a workshop on React performance next month.
Join us for a hands-on session — limited seats available.
The launch has been a great success so far.`

  it('canonical: workshop launch is not a buyer request', () => {
    const r = resolveBuyerIntentFromSource(WORKSHOP)
    expect(r.verifiedBuyerRequest).toBe(false)
  })

  it('composite: workshop content does not score as buyer', () => {
    const signals = extractSignals(WORKSHOP)
    const composite = computeCompositeScore({ signals, rawText: WORKSHOP })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(50)
  })
})

describe('BUG-BUYER-006 customer product launch', () => {
  const CUSTOMER_LAUNCH = `Tom Becker
Product Manager at Acme
One of our customers just launched their new mobile app.
We helped them scale from zero to 1M users.
The launch was a great success — they realized immediately that our platform worked.
Pricing starts at $500/month for the enterprise tier.`

  it('canonical: customer launch is not the prospect buying', () => {
    const r = resolveBuyerIntentFromSource(CUSTOMER_LAUNCH)
    expect(r.verifiedBuyerRequest).toBe(false)
  })

  it('composite: customer story does not score as buyer', () => {
    const signals = extractSignals(CUSTOMER_LAUNCH)
    const composite = computeCompositeScore({ signals, rawText: CUSTOMER_LAUNCH })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(50)
  })
})

describe('BUG-BUYER-007 third-party funding announcement', () => {
  const THIRD_PARTY_FUNDING = `Ana Costa
Journalist at TechNews
Via @founder: we just raised a $5M seed round led by Acme Ventures.
The startup is building a new AI-powered design tool.
They are hiring 3 engineers and 2 designers.
Looking for a dev shop to help scale the platform.
Contact us if you know a good agency.`

  it('canonical: third-party repost is not the prospect buying', () => {
    const r = resolveBuyerIntentFromSource(THIRD_PARTY_FUNDING)
    expect(r.verifiedBuyerRequest).toBe(false)
  })

  it('composite: third-party content does not score as buyer', () => {
    const signals = extractSignals(THIRD_PARTY_FUNDING)
    const composite = computeCompositeScore({ signals, rawText: THIRD_PARTY_FUNDING })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeLessThan(60)
  })
})

describe('BUG-BUYER-008 prospect explicit funding', () => {
  const PROSPECT_FUNDING = `Leo Martin
CEO at NovaTech
We just closed our $3M seed round last month.
The funding lets us expand the team — we are hiring a VP of Engineering.
Looking for a development partner to rebuild our mobile app.
Budget approved for Q1. Start within 2 weeks.`

  it('canonical: prospect vendor request is verified', () => {
    const r = resolveBuyerIntentFromSource(PROSPECT_FUNDING)
    expect(r.verifiedBuyerRequest).toBe(true)
    expect(r.relationshipRole).toBe('BUYER')
  })

  it('composite: explicit buyer with funding scores high', () => {
    const signals = extractSignals(PROSPECT_FUNDING)
    const composite = computeCompositeScore({ signals, rawText: PROSPECT_FUNDING })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeGreaterThanOrEqual(60)
  })
})

describe('BUG-BUYER-009 prospect seeking contractor', () => {
  const EXPLICIT = `Sarah Lane
CTO at Fieldnote Apps
We are looking for a software development agency to rebuild our mobile app in React Native.
Our release cycle is killing us, we need outside help to ship faster.
Budget approved for Q1. Launch planned within 3 months.`

  it('canonical: explicit agency request is verified', () => {
    const r = resolveBuyerIntentFromSource(EXPLICIT)
    expect(r.verifiedBuyerRequest).toBe(true)
  })

  it('composite: explicit buyer request scores high', () => {
    const signals = extractSignals(EXPLICIT)
    const composite = computeCompositeScore({ signals, rawText: EXPLICIT })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeGreaterThanOrEqual(60)
  })
})

describe('BUG-BUYER-010 service provider with genuine buyer episode', () => {
  const MIXED = `Chris Wong
CTO & Co-founder at BuildCo
BuildCo helps companies ship faster — we offer React and Node development services.
Our team of 8 engineers works with clients on MVPs and redesigns.
Hire us for your next project.

We are also looking for an agency specialized in DevOps to help with our CI/CD pipeline.
Our deployment process is too slow, we need outside help to automate it.
Budget: $5k/month. Start within 3 weeks.`

  it('canonical: genuine buyer episode inside a seller profile is verified', () => {
    const r = resolveBuyerIntentFromSource(MIXED)
    expect(r.verifiedBuyerRequest).toBe(true)
    expect(r.relationshipRole).toBe('BUYER')
    expect(r.sellerSideContent).toBe(true)
  })

  it('composite: mixed profile still scores buyer on genuine episode', () => {
    const signals = extractSignals(MIXED)
    const composite = computeCompositeScore({ signals, rawText: MIXED })
    const buyerDim = composite.dimensions.find((d) => d.key === 'buyerIntent')!
    expect(buyerDim.score).toBeGreaterThan(0)
    expect(buyerDim.score).toBeLessThan(60)
    expect(buyerDim.evidence.join(' ')).toMatch(/verified/)
  })
})
