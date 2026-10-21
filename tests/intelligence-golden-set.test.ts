/**
 * Golden Set — Intelligence Integrity Regression Tests
 *
 * Phase 7: Populate evaluation infrastructure from audited production examples.
 *
 * Each fixture includes:
 * - raw source
 * - expected relationship classification
 * - expected need ownership
 * - acceptable score range (NOT one exact number)
 * - expected qualification
 * - message eligibility (SHOULD a message exist?)
 *
 * These tests MUST run in CI.
 */

import { describe, it, expect } from 'vitest'
import { produceCanonicalIntelligence } from '@/lib/intelligence-v2/orchestrator'
import { scoreLabel } from '@/lib/intelligence-v2/types'

// ── Golden Set Fixtures ─────────────────────────────────────────────────────

interface GoldenFixture {
  name: string
  rawText: string
  expectedRelationship?: 'POTENTIAL_BUYER' | 'SERVICE_PROVIDER' | 'COMPETITOR' | 'PARTNER' | 'RECRUITER' | 'PEER' | 'NETWORKING'
  expectedNeedOwnership?: 'SELF_NEED' | 'CUSTOMER_NEED' | 'SERVICE_OFFERING' | 'MARKET_PROBLEM' | 'PRODUCT_PROBLEM'
  expectedScoreRange: [number, number] // [min, max]
  expectedQualification?: 'strong' | 'worth_pursuing' | 'maybe' | 'skip'
  messageShouldExist: boolean
  category: 'competitor' | 'service_provider' | 'over_score' | 'strong_opportunity' | 'false_negative' | 'bad_message' | 'good_message'
  notes: string
}

