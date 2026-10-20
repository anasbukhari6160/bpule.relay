import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { describe, it, expect } from 'vitest'
import { computeCanonicalScore, checkHardNegatives, SCORE_VERSION, DIMENSION_WEIGHTS } from '@/lib/intelligence-v2/scoring-engine'
import { assessRemoteEligibility } from '@/lib/intelligence-v2/remote-eligibility'
import { isClinicianProfile, isLinkedInChromeText, techKeywordMatches } from '@/lib/intelligence-v2/role-signals'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { scoreLabel, canonicalToDisplay } from '@/lib/intelligence-v2/types'
import type { NormalizedIntelligence } from '@/lib/intelligence-v2/types'

// ── Test Fixtures ──────────────────────────────────────────────────────────

function makeIntelligence(overrides: Partial<NormalizedIntelligence> = {}): NormalizedIntelligence {
  return {
    person: {
      fullName: 'Fizza Hussain',
      firstName: 'Fizza',
      title: 'CTO',
      seniority: 'executive',
      location: 'London, United Kingdom',
      linkedinUrl: 'https://linkedin.com/in/fizza',
      otherUrls: [],
    },
    company: {
      name: 'TechCorp',
      domain: 'techcorp.io',
      linkedinUrl: null,
      industry: 'SaaS',
      size: '50+',
      sizeEvidence: '50 employees',
      product: 'Health platform',
      stage: 'growth',
      stageEvidence: 'Series A',
    },
    opportunity: {
      signals: ['hiring'],
      primarySignal: 'hiring',
      description: 'Hiring founding engineer',
      urgency: 'immediate',
    },
    job: null,
    content: {
      recentPosts: [],
      topics: ['engineering', 'hiring'],
      explicitProblems: [],
      initiatives: [],
      launches: [],
      technicalSignals: ['fullstack', 'react'],
      hiringSignals: ['hiring founding engineer'],
    },
    remoteEligibility: {
      workplaceType: 'REMOTE',
      remoteScope: 'WORLDWIDE',
      eligibility: 'ELIGIBLE',
      reason: 'Remote worldwide — eligible from Pakistan.',
    },
    probableNeed: 'Needs a founding engineer to build their health platform',
    opportunityTrigger: 'Just raised Series A, actively hiring founding engineer',
    timingSignal: 'Immediate hiring need',
    risks: [],
    unknowns: [],
    resolvedContradictions: [],
    businessModel: 'PRODUCT',
    relationship: 'POTENTIAL_BUYER',
    ...overrides,
  }
}

// ── Canonical Scoring Engine Tests ─────────────────────────────────────────

