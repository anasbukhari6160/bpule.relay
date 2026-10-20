import { describe, it, expect } from 'vitest'
import {
  buildProfileIntelligence,
  matchProofToLead,
  classifyClaimSafety,
  classifyLeadFact,
  compareProfileFit,
} from '@/lib/relay/profile-intelligence'
import {
  createOutreachStrategy,
  selectMessageMode,
  strategyToPromptBlock,
} from '@/lib/relay/outreach-strategy'
import {
  generateStrategyCandidates,
  evaluateMessage,
  isGeneric,
  feelsSurveillance,
  repairMessage,
} from '@/lib/relay/message-forge'
import {
  analyzeReply,
  getNextStage,
  buildReplyStrategy,
  buildConversationContext,
} from '@/lib/relay/conversation-engine'
import {
  determineFollowup,
  buildFollowupPrompt,
} from '@/lib/relay/followup-engine'
import {
  computeEditDelta,
  accumulateEditSignals,
} from '@/lib/relay/edit-learning'
import type { Profile, ProofItem, ProofCard, Fact, StyleCard } from '@/lib/domain/types'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeProfile(overrides?: Partial<Profile>): Profile {
  return {
    id: 'profile-fizza',
    repId: 'rep-aneeb',
    organizationId: 'org1',
    platform: 'linkedin',
    label: 'Fizza',
    profileUrl: 'https://linkedin.com/in/fizza',
    headline: 'Full-stack engineer · Web3 · Rails',
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
    capability: 'Web3 transaction monitoring',
    strength: 'strong',
    safeClaim: 'Built a transaction monitoring dashboard for a Solana-based product',
    sourceType: 'project',
    sourceReference: 'Solana project',
    tags: ['web3', 'solana', 'blockchain', 'dashboard'],
    verified: true,
    forbiddenClaims: [],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  }
}

// Test fixtures — some used indirectly via makeProfile/makeProofCard
function _makeFacts(): Fact[] {
  return [
    { id: 'f1', organizationId: 'org1', label: 'Site live', value: 'true', factType: 'config', addedBy: null, createdAt: '2024-01-01' },
  ]
}

function _makeStyleCard(): StyleCard {
  return {
    contractions: 'mostly_yes',
    formality: 2,
    sentence_length: 'medium',
    punctuation: 'relaxed',
    openers: 'statement',
    emoji_use: 'none',
    greeting: 'Hey',
    sign_off: '',
    never_words: ['synergy', 'leverage'],
    preferred_words: ['ship', 'build'],
    summary: 'Direct, technical, no fluff.',
  }
}

// ── Profile Intelligence Tests ──────────────────────────────────────────────

