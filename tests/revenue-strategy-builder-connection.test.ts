/**
 * Revenue Strategy Builder Connection Test
 *
 * Verifies that founders/builders with high commercial potential but no explicit
 * buyer request get a connection note recommendation on LinkedIn.
 */

import { describe, it, expect } from 'vitest'
import { buildRevenueStrategy, sourceFromCanonical } from '@/lib/relay/revenue-strategy'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'

function makeCanonical(overrides: Partial<CanonicalProspectIntelligence['intelligence']> = {}): CanonicalProspectIntelligence {
  return {
    version: 'relay_qualification_v2',
    intelligenceRunId: 'test',
    intelligenceInputHash: 'test',
    intelligenceVersion: 'test',
    computedAt: new Date().toISOString(),
    canonicalScore: 24,
    scoreVersion: 'test',
    scoredAt: new Date().toISOString(),
    scoreBreakdown: { dimensions: [], hardNegatives: [], missingInfo: [], total: 24, label: 'Weak fit', reasons: [], watchOut: [] },
    confidence: 50,
    qualification: 'skip',
    intelligence: {
      person: { fullName: 'Nour Abutabikh', firstName: 'Nour', title: 'Founder', seniority: null, location: null, linkedinUrl: null, otherUrls: [] },
      company: { name: 'DaddyHug', domain: null, linkedinUrl: null, industry: null, size: null, sizeEvidence: null, product: null, stage: null, stageEvidence: null },
      opportunity: { signals: [], primarySignal: null, description: null, urgency: 'unknown' },
      job: { title: null, employmentType: 'unknown', workplaceType: 'UNKNOWN', allowedGeography: null, timezone: null, compensation: null, skills: [], seniority: 'unknown', source: null, postedDate: null },
      content: { recentPosts: [], topics: [], explicitProblems: [], initiatives: [], launches: [], technicalSignals: [], hiringSignals: [] },
      probableNeed: null,
      opportunityTrigger: null,
      timingSignal: null,
      risks: [],
      unknowns: [],
      resolvedContradictions: [],
      businessModel: 'PRODUCT',
      relationship: 'UNKNOWN',
      commercialReading: { serviceBuyerIntent: 'MEDIUM', externalEngineeringNeed: 'NONE_DETECTED', immediateBuyerNeed: false, buyerTiming: 'UNKNOWN', productMomentum: 'MEDIUM', customerDiscovery: 'NONE', preLaunchActivity: 'NONE', technicalRelevance: 'MEDIUM', buyerEvidenceKinds: [] },
      remoteEligibility: { workplaceType: 'REMOTE', remoteScope: 'UNKNOWN', eligibility: 'ELIGIBLE', reason: '', evidence: [] },
      needOwnershipSummary: { dominant: 'UNKNOWN', counts: { SELF_NEED: 0, CUSTOMER_NEED: 0, MARKET_PROBLEM: 0, SERVICE_OFFERING: 0, PRODUCT_PROBLEM: 0, EMPLOYER_NEED: 0, UNKNOWN: 0 } },
      ...overrides,
    },
    rawSource: { rawInput: '', sourceType: 'mixed', sourceUrl: null, profileUrl: null, companyUrl: null, jobUrl: null, postUrls: [], rawPosts: [], rawJobDescription: null, rawProfileText: null, rawCompanyText: null, capturedAt: new Date().toISOString() },
    evidenceLedger: [],
    remoteEligibility: { workplaceType: 'REMOTE', remoteScope: 'UNKNOWN', eligibility: 'ELIGIBLE', reason: '', evidence: [] },
    extractionCompleteness: { score: 0, presentFields: [], missingFields: [], weakFields: [], repairAttempted: false, repairImproved: false, sourceUrlsFound: [], urlsPreserved: [] },
    rescoreEvents: [],
    recommendedIdentityId: null,
    recommendedProofIds: [],
    personalizationAngle: null,
    outreachContext: { whyNow: null, probableNeed: null, bestProof: null, personalizationAnchor: null, messageGoal: null, cta: null, thingsNotToClaim: [] },
    extractionCallLog: [],
    extractionTrace: [],
  }
}

describe('Builder connection on LinkedIn', () => {
  it('recommends connection note for founder with no explicit buyer request', () => {
    const canonical = makeCanonical()
    const source = sourceFromCanonical(canonical, { channel: 'connection' })
    const strategy = buildRevenueStrategy(source)

    // Founder with high commercial potential should get a connection note
    expect(strategy.contact.messageRecommended).toBe(true)
    expect(strategy.messageJob).toBe('EARN_CONNECTION')
  })

  it('recommends connection note for CEO with no explicit buyer request', () => {
    const canonical = makeCanonical({
      person: { fullName: 'Jane CEO', firstName: 'Jane', title: 'CEO', seniority: null, location: null, linkedinUrl: null, otherUrls: [] },
    })
    const source = sourceFromCanonical(canonical, { channel: 'connection' })
    const strategy = buildRevenueStrategy(source)

    expect(strategy.contact.messageRecommended).toBe(true)
    expect(strategy.messageJob).toBe('EARN_CONNECTION')
  })

  it('does NOT recommend connection note for DM channel (only connection)', () => {
    const canonical = makeCanonical()
    const source = sourceFromCanonical(canonical, { channel: 'dm' })
    const strategy = buildRevenueStrategy(source)

    // DM channel should NOT get a message for builder without explicit request
    expect(strategy.contact.messageRecommended).toBe(false)
  })

  it('does NOT recommend connection note for recruiter', () => {
    const canonical = makeCanonical({
      relationship: 'RECRUITER',
    })
    const source = sourceFromCanonical(canonical, { channel: 'connection' })
    const strategy = buildRevenueStrategy(source)

    // Recruiters should not get connection notes
    expect(strategy.contact.messageRecommended).toBe(false)
  })

  it('does NOT recommend connection note for recruiter (non-buyer relationship)', () => {
    const canonical = makeCanonical({
      relationship: 'RECRUITER',
      person: { fullName: 'Jane Recruiter', firstName: 'Jane', title: 'Technical Recruiter', seniority: null, location: null, linkedinUrl: null, otherUrls: [] },
    })
    const source = sourceFromCanonical(canonical, { channel: 'connection' })
    const strategy = buildRevenueStrategy(source)

    expect(strategy.contact.messageRecommended).toBe(false)
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(strategy.assessment.fit).not.toBe('HIGH')
    expect(strategy.assessment.intentWhy).toMatch(/research/i)
  })
})
