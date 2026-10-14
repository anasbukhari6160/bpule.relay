import { describe, expect, it } from 'vitest'
import type { EvidenceEntry } from '@/lib/intelligence-v2/types'
import {
  buildRevenueStrategy,
  scopeEvidenceText,
  shouldWriteMessage,
  toUiSnapshot,
  type StrategySource,
} from '@/lib/relay/revenue-strategy'
import { summarizeFunnel, funnelStageFromEvent, qualifiedProspectRateCopy } from '@/lib/relay/funnel'
import { analyzeReply } from '@/lib/relay/conversation-engine'
import { determineFollowup } from '@/lib/relay/followup-engine'
import { evaluateMessage } from '@/lib/relay/message-forge'
import { classifySendDisposition, inferFeedbackReasons } from '@/lib/relay/edit-learning'
import { classifyInput } from '@/lib/prospect/qualification-gate'
import type { Lead, Message } from '@/lib/domain/types'

function source(overrides: Partial<StrategySource>): StrategySource {
  return {
    name: 'Alex Rivera',
    title: 'Founder',
    company: 'Acme Robotics',
    qualification: 'worth_pursuing',
    relationship: 'POTENTIAL_BUYER',
    businessModel: 'PRODUCT',
    canonicalScore: 72,
    extractionCompleteness: 70,
    opportunitySignals: [],
    urgency: 'unknown',
    explicitProblems: [],
    hiringSignals: [],
    technicalSignals: [],
    recentPosts: [],
    opportunityDescription: null,
    opportunityTrigger: null,
    probableNeed: null,
    unknowns: [],
    risks: [],
    evidenceLedger: [],
    hardNegatives: [],
    dimensionPoints: {},
    rawText: null,
    signalType: 7,
    signalEvidence: null,
    verbatimQuote: null,
    tags: [],
    relationshipStage: 'first_touch',
    channel: 'dm',
    alreadyShared: [],
    thingsNotToClaim: [],
    conversation: null,
    priorFollowupCount: 0,
    ...overrides,
  }
}

function fact(signal: string, extra?: Partial<EvidenceEntry>): EvidenceEntry {
  return {
    signal,
    source: 'pasted_text',
    evidenceType: 'FACT',
    ownership: 'HIRING_INTENT',
    confidence: 'HIGH',
    safeForOutreach: true,
    verbatimQuote: signal,
    ...extra,
  }
}

describe('FIT / INTENT / CONFIDENCE', () => {
  it('keeps HIGH FIT + UNKNOWN INTENT instead of guessing a need', () => {
    const strategy = buildRevenueStrategy(source({
      title: 'Founder & CEO',
      opportunitySignals: [],
      dimensionPoints: { opportunityFit: { points: 15, max: 20, note: 'Strong company/role' } },
      extractionCompleteness: 62,
    }))
    expect(strategy.assessment.fit).toBe('HIGH')
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(strategy.contact.action).toBe('CONNECT_OR_OBSERVE')
    expect(strategy.contact.messageRecommended).toBe(false)
  })

  it('uses UNKNOWN rather than inventing intent from thin data', () => {
    const strategy = buildRevenueStrategy(source({
      name: 'Sam',
      title: 'Founder',
      company: 'Tiny Co',
      extractionCompleteness: 20,
      opportunitySignals: [],
      signalEvidence: 'Founder at Tiny Co',
    }))
    expect(strategy.assessment.intent).toBe('UNKNOWN')
    expect(strategy.contact.action).toMatch(/RESEARCH_MORE|CONNECT_OR_OBSERVE|SKIP/)
    expect(shouldWriteMessage(strategy)).toBe(false)
  })
})