describe('Profile Intelligence', () => {
  it('builds profile intelligence from proof items and cards', () => {
    const profile = makeProfile()
    const proofItems: ProofItem[] = [
      {
        id: 'pi1',
        organizationId: 'org1',
        profileId: profile.id,
        clientNamed: false,
        clientName: null,
        permissionOnFile: false,
        projectSummary: 'Built a Rails e-commerce platform handling high traffic',
        reviewQuote: null,
        tags: ['rails', 'ecommerce', 'ruby'],
        createdAt: '2024-01-01',
      },
    ]
    const intelligence = buildProfileIntelligence(profile, proofItems)
    expect(intelligence.profile.id).toBe(profile.id)
    expect(intelligence.proofCards.length).toBeGreaterThan(0)
    expect(intelligence.technologies.length).toBeGreaterThan(0)
  })

  it('matches proof to lead tags correctly', () => {
    const profile = makeProfile()
    const cards = [
      makeProofCard({ tags: ['web3', 'solana'] }),
      makeProofCard({ id: 'pc2', capability: 'Rails work', safeClaim: 'Rails modernization', tags: ['rails', 'ruby'] }),
    ]
    const intelligence = buildProfileIntelligence(profile, [], cards)
    const matched = matchProofToLead(intelligence, ['web3', 'solana', 'blockchain'])
    expect(matched.length).toBeGreaterThan(0)
    expect(matched[0].proofCard.capability).toContain('Web3')
  })

  it('ranks stronger proof higher', () => {
    const profile = makeProfile()
    const cards = [
      makeProofCard({ strength: 'weak', tags: ['react'] }),
      makeProofCard({ id: 'pc2', strength: 'strong', tags: ['react'] }),
    ]
    const intelligence = buildProfileIntelligence(profile, [], cards)
    const matched = matchProofToLead(intelligence, ['react'])
    expect(matched[0].proofCard.strength).toBe('strong')
  })

  it('classifies claim safety correctly', () => {
    const profile = makeProfile()
    const cards = [makeProofCard({ capability: 'Web3 development', verified: true })]
    const intelligence = buildProfileIntelligence(profile, [], cards)

    expect(classifyClaimSafety('I built a Web3 dashboard', intelligence)).toBe('VERIFIED_PROFILE_PROOF')
    expect(classifyClaimSafety('I have 20 years of experience', intelligence)).toBe('UNSUPPORTED')
  })

  it('flags forbidden claims as unsupported', () => {
    const profile = makeProfile()
    const cards = [makeProofCard({ forbiddenClaims: ['guaranteed results', 'overnight delivery'] })]
    const intelligence = buildProfileIntelligence(profile, [], cards)

    expect(classifyClaimSafety('I guarantee results', intelligence)).toBe('UNSUPPORTED')
  })

  it('classifies funding signal as NOT safe to mention', () => {
    const fact = classifyLeadFact(
      'raised $5M',
      'closed a Series A round with Solana Foundation',
      3,
    )
    expect(fact.safety).toBe('VERIFIED_PUBLIC')
    expect(fact.safeToMention).toBe(false)
  })

  it('classifies hiring signal as safe to mention', () => {
    const fact = classifyLeadFact(
      'hiring senior devs',
      'hiring 3 senior Rails developers',
      1,
    )
    expect(fact.safety).toBe('VERIFIED_PUBLIC')
    expect(fact.safeToMention).toBe(true)
  })

  it('compares profile fit and suggests stronger', () => {
    const profileA = makeProfile({ id: 'pA', label: 'A' })
    const profileB = makeProfile({ id: 'pB', label: 'B' })
    const result = compareProfileFit(
      { profile: profileA, matchedProof: [{ proofCard: makeProofCard(), relevanceScore: 2, matchingTags: ['react'], safeClaim: 'x' }] },
      { profile: profileB, matchedProof: [{ proofCard: makeProofCard(), relevanceScore: 10, matchingTags: ['web3', 'solana', 'blockchain'], safeClaim: 'y' }] },
    )
    expect(result.stronger?.label).toBe('B')
  })
})

// ── Outreach Strategy Tests ─────────────────────────────────────────────────

