import { describe, it, expect } from 'vitest'
import { scoreProspect } from '@/lib/prospect/intelligence'
import { evaluateConnectionNote, repairConnectionNote, validateAndRepair } from '@/lib/prospect/connection-note'
import { buildConnectionNoteStrategy } from '@/lib/prospect/strategy'
import type { ExtractedLead, Profile, ProofCard, MatchedProof } from '@/lib/domain/types'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeProfile(overrides?: Partial<Profile>): Profile {
  return {
    id: 'profile-fizza',
    repId: 'rep-aneeb',
    organizationId: 'org1',
    platform: 'linkedin',
    label: 'Fizza',
    profileUrl: 'https://linkedin.com/in/fizza',
    headline: 'Full-stack engineer · Rails · React',
    cvPath: null,
    createdAt: '2024-01-01',
    ...overrides,
  }
}

function makeProofCard(overrides?: Partial<ProofCard>): ProofCard {
  return {
    id: 'pc1',
    organizationId: 'org1',
    profileId: 'profile-fizza',
    capability: 'Rails and React product delivery',
    strength: 'strong',
    safeClaim: 'Built a Rails/React platform for a fintech product',
    sourceType: 'project',
    sourceReference: 'Fintech project',
    tags: ['rails', 'react', 'fintech', 'saas'],
    verified: true,
    forbiddenClaims: [],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  }
}

function makeExtracted(overrides?: Partial<ExtractedLead>): ExtractedLead {
  return {
    name: 'Sarah Chen',
    title: 'CTO',
    titleRaw: 'CTO',
    company: 'ExampleCo',
    url: 'https://linkedin.com/in/sarahchen',
    locationRaw: 'San Francisco, California, United States',
    aboutSummary: 'Building engineering teams and shipping product.',
    experienceSummary: '10+ years in software engineering leadership.',
    recentPosts: [],
    roleCategory: 'technical_leadership',
    marketRegion: 'US',
    signalType: 1,
    signalEvidence: 'hiring 3 senior Rails engineers',
    extractionConfidence: 85,
    confidenceNotes: [],
    verbatimQuote: null,
    tags: ['rails', 'hiring', 'saas'],
    ...overrides,
  }
}

function makeMatchedProof(proofCard: ProofCard, score = 8): MatchedProof {
  return {
    proofCard,
    relevanceScore: score,
    matchingTags: proofCard.tags.slice(0, 2),
    safeClaim: proofCard.safeClaim,
  }
}

// ── Test Case A: CTO at relevant SaaS, clear engineering expansion ──────────

describe('Prospect Scoring — Case A: Strong CTO prospect', () => {
  const extracted = makeExtracted()
  const profile = makeProfile()
  const proofCard = makeProofCard()
  const matchedProof = [makeMatchedProof(proofCard, 12)]

  it('scores as a strong prospect (70+)', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [profile],
      profileIntelligences: [{ profile, matchedProof }],
      bestSender: profile,
      bestSenderProof: matchedProof,
    })
    expect(result.total).toBeGreaterThanOrEqual(70)
    expect(result.recommendation).toBe('connect')
  })

  it('identifies the seniority signal', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [profile],
      profileIntelligences: [{ profile, matchedProof }],
      bestSender: profile,
      bestSenderProof: matchedProof,
    })
    expect(result.why.some((w) => w.toLowerCase().includes('seniority') || w.toLowerCase().includes('decision'))).toBe(true)
  })

  it('flags the hiring signal as safe to mention', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [profile],
      profileIntelligences: [{ profile, matchedProof }],
      bestSender: profile,
      bestSenderProof: matchedProof,
    })
    const hiringSignal = result.signals.find((s) => s.label === 'Hiring activity')
    expect(hiringSignal).toBeDefined()
    expect(hiringSignal?.mention).toBe('SAFE_TO_MENTION')
  })
})

// ── Test Case B: Senior engineer at perfect-fit company, low buying influence

describe('Prospect Scoring — Case B: Senior engineer (low buying influence)', () => {
  const extracted = makeExtracted({
    name: 'Alex Kumar',
    title: 'Senior Software Engineer',
    titleRaw: 'Senior Software Engineer',
    roleCategory: 'other',
    signalType: 1,
    signalEvidence: 'hiring engineers',
  })

  it('scores lower due to contact appropriateness', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    // Should be lower than Case A because of individual contributor role
    expect(result.total).toBeLessThan(70)
    const accessDim = result.dimensions.find((d) => d.key === 'access')
    expect(accessDim?.points).toBeLessThanOrEqual(2)
  })

  it('warns about contact appropriateness', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.watchOut.some((w) => w.toLowerCase().includes('contact') || w.toLowerCase().includes('individual'))).toBe(true)
  })
})