describe('First message after the invitation is accepted', () => {
  const launch = {
    channel: 'dm' as const,
    opportunitySignals: ['launch' as const],
    signalEvidence: 'They launched a new product line',
    verbatimQuote: 'We just launched the new platform',
    evidenceLedger: [fact('We just launched the new platform')],
  }

  it('still refuses a cold DM when the invitation is not accepted', () => {
    const strategy = buildRevenueStrategy(source(launch))
    expect(shouldWriteMessage(strategy)).toBe(false)
    expect(strategy.contact.noMessageReason).toMatch(/do not force a DM/)
  })

  it('writes the first DM once the invitation is accepted', () => {
    const strategy = buildRevenueStrategy(source({ ...launch, connectionAccepted: true }))
    expect(shouldWriteMessage(strategy)).toBe(true)
    expect(strategy.contact.noMessageReason).toBeNull()
    expect(strategy.messageJob).toBe('DISCOVER_NEED')
    expect(strategy.contact.action).toBe('CONTACT_NOW')
  })

  it('still stays silent for an irrelevant profile even if acceptance was marked', () => {
    const strategy = buildRevenueStrategy(source({
      channel: 'dm',
      connectionAccepted: true,
      hardNegatives: ['IRRELEVANT_OR_INSUFFICIENT_INPUT'],
      qualification: 'skip',
    }))
    expect(shouldWriteMessage(strategy)).toBe(false)
  })
})

describe('Right to contact — real cases', () => {
  it('explicit project need → CONTACT_NOW + TEST_DELIVERY_MODEL', () => {
    const strategy = buildRevenueStrategy(source({
      name: 'Abdulhakim',
      title: 'Founder',
      company: 'Northstar',
      opportunitySignals: ['freelance_project_need'],
      hiringSignals: ['Looking for a team to build our platform'],
      signalEvidence: 'Looking for a full-stack team to build our platform',
      verbatimQuote: 'We are looking for a full-stack team to build our platform',
      evidenceLedger: [fact('Looking for a full-stack team to build our platform')],
      urgency: 'immediate',
    }))
    expect(strategy.contact.reason).toBe('EXPLICIT_NEED')
    expect(strategy.contact.action).toBe('CONTACT_NOW')
    expect(strategy.messageJob).toMatch(/TEST_DELIVERY_MODEL|CONFIRM_RELEVANCE|DISCOVER_NEED/)
    expect(strategy.allowedNow.length).toBeGreaterThan(0)
    expect(strategy.allowedNow.join(' ')).not.toMatch(/^(we(?:'re| are)|i(?:'m| am))\b/i)
    expect(shouldWriteMessage(strategy)).toBe(true)
  })

  it('irrelevant prospect → SKIP and no message', () => {
    const strategy = buildRevenueStrategy(source({
      name: 'Dr. Pat',
      title: 'Pediatrician',
      company: 'City Clinic',
      qualification: 'skip',
      hardNegatives: ['clinician'],
      dimensionPoints: { opportunityFit: { points: 2, max: 20, note: 'not a buyer' } },
    }))
    expect(strategy.contact.action).toBe('SKIP')
    expect(shouldWriteMessage(strategy)).toBe(false)
  })

  it('historical onsite evidence is never a current opportunity', () => {
    const historical = 'Previously required on-site in London when they were at Stripe in 2019'
    expect(scopeEvidenceText(historical)).toMatch(/HISTORICAL/)
    const strategy = buildRevenueStrategy(source({
      opportunitySignals: ['hiring'],
      signalEvidence: historical,
      evidenceLedger: [fact(historical, { ownership: 'JOB_REQUIREMENT' })],
    }))
    expect(strategy.contact.action).toMatch(/RESEARCH_MORE|SKIP/)
    expect(shouldWriteMessage(strategy)).toBe(false)
    expect(strategy.unsupportedClaims.join(' ').toLowerCase()).toMatch(/previously|stripe|2019/)
  })

  it('generic posts only are not a reason to write', () => {
    const strategy = buildRevenueStrategy(source({
      recentPosts: [{ paraphrase: 'Thoughts on remote work culture', verbatimQuote: 'Remote work is evolving' }],
      opportunitySignals: [],
      title: 'Founder',
    }))
    expect(strategy.contact.messageRecommended).toBe(false)
    expect(strategy.contact.reason).toBe('NO_CREDIBLE_REASON')
  })

  it('strong problem signal → CONTACT_NOW with CONFIRM_RELEVANCE', () => {
    const strategy = buildRevenueStrategy(source({
      opportunitySignals: ['technical_problem'],
      explicitProblems: ['Checkout latency is killing conversion'],
      verbatimQuote: 'Checkout latency is killing conversion',
      evidenceLedger: [fact('Checkout latency is killing conversion', { ownership: 'BUYER_INTENT' })],
    }))
    expect(strategy.contact.reason).toBe('DEMONSTRATED_PROBLEM')
    expect(strategy.messageJob).toBe('CONFIRM_RELEVANCE')
    expect(strategy.allowedNow.some((item) => /latency/i.test(item))).toBe(true)
  })

  it('login/UI garbage is irrelevant immediately', () => {
    const result = classifyInput('Sign in\nEmail\nPassword\nForgot password\nLog in to your account')
    expect(result.classification).toBe('IRRELEVANT')
  })

  // Regression: a lead with a low canonical/qualification score (some other
  // scoring dimension pulled the number down) can still carry a genuine,
  // explicit hiring signal — the action/messageRecommended must reflect
  // that real signal, not the raw score alone. See Ran Endelman / PlexAI
  // hardening report, where a 25/100 qualification ('skip') sat next to a
  // strategy card independently showing Fit/Intent/Confidence all HIGH with
  // a DM recommended — canDraft in lead-workspace-simple.tsx must not gate purely
  // on the 'skip' qualification when the strategy layer disagrees.
  it('low qualification score does not suppress a genuine explicit project signal', () => {
    const strategy = buildRevenueStrategy(source({
      name: 'Ran Endelman',
      title: 'Co-Founder & CEO',
      company: 'PlexAI',
      qualification: 'skip',
      canonicalScore: 25,
      opportunitySignals: ['freelance_project_need'],
      hiringSignals: ['We need a team to build our AI platform.'],
      signalEvidence: 'We need a team to build our AI platform.',
      verbatimQuote: 'We need a team to build our AI platform.',
      evidenceLedger: [fact('We need a team to build our AI platform.')],
      urgency: 'immediate',
    }))
    expect(strategy.contact.action).not.toBe('SKIP')
    expect(shouldWriteMessage(strategy)).toBe(true)
  })
})