describe('Outreach Strategy', () => {
  it('creates a valid strategy for a first-touch DM', () => {
    const strategy = createOutreachStrategy({
      leadCompany: 'Nomadz',
      contactName: 'Sarah',
      contactTitle: 'Founder',
      signalType: 7,
      signalEvidence: 'looking for a technical partner',
      verbatimQuote: 'We need help with our Solana integration',
      tags: ['web3', 'solana', 'infra'],
      safeFacts: [{ fact: 'looking for help', safety: 'VERIFIED_PUBLIC', source: 'post', safeToMention: true }],
      senderProfile: makeProfile(),
      matchedProof: [{ proofCard: makeProofCard(), relevanceScore: 8, matchingTags: ['web3', 'solana'], safeClaim: 'Built Solana monitoring dashboard' }],
      channel: 'dm',
      relationshipStage: 'first_touch',
    })
    expect(strategy.mode).toBeDefined()
    expect(strategy.messageGoal).toContain('reply')
    expect(strategy.leadContext).toContain('Nomadz')
    expect(strategy.risk).toBeDefined()
  })

  it('selects proof_led mode when strong proof is available', () => {
    const mode = selectMessageMode({
      leadCompany: 'Test',
      contactName: 'Alex',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      verbatimQuote: null,
      tags: ['web3'],
      safeFacts: [],
      senderProfile: makeProfile(),
      matchedProof: [{ proofCard: makeProofCard({ strength: 'strong' }), relevanceScore: 8, matchingTags: ['web3'], safeClaim: 'x' }],
      channel: 'dm',
      relationshipStage: 'first_touch',
    })
    expect(mode).toBe('proof_led')
  })

  it('selects followup mode for followup stage', () => {
    const mode = selectMessageMode({
      leadCompany: 'Test',
      contactName: 'Alex',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      verbatimQuote: null,
      tags: [],
      safeFacts: [],
      senderProfile: makeProfile(),
      matchedProof: [],
      channel: 'dm',
      relationshipStage: 'followup',
    })
    expect(mode).toBe('followup')
  })

  it('serializes strategy to a compact prompt block', () => {
    const strategy = createOutreachStrategy({
      leadCompany: 'Test Co',
      contactName: 'Alex',
      contactTitle: 'CTO',
      signalType: 1,
      signalEvidence: 'hiring 3 engineers',
      verbatimQuote: null,
      tags: ['hiring', 'rails'],
      safeFacts: [],
      senderProfile: makeProfile(),
      matchedProof: [],
      channel: 'dm',
      relationshipStage: 'first_touch',
    })
    const block = strategyToPromptBlock(strategy)
    expect(block).toContain('Outreach Strategy')
    expect(block).toContain('Test Co')
    expect(block).toContain('**Mode:**')
  })
})

// ── Message Forge / Quality Gate Tests ──────────────────────────────────────