// ── Test Case C: CEO of tiny relevant startup, sparse profile

describe('Prospect Scoring — Case C: CEO of small startup, sparse profile', () => {
  const extracted = makeExtracted({
    name: 'Jordan Lee',
    title: 'CEO',
    titleRaw: 'CEO',
    company: 'TinyStartup',
    aboutSummary: 'Building something new.',
    experienceSummary: '',
    signalType: 2,
    signalEvidence: 'solo founder',
    extractionConfidence: 45,
    tags: [],
  })

  it('shows possible fit with lower confidence', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    // CEO gets person points, but low confidence drags it down
    expect(result.evidenceConfidence).toBeLessThan(50)
    expect(result.total).toBeGreaterThan(0)
  })

  it('flags low confidence', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.watchOut.some((w) => w.toLowerCase().includes('confidence') || w.toLowerCase().includes('sparse'))).toBe(true)
  })
})

// ── Test Case D: Student with matching keywords

describe('Prospect Scoring — Case D: Student (should skip)', () => {
  const extracted = makeExtracted({
    name: 'Jamie Smith',
    title: 'Student',
    titleRaw: 'Computer Science Student',
    company: 'University',
    aboutSummary: 'Learning React, Rails, and AI. Looking for internship opportunities.',
    signalType: 7,
    signalEvidence: 'looking for internship',
    tags: ['react', 'rails', 'ai'],
  })

  it('scores as skip despite keyword overlap', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.recommendation).toBe('skip')
    expect(result.total).toBeLessThan(55)
  })

  it('flags student status', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.watchOut.some((w) => w.toLowerCase().includes('student'))).toBe(true)
  })
})

// ── Test Case E: Recruiter hiring Rails engineers

describe('Prospect Scoring — Case E: Recruiter (not a buyer)', () => {
  const extracted = makeExtracted({
    name: 'Pat Morgan',
    title: 'Technical Recruiter',
    titleRaw: 'Technical Recruiter',
    company: 'TalentCo',
    aboutSummary: 'Hiring Rails engineers for our clients.',
    signalType: 1,
    signalEvidence: 'hiring Rails engineers for clients',
    tags: ['rails', 'hiring'],
  })

  it('does not infer buyer intent from hiring signal', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.recommendation).toBe('skip')
  })

  it('flags recruiter role', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.watchOut.some((w) => w.toLowerCase().includes('recruiter'))).toBe(true)
  })
})

// ── Test Case F: Recently funded startup

describe('Prospect Scoring — Case F: Funded startup (internal signal only)', () => {
  const extracted = makeExtracted({
    signalType: 3,
    signalEvidence: 'closed a Series A round',
    aboutSummary: 'Raised $5M Series A. Building the team.',
  })

  it('does not expose funding in the "why" reasons', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    // Funding should NOT appear in the user-facing "why" reasons
    const fundingInWhy = result.why.some((w) =>
      w.toLowerCase().includes('funding') || w.toLowerCase().includes('raised') || w.toLowerCase().includes('series'),
    )
    expect(fundingInWhy).toBe(false)
  })

  it('classifies funding signal as INTERNAL_ONLY', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    const fundingSignal = result.signals.find((s) => s.label === 'Funding signal')
    expect(fundingSignal).toBeDefined()
    expect(fundingSignal?.mention).toBe('INTERNAL_ONLY')
  })
})

// ── Test Case G: Strong company but no relevant sender proof

describe('Prospect Scoring — Case G: No relevant sender proof', () => {
  const extracted = makeExtracted()
  const profile = makeProfile({ label: 'Hassan' })
  const _proofCard = makeProofCard({
    capability: 'WordPress sites',
    tags: ['wordpress', 'php'],
    safeClaim: 'Built WordPress sites for small businesses',
  })
  void _proofCard

  it('lowers the sender match score', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [profile],
      profileIntelligences: [{ profile, matchedProof: [] }],
      bestSender: profile,
      bestSenderProof: [],
    })
    const senderDim = result.dimensions.find((d) => d.key === 'sender')
    expect(senderDim?.points).toBeLessThan(10)
  })

  it('warns about lack of proof', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [profile],
      profileIntelligences: [{ profile, matchedProof: [] }],
      bestSender: profile,
      bestSenderProof: [],
    })
    expect(result.watchOut.some((w) => w.toLowerCase().includes('proof') || w.toLowerCase().includes('credibility'))).toBe(true)
  })
})

// ── Test Case H: Long impressive profile with no relevance