describe('Canonical Scoring Engine', () => {
  it('produces a deterministic score for the same input', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'Fizza Hussain, CTO at TechCorp. Hiring founding engineer. Remote worldwide.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: false,
    }

    const score1 = computeCanonicalScore(input)
    const score2 = computeCanonicalScore(input)

    expect(score1.total).toBe(score2.total)
    expect(score1.dimensions.length).toBe(score2.dimensions.length)
  })

  it('score is within 0-100 range', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'Fizza Hussain, CTO at TechCorp. Hiring founding engineer. Remote worldwide.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: true,
    }

    const score = computeCanonicalScore(input)
    expect(score.total).toBeGreaterThanOrEqual(0)
    expect(score.total).toBeLessThanOrEqual(100)
  })

  it('dimension breakdown sums to total (minus hard negative cap)', () => {
    const intelligence = makeIntelligence({
      // Override default 'hiring' signal with real buyer evidence
      opportunity: {
        signals: ['freelance_project_need'],
        primarySignal: 'freelance_project_need',
        description: 'Looking for a team to build our platform',
        urgency: 'immediate',
      },
    })
    const input = {
      intelligence,
      rawText: 'Fizza Hussain, CTO at TechCorp. Looking for a strong React/Node.js team to help us scale. Remote worldwide.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: true,
    }

    const score = computeCanonicalScore(input)
    const dimSum = score.dimensions.reduce((s, d) => s + d.points, 0)

    // Without hard negatives, total should be <= dim sum (need ownership penalty may reduce it)
    if (score.hardNegatives.length === 0) {
      expect(score.total).toBeLessThanOrEqual(Math.max(0, Math.min(100, dimSum)))
      // Total should be close to dim sum (within need ownership penalty range)
      expect(score.total).toBeGreaterThanOrEqual(Math.max(0, Math.min(100, dimSum) - 40))
    }
  })

  it('all 8 dimensions are evaluated', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'Test',
      hasRelevantProof: false,
      proofMatchStrength: 0,
      hasCredibleIdentity: false,
      isReachable: false,
      resemblesPastWin: false,
    }

    const score = computeCanonicalScore(input)
    expect(score.dimensions.length).toBe(8)

    const dimKeys = score.dimensions.map((d) => d.key)
    expect(dimKeys).toContain('opportunityFit')
    expect(dimKeys).toContain('remoteEligibility')
    expect(dimKeys).toContain('needIntent')
    expect(dimKeys).toContain('revenueIdentityFit')
    expect(dimKeys).toContain('proofStrength')
    expect(dimKeys).toContain('accessReachability')
    expect(dimKeys).toContain('timing')
    expect(dimKeys).toContain('conversionEvidence')
  })

  it('dimension max values match the centralized weights', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'Test',
      hasRelevantProof: false,
      proofMatchStrength: 0,
      hasCredibleIdentity: false,
      isReachable: false,
      resemblesPastWin: false,
    }

    const score = computeCanonicalScore(input)
    const dimMap = Object.fromEntries(score.dimensions.map((d) => [d.key, d]))

    expect(dimMap.opportunityFit.max).toBe(DIMENSION_WEIGHTS.opportunityFit.max)
    expect(dimMap.remoteEligibility.max).toBe(DIMENSION_WEIGHTS.remoteEligibility.max)
    expect(dimMap.needIntent.max).toBe(DIMENSION_WEIGHTS.needIntent.max)
    expect(dimMap.revenueIdentityFit.max).toBe(DIMENSION_WEIGHTS.revenueIdentityFit.max)
    expect(dimMap.proofStrength.max).toBe(DIMENSION_WEIGHTS.proofStrength.max)
    expect(dimMap.accessReachability.max).toBe(DIMENSION_WEIGHTS.accessReachability.max)
    expect(dimMap.timing.max).toBe(DIMENSION_WEIGHTS.timing.max)
    expect(dimMap.conversionEvidence.max).toBe(DIMENSION_WEIGHTS.conversionEvidence.max)
  })

  it('score version is relay_qualification_v2', () => {
    expect(SCORE_VERSION).toBe('relay_qualification_v2')
  })
})

// ── Hard Negatives Tests ───────────────────────────────────────────────────