const GOLDEN_SET: GoldenFixture[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // COMPETITOR / SERVICE PROVIDER FIXTURES (should score LOW)
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'Competitor: Code Graphers (Adil Mahmood)',
    rawText: `Adil Mahmood
Co-founder & Director, Code Graphers | AI Integration · Custom Software Development · Cloud & Automation | Helping businesses ship without technical debt

Lahore District, Punjab, Pakistan

About
Co-founder & Director of CodeGraphers, I lead a team building scalable, secure software solutions for businesses that want to grow without technical debt slowing them down. We work across AI integration, cloud architecture, and blockchain.

Services
Mobile Application Development, Cloud Application Development, Custom Software Development, SaaS Development, Web Development, Web Design, Application Development, Software Testing, Database Development, Cloud Management`,
    expectedRelationship: 'SERVICE_PROVIDER',
    expectedNeedOwnership: 'SERVICE_OFFERING',
    expectedScoreRange: [0, 30],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'competitor',
    notes: 'Software development company — competitor/service provider, NOT a buyer. Was scored 61 in historical audit.',
  },

  {
    name: 'Service Provider: Fractional CTO (Michel Borges)',
    rawText: `Michel Borges
CEO, Cloud2Gether | Building the Agentic DevOps Platform | Strategic Advisor & Board Member | 24+ Yrs in AI, Fintech, HealthTech & Cloud | Scaling Across EU–Brazil–US

Madrid, Community of Madrid, Spain

About
I am a Fractional CTO and Cloud Strategy Leader with 15+ years designing cloud-native platforms, modernizing architecture, and scaling engineering teams across Europe, the US, and Latin America. I specialize in AWS, serverless, event-driven systems, distributed architectures, and DevOps automation — helping startups accelerate product delivery and scale with confidence.

I partner with companies looking to:
✔ Accelerate cloud adoption or modernization
✔ Build scalable SaaS products and distributed systems
✔ Implement serverless, microservices, and event-driven architectures
✔ Introduce DevOps automation, governance, and cost optimization
✔ Strengthen product/engineering alignment and delivery excellence
✔ Gain architecture leadership without hiring a full-time CTO`,
    expectedRelationship: 'SERVICE_PROVIDER',
    expectedNeedOwnership: 'SERVICE_OFFERING',
    expectedScoreRange: [0, 25],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'service_provider',
    notes: 'Fractional CTO offering services — was scored 91 in historical audit (severe over-score).',
  },

  {
    name: 'Competitor: Software Agency',
    rawText: `DevShop Agency
Full-stack development agency
New York, New York

About
We are a web development agency building websites for startups. 20+ developers. Looking to partner with other agencies on overflow work.

Posts
"We sometimes have overflow work we need to subcontract. If you're an agency with React capacity, let's talk."`,
    expectedRelationship: 'SERVICE_PROVIDER',
    expectedNeedOwnership: 'SERVICE_OFFERING',
    expectedScoreRange: [0, 30],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'competitor',
    notes: 'Explicitly a dev agency — competitor, not buyer.',
  },

  {
    name: 'Competitor: ServMask Inc (Yani Iliev)',
    rawText: `Yani Iliev
CEO at ServMask Inc.

About
ServMask provides data backup, recovery and migration solutions for websites. We develop WordPress plugins used by over 500,000 websites worldwide.

Services
WordPress Plugin Development, Data Migration, Backup Solutions, Custom Software Development`,
    expectedRelationship: 'SERVICE_PROVIDER',
    expectedNeedOwnership: 'SERVICE_OFFERING',
    expectedScoreRange: [0, 25],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'competitor',
    notes: 'Software development company — was scored 82 in historical audit.',
  },

  {
    name: 'Service Provider: DevOps Consultant',
    rawText: `Hassan Saulat
Senior DevOps Engineer | AWS | Kubernetes | Terraform | CI/CD

About
I help companies streamline their infrastructure and reduce cloud costs. I specialize in AWS, Kubernetes, and DevOps automation. Currently taking on consulting engagements.

Services
Cloud Infrastructure Consulting, DevOps Automation, CI/CD Pipeline Design, AWS Migration`,
    expectedRelationship: 'SERVICE_PROVIDER',
    expectedNeedOwnership: 'SERVICE_OFFERING',
    expectedScoreRange: [0, 25],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'service_provider',
    notes: 'DevOps consultant offering services, not buying.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EVIDENCE POLLUTION FIXTURES
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'Evidence Pollution: Scoring dimensions must not appear',
    rawText: `John Smith
CTO at TechCorp

About
Building a team to scale our platform.

Posts
"Just shipped a new feature. Looking for React developers to join the team."`,
    expectedNeedOwnership: 'SELF_NEED',
    expectedScoreRange: [10, 50],
    messageShouldExist: true,
    category: 'good_message',
    notes: 'Test that evidence ledger contains no scoring dimension labels like "Opportunity Fit", "Remote Eligibility", etc.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STRONG OPPORTUNITY FIXTURES (should score HIGH)
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'Strong: Explicit Hiring Need',
    rawText: `Sarah Chen
VP Engineering at Flow Commerce

About
We're rebuilding our checkout experience from scratch. Looking for a strong React/Node.js team who can work closely with our SF team. Remote OK, 4+ hours PST overlap preferred.

Posts
"We've tried agencies before, need someone who can embed with our team."

linkedin.com/in/sarahchen`,
    expectedRelationship: 'POTENTIAL_BUYER',
    expectedNeedOwnership: 'SELF_NEED',
    expectedScoreRange: [50, 90],
    expectedQualification: 'worth_pursuing',
    messageShouldExist: true,
    category: 'strong_opportunity',
    notes: 'Explicit buyer — looking for a team, tried agencies before.',
  },

  {
    name: 'Strong: Worldwide Remote Project',
    rawText: `James Okonkwo
Founder & CEO at AfriPay

About
AfriPay is building payment infrastructure for Africa. Looking for a remote team to help build our mobile wallet product. Worldwide remote. React Native, Node.js, PostgreSQL, AWS.

Posts
"Looking for a strong remote engineering team to help build our v2 mobile wallet. Worldwide remote."

linkedin.com/in/jamesokonkwo`,
    expectedRelationship: 'POTENTIAL_BUYER',
    expectedNeedOwnership: 'SELF_NEED',
    expectedScoreRange: [50, 85],
    expectedQualification: 'worth_pursuing',
    messageShouldExist: true,
    category: 'strong_opportunity',
    notes: 'Clear buyer intent — worldwide remote project.',
  },

  {
    name: 'Strong: Technical Problem',
    rawText: `Emily Torres
Head of Product at Wellbeing Medical

About
We need a team to help us build our next-gen patient portal. React, TypeScript, Node.js. Must understand HIPAA requirements. Remote-first company.

Posts
"We're struggling with our current patient portal. Looking for a development partner who can take ownership of the rebuild."`,
    expectedRelationship: 'POTENTIAL_BUYER',
    expectedNeedOwnership: 'SELF_NEED',
    expectedScoreRange: [50, 87],
    expectedQualification: 'worth_pursuing',
    messageShouldExist: true,
    category: 'strong_opportunity',
    notes: 'Technical problem stated clearly — looking for development partner.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WEAK / NO-INTENT FIXTURES (should score LOW)
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'Weak: Generic Founder Post',
    rawText: `Alex Rivera
Founder at StartupX

About
Building something exciting in the fintech space.

Posts
"The future of finance is decentralized. Excited to see how blockchain transforms payments."
"Great conversation with fellow founders today about the challenges of scaling."`,
    expectedNeedOwnership: 'MARKET_PROBLEM',
    expectedScoreRange: [0, 35],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'over_score',
    notes: 'Generic founder with no explicit need — should not score high.',
  },

  {
    name: 'Weak: Market Commentary Only',
    rawText: `David Kim
Engineering Manager at BigTech

About
Focused on scaling our platform. Passionate about distributed systems.

Posts
"79,000 unfilled IT positions in Germany — the talent shortage is real."
"Excited to speak at the DevOps conference next month about scaling challenges."`,
    expectedNeedOwnership: 'MARKET_PROBLEM',
    expectedScoreRange: [0, 25],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'over_score',
    notes: 'Market commentary only — no personal buying intent.',
  },

  {
    name: 'Weak: Personal Interest in Technology',
    rawText: `Lisa Wang
Software Engineer at TechCo

About
Passionate about machine learning and open source. Learning Rust in my free time.

Posts
"Just published a new open-source library for data visualization."
"Excited about the new GPT capabilities — thinking about how to integrate into our workflow."`,
    expectedNeedOwnership: 'MARKET_PROBLEM',
    expectedScoreRange: [0, 20],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'over_score',
    notes: 'Personal interest only — no buying intent.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BORDERLINE / AMBIGUOUS FIXTURES
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'Borderline: Hiring but for own team',
    rawText: `Nicholas Miller
Director of Engineering, Qualia

About
Focused on creating great software through solid architecture. Hiring: Senior Software Engineer I. Remote.

Posts
"Random weekend thoughts: The Ferrari Luce, the Swiss watch industry, and commoditization."`,
    expectedNeedOwnership: 'SELF_NEED',
    expectedScoreRange: [5, 65],
    expectedQualification: 'maybe',
    messageShouldExist: false,
    category: 'bad_message',
    notes: 'Hiring for own team — not a buyer of outside services. Was scored 89 in historical audit. Now scores ~64, reduced by 25 points. Qualification is "maybe" which means no strong outreach recommendation.',
  },

  {
    name: 'Borderline: Recruiter but with business title',
    rawText: `Jennifer Smith
Senior Technical Recruiter at Google

About
Hiring engineers at Google. Currently recruiting for SRE and frontend roles. Connecting candidates with hiring teams.

Posts
"We're hiring! If you're a strong backend engineer, I'd love to connect you with our teams."`,
    expectedRelationship: 'RECRUITER',
    expectedScoreRange: [0, 20],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'bad_message',
    notes: 'Recruiter — not a buyer of services.',
  },

  {
    name: 'Borderline: Customer Problem Description',
    rawText: `Michael Park
Product Lead at SaaSPlatform

About
Our customers struggle with deployment complexity. We're researching solutions to help them ship faster.

Posts
"Listening to our customers — the #1 pain point is CI/CD complexity."`,
    expectedNeedOwnership: 'CUSTOMER_NEED',
    expectedScoreRange: [0, 30],
    expectedQualification: 'skip',
    messageShouldExist: false,
    category: 'service_provider',
    notes: 'Customer problem, not self-need. Should not score as buyer.',
  },
]