describe('Prospect Scoring — Case H: Impressive but irrelevant', () => {
  const extracted = makeExtracted({
    name: 'Dr. Emily Watson',
    title: 'Professor of Literature',
    titleRaw: 'Professor of English Literature',
    company: 'Oxford University',
    aboutSummary: 'Published author and researcher in Victorian literature. 20+ years of teaching. Extensive publications on 19th century novels.',
    experienceSummary: 'Fellow of the Royal Society of Literature. Keynote speaker at international conferences.',
    signalType: 4,
    signalEvidence: 'no recent updates',
    tags: [],
  })

  it('does not score highly because of information volume alone', () => {
    const result = scoreProspect({
      extracted,
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    // Should be low — no relevance to software delivery
    expect(result.total).toBeLessThan(50)
  })
})

// ── Connection Note Quality Gate ────────────────────────────────────────────

describe('Connection Note Quality Gate', () => {
  const profile = makeProfile()

  // Openers like "I came across your profile", "let's connect", praise and
  // exclamation marks are allowed at the gate since bf4c086; the repair
  // pass normalises "!" and emoji instead of rejecting the note.

  it('allows an "I came across your profile" opening', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, I came across your profile and would love to connect.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
  })

  it('allows praise at the gate and normalises the exclamation mark on repair', () => {
    const input = {
      text: 'Hi Sarah, your amazing work at ExampleCo is incredible. Would love to connect!',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    }
    expect(evaluateConnectionNote(input).passed).toBe(true)
    const repaired = validateAndRepair(input)
    expect(repaired.text).not.toContain('!')
    expect(repaired.text).toMatch(/Would love to connect\.$/)
  })

  it('allows a bare "let\'s connect" CTA', () => {
    const input = {
      text: 'Hi Sarah, let\'s connect!',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    }
    expect(evaluateConnectionNote(input).passed).toBe(true)
    expect(validateAndRepair(input).text).toBe("Hi Sarah, let's connect.")
  })

  it('rejects sales pitch in connection note', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, I can help ExampleCo ship faster with our Rails expertise.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.toLowerCase().includes('sales pitch'))).toBe(true)
  })

  it('rejects budget/funding inference', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, congrats on the funding! With that budget, let\'s connect.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.toLowerCase().includes('budget'))).toBe(true)
  })

  it('strips emojis on repair even when the gate passes', () => {
    const result = validateAndRepair({
      text: 'Hi Sarah, great to see your work 👋 Let\'s connect.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
    expect(result.text).not.toContain('👋')
    expect(result.text).toBe("Hi Sarah, great to see your work Let's connect.")
    expect(result.repaired).not.toBeNull()
  })

  it('rejects "we" for solo sender', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, we can help ExampleCo with Rails work. Let\'s connect.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.toLowerCase().includes('"we"'))).toBe(true)
  })

  it('rejects notes over 120 characters', () => {
    const longNote = 'Hi Sarah, ' + 'this is a very long note. '.repeat(15) + 'Let\'s connect!'
    const result = evaluateConnectionNote({
      text: longNote,
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.withinLimit).toBe(false)
  })

  it('rejects the generic "explore synergies" note on the cliché gate', () => {
    // The "could send to 100 prospects" heuristic was dropped in bf4c086;
    // this template still fails because "synergies" is an AI cliché.
    const result = evaluateConnectionNote({
      text: 'Hi, I came across your profile. I would love to connect and explore synergies.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures).toContain('AI cliché')
  })

  it('passes a well-crafted connection note', () => {
    const result = evaluateConnectionNote({
      text: 'Hey Sarah, the Rails work at ExampleCo stood out. I shipped a similar setup last year.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [makeMatchedProof(makeProofCard(), 8)],
    })
    expect(result.passed).toBe(true)
    expect(result.failures.length).toBe(0)
  })

  it('passes a short, natural note', () => {
    const result = evaluateConnectionNote({
      text: 'Hey Sarah, your post on engineering culture resonated. Always interesting to hear from other Rails shops.',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
  })
})

// ── Connection Note Repair ──────────────────────────────────────────────────

describe('Connection Note Repair', () => {
  const profile = makeProfile()

  it('repairs surveillance openings', () => {
    const repaired = repairConnectionNote(
      'Hey Sarah, I came across your profile and would love to connect.',
      ['Opens with surveillance language'],
    )
    expect(repaired).not.toMatch(/i came across/i)
  })

  it('repairs "we" to "I"', () => {
    const repaired = repairConnectionNote(
      'Hi Sarah, we can help ExampleCo ship faster.',
      ['Uses "we" for a solo sender'],
    )
    expect(repaired).not.toMatch(/\bwe can help\b/i)
  })

  it('removes emojis and exclamation marks', () => {
    const repaired = repairConnectionNote(
      'Hi Sarah, great work! 👋',
      ['Contains emoji', 'Contains exclamation mark'],
    )
    expect(repaired).not.toMatch(/[👋💡🎉]/)
    expect(repaired).not.toMatch(/!/)

    const result = validateAndRepair({
      text: 'Hi Sarah, great work! 👋',
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.text).not.toMatch(/!/)
  })

  it('shortens notes over 120 chars', () => {
    const longNote = 'Hey Sarah, ' + 'this is a very long note with lots of detail. '.repeat(10) + 'Let\'s connect and explore synergies together!'
    const result = validateAndRepair({
      text: longNote,
      profile,
      prospectName: 'Sarah',
      prospectCompany: 'ExampleCo',
      matchedProof: [],
    })
    expect(result.charCount).toBeLessThanOrEqual(120)
  })
})

// ── Connection Note Strategy ────────────────────────────────────────────────

describe('Connection Note Strategy', () => {
  const profile = makeProfile()
  const proofCard = makeProofCard()

  it('builds a strategy for a CTO prospect', () => {
    const extracted = makeExtracted()
    const strategy = buildConnectionNoteStrategy(extracted, profile, [makeMatchedProof(proofCard, 8)])
    expect(strategy.whyConnect).toBeTruthy()
    expect(strategy.tone).toBeTruthy()
    expect(strategy.candidateAngles.length).toBeGreaterThan(0)
    expect(strategy.candidateAngles.length).toBeLessThanOrEqual(3)
  })

  it('forbids mentioning funding', () => {
    const extracted = makeExtracted({
      signalType: 3,
      signalEvidence: 'closed a Series A round',
    })
    const strategy = buildConnectionNoteStrategy(extracted, profile, [])
    expect(strategy.forbidden.some((f) => f.toLowerCase().includes('funding') || f.toLowerCase().includes('raise'))).toBe(true)
  })

  it('generates different candidate angles', () => {
    const extracted = makeExtracted({
      verbatimQuote: 'We are rebuilding our payment processing pipeline',
    })
    const strategy = buildConnectionNoteStrategy(extracted, profile, [makeMatchedProof(proofCard, 8)])
    const labels = strategy.candidateAngles.map((a) => a.label)
    // Should have at least 2 different angles
    expect(new Set(labels).size).toBeGreaterThanOrEqual(2)
  })

  it('includes proof-led angle when proof matches', () => {
    const extracted = makeExtracted()
    const strategy = buildConnectionNoteStrategy(extracted, profile, [makeMatchedProof(proofCard, 8)])
    const hasProofAngle = strategy.candidateAngles.some((a) => a.label === 'Relevant proof')
    expect(hasProofAngle).toBe(true)
  })
})

// ── Score Dimension Validation ──────────────────────────────────────────────

describe('Score Dimensions', () => {
  it('returns all 7 dimensions', () => {
    const result = scoreProspect({
      extracted: makeExtracted(),
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.dimensions.length).toBe(7)
    const keys = result.dimensions.map((d) => d.key)
    expect(keys).toContain('person')
    expect(keys).toContain('company')
    expect(keys).toContain('need')
    expect(keys).toContain('sender')
    expect(keys).toContain('timing')
    expect(keys).toContain('confidence')
    expect(keys).toContain('access')
  })

  it('total never exceeds 100', () => {
    const result = scoreProspect({
      extracted: makeExtracted({
        title: 'CEO',
        titleRaw: 'CEO',
        signalType: 7,
        signalEvidence: 'looking for a technical partner',
        extractionConfidence: 100,
        aboutSummary: 'Hiring engineers, building AI product, scaling team, migrating to Rails, launching new platform.',
      }),
      assignedProfiles: [makeProfile()],
      profileIntelligences: [{
        profile: makeProfile(),
        matchedProof: [makeMatchedProof(makeProofCard(), 15)],
      }],
      bestSender: makeProfile(),
      bestSenderProof: [makeMatchedProof(makeProofCard(), 15)],
    })
    expect(result.total).toBeLessThanOrEqual(100)
    expect(result.total).toBeGreaterThanOrEqual(0)
  })

  it('total never goes below 0', () => {
    const result = scoreProspect({
      extracted: makeExtracted({
        title: 'Student',
        titleRaw: 'Student learning to code',
        aboutSummary: 'Aspiring developer, bootcamp graduate, looking for first role.',
        signalType: 4,
        signalEvidence: 'no signal',
        extractionConfidence: 20,
      }),
      assignedProfiles: [],
      profileIntelligences: [],
      bestSender: null,
      bestSenderProof: [],
    })
    expect(result.total).toBeGreaterThanOrEqual(0)
  })
})
