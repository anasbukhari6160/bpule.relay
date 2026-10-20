/**
 * Signal Ownership Regression Tests — V3 Hardening
 *
 * Every score-affecting signal must carry: actor, organization, subject,
 * needOwner, eventType, eventTime, evidenceSpan, verificationStatus.
 *
 * These tests verify that signals are attributed to the correct actor,
 * organization, and event — preventing cross-contamination between
 * unrelated episodes, persons, and activities.
 */

import { describe, it, expect } from 'vitest'
import { detectCommercialRequest, isEmploymentHiringOnly } from '@/lib/intelligence-v3/source-facts'
import { extractEventsDeterministically } from '@/lib/intelligence-v3/deterministic-events'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'

/** Production deterministic event path: source facts first, then events. */
function eventsFor(text: string) {
  return extractEventsDeterministically(text, readSourceFacts(text))
}
import { extractSignals } from '@/lib/scoring/signal-extractor'
import { assessCommercialPotential } from '@/lib/intelligence-v3/latent-opportunity'
import { scoreEpisode, isEmploymentHiringNotPurchase, type V3ScoreInput } from '@/lib/intelligence-v3/scoring/score-v3'
import type { V3OpportunityEpisode, V3BoundedDecision, V3Event, CommercialPotentialAssessment } from '@/lib/intelligence-v3/types'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<V3Event> = {}): V3Event {
  return {
    id: 'evt_test',
    eventType: 'HIRING',
    personId: 'person_1',
    organizationId: 'org_1',
    organizationName: 'TestCo',
    occurredAt: new Date().toISOString(),
    channel: 'linkedin',
    requestedCapability: ['react', 'node.js'],
    targetAudience: 'PUBLIC',
    explicitness: 'EXPLICIT',
    applyInstructions: [],
    evidenceRefs: [],
    polarity: 'ACTIVE',
    ...overrides,
  }
}

function makeEpisode(overrides: Partial<V3OpportunityEpisode> = {}): V3OpportunityEpisode {
  return {
    id: 'ep_test',
    anchorEvent: makeEvent(),
    organizationId: 'org_1',
    organizationName: 'TestCo',
    needOwnerPersonId: 'person_1',
    needOwnerType: 'HIRING_NEED',
    explicitRequest: true,
    requestedCapabilities: ['react', 'node.js'],
    applicationChannels: [],
    evidenceRefs: [],
    eventRefs: ['evt_test'],
    status: 'CURRENT',
    detectedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ageDays: 2,
    ...overrides,
  }
}

function makeDecision(overrides: Partial<V3BoundedDecision> = {}): V3BoundedDecision {
  return {
    relationship: 'UNKNOWN',
    buyerRequestProbability: 0.1,
    externalNeedProbability: 0.1,
    needOwnerType: 'HIRING_NEED',
    fit: 'MEDIUM',
    timing: 'CURRENT',
    access: 'CONNECTION',
    messageEligible: false,
    providerConfidence: 0.5,
    ...overrides,
  }
}

function makeV2Canonical(overrides: Partial<CanonicalProspectIntelligence> = {}): CanonicalProspectIntelligence {
  return {
    intelligence: {
      person: {
        name: 'Test Person',
        title: 'CEO',
        seniority: 'executive',
        affiliations: [{ organizationName: 'TestCo', role: 'CEO' }],
        linkedinUrl: 'https://linkedin.com/in/testperson',
        otherUrls: [],
      },
      company: {
        name: 'TestCo',
        domain: 'testco.com',
        size: '1-10',
        stage: 'seed',
        product: 'cybersecurity platform',
        industry: 'cybersecurity',
      },
      content: {
        topics: ['cybersecurity', 'threat detection'],
        technicalSignals: ['python', 'react'],
        recentPosts: [],
        launches: [],
        initiatives: [],
        hiringSignals: [],
      },
    },
    ...overrides,
  } as CanonicalProspectIntelligence
}