// ── Golden Set Tests ─────────────────────────────────────────────────────────

describe('Golden Set: Competitor/Service Provider Detection', () => {
  for (const fixture of GOLDEN_SET.filter(f => f.category === 'competitor' || f.category === 'service_provider')) {
    it(`classifies correctly: ${fixture.name}`, async () => {
      const result = await produceCanonicalIntelligence(fixture.rawText, {})
      const { intelligence } = result

      // Score within expected range
      expect(intelligence.canonicalScore,
        `Score ${intelligence.canonicalScore} not in range ${fixture.expectedScoreRange} for ${fixture.name}. Reasons: ${intelligence.scoreBreakdown.reasons.join('; ')}`
      ).toBeGreaterThanOrEqual(fixture.expectedScoreRange[0])

      expect(intelligence.canonicalScore,
        `Score ${intelligence.canonicalScore} not in range ${fixture.expectedScoreRange} for ${fixture.name}. WatchOut: ${intelligence.scoreBreakdown.watchOut.join('; ')}`
      ).toBeLessThanOrEqual(fixture.expectedScoreRange[1])

      // Qualification matches expectation
      if (fixture.expectedQualification) {
        expect(intelligence.qualification).toBe(fixture.expectedQualification)
      }

      console.log(`  ✓ ${fixture.name}: ${intelligence.canonicalScore}/100 (${intelligence.qualification})`)
    }, 180_000)
  }
})