describe('Conversation replies become first-party intelligence', () => {
  const ctx = {
    leadId: 'l1',
    leadCompany: 'Acme',
    contactName: 'Alex',
    replyText: '',
    priorMessages: [] as Message[],
    conversationStage: 'contacted' as const,
    senderProfileId: null,
  }

  it('positive reply asking for examples and rate updates state', () => {
    const text = 'Sounds interesting. Can you share examples and your rate?'
    const analysis = analyzeReply(text, { ...ctx, replyText: text })
    expect(analysis.knowledge.fields.proofNeeded.status).toBe('known')
    expect(analysis.knowledge.messageJob).toBe('PROVIDE_PROOF')
    expect(analysis.knowledge.nextMove).toBe('PROVIDE_PROOF')
    expect(analysis.knowledge.newFacts.length).toBeGreaterThan(0)
  })

  it('already hired → close the loop', () => {
    const text = 'Thanks — we already hired someone last week.'
    const analysis = analyzeReply(text, { ...ctx, replyText: text })
    expect(analysis.knowledge.fields.need.value).toMatch(/hired|filled/i)
    expect(analysis.knowledge.messageJob).toBe('CLOSE_LOOP')
    expect(analysis.knowledge.nextMove).toBe('CLOSE')
  })

  it('maybe next quarter → understand timeline, not a pitch', () => {
    const text = 'Maybe next quarter — we are heads down until then.'
    const analysis = analyzeReply(text, { ...ctx, replyText: text })
    expect(analysis.knowledge.fields.timeline.status).toBe('known')
    expect(analysis.knowledge.messageJob).toBe('UNDERSTAND_TIMELINE')
  })

  it('negative reply → close', () => {
    const text = 'Not interested, please do not follow up.'
    const analysis = analyzeReply(text, { ...ctx, replyText: text })
    expect(analysis.intent).toBe('not_interested')
    expect(analysis.knowledge.messageJob).toBe('CLOSE_LOOP')
  })
})