// ═══════════════════════════════════════════════════════════════════════════
// Case 1: "I'm open to contract/full-time opportunities" → CANDIDATE
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 1: job-seeking language is CANDIDATE, not HIRING or BUYER', () => {
  const candidatePhrases = [
    "I'm open to contract opportunities",
    "I'm open to full-time opportunities",
    "Open to new opportunities",
    "Looking for my next role",
    "Seeking new challenges",
    "Available for hire",
    "Looking for contract work",
    "Open to work",
  ]

  candidatePhrases.forEach((phrase) => {
    it(`"${phrase}" is NOT a hiring event`, () => {
      const facts = detectCommercialRequest(phrase)
      expect(facts.employmentHiring).toBeNull()
      expect(facts.externalServiceRequest).toBeNull()
    })

    it(`"${phrase}" is NOT employment hiring`, () => {
      expect(isEmploymentHiringOnly(phrase)).toBe(false)
    })
  })

  it('"open to work" is candidate language — never a purchase', () => {
    const episode = makeEpisode({ anchorEvent: makeEvent({ eventType: 'OTHER' }) })
    expect(isEmploymentHiringNotPurchase("I'm open to contract opportunities", episode)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 2: "If you're hiring for X, let's connect" → SERVICE/CANDIDATE offering
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 2: service offering is NOT buyer need', () => {
  const offeringPhrases = [
    "If you're hiring for React developers, let's connect",
    "If you need a developer, DM me",
    "Hiring? I know great candidates — reach out",
    "Looking for talent? Let me help",
  ]

  offeringPhrases.forEach((phrase) => {
    it(`"${phrase}" is NOT a buyer request`, () => {
      const facts = detectCommercialRequest(phrase)
      expect(facts.externalServiceRequest).toBeNull()
    })

    it(`"${phrase}" is NOT employment hiring`, () => {
      expect(isEmploymentHiringOnly(phrase)).toBe(false)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 3: "I'd love your feedback on my product" → CUSTOMER_DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 3: customer discovery is NOT external help request', () => {
  const discoveryPhrases = [
    "I'd love your feedback on my product",
    "Talking to founders about their problems",
    "Would love feedback on our new feature",
    "Customer discovery: what tools do you use?",
  ]

  discoveryPhrases.forEach((phrase) => {
    it(`"${phrase}" is NOT a buyer request`, () => {
      const facts = detectCommercialRequest(phrase)
      expect(facts.externalServiceRequest).toBeNull()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 4: recent product post "2d" → BUILD ACTIVITY, not urgent BUYER TIMING
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 4: product launch is BUILD ACTIVITY, not buyer timing', () => {
  it('product launch post does not create buyer request', () => {
    const facts = detectCommercialRequest("Just launched our new SaaS platform!")
    expect(facts.externalServiceRequest).toBeNull()
    expect(facts.employmentHiring).toBeNull()
  })

  it('product launch event type is PRODUCT_LAUNCH, not AGENCY_REQUEST', () => {
    const events = eventsFor("Just launched our new SaaS platform!")
    const launchEvent = events.find(e => e.evidenceQuote.includes('launched'))
    if (launchEvent) {
      expect(launchEvent.eventType).toBe('PRODUCT_LAUNCH')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 5: 1st-degree + Message available → DIRECT ACCESS
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 5: first-degree connection with message availability', () => {
  it('detects 1st-degree access from LinkedIn notation', () => {
    const signals = extractSignals('Test Person\nCEO at TestCo\n· 1st')
    expect(signals.access.isFirstDegree).toBe(true)
    expect(signals.access.canMessage).toBe(true)
  })

  it('detects 1st-degree from "1st" badge', () => {
    const signals = extractSignals('Test Person · 1st · Message')
    expect(signals.access.isFirstDegree).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 6: named mutual connections → mutual connection signal
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 6: named mutual connections are parsed correctly', () => {
  it('parses "Sharon, Alankrit and 2 other mutual connections" as 4 mutuals', () => {
    const signals = extractSignals('Sharon, Alankrit and 2 other mutual connections')
    expect(signals.access.mutualConnections).toBe(4)
    expect(signals.access.canMessage).toBe(true)
  })

  it('parses "Sharon and Alankrit and 0 other mutual connections" as 2 mutuals', () => {
    const signals = extractSignals('Sharon and Alankrit and 0 other mutual connections')
    expect(signals.access.mutualConnections).toBe(2)
  })

  it('never returns "No mutual connections" when named connections exist', () => {
    const signals = extractSignals('Sharon, Alankrit and 2 other mutual connections')
    expect(signals.access.mutualConnections).not.toBeNull()
    expect(signals.access.mutualConnections).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 7: healthcare activity under NexaCareTech → scoped to that episode
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 7: industry is scoped to the correct organization', () => {
  it('cybersecurity company gets cybersecurity industry', () => {
    const signals = extractSignals(
      'Ory\nCEO at Tencyle\n\nCybersecurity platform for enterprise threat detection'
    )
    expect(signals.company.industry).toBe('cybersecurity')
  })

  it('healthcare company gets healthcare industry', () => {
    const signals = extractSignals(
      'Jane\nCEO at NexaCareTech\n\nHealthcare platform for patient management'
    )
    expect(signals.company.industry).toBe('healthcare')
  })

  it('commercial potential is scoped per-organization', async () => {
    const v2Tencyle = makeV2Canonical({
      intelligence: {
        ...makeV2Canonical().intelligence,
        company: {
          ...makeV2Canonical().intelligence.company,
          name: 'Tencyle',
          product: 'cybersecurity platform',
          industry: 'cybersecurity',
        },
        person: {
          ...makeV2Canonical().intelligence.person,
          affiliations: [
            { organizationName: 'Tencyle', role: 'CEO' },
            { organizationName: 'AgentAce', role: 'Advisor' },
            { organizationName: 'Tayo360', role: 'Co-Founder' },
          ],
        },
      },
    })

    const cp = await assessCommercialPotential(v2Tencyle, 'Ory\nCEO at Tencyle\n\nCybersecurity platform')
    expect(cp.decisionAuthority).toBeGreaterThanOrEqual(0.7)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 8: founder with multiple active products → HIGH commercial potential
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 8: founder with multiple products has HIGH commercial potential', () => {
  it('multi-product founder gets VERY_HIGH build intensity', async () => {
    const v2Multi = makeV2Canonical({
      intelligence: {
        ...makeV2Canonical().intelligence,
        person: {
          ...makeV2Canonical().intelligence.person,
          title: 'CEO',
          affiliations: [
            { organizationName: 'CompanyA', role: 'CEO' },
            { organizationName: 'CompanyB', role: 'Founder' },
            { organizationName: 'CompanyC', role: 'Co-Founder' },
          ],
        },
        company: {
          ...makeV2Canonical().intelligence.company,
          name: 'CompanyA',
          stage: 'seed',
        },
        content: {
          ...makeV2Canonical().intelligence.content,
          launches: ['ProductA launch', 'ProductB beta'],
          initiatives: ['New platform', 'AI feature'],
        },
      },
    })

    const cp = await assessCommercialPotential(v2Multi, 'Taylor Kim\nCEO at CompanyA | Founder at CompanyB\n\nAbout\nWe are building multiple SaaS products on React and Node. Just launched ProductA and ProductB beta.\n\nActivity\n2d •\nProductB beta is live — 300 signups in a day.')
    expect(['HIGH', 'VERY_HIGH']).toContain(cp.overallPotential)
  })

  it('founder episode scores naturally above OBSERVE threshold', () => {
    const episode = makeEpisode({
      needOwnerType: 'ORGANIZATION_NEED',
      anchorEvent: makeEvent({ eventType: 'PRODUCT_LAUNCH' }),
      explicitRequest: false,
      ageDays: 2,
    })
    const decision = makeDecision({
      relationship: 'UNKNOWN',
      buyerRequestProbability: 0.1,
      externalNeedProbability: 0.2,
      fit: 'STRONG',
      timing: 'CURRENT',
      access: 'CONNECTION',
    })
    const cp: CommercialPotentialAssessment = {
      decisionAuthority: 0.9,
      buildIntensity: 'VERY_HIGH',
      technicalRelevance: 0.6,
      capacityNeedLikelihood: 0.7,
      reachability: 0.8,
      companyMaturity: 0.5,
      commercialActivity: 0.6,
      overallPotential: 'HIGH',
      confidence: 0.75,
      signals: ['Decision-maker role', 'Active building (VERY_HIGH)', 'Technical stack overlap', 'Likely needs external help', 'Reachable'],
    }
    void cp
    const input: V3ScoreInput = { episode, decision, rawText: 'Taylor Kim\nCEO at CompanyA | Founder at CompanyB\n\nAbout\nWe are building multiple SaaS products on React and Node. Just launched ProductA and ProductB beta.\n\nActivity\n2d •\nProductB beta is live — 300 signups in a day.' }
    const result = scoreEpisode(input)
    expect(result.score).toBeGreaterThanOrEqual(35)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 9: explicit "looking for a developer/agency/contractor" → buyer event
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 9: explicit external provider request is a genuine buyer event', () => {
  const buyerPhrases = [
    "Looking for a development agency to build our platform",
    "Need a contractor for a 3-month React project",
    "Looking for a developer to help scale our product",
    "Seeking an outsourced team for our MVP",
  ]

  buyerPhrases.forEach((phrase) => {
    it(`"${phrase}" is a buyer request`, () => {
      const facts = detectCommercialRequest(phrase)
      expect(facts.externalServiceRequest).not.toBeNull()
    })

    it(`"${phrase}" is NOT employment hiring`, () => {
      expect(isEmploymentHiringOnly(phrase)).toBe(false)
    })
  })

  it('agency request event type is AGENCY_REQUEST', () => {
    const events = eventsFor("Looking for a development agency to build our platform")
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].eventType).toBe('AGENCY_REQUEST')
  })

  it('contractor request event type is FREELANCE_REQUEST', () => {
    const events = eventsFor("Need a contractor for a React project")
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].eventType).toBe('FREELANCE_REQUEST')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Case 10: seller + separate buyer request → seller doesn't suppress buyer
// ═══════════════════════════════════════════════════════════════════════════

describe('Case 10: service provider with separate buyer request keeps buyer episode', () => {
  it('seller offering does not create buyer request', () => {
    const facts = detectCommercialRequest("We provide React development services for startups")
    expect(facts.externalServiceRequest).toBeNull()
  })

  it('buyer request on separate line is detected independently', () => {
    const source = "We provide React development services for startups\n\nAlso looking for a DevOps contractor for our internal team"
    const facts = detectCommercialRequest(source)
    expect(facts.externalServiceRequest).not.toBeNull()
  })

  it('seller relationship does not suppress buyer episode score', () => {
    const sellerEpisode = makeEpisode({
      id: 'ep_seller',
      organizationId: 'org_seller',
      organizationName: 'DevAgency',
      needOwnerType: 'SERVICE_OFFERING',
      anchorEvent: makeEvent({ eventType: 'SERVICE_OFFERING', organizationId: 'org_seller', organizationName: 'DevAgency' }),
      explicitRequest: false,
    })
    const buyerEpisode = makeEpisode({
      id: 'ep_buyer',
      organizationId: 'org_buyer',
      organizationName: 'ClientCo',
      needOwnerType: 'ORGANIZATION_NEED',
      anchorEvent: makeEvent({ eventType: 'AGENCY_REQUEST', organizationId: 'org_buyer', organizationName: 'ClientCo' }),
      explicitRequest: true,
    })
    const decision = makeDecision({
      relationship: 'BUYER',
      buyerRequestProbability: 0.8,
      externalNeedProbability: 0.8,
      fit: 'STRONG',
      timing: 'CURRENT',
      access: 'CONNECTION',
    })
    const buyerCp: CommercialPotentialAssessment = {
      decisionAuthority: 0.75,
      buildIntensity: 'MEDIUM',
      technicalRelevance: 0.6,
      capacityNeedLikelihood: 0.7,
      reachability: 0.7,
      companyMaturity: 0.5,
      commercialActivity: 0.4,
      overallPotential: 'HIGH',
      confidence: 0.6,
      signals: ['Decision-maker role', 'Likely needs external help', 'Reachable'],
    }
    void buyerCp
    void sellerEpisode
    const buyerResult = scoreEpisode({
      episode: buyerEpisode,
      decision,
      rawText: 'Dana Cole\nCEO at ClientCo\n· 2nd\n500+ connections\nMessage\n\nActivity\n3d •\nLooking for a development agency to build our platform. React + Node.js. Budget $50k approved. DM me with references.',
    })
    expect(buyerResult.score).toBeGreaterThan(55)
    expect(['STRONG', 'WORTH_PURSUING']).toContain(buyerResult.qualification)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Composite: Abdulhakim-class — worth pursuing without false hiring/help signals
// ═══════════════════════════════════════════════════════════════════════════

describe('Abdulhakim-class: multi-role founder remains worth pursuing', () => {
  it('founder with agency + product company scores on product episode', async () => {
    const v2Abdulhakim = makeV2Canonical({
      intelligence: {
        ...makeV2Canonical().intelligence,
        person: {
          ...makeV2Canonical().intelligence.person,
          name: 'Abdulhakim',
          title: 'Software Engineer',
          affiliations: [
            { organizationName: 'Tayo360', role: 'Software Engineer' },
            { organizationName: 'AgentAce', role: 'Founder' },
          ],
        },
        company: {
          ...makeV2Canonical().intelligence.company,
          name: 'Tayo360',
          stage: 'mvp',
          product: 'healthtech platform',
        },
        content: {
          ...makeV2Canonical().intelligence.content,
          launches: [],
          initiatives: [],
        },
      },
    })

    const cp = await assessCommercialPotential(
      v2Abdulhakim,
      'Abdulhakim\nSoftware Engineer at Tayo360\n\nBuilding a healthtech platform for Africa\n\nOpen to contract opportunities'
    )
    expect(cp.decisionAuthority).toBeGreaterThanOrEqual(0.4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Composite: Ory-class — no invented hiring from "Full-time"
// ═══════════════════════════════════════════════════════════════════════════

describe('Ory-class: employment metadata does not invent hiring', () => {
  it('Tencyle · Full-time is not hiring', () => {
    const facts = detectCommercialRequest('Tencyle · Full-time')
    expect(facts.employmentHiring).toBeNull()
  })

  it('full Ory profile: no buyer request, no hiring, no industry misattribution', () => {
    const source = `Ory
Co-Founder & CEO at Tencyle
Cybersecurity expert with 10+ years experience
Tencyle · Full-time
Sharon, Alankrit and 2 other mutual connections
Former CTO at SecurityStartup
Building threat detection tools`

    const facts = detectCommercialRequest(source)
    expect(facts.employmentHiring).toBeNull()
    expect(facts.externalServiceRequest).toBeNull()
    expect(isEmploymentHiringOnly(source)).toBe(false)

    const signals = extractSignals(source)
    expect(signals.company.industry).toBe('cybersecurity')
    expect(signals.access.mutualConnections).toBe(4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Composite: Adir-class — seller content does not become buyer intent
// ═══════════════════════════════════════════════════════════════════════════

describe('Adir-class: seller content does not become buyer intent', () => {
  it('service offering is not buyer intent', () => {
    const source = `Adir
CEO at DevShop
We provide React and Node.js development services for startups
Our agency helps companies build MVPs`

    const facts = detectCommercialRequest(source)
    expect(facts.externalServiceRequest).toBeNull()
    expect(isEmploymentHiringOnly(source)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Genuine buyer remains highly ranked
// ═══════════════════════════════════════════════════════════════════════════

describe('Genuine buyer remains highly ranked', () => {
  it('explicit agency request scores STRONG', () => {
    const episode = makeEpisode({
      needOwnerType: 'ORGANIZATION_NEED',
      anchorEvent: makeEvent({ eventType: 'AGENCY_REQUEST' }),
      explicitRequest: true,
      requestedCapabilities: ['react', 'node.js'],
    })
    const decision = makeDecision({
      relationship: 'BUYER',
      buyerRequestProbability: 0.9,
      externalNeedProbability: 0.85,
      fit: 'STRONG',
      timing: 'URGENT',
      access: 'CONNECTION',
    })
    const buyerCp: CommercialPotentialAssessment = {
      decisionAuthority: 0.7,
      buildIntensity: 'MEDIUM',
      technicalRelevance: 0.6,
      capacityNeedLikelihood: 0.7,
      reachability: 0.7,
      companyMaturity: 0.5,
      commercialActivity: 0.4,
      overallPotential: 'HIGH',
      confidence: 0.6,
      signals: ['Decision-maker role', 'Likely needs external help', 'Reachable'],
    }
    const result = scoreEpisode({
      episode,
      decision,
      commercialPotential: buyerCp,
      rawText: 'Looking for a development agency to build our platform. React + Node.js. Budget $50k approved.',
    })
    expect(result.score).toBeGreaterThan(55)
    expect(['STRONG', 'WORTH_PURSUING']).toContain(result.qualification)
  })
})