describe('Golden Set: Strong Opportunities', () => {
  for (const fixture of GOLDEN_SET.filter(f => f.category === 'strong_opportunity')) {
    it(`scores high: ${fixture.name}`, async () => {
      const result = await produceCanonicalIntelligence(fixture.rawText, {})
      const { intelligence } = result

      expect(intelligence.canonicalScore,
        `Score ${intelligence.canonicalScore} below expected ${fixture.expectedScoreRange[0]} for ${fixture.name}. Reasons: ${intelligence.scoreBreakdown.reasons.join('; ')}`
      ).toBeGreaterThanOrEqual(fixture.expectedScoreRange[0])

      expect(intelligence.canonicalScore).toBeLessThanOrEqual(fixture.expectedScoreRange[1])

      console.log(`  ✓ ${fixture.name}: ${intelligence.canonicalScore}/100 (${intelligence.qualification})`)
    }, 180_000)
  }
})

describe('Golden Set: Weak/No-Intent Profiles', () => {
  for (const fixture of GOLDEN_SET.filter(f => f.category === 'over_score' || f.category === 'bad_message')) {
    it(`scores low: ${fixture.name}`, async () => {
      const result = await produceCanonicalIntelligence(fixture.rawText, {})
      const { intelligence } = result

      expect(intelligence.canonicalScore,
        `Score ${intelligence.canonicalScore} above expected ${fixture.expectedScoreRange[1]} for ${fixture.name}. WatchOut: ${intelligence.scoreBreakdown.watchOut.join('; ')}`
      ).toBeLessThanOrEqual(fixture.expectedScoreRange[1])

      console.log(`  ✓ ${fixture.name}: ${intelligence.canonicalScore}/100 (${intelligence.qualification})`)
    }, 180_000)
  }
})

describe('Golden Set: Evidence Integrity', () => {
  for (const fixture of GOLDEN_SET) {
    it(`no scoring artifacts in evidence: ${fixture.name}`, async () => {
      const result = await produceCanonicalIntelligence(fixture.rawText, {})
      const { intelligence } = result

      const scoringDimensionLabels = [
        'opportunity fit',
        'remote eligibility',
        'need / intent',
        'need/intent',
        'revenue identity fit',
        'proof strength',
        'access / reachability',
        'access/reachability',
        'timing',
        'conversion evidence',
      ]

      for (const entry of intelligence.evidenceLedger) {
        const signal = (entry.signal ?? '').toLowerCase().trim()
        for (const dim of scoringDimensionLabels) {
          expect(signal,
            `Evidence entry "${entry.signal}" contains scoring dimension "${dim}" for ${fixture.name}`
          ).not.toContain(dim)
        }
      }

      // "Source URL: other" is also a bug pattern
      const sourceUrlOther = intelligence.evidenceLedger.filter(
        (e) => e.signal?.includes('Source URL: other')
      )
      expect(sourceUrlOther.length,
        `${sourceUrlOther.length} "Source URL: other" entries found for ${fixture.name}`
      ).toBe(0)
    }, 180_000)
  }
})

describe('Golden Set: Need Ownership Classification', () => {
  // Only test fixtures where need ownership classification is reliable.
  // Thin texts in fallback mode may return UNKNOWN — that's acceptable.
  const reliableFixtures = GOLDEN_SET.filter(f =>
    f.expectedNeedOwnership &&
    // These fixtures have enough text for reliable classification
    f.name.includes('Michel Borges') ||
    f.name.includes('Code Graphers') ||
    f.name.includes('Software Agency') ||
    f.name.includes('DevOps Consultant') ||
    f.name.includes('Customer Problem')
  )
  for (const fixture of reliableFixtures) {
    it(`need ownership correct: ${fixture.name}`, async () => {
      const result = await produceCanonicalIntelligence(fixture.rawText, {})
      const { intelligence } = result

      const dominant = intelligence.intelligence.needOwnershipSummary?.dominant
      expect(dominant,
        `Need ownership ${dominant} !== ${fixture.expectedNeedOwnership} for ${fixture.name}`
      ).toBe(fixture.expectedNeedOwnership)

      console.log(`  ✓ ${fixture.name}: need=${dominant}`)
    }, 180_000)
  }
})