describe('Follow-up and waiting', () => {
  const lead: Lead = {
    id: 'l1',
    organizationId: 'org1',
    ownerRepId: null,
    company: 'Acme',
    companyKey: 'acme',
    contactName: 'Alex',
    contactTitle: 'Founder',
    url: null,
    rawInput: null,
    signalType: 1,
    signalEvidence: 'hiring',
    verbatimQuote: null,
    score: 8,
    verdict: 'send',
    status: 'contacted',
    playId: null,
    tags: [],
    createdAt: '2024-01-01',
  }

  it('no response before 5 business days waits', () => {
    const result = determineFollowup({
      lead,
      priorMessages: [{
        id: 'm1', organizationId: 'org1', leadId: 'l1', repId: 'r1', type: 'dm',
        draftText: 'Hi', sentText: 'Hi Alex, are you set on hiring for that role?',
        sentAt: new Date().toISOString(), modelUsed: null, createdAt: '2024-01-01',
      }],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: new Date().toISOString(),
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(false)
    expect(result.waitReason).toMatch(/calendar day/)
  })

  // Approved product design change: the follow-up cap was raised from 1 to
  // 3 (see followup-engine.ts / default-targets.ts's followup: 3 rebalance).
  // followupCount 1 is now the *second* follow-up, still allowed — this
  // replaces the old "does not duplicate a follow-up" assertion at count 1,
  // which asserted the now-superseded 1-follow-up rule. Business-rule
  // change, not a regression. The real "does not duplicate" boundary is now
  // at followupCount 3 (a 4th follow-up), covered below.
  it('allows a second follow-up once followupCount is 1 (within the new 3-follow-up cap)', () => {
    const result = determineFollowup({
      lead: { ...lead, status: 'followed_up' },
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 1,
      lastSentAt: '2024-01-01T00:00:00.000Z',
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(true)
  })

  it('does not allow a 4th follow-up once followupCount reaches 3', () => {
    const result = determineFollowup({
      lead: { ...lead, status: 'followed_up' },
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 3,
      lastSentAt: '2024-01-01T00:00:00.000Z',
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(false)
    expect(result.reason).toMatch(/already/)
  })
})

describe('Writing quality gate — systemic failures', () => {
  it('rejects research-dump / fake personalization / multiple CTAs', () => {
    const text = 'Hey Alex, saw your post about hiring. Congrats on the raise. Over the past 8 years we specialize in delivery. I can write a quick analysis. Would that be useful? Can we also hop on a chat?'
    const result = evaluateMessage(text, null, 'dm')
    expect(result.passed).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(2)
  })

  it('accepts a short one-job hiring message', () => {
    const text = 'Hey Abdulhakim — are you set on hiring for that full-stack role at Northstar, or open to someone taking ownership of the build instead?'
    const result = evaluateMessage(text, {
      leadContext: 'Company: Northstar. Contact: Abdulhakim (Founder)',
      safeTrigger: 'Hiring a full-stack engineer',
      probableNeed: 'delivery ownership',
      sender: 'Fizza',
      relevantProof: [],
      messageGoal: 'TEST_DELIVERY_MODEL',
      relationshipStage: 'first_touch',
      channel: 'dm',
      tone: 'direct',
      risk: 'low',
      ctaStrategy: 'one either/or',
      mode: 'relevant_question',
      messageJob: 'TEST_DELIVERY_MODEL',
      allowedNow: ['Hiring a full-stack engineer'],
      wordBudget: { min: 20, max: 55, label: 'first DM' },
    }, 'dm')
    expect(result.score).toBeGreaterThan(60)
    expect(result.reasons.some((r) => /surveillance|caught my eye|specialize/i.test(r))).toBe(false)
  })
})

describe('Human send feedback', () => {
  it('classifies unchanged / light / heavy / rejected', () => {
    expect(classifySendDisposition('Hey Alex — still hiring?', 'Hey Alex — still hiring?')).toBe('SENT_UNCHANGED')
    expect(classifySendDisposition('Hey Alex — still hiring for that role?', 'Hey Alex — still hiring?')).toBe('LIGHT_EDIT')
    expect(classifySendDisposition(
      'Hey Alex, saw your post. We specialize in delivery and I can write a quick analysis. Would that be useful?',
      'Hey Alex — still hiring for the full-stack role?',
    )).toBe('HEAVY_EDIT')
    expect(classifySendDisposition('x', 'y', true)).toBe('REJECTED')
  })

  it('infers TOO_LONG and FAKE_PERSONALIZATION from the edit', () => {
    const reasons = inferFeedbackReasons(
      'Hey Alex, saw your post and this caught my eye. Long biography follows for many extra words here about our years.',
      'Hey Alex — still hiring?',
      'HEAVY_EDIT',
    )
    expect(reasons).toContain('TOO_LONG')
    expect(reasons).toContain('FAKE_PERSONALIZATION')
  })
})

describe('Revenue loop events map to funnel stages without inventing data', () => {
  it('maps existing event types and reports missing stages honestly', () => {
    expect(funnelStageFromEvent({ eventType: 'PROSPECT_ANALYZED', payload: {} })).toBe('ANALYZED')
    expect(funnelStageFromEvent({ eventType: 'LEAD_QUALIFIED', payload: {} })).toBe('QUALIFIED_FOR_CONTACT')
    expect(funnelStageFromEvent({ eventType: 'OUTREACH_RECORDED', payload: {} })).toBe('CONTACTED')
    expect(funnelStageFromEvent({ eventType: 'CLIENT_REPLIED', payload: {} })).toBe('REPLIED')
    expect(funnelStageFromEvent({ eventType: 'CONVERSATION_ADVANCED', payload: { stage: 'meeting' } })).toBe('CALL')
    expect(funnelStageFromEvent({ eventType: 'OUTCOME_RECORDED', payload: { outcome: 'won', revenue: 12000 } })).toBe('REVENUE')

    const summary = summarizeFunnel([
      { eventType: 'PROSPECT_ANALYZED', payload: {}, entityId: 'p1' },
      { eventType: 'LEAD_QUALIFIED', payload: {}, entityId: 'l1' },
      { eventType: 'OUTREACH_RECORDED', payload: {}, entityId: 'l1' },
    ])
    expect(summary.analyzed).toBe(1)
    expect(summary.contacted).toBe(1)
    expect(summary.won).toBe(0)
    expect(summary.revenue).toBeNull()
    expect(summary.missing.some((m) => /REVENUE/i.test(m))).toBe(true)
    expect(qualifiedProspectRateCopy(summary)).toMatch(/qualified prospects/)
  })
})

describe('Knowledge release', () => {
  it('writer only receives ALLOWED_NOW and holds BPulse positioning', () => {
    const strategy = buildRevenueStrategy(source({
      opportunitySignals: ['freelance_project_need'],
      hiringSignals: ['Looking for a team to build our backend'],
      evidenceLedger: [fact('Looking for a team to build our backend')],
      verbatimQuote: 'Looking for a team to build our backend',
    }))
    expect(strategy.allowedNow.length).toBeLessThanOrEqual(2)
    expect(strategy.evidenceToHold.join(' ')).toMatch(/BPulse|biography|experience/i)
    const snap = toUiSnapshot(strategy)
    expect(snap.messageJob).toMatch(/TEST_DELIVERY_MODEL|CONFIRM_RELEVANCE|DISCOVER_NEED/)
  })

})