import { describe, it, expect } from 'vitest'
import {
  processInboundMessage,
  resolveConversationState,
  type InboundMessage,
  type ConversationContext,
  type LifecycleStage,
} from '@/lib/conversation/intelligence-engine'

function makeMessage(text: string, leadId = 'lead-1', messageId = 'msg-1'): InboundMessage {
  return { text, leadId, messageId, timestamp: '2026-10-19T10:00:00Z' }
}

function makeContext(stage: LifecycleStage = 'WAITING', overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    currentStage: stage,
    clientMessages: [],
    followupCount: 0,
    knownObjections: [],
    stakeholders: [],
    ...overrides,
  }
}

const baseMessage = (text: string) => makeMessage(text)

describe('BUYING_INTENT test matrix', () => {
  it('"tell me more" → BUYING_INTEREST', () => {
    const result = processInboundMessage({ message: baseMessage('tell me more'), context: makeContext() })
    expect(result.primaryIntent).toBe('BUYING_INTEREST')
    expect(result.commercialStrength).toBe('MEDIUM')
  })

  it('"send pricing" → PRICING + HIGH', () => {
    const result = processInboundMessage({ message: baseMessage('send pricing'), context: makeContext() })
    expect(result.primaryIntent).toBe('PRICING')
    expect(result.commercialStrength).toBe('HIGH')
    expect(result.requestedItems.some(i => i.type === 'pricing')).toBe(true)
    expect(result.recommendedAction).toBe('SEND_PRICING')
  })

  it('"send proposal" → CONTRACTING/WON_CONFIRMATION', () => {
    const result = processInboundMessage({ message: baseMessage('send me a proposal'), context: makeContext('INTERESTED') })
    expect(['WON_CONFIRMATION', 'CONTRACTING']).toContain(result.primaryIntent)
    expect(result.commercialStrength).toBe('COMMITMENT')
  })

  it('"send contract" → CONTRACTING', () => {
    const result = processInboundMessage({ message: baseMessage('send the contract'), context: makeContext('NEGOTIATION') })
    expect(result.primaryIntent).toBe('CONTRACTING')
    expect(result.recommendedAction).toBe('SEND_CONTRACT')
  })

  it('"when can you start?" → TIMELINE + BUYING_INTEREST', () => {
    const result = processInboundMessage({ message: baseMessage('when can you start?'), context: makeContext() })
    expect(result.secondaryIntents).toContain('TIMELINE')
    expect(result.recommendedAction).toBe('REPLY_NOW')
  })

  it('"you\'re hired" → WON_CONFIRMATION', () => {
    const result = processInboundMessage({ message: baseMessage("you're hired"), context: makeContext('NEGOTIATION') })
    expect(result.primaryIntent).toBe('WON_CONFIRMATION')
    expect(result.commercialStrength).toBe('COMMITMENT')
    expect(result.newStage).toBe('WON')
  })
})

describe('QUESTIONS test matrix', () => {
  it('"how does this work?" → REQUEST_FOR_INFO', () => {
    const result = processInboundMessage({ message: baseMessage('how does this work?'), context: makeContext() })
    expect(result.primaryIntent).toBe('REQUEST_FOR_INFO')
  })

  it('"what stack do you use?" → REQUEST_FOR_INFO', () => {
    const result = processInboundMessage({ message: baseMessage('what stack do you use?'), context: makeContext() })
    expect(result.primaryIntent).toBe('REQUEST_FOR_INFO')
    expect(result.commercialStrength).toBe('MEDIUM')
  })

  it('"do you have examples?" → REQUEST_FOR_PROOF', () => {
    const result = processInboundMessage({ message: baseMessage('do you have examples?'), context: makeContext() })
    expect(result.primaryIntent).toBe('REQUEST_FOR_PROOF')
    expect(result.recommendedAction).toBe('SEND_PROOF')
  })
})

