import { describe, expect, it } from 'vitest'
import { deriveCommercialReading } from '@/lib/intelligence-v2/commercial-reading'
import { scoreEpisode } from '@/lib/intelligence-v3/scoring/score-v3'
import type { V3BoundedDecision, V3OpportunityEpisode } from '@/lib/intelligence-v3/types'
import { determineFollowup } from '@/lib/relay/followup-engine'
import { displayScoreFromCanonical, normalizeScoreDimensions, scoreExplanation } from '@/lib/scoring/display-score'
import { evaluateMessageStage } from '@/lib/writing/engine'
import type { Lead, Message } from '@/lib/domain/types'

const lead = {
  id: 'l1',
  organizationId: 'org1',
  ownerRepId: null,
  company: 'B2Bnetwork',
  companyKey: 'b2bnetwork',
  contactName: 'Michał',
  contactTitle: 'IT Recruiter',
  url: null,
  rawInput: null,
  signalType: 1,
  signalEvidence: '',
  verbatimQuote: null,
  score: 5,
  verdict: 'send',
  status: 'contacted',
  playId: null,
  tags: [],
  createdAt: '2026-10-16',
} as Lead

function message(partial: Partial<Message> & Pick<Message, 'id' | 'type'>): Message {
  return {
    organizationId: 'org1',
    leadId: 'l1',
    repId: 'r1',
    draftText: null,
    sentText: 'note',
    sentAt: '2026-10-16T12:00:00.000Z',
    modelUsed: null,
    createdAt: '2026-10-16T12:00:00.000Z',
    direction: 'outbound',
    ...partial,
  }
}

describe('QA 16 Oct — score display', () => {
  it('maps a V3 maybe qualification to 5/10 and explains the canonical total', () => {
    const display = displayScoreFromCanonical({
      intelligenceVersion: 'relay_decision_v3.0.0',
      qualification: 'maybe',
      canonicalScore: 47,
    })
    expect(display).toBe(5)
    expect(scoreExplanation({ displayScore: display, canonicalScore: 47, qualification: 'maybe' })).toMatch(/5\/10/)
    expect(scoreExplanation({ displayScore: display, canonicalScore: 47, qualification: 'maybe' })).toMatch(/47\/100/)
  })

  it('renders earned/maximum for V3 dimensions and an unavailable state when values are missing', () => {
    const rows = normalizeScoreDimensions([
      { key: 'buyerRequest', label: 'Buyer Request', contribution: 19, raw: 0.95, weight: 0.2, note: 'capped' },
      { key: 'mystery', label: 'Legacy group' },
    ])
    expect(rows[0]).toMatchObject({ points: 19, max: 20, unavailable: false, inTotal: true })
    expect(rows[1]).toMatchObject({ unavailable: true, inTotal: false })
  })
})

describe('QA 16 Oct — recruiter is not a buyer', () => {
  it('does not call employer hiring a high buyer request', () => {
    const reading = deriveCommercialReading(`Michał Walasek
IT Recruiter
B2Bnetwork

We are hiring developers. Send a resume and apply. Contact us with instructions to apply.`)
    expect(reading.serviceBuyerIntent).not.toBe('HIGH')
    expect(reading.externalEngineeringNeed).toBe('NONE_DETECTED')
    expect(reading.buyerEvidenceKinds).not.toContain('BUYER_REQUEST')
  })

  it('keeps a real agency request as buyer evidence', () => {
    const reading = deriveCommercialReading(`Jane Founder
CEO at ProductCo

We are looking for an agency to build our platform.`)
    expect(reading.serviceBuyerIntent).toBe('HIGH')
  })

  it('does not emit an explicit buyer reason for a recruiter profile', () => {
    const episode = {
      id: 'ep',
      anchorEvent: { id: 'e', eventType: 'HIRING', explicitness: 'EXPLICIT' },
      organizationId: 'org',
      organizationName: 'B2Bnetwork',
      needOwnerType: 'HIRING_NEED',
      explicitRequest: true,
      requestedCapabilities: [],
      applicationChannels: [],
      evidenceRefs: [],
      eventRefs: [],
      status: 'CURRENT',
      detectedAt: '2026-10-16T00:00:00.000Z',
      lastActivityAt: '2026-10-16T00:00:00.000Z',
      ageDays: 1,
    } as V3OpportunityEpisode
    const decision = {
      relationship: 'SERVICE_PROVIDER',
      buyerRequestProbability: 0.92,
      externalNeedProbability: 0.8,
      needOwnerType: 'HIRING_NEED',
      fit: 'STRONG',
      timing: 'CURRENT',
      access: 'DIRECT',
      messageEligible: 0.4,
      providerConfidence: 0.8,
    } as V3BoundedDecision
    const result = scoreEpisode({
      episode,
      decision,
      rawText: `Michał Walasek\nIT Recruiter\nB2Bnetwork\nHelping companies hire engineers.`,
    })
    expect(result.reasons.join(' ')).not.toMatch(/explicit buyer request|strong buyer signal/i)
    const buyer = result.dimensions.find((d) => d.key === 'buyerIntent')
    expect(buyer?.raw).toBeLessThanOrEqual(0.2)
    expect(buyer?.note).toMatch(/recruiter|not a request|no request|disagree/i)
    expect(result.watchOut.join(' ')).toMatch(/buyer request|not credited|employee hiring/i)
  })
})

describe('QA 16 Oct — connection and follow-up', () => {
  it('does not open a follow-up while the connection is pending', () => {
    const result = determineFollowup({
      lead,
      priorMessages: [message({ id: 'c1', type: 'connection', sentAt: new Date().toISOString() })],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: new Date().toISOString(),
      lastReplyAt: null,
    })
    expect(result.shouldFollowUp).toBe(false)
    expect(result.waitReason).toMatch(/acceptance/i)
  })

  it('does not use the canned follow-up call to action', () => {
    const due = determineFollowup({
      lead,
      priorMessages: [message({ id: 'd1', type: 'dm', sentText: 'Hi Michał', sentAt: '2026-01-01T00:00:00.000Z' })],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: 0,
      lastSentAt: '2026-01-01T00:00:00.000Z',
      lastReplyAt: null,
    })
    expect(due.shouldFollowUp).toBe(true)
    expect(due.ctaApproach.toLowerCase()).not.toContain('perfect reply')
    const gate = evaluateMessageStage('Not now is a perfect reply. Happy to share generic advice about tech recruitment.', 'follow_up')
    expect(gate.passed).toBe(false)
    expect(gate.issues.join(' ')).toMatch(/unnatural/i)
    const generic = evaluateMessageStage('A useful tip on tech recruitment: keep your pipeline warm.', 'follow_up')
    expect(generic.passed).toBe(false)
  })
})