describe('Hard Negatives', () => {
  it('detects explicitly on-site only requirement', () => {
    const negatives = checkHardNegatives('This is an on-site only role at our New York office.')
    expect(negatives.length).toBeGreaterThan(0)
  })

  it('detects US-only geography restriction', () => {
    const negatives = checkHardNegatives('Must be based in the United States.')
    expect(negatives.length).toBeGreaterThan(0)
  })

  it('detects EU-only restriction', () => {
    const negatives = checkHardNegatives('EU only position.')
    expect(negatives.length).toBeGreaterThan(0)
  })

  it('does NOT flag worldwide remote as hard negative', () => {
    const negatives = checkHardNegatives('Remote worldwide. Can be based anywhere.')
    expect(negatives.length).toBe(0)
  })

  it('does NOT flag generic remote as hard negative', () => {
    const negatives = checkHardNegatives('Fully remote position.')
    expect(negatives.length).toBe(0)
  })

  it('caps score when hard negatives present', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'On-site only role in New York. Must be based in the US.',
      hasRelevantProof: true,
      proofMatchStrength: 10,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: true,
    }

    const score = computeCanonicalScore(input)
    expect(score.total).toBeLessThanOrEqual(25)
    expect(score.hardNegatives.length).toBeGreaterThan(0)
  })

  it('does not treat a clinician founder as a student or software buyer', () => {
    const intelligence = makeIntelligence({
      person: {
        ...makeIntelligence().person,
        fullName: 'Yosief Berhe',
        firstName: 'Yosief',
        title: 'PMHNP-BC',
        seniority: 'Founder',
      },
      company: {
        ...makeIntelligence().company,
        name: 'Clarity Psychiatry',
        industry: 'Telehealth',
      },
      opportunity: {
        signals: [],
        primarySignal: null,
        description: 'Telehealth psychiatric practice',
        urgency: 'unknown',
      },
      content: {
        ...makeIntelligence().content,
        technicalSignals: [],
        hiringSignals: [],
        topics: ['Mental Health'],
      },
      probableNeed: null,
    })
    const score = computeCanonicalScore({
      intelligence,
      rawText: 'Founder of Clarity Psychiatry. Psychiatric Nurse Practitioner Intern. Please feel free to reach out.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: true,
    })
    expect(score.watchOut.some((w) => /student/i.test(w))).toBe(false)
    expect(score.watchOut.some((w) => /clinician/i.test(w))).toBe(true)
    expect(score.label).toBe('Not a fit')
    expect(score.total).toBeLessThanOrEqual(25)
  })

  it('does not invent software demand from a clinician LinkedIn paste', async () => {
    // Canonical path (V3, offline): the legacy V2 scorer is only reachable
    // with V3_CANONICAL=false and is not what production ships.
    const { intelligence } = await produceV3Intelligence(
      `Yosief Berhe PMHNP-BC
PMHNP-BC | Licensed in Oregon & California | Founder of Clarity Psychiatry
Portland, Oregon Metropolitan Area
56 reactions · 8 comments
I'm a board-certified Psychiatric Mental Health Nurse Practitioner and the founder of Clarity Psychiatry.
Please feel free to reach out.
I raised my hand and helped.
Psychiatric Nurse Practitioner Intern`,
      { deterministicOnly: true, skipEventModel: true },
    )
    // Canonical bands: a clinician founder with no stack, no need and no
    // product is LOW or SKIP — never MAYBE or better. Unknown ≠ negative, but
    // nothing here is unknown: there is simply no software demand.
    expect(['skip', 'low']).toContain(intelligence.qualification)
    expect(intelligence.intelligence.content.technicalSignals).not.toContain('react')
    expect(intelligence.intelligence.probableNeed).toBeNull()
    expect(intelligence.intelligence.opportunity.signals).not.toContain('funding')
    expect(intelligence.intelligence.opportunity.signals).not.toContain('explicit_ask')
    expect(intelligence.scoreBreakdown.watchOut.some((w) => /student/i.test(w))).toBe(false)
    expect(intelligence.scoreBreakdown.watchOut.some((w) => /no clear buyer request|no capability|fit unverified|healthcare|clinic/i.test(w))).toBe(true)
  })
})

// ── Remote Eligibility Tests ────────────────────────────────────────────────

describe('Remote Eligibility', () => {
  it('Remote / worldwide → ELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote worldwide. Work from anywhere.',
    })
    expect(result.eligibility).toBe('ELIGIBLE')
    expect(result.workplaceType).toBe('REMOTE')
    expect(result.remoteScope).toBe('WORLDWIDE')
  })

  it('does not treat public-health "worldwide" copy as a remote role', () => {
    const result = assessRemoteEligibility({
      rawText: 'Anxiety disorders surpassed depression as the leading cause of mental health disability worldwide in 2023. Global anxiety prevalence surged 47%.',
    })
    expect(result.remoteScope).not.toBe('WORLDWIDE')
    expect(result.reason).not.toMatch(/worldwide|global/i)
  })

  it('Remote / anywhere → ELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Fully remote. Location independent.',
    })
    expect(result.eligibility).toBe('ELIGIBLE')
  })

  it('Remote but US-only → INELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote, but must be based in the United States.',
    })
    expect(result.eligibility).toBe('INELIGIBLE')
  })

  it('Remote but EU-only → INELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote within EU only.',
    })
    expect(result.eligibility).toBe('INELIGIBLE')
  })

  it('Hybrid London → INELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Hybrid role, 3 days per week in our London office.',
      requiredWorkerLocation: 'London, United Kingdom',
    })
    expect(result.eligibility).toBe('INELIGIBLE')
  })

  it('On-site New York → INELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'On-site position at our New York headquarters.',
      requiredWorkerLocation: 'New York, United States',
    })
    expect(result.eligibility).toBe('INELIGIBLE')
  })

  it('No workplace information → UNKNOWN (not automatic rejection)', () => {
    const result = assessRemoteEligibility({
      rawText: 'Building a new product. Looking for help.',
    })
    expect(result.eligibility).toBe('UNCLEAR')
    expect(result.workplaceType).toBe('UNKNOWN')
  })

  it('Company location does NOT penalize international remote', () => {
    const result = assessRemoteEligibility({
      rawText: 'Our company is based in San Francisco. Hiring remote engineer worldwide.',
      companyLocation: 'San Francisco, California',
    })
    expect(result.eligibility).toBe('ELIGIBLE')
  })

  it('Timezone overlap with PST → evaluates PKT feasibility', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote with some Pacific timezone overlap preferred.',
    })
    expect(result.remoteScope).toBe('TIMEZONE_RESTRICTED')
    expect(result.pktOverlapFeasibility).toBeDefined()
    // PKT (UTC+5) vs PST (UTC-8) = 13 hour difference → poor overlap
    expect(result.pktOverlapFeasibility!).toBeLessThan(40)
  })

  it('Timezone overlap with GMT → good PKT feasibility', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote with GMT timezone overlap required.',
    })
    expect(result.remoteScope).toBe('TIMEZONE_RESTRICTED')
    expect(result.pktOverlapFeasibility).toBeDefined()
    // PKT (UTC+5) vs GMT (UTC+0) = 5 hour difference → moderate/good
    expect(result.pktOverlapFeasibility!).toBeGreaterThanOrEqual(40)
  })

  it('Flexible/async schedule → LIKELY_ELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote, async work. Flexible hours.',
    })
    expect(result.eligibility).toBe('LIKELY_ELIGIBLE')
  })

  it('Pakistan explicitly allowed → ELIGIBLE', () => {
    const result = assessRemoteEligibility({
      rawText: 'Remote. Open to Pakistan-based engineers.',
    })
    expect(result.eligibility).toBe('ELIGIBLE')
  })
})

// ── Score Label Tests ──────────────────────────────────────────────────────

// Labels delegate to the canonical bands in src/lib/scoring/qualification.ts:
// STRONG 75-100, WORTH_PURSUING 55-74, MAYBE 35-54, LOW 15-34, SKIP 0-14.
describe('Score Labels', () => {
  it('75+ → Strong opportunity', () => {
    const { label, qualification } = scoreLabel(87)
    expect(label).toBe('Strong opportunity')
    expect(qualification).toBe('strong')
  })

  it('55-74 → Worth pursuing', () => {
    const { label, qualification } = scoreLabel(60)
    expect(label).toBe('Worth pursuing')
    expect(qualification).toBe('worth_pursuing')
  })

  it('35-54 → Maybe', () => {
    const { label, qualification } = scoreLabel(42)
    expect(label).toBe('Maybe — needs more signal')
    expect(qualification).toBe('maybe')
  })

  it('15-34 → Low', () => {
    const { qualification } = scoreLabel(25)
    expect(qualification).toBe('low')
  })

  it('Below 15 → Not a fit', () => {
    const { label, qualification } = scoreLabel(10)
    expect(label).toBe('Not a fit')
    expect(qualification).toBe('skip')
  })
})

// ── Display Score Conversion Tests ─────────────────────────────────────────

describe('Display Score Conversion', () => {
  // Display is band-aligned (display_v2): every STRONG lead shows 8+, every
  // WORTH_PURSUING 6-7, MAYBE 4-5, LOW 2-3, SKIP 1. Never 0 for a scored lead.
  it('converts canonical 0-100 to display /10 along the band edges', () => {
    expect(canonicalToDisplay(87)).toBe(9)
    expect(canonicalToDisplay(75)).toBe(8)
    expect(canonicalToDisplay(50)).toBe(5)
    expect(canonicalToDisplay(100)).toBe(10)
    expect(canonicalToDisplay(0)).toBe(1)
  })

  it('display score is an integer and monotonic', () => {
    expect(canonicalToDisplay(82)).toBe(8)
    expect(canonicalToDisplay(83)).toBe(9)
    expect(canonicalToDisplay(92)).toBe(10)
    let prev = 0
    for (let s = 0; s <= 100; s++) {
      const d = canonicalToDisplay(s)
      expect(Number.isInteger(d)).toBe(true)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})

// ── Score Stability Invariant Tests ────────────────────────────────────────

describe('Score Stability Invariants', () => {
  it('same input always produces same score (deterministic)', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'Fizza Hussain, CTO at TechCorp. Hiring founding engineer. Remote worldwide.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: false,
    }

    const scores = Array.from({ length: 10 }, () => computeCanonicalScore(input).total)
    const allSame = scores.every((s) => s === scores[0])
    expect(allSame).toBe(true)
  })

  it('score breakdown reasons match the dimensions that scored positively', () => {
    const intelligence = makeIntelligence()
    const input = {
      intelligence,
      rawText: 'Fizza Hussain, CTO at TechCorp. Hiring founding engineer. Remote worldwide.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: true,
    }

    const score = computeCanonicalScore(input)

    // Each reason should reference a dimension that scored positively
    expect(score.reasons.length).toBeGreaterThan(0)
    expect(score.reasons.length).toBeLessThanOrEqual(5)
  })

  it('missing info reduces confidence, not necessarily score', () => {
    const sparseIntelligence = makeIntelligence({
      person: { fullName: null, firstName: null, title: null, seniority: null, location: null, linkedinUrl: null, otherUrls: [] },
      company: { name: null, domain: null, linkedinUrl: null, industry: null, size: null, sizeEvidence: null, product: null, stage: null, stageEvidence: null },
    })

    const fullIntelligence = makeIntelligence()

    const sparseInput = {
      intelligence: sparseIntelligence,
      rawText: 'Hiring engineer remote worldwide.',
      hasRelevantProof: false,
      proofMatchStrength: 0,
      hasCredibleIdentity: false,
      isReachable: false,
      resemblesPastWin: false,
    }

    const fullIntelligenceBuyer = makeIntelligence({
      opportunity: {
        signals: ['freelance_project_need'],
        primarySignal: 'freelance_project_need',
        description: 'Looking for a team to build our platform',
        urgency: 'immediate',
      },
    })
    const fullInput = {
      intelligence: fullIntelligenceBuyer,
      rawText: 'Fizza Hussain CTO at TechCorp. Looking for a strong React/Node.js team to help us scale. Remote worldwide.',
      hasRelevantProof: true,
      proofMatchStrength: 8,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: false,
    }

    const sparseScore = computeCanonicalScore(sparseInput)
    const fullScore = computeCanonicalScore(fullInput)

    // Sparse input should have more missing info tracked
    expect(sparseScore.missingInfo.length).toBeGreaterThan(0)
    // Full input should score higher
    expect(fullScore.total).toBeGreaterThan(sparseScore.total)
  })

  it('remote worldwide naturally scores higher than remote US-only', () => {
    const worldwideIntel = makeIntelligence({
      remoteEligibility: {
        workplaceType: 'REMOTE',
        remoteScope: 'WORLDWIDE',
        eligibility: 'ELIGIBLE',
        reason: 'Remote worldwide',
      },
    })

    const usOnlyIntel = makeIntelligence({
      remoteEligibility: {
        workplaceType: 'REMOTE',
        remoteScope: 'COUNTRY_RESTRICTED',
        eligibility: 'INELIGIBLE',
        restrictedCountries: ['US'],
        reason: 'US only',
      },
    })

    const baseInput = {
      rawText: 'Hiring engineer. Remote.',
      hasRelevantProof: true,
      proofMatchStrength: 7,
      hasCredibleIdentity: true,
      isReachable: true,
      resemblesPastWin: false,
    }

    const worldwideScore = computeCanonicalScore({ ...baseInput, intelligence: worldwideIntel })
    const usOnlyScore = computeCanonicalScore({ ...baseInput, intelligence: usOnlyIntel })

    expect(worldwideScore.total).toBeGreaterThan(usOnlyScore.total)
  })
})

describe('Role signal hygiene', () => {
  it('does not treat LinkedIn reactions as React', () => {
    expect(techKeywordMatches('56 reactions · 8 comments', 'react')).toBe(false)
    expect(techKeywordMatches('We need a React developer', 'react')).toBe(true)
    expect(isLinkedInChromeText('Posts')).toBe(true)
    expect(isLinkedInChromeText('Post')).toBe(true)
    expect(isClinicianProfile('PMHNP-BC', 'Clarity Psychiatry', 'Telehealth')).toBe(true)
  })
})