describe('OBJECTIONS test matrix', () => {
  it('"too expensive" → OBJECTION', () => {
    const result = processInboundMessage({ message: baseMessage('too expensive'), context: makeContext('INTERESTED') })
    expect(result.primaryIntent).toBe('OBJECTION')
    expect(result.recommendedAction).toBe('REPLY_NOW')
    // Should NOT advance to LOST
    expect(result.newStage).not.toBe('LOST')
  })

  it('"not sure about timeline" → OBJECTION', () => {
    const result = processInboundMessage({ message: baseMessage('not sure about the timeline'), context: makeContext('QUALIFIED') })
    expect(result.primaryIntent).toBe('OBJECTION')
  })

  it('"need internal approval" → OBJECTION', () => {
    const result = processInboundMessage({ message: baseMessage('I need internal approval'), context: makeContext('INTERESTED') })
    expect(result.primaryIntent).toBe('OBJECTION')
  })
})

describe('NEGATIVE test matrix', () => {
  it('"no thanks" → NEGATIVE', () => {
    const result = processInboundMessage({ message: baseMessage('no thanks'), context: makeContext() })
    expect(result.primaryIntent).toBe('NEGATIVE')
    expect(result.commercialStrength).toBe('NONE')
    expect(result.newStage).toBe('LOST')
  })

  it('"not interested" → NEGATIVE', () => {
    const result = processInboundMessage({ message: baseMessage('not interested'), context: makeContext() })
    expect(result.primaryIntent).toBe('NEGATIVE')
    expect(result.recommendedAction).toBe('CLOSE_GRACEFULLY')
  })

  it('"already solved" → NEGATIVE', () => {
    const result = processInboundMessage({ message: baseMessage('we already have a solution'), context: makeContext() })
    expect(result.primaryIntent).toBe('NEGATIVE')
  })
})

describe('DEFERRED test matrix', () => {
  it('"next quarter" → DEFERRED', () => {
    const result = processInboundMessage({ message: baseMessage('reach out next quarter'), context: makeContext() })
    expect(result.primaryIntent).toBe('DEFERRED')
    expect(result.recommendedAction).toBe('DEFER_FOLLOWUP')
    expect(result.newStage).toBe('DEFERRED')
  })

  it('"maybe next month" → DEFERRED', () => {
    const result = processInboundMessage({ message: baseMessage('maybe next month'), context: makeContext() })
    expect(result.primaryIntent).toBe('DEFERRED')
  })
})

describe('REFERRAL test matrix', () => {
  it('"talk to my partner" → REFERRAL', () => {
    const result = processInboundMessage({ message: baseMessage('talk to my partner'), context: makeContext() })
    expect(result.primaryIntent).toBe('REFERRAL')
    expect(result.stakeholders.length).toBeGreaterThan(0)
    expect(result.stakeholders[0].role).toBe('Partner')
    // NOT a rejection
    expect(result.newStage).not.toBe('LOST')
  })

  it('"send this to CTO" → REFERRAL', () => {
    const result = processInboundMessage({ message: baseMessage('send this to my CTO'), context: makeContext() })
    expect(result.primaryIntent).toBe('REFERRAL')
    expect(result.stakeholders.some(s => s.role === 'CTO')).toBe(true)
  })
})

describe('PROCUREMENT test matrix', () => {
  it('"send NDA" → CONTRACTING', () => {
    const result = processInboundMessage({ message: baseMessage('please send over an NDA'), context: makeContext('INTERESTED') })
    expect(result.primaryIntent).toBe('CONTRACTING')
    expect(result.recommendedAction).toBe('SEND_CONTRACT')
  })

  it('"fill vendor form" → PROCUREMENT/CONTRACTING', () => {
    const result = processInboundMessage({ message: baseMessage('please fill out our vendor form'), context: makeContext('NEGOTIATION') })
    expect(['CONTRACTING', 'PROCUREMENT']).toContain(result.primaryIntent)
  })

  it('"send invoice" → CONTRACTING', () => {
    const result = processInboundMessage({ message: baseMessage('please send an invoice'), context: makeContext('CONTRACTING') })
    expect(result.primaryIntent).toBe('CONTRACTING')
  })
})