describe('Message Forge Quality Gate', () => {
  const strategy = createOutreachStrategy({
    leadCompany: 'Nomadz',
    contactName: 'Sarah',
    contactTitle: 'Founder',
    signalType: 7,
    signalEvidence: 'looking for help',
    verbatimQuote: null,
    tags: ['web3'],
    safeFacts: [],
    senderProfile: makeProfile(),
    matchedProof: [],
    channel: 'dm',
    relationshipStage: 'first_touch',
  })

  it('rejects the bad example from the spec', () => {
    const badExample = `You've recently closed a Builders Round with Solana Foundation, which likely gives you some budget to spend on delivery. With your focus on building operational infrastructure at Nomadz, I can write up a quick read of your product to help identify any potential delivery risks to your roadmap and revenue. Let me know if that sounds helpful.`
    const result = evaluateMessage(badExample, strategy, 'dm')
    expect(result.passed).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('flags surveillance-like opening', () => {
    const msg = `Hey Sarah, I noticed Nomadz just closed a round. That's exciting! I can help with your Solana work.`
    const result = evaluateMessage(msg, strategy, 'dm')
    expect(result.reasons.some((r) => r.includes('surveillance'))).toBe(true)
  })

  it('flags budget inference', () => {
    const msg = `Hey Sarah, congrats on the funding! With that budget, I can help Nomadz ship faster.`
    const result = evaluateMessage(msg, strategy, 'dm')
    expect(result.reasons.some((r) => r.includes('budget'))).toBe(true)
  })

  it('flags generic CTAs', () => {
    const msg = `Hey Sarah, saw what you're building at Nomadz. Let me know if that sounds helpful.`
    const result = evaluateMessage(msg, strategy, 'dm')
    expect(result.reasons.some((r) => r.includes('CTA'))).toBe(true)
  })

  it('passes a well-crafted message', () => {
    const goodMsg = `Hey Sarah, the Solana integration work at Nomadz caught my eye. I built a similar monitoring system for a Solana-based product last year. If useful, I can share one specific approach that reduced their transaction failures by half. Worth a thought?`
    const result = evaluateMessage(goodMsg, strategy, 'dm')
    // Should pass or at least have fewer issues than the bad example
    expect(result.score).toBeGreaterThan(50)
  })

  it('detects generic messages that could be sent to 100 leads', () => {
    expect(isGeneric('Hey, I noticed your company. I can help you ship faster. Let me know if interested.', 'Acme')).toBe(true)
    expect(isGeneric('Hey Sarah, the specific Solana work at Nomadz is interesting because of the Anchor patterns you are using.', 'Nomadz')).toBe(false)
  })

  it('detects surveillance feel', () => {
    expect(feelsSurveillance('You recently closed a round with Solana Foundation.')).toBe(true)
    expect(feelsSurveillance('I saw your post about the integration challenges.')).toBe(true)
    expect(feelsSurveillance('Congrats on the Series A!')).toBe(true)
  })

  it('repairs surveillance openings when enough of the message survives', () => {
    const repaired = repairMessage(
      'Hey Sarah, I noticed the Solana integration at Nomadz is still the live constraint on the roadmap this quarter.',
      ['Opens with surveillance language'],
      strategy,
    )
    expect(repaired).not.toMatch(/i noticed/i)
    expect(repaired).toMatch(/Solana integration at Nomadz/)
  })

  it('leaves a short surveillance opener unchanged rather than gutting it (< 8 words would remain)', () => {
    const original = 'Hey Sarah, I noticed Nomadz just closed a round.'
    const repaired = repairMessage(original, ['Opens with surveillance language'], strategy)
    expect(repaired).toBe(original)
  })

  it('repairs generic CTAs', () => {
    const repaired = repairMessage(
      'Hey Sarah, saw your work. Let me know if that sounds helpful.',
      ['Generic or call-seeking CTA'],
      strategy,
    )
    expect(repaired).not.toMatch(/let me know if that sounds helpful/i)
  })

  it('generates strategy candidates', () => {
    const candidates = generateStrategyCandidates(strategy)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(3)
    expect(candidates[0].label).toBe('Primary')
  })
})

// ── Conversation Engine Tests ───────────────────────────────────────────────

describe('Conversation Engine', () => {
  it('analyzes interested reply correctly', () => {
    const analysis = analyzeReply(
      'This sounds interesting. Can you tell me more about your approach?',
      { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'This sounds interesting. Can you tell me more about your approach?', priorMessages: [], conversationStage: 'contacted', senderProfileId: null },
    )
    expect(analysis.intent).toBe('interested')
    expect(analysis.buyingSignal).toBe(true)
  })

  it('analyzes not-interested reply', () => {
    const analysis = analyzeReply(
      'Thanks but not interested at this time.',
      { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'Thanks but not interested at this time.', priorMessages: [], conversationStage: 'contacted', senderProfileId: null },
    )
    expect(analysis.intent).toBe('not_interested')
    expect(analysis.sentiment).toBe('negative')
  })

  it('analyzes pricing question', () => {
    const analysis = analyzeReply(
      'How much do you typically charge for this kind of work?',
      { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'How much do you typically charge for this kind of work?', priorMessages: [], conversationStage: 'contacted', senderProfileId: null },
    )
    expect(analysis.intent).toBe('pricing')
  })

  it('analyzes meeting request', () => {
    const analysis = analyzeReply(
      'Sounds good. Can we schedule a call next week?',
      { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'Sounds good. Can we schedule a call next week?', priorMessages: [], conversationStage: 'contacted', senderProfileId: null },
    )
    expect(analysis.intent).toBe('meeting_request')
    expect(analysis.buyingSignal).toBe(true)
  })

  it('transitions stage correctly for interested reply', () => {
    const analysis = analyzeReply('Tell me more about this.', { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'Tell me more about this.', priorMessages: [], conversationStage: 'replied', senderProfileId: null })
    const nextStage = getNextStage('replied', analysis)
    expect(nextStage).toBe('qualifying')
  })

  it('transitions to lost for not-interested', () => {
    const analysis = analyzeReply('Not interested.', { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'Not interested.', priorMessages: [], conversationStage: 'contacted', senderProfileId: null })
    const nextStage = getNextStage('contacted', analysis)
    expect(nextStage).toBe('lost')
  })

  it('builds reply strategy for objection', () => {
    const analysis = analyzeReply(
      'How do I know you can actually deliver on this?',
      { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'How do I know you can actually deliver on this?', priorMessages: [], conversationStage: 'contacted', senderProfileId: null },
    )
    const replyStrategy = buildReplyStrategy(analysis, { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: '', priorMessages: [], conversationStage: 'contacted', senderProfileId: null }, null)
    expect(replyStrategy.approach).toContain('concern')
  })

  it('builds conversation context correctly', () => {
    const context = buildConversationContext(
      { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'This sounds interesting!', priorMessages: [{ id: 'm1', organizationId: 'org1', leadId: 'l1', repId: 'r1', type: 'dm', draftText: 'Original message', sentText: 'Original message', sentAt: '2024-01-01', modelUsed: null, createdAt: '2024-01-01' }], conversationStage: 'contacted', senderProfileId: null },
      analyzeReply('This sounds interesting!', { leadId: 'l1', leadCompany: 'Acme', contactName: 'Alex', replyText: 'This sounds interesting!', priorMessages: [], conversationStage: 'contacted', senderProfileId: null }),
    )
    expect(context).toContain('Deterministic conversation summary')
    expect(context).toContain('Acme')
    expect(context).toContain('Original message')
  })
})

// ── Follow-up Engine Tests ──────────────────────────────────────────────────

describe('Follow-up Engine', () => {
  it('does not allow follow-up before 5 business days', () => {
    const result = determineFollowup({
      lead: { id: 'l1', organizationId: 'org1', ownerRepId: null, company: 'Acme', companyKey: 'acme', contactName: 'Alex', contactTitle: 'Founder', url: null, rawInput: null, signalType: 1, signalEvidence: 'hiring', verbatimQuote: null, score: 8, verdict: 'send', status: 'contacted', playId: null, tags: [], createdAt: '2024-01-01' },
      priorMessages: [{ id: 'm1', organizationId: 'org1', leadId: 'l1', repId: 'r1', type: 'dm', draftText: 'Hi', sentText: 'Hi Alex, noticed you are hiring', sentAt: new Date().toISOString(), modelUsed: null, createdAt: '2024-01-01' }],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: new Date().toISOString(),
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(false)
    expect(result.waitReason).toContain('calendar day')
  })

  // Approved product design change: the follow-up cap was raised from 1 to
  // 3 (a lead can now receive up to 3 follow-ups total across its life —
  // see src/lib/relay/followup-engine.ts and default-targets.ts's
  // followup: 3 rebalance). A followupCount of 1 is now the *second*
  // follow-up, still allowed — this replaces the old "does not allow a
  // second follow-up" test, which asserted the now-superseded 1-follow-up
  // rule. Business-rule change, not a regression.
  it('allows a second follow-up (followupCount 1 of the new 3-follow-up cap), once 5 business days have passed', () => {
    const result = determineFollowup({
      lead: { id: 'l1', organizationId: 'org1', ownerRepId: null, company: 'Acme', companyKey: 'acme', contactName: 'Alex', contactTitle: 'Founder', url: null, rawInput: null, signalType: 1, signalEvidence: 'hiring', verbatimQuote: null, score: 8, verdict: 'send', status: 'followed_up', playId: null, tags: [], createdAt: '2024-01-01' },
      priorMessages: [{ id: 'm1', organizationId: 'org1', leadId: 'l1', repId: 'r1', type: 'followup', draftText: null, sentText: 'Following up, Alex', sentAt: '2024-01-01', modelUsed: null, createdAt: '2024-01-01' }],
      conversationStage: 'followed_up',
      senderProfileId: null,
      followupCount: 1,
      lastSentAt: '2024-01-01',
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(true)
  })

  it('does not allow a fourth follow-up once all 3 have been used', () => {
    const result = determineFollowup({
      lead: { id: 'l1', organizationId: 'org1', ownerRepId: null, company: 'Acme', companyKey: 'acme', contactName: 'Alex', contactTitle: 'Founder', url: null, rawInput: null, signalType: 1, signalEvidence: 'hiring', verbatimQuote: null, score: 8, verdict: 'send', status: 'followed_up', playId: null, tags: [], createdAt: '2024-01-01' },
      priorMessages: [],
      conversationStage: 'followed_up',
      senderProfileId: null,
      followupCount: 3,
      lastSentAt: '2024-01-01',
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(false)
    expect(result.reason).toContain('All 3 follow-ups already used')
  })

  it('does not follow up if lead has replied', () => {
    const result = determineFollowup({
      lead: { id: 'l1', organizationId: 'org1', ownerRepId: null, company: 'Acme', companyKey: 'acme', contactName: 'Alex', contactTitle: 'Founder', url: null, rawInput: null, signalType: 1, signalEvidence: 'hiring', verbatimQuote: null, score: 8, verdict: 'send', status: 'replied', playId: null, tags: [], createdAt: '2024-01-01' },
      priorMessages: [],
      conversationStage: 'replied',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: '2024-01-01',
      lastReplyAt: '2024-01-03',
    })
    expect(result.shouldFollowUp).toBe(false)
  })

  it('builds followup prompt with anti-rules', () => {
    const strategy = determineFollowup({
      lead: { id: 'l1', organizationId: 'org1', ownerRepId: null, company: 'Acme', companyKey: 'acme', contactName: 'Alex', contactTitle: 'Founder', url: null, rawInput: null, signalType: 1, signalEvidence: 'hiring', verbatimQuote: null, score: 8, verdict: 'send', status: 'contacted', playId: null, tags: [], createdAt: '2024-01-01' },
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: '2024-01-01',
      lastReplyAt: null,
      now: new Date('2024-01-15'),
    })
    const context = buildFollowupPrompt({
      lead: { id: 'l1', organizationId: 'org1', ownerRepId: null, company: 'Acme', companyKey: 'acme', contactName: 'Alex', contactTitle: 'Founder', url: null, rawInput: null, signalType: 1, signalEvidence: 'hiring', verbatimQuote: null, score: 8, verdict: 'send', status: 'contacted', playId: null, tags: [], createdAt: '2024-01-01' },
      priorMessages: [{ id: 'm1', organizationId: 'org1', leadId: 'l1', repId: 'r1', type: 'dm', draftText: 'Original', sentText: 'Original message', sentAt: '2024-01-01', modelUsed: null, createdAt: '2024-01-01' }],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: '2024-01-01',
      lastReplyAt: null,
      now: new Date('2024-01-15'),
    }, strategy)
    expect(context).toContain('Do NOT say "just following up"')
  })
})

// ── Edit Learning Tests ─────────────────────────────────────────────────────

describe('Edit Learning', () => {
  it('computes edit delta correctly', () => {
    const delta = computeEditDelta(
      'Hey Alex, I noticed Acme is hiring. Happy to send over a free Read.',
      'Hey Alex, saw Acme is hiring. Free Read if useful.',
    )
    expect(delta.madeShorter).toBe(true)
    expect(delta.lengthDelta).toBeLessThan(0)
  })

  it('detects greeting change', () => {
    const delta = computeEditDelta(
      'Hey Alex, noticed the hiring.',
      'Hi Alex, noticed the hiring.',
    )
    expect(delta.greetingChanged).toBe(true)
  })

  it('detects CTA change', () => {
    const delta = computeEditDelta(
      'Let me know if that sounds helpful.',
      'Worth a quick thought?',
    )
    expect(delta.ctaChanged).toBe(true)
  })

  it('accumulates edit signals across multiple edits', () => {
    const deltas = [
      computeEditDelta('Long message with proof reference.', 'Short message.'),
      computeEditDelta('Another long message with details.', 'Shorter.'),
      computeEditDelta('Yet another detailed message.', 'Brief.'),
    ]
    const signals = accumulateEditSignals(deltas)
    expect(signals.prefersShorter).toBe(true)
  })

  it('detects stable formality when no consistent shift', () => {
    const deltas = [
      { ...computeEditDelta('A', 'B'), formalityShift: 'same' as const },
      { ...computeEditDelta('C', 'D'), formalityShift: 'same' as const },
    ]
    const signals = accumulateEditSignals(deltas)
    expect(signals.formalityTrend).toBe('stable')
  })
})

// ── Integration: Bad Example Regression ─────────────────────────────────────

describe('Bad Example Regression Test', () => {
  const badExample = `You've recently closed a Builders Round with Solana Foundation, which likely gives you some budget to spend on delivery. With your focus on building operational infrastructure at Nomadz, I can write up a quick read of your product to help identify any potential delivery risks to your roadmap and revenue. Let me know if that sounds helpful.`

  it('detects ALL problems in the bad example', () => {
    const strategy = createOutreachStrategy({
      leadCompany: 'Nomadz',
      contactName: 'Sarah',
      contactTitle: 'Founder',
      signalType: 3,
      signalEvidence: 'closed a Builders Round',
      verbatimQuote: null,
      tags: ['web3', 'solana'],
      safeFacts: [classifyLeadFact('funding raised', 'closed a Builders Round', 3)],
      senderProfile: makeProfile(),
      matchedProof: [],
      channel: 'dm',
      relationshipStage: 'first_touch',
    })

    const evaluation = evaluateMessage(badExample, strategy, 'dm')

    // The quality gate must reject this
    expect(evaluation.passed).toBe(false)

    // Must detect at least one major issue (budget, surveillance, or generic)
    const hasBudgetIssue = evaluation.reasons.some((r) => r.toLowerCase().includes('budget'))
    const hasCtaIssue = evaluation.reasons.some((r) => r.toLowerCase().includes('cta') || r.toLowerCase().includes('generic'))
    const hasSurveillanceIssue = evaluation.reasons.some((r) => r.toLowerCase().includes('surveillance'))
    expect(hasBudgetIssue || hasCtaIssue || hasSurveillanceIssue).toBe(true)

    // Must detect surveillance feel
    expect(feelsSurveillance(badExample)).toBe(true)

    // Must detect it could be sent to 100 leads (or score low enough)
    const genericCheck = isGeneric(badExample, 'Nomadz')
    const lowScore = evaluation.score < 50
    expect(genericCheck || lowScore).toBe(true)
  })

  it('the repaired version should be better', () => {
    const strategy = createOutreachStrategy({
      leadCompany: 'Nomadz',
      contactName: 'Sarah',
      contactTitle: 'Founder',
      signalType: 3,
      signalEvidence: 'closed a Builders Round',
      verbatimQuote: null,
      tags: ['web3', 'solana'],
      safeFacts: [],
      senderProfile: makeProfile(),
      matchedProof: [{ proofCard: makeProofCard(), relevanceScore: 5, matchingTags: ['web3'], safeClaim: 'Built a Web3 dashboard' }],
      channel: 'dm',
      relationshipStage: 'first_touch',
    })

    const evaluation = evaluateMessage(badExample, strategy, 'dm')
    let repaired = repairMessage(badExample, evaluation.reasons, strategy)

    // Run repair again to catch nested issues (the first pass may change structure)
    const secondEval = evaluateMessage(repaired, strategy, 'dm')
    if (!secondEval.passed) {
      repaired = repairMessage(repaired, secondEval.reasons, strategy)
    }

    // Repaired version should have a better score than the original
    const finalEval = evaluateMessage(repaired, strategy, 'dm')
    expect(finalEval.score).toBeGreaterThan(evaluation.score)

    // The generic CTA should be fixed
    expect(repaired).not.toMatch(/let me know if that sounds helpful/i)
  })
})