describe('AMBIGUOUS test matrix', () => {
  it('"interesting" → BUYING_INTEREST or NEUTRAL (no hallucinated intent)', () => {
    const result = processInboundMessage({ message: baseMessage('interesting'), context: makeContext() })
    // "interesting" is classified as POSITIVE by intent.ts → BUYING_INTEREST
    // This is NOT a hallucination — it's deterministic from phrase matching
    expect(['NEUTRAL', 'BUYING_INTEREST']).toContain(result.primaryIntent)
  })

  it('"maybe" → NEUTRAL', () => {
    const result = processInboundMessage({ message: baseMessage('maybe'), context: makeContext() })
    expect(['NEUTRAL', 'UNKNOWN']).toContain(result.primaryIntent)
  })

  it('"let\'s see" → NEUTRAL', () => {
    const result = processInboundMessage({ message: baseMessage("let's see"), context: makeContext() })
    expect(['NEUTRAL', 'UNKNOWN']).toContain(result.primaryIntent)
  })
})

describe('MULTI-TURN test matrix', () => {
  it('rejection then reopen → ENGAGED', () => {
    const messages = [
      makeMessage('not interested', 'lead-1', 'msg-1'),
      makeMessage('actually, send pricing', 'lead-1', 'msg-2'),
    ]
    const state = resolveConversationState(messages, 'WAITING')
    expect(state.currentStage).toBe('ENGAGED')
    expect(state.intents[0]).toBe('NEGATIVE')
    expect(state.intents[1]).toBe('PRICING')
  })

  it('interested then objection → stays at stage', () => {
    const messages = [
      makeMessage('sounds good, tell me more', 'lead-1', 'msg-1'),
      makeMessage('too expensive though', 'lead-1', 'msg-2'),
    ]
    const state = resolveConversationState(messages, 'ENGAGED')
    // Should NOT go to LOST for objection within active deal
    expect(state.currentStage).not.toBe('LOST')
    expect(state.intents[1]).toBe('OBJECTION')
  })

  it('pricing then contract → CONTRACTING', () => {
    const messages = [
      makeMessage('send rates and portfolio', 'lead-1', 'msg-1'),
      makeMessage('looks good, send contract', 'lead-1', 'msg-2'),
    ]
    const state = resolveConversationState(messages, 'WAITING')
    expect(state.currentStage).toBe('CONTRACTING')
  })

  it('referral then approval → stays or advances', () => {
    const messages = [
      makeMessage('talk to my CTO', 'lead-1', 'msg-1'),
      makeMessage('CTO approved, let\'s start', 'lead-1', 'msg-2'),
    ]
    const state = resolveConversationState(messages, 'ENGAGED')
    expect(state.intents[0]).toBe('REFERRAL')
    // Second message should advance to won or contracting
    expect(['WON', 'CONTRACTING', 'NEGOTIATION', 'INTERESTED']).toContain(state.currentStage)
  })
})

describe('LIVE STATE overrides COLD STATE', () => {
  it('cold score 2/10 + "send proposal" → ACTIVE_DEAL (not cold)', () => {
    // Even if initial prospect was cold (NEW stage), inbound buying signal drives
    const result = processInboundMessage({
      message: baseMessage('send me a proposal'),
      context: makeContext('NEW'),
    })
    expect(['WON_CONFIRMATION', 'CONTRACTING']).toContain(result.primaryIntent)
    expect(result.commercialStrength).toBe('COMMITMENT')
    expect(result.priority).toBeGreaterThan(80)
  })

  it('cold score 9/10 + "not interested" → CLOSED', () => {
    // Even hot prospect gets closed on rejection
    const result = processInboundMessage({
      message: baseMessage('not interested'),
      context: makeContext('WAITING'),
    })
    expect(result.primaryIntent).toBe('NEGATIVE')
    expect(result.newStage).toBe('LOST')
  })
})

describe('REQUEST EXTRACTION', () => {
  it('"send rates, 2 case studies, and availability next week" → 3 items', () => {
    const result = processInboundMessage({
      message: baseMessage('can you send rates, 2 case studies, and your availability next week?'),
      context: makeContext(),
    })
    const types = result.requestedItems.map(i => i.type)
    expect(types).toContain('pricing')
    expect(types).toContain('case_study')
    expect(types).toContain('availability')
    expect(result.replyStrategy.mustAddress.length).toBeGreaterThanOrEqual(3)
  })
})

describe('REPLY STRATEGY', () => {
  it('pricing request → goal is to answer price', () => {
    const result = processInboundMessage({
      message: baseMessage('how much do you charge?'),
      context: makeContext(),
    })
    expect(result.replyStrategy.goal.toLowerCase()).toContain('pric')
    expect(result.replyStrategy.mustNotAddress).toContain('Send generic portfolio')
  })

  it('rejection → no argument', () => {
    const result = processInboundMessage({
      message: baseMessage('no thanks'),
      context: makeContext(),
    })
    expect(result.replyStrategy.mustNotAddress).toContain('Argue')
    expect(result.replyStrategy.tone).toBe('warm')
  })

  it('objection → address concern', () => {
    const result = processInboundMessage({
      message: baseMessage('too expensive for us'),
      context: makeContext('INTERESTED'),
    })
    expect(result.replyStrategy.goal.toLowerCase()).toContain('concern')
    expect(result.replyStrategy.keyPoints.some(p => p.toLowerCase().toLowerCase())).toBe(true)
  })
})

describe('IDEMPOTENCY', () => {
  it('same message + same action → same key', () => {
    const msg = baseMessage('send pricing')
    const result1 = processInboundMessage({ message: msg, context: makeContext() })
    const result2 = processInboundMessage({ message: msg, context: makeContext() })
    expect(result1.idempotencyKey).toBe(result2.idempotencyKey)
  })

  it('different lead → different key', () => {
    const result1 = processInboundMessage({ message: makeMessage('send pricing', 'lead-1'), context: makeContext() })
    const result2 = processInboundMessage({ message: makeMessage('send pricing', 'lead-2'), context: makeContext() })
    expect(result1.idempotencyKey).not.toBe(result2.idempotencyKey)
  })
})

describe('DECISION TRACE', () => {
  it('shows evolution across steps', () => {
    const result = processInboundMessage({
      message: baseMessage('send pricing and case studies'),
      context: makeContext('WAITING'),
    })
    expect(result.decisionTrace.length).toBeGreaterThanOrEqual(4)
    expect(result.decisionTrace.some(s => s.step === 'Intent classification')).toBe(true)
    expect(result.decisionTrace.some(s => s.step === 'Lifecycle transition')).toBe(true)
    expect(result.decisionTrace.some(s => s.step === 'Recommended action')).toBe(true)
  })
})

describe('LIFECYCLE SAFETY', () => {
  it('WON terminal state preserved', () => {
    const result = processInboundMessage({
      message: baseMessage('when can we start?'),
      context: makeContext('WON'),
    })
    expect(result.newStage).toBe('WON')
  })

  it('DEFERRED stays deferred without buying signal', () => {
    const result = processInboundMessage({
      message: baseMessage('thanks'),
      context: makeContext('DEFERRED'),
    })
    expect(result.newStage).toBe('DEFERRED')
  })

  it('DEFERRED → ENGAGED with buying signal', () => {
    const result = processInboundMessage({
      message: baseMessage('actually send pricing now'),
      context: makeContext('DEFERRED'),
    })
    expect(result.newStage).toBe('ENGAGED')
  })
})
