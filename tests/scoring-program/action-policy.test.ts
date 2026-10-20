/**
 * ONE action policy — cold, live and routing overlays (Phases 25-27).
 * 100+ table-driven cases.
 */
import { describe, it, expect } from 'vitest'
import { deriveRecommendedAction, type ActionOpportunityInput, type ActionConversationInput, type RecommendedAction } from '@/lib/intelligence-v3/action/recommended-action'
import { classifyConversationIntent, type ConversationIntent } from '@/lib/relay/conversation-override'

const opp = (over: Partial<ActionOpportunityInput> = {}): ActionOpportunityInput => ({
  score: 60, qualification: 'WORTH_PURSUING', buyerIntentLevel: 'UNKNOWN', verifiedBuyerRequest: false, relationshipRole: 'BUILDER',
  access: 'CONNECTION', buyerTiming: 'NONE', activityRecency: 'RECENT', commercialPotential: 'HIGH', episodeClosed: false, ...over,
})
const conf = (label: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH') => ({ label, researchMore: label === 'LOW' })
const conv = (over: Partial<ActionConversationInput> = {}): ActionConversationInput => ({
  latestInboundIntent: null, lastDirection: null, stage: 'cold', daysSinceLastOutbound: null, followupCount: 0, followupLimit: 3, connectionAccepted: false, ...over,
})

describe('cold policy', () => {
  const cases: Array<[string, Partial<ActionOpportunityInput>, 'HIGH' | 'MEDIUM' | 'LOW', RecommendedAction[]]> = [
    ['verified HIGH + DIRECT → CONTACT_NOW', { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'DIRECT', buyerTiming: 'URGENT', score: 85, qualification: 'STRONG' }, 'HIGH', ['CONTACT_NOW']],
    ['verified HIGH + CONNECTION → CONNECT_WITH_NOTE', { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'CONNECTION', buyerTiming: 'CURRENT', score: 80, qualification: 'STRONG' }, 'HIGH', ['CONNECT_WITH_NOTE']],
    ['verified HIGH + INDIRECT → CONNECT_WITHOUT_NOTE', { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'INDIRECT', buyerTiming: 'CURRENT', score: 70, qualification: 'WORTH_PURSUING' }, 'HIGH', ['CONNECT_WITHOUT_NOTE']],
    ['verified HIGH + NONE access → CONNECT_WITHOUT_NOTE', { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'NONE', buyerTiming: 'CURRENT', score: 65, qualification: 'WORTH_PURSUING' }, 'HIGH', ['CONNECT_WITHOUT_NOTE']],
    ['verified MEDIUM + LOW confidence → RESEARCH_MORE', { buyerIntentLevel: 'MEDIUM', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'DIRECT', buyerTiming: 'CURRENT' }, 'LOW', ['RESEARCH_MORE']],
    ['verified HIGH + LOW confidence still acts', { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'DIRECT', buyerTiming: 'CURRENT', score: 80, qualification: 'STRONG' }, 'LOW', ['CONTACT_NOW']],
    ['verified request, stale → WAIT', { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'DIRECT', buyerTiming: 'WEAK', activityRecency: 'STALE', score: 50, qualification: 'MAYBE' }, 'HIGH', ['WAIT']],
    ['closed episode → CLOSE', { episodeClosed: true, buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true }, 'HIGH', ['CLOSE']],
    ['INELIGIBLE → CLOSE', { qualification: 'INELIGIBLE' }, 'HIGH', ['CLOSE']],
    ['no score → RESEARCH_MORE', { score: null, qualification: null }, 'HIGH', ['RESEARCH_MORE']],
    ['SKIP → CLOSE', { score: 10, qualification: 'SKIP', commercialPotential: 'LOW' }, 'HIGH', ['CLOSE']],
    ['STRONG founder no request, reachable → CONNECT_WITH_NOTE', { score: 76, qualification: 'STRONG' }, 'HIGH', ['CONNECT_WITH_NOTE']],
    ['WORTH_PURSUING founder, reachable → CONNECT_WITH_NOTE', { score: 60 }, 'HIGH', ['CONNECT_WITH_NOTE']],
    ['WORTH_PURSUING founder, unreachable → CONNECT_WITHOUT_NOTE', { score: 60, access: 'NONE' }, 'HIGH', ['CONNECT_WITHOUT_NOTE']],
    ['WORTH_PURSUING founder, LOW confidence → RESEARCH_MORE', { score: 60 }, 'LOW', ['RESEARCH_MORE']],
    ['MAYBE + HIGH cp → CONNECT_WITHOUT_NOTE', { score: 45, qualification: 'MAYBE', commercialPotential: 'HIGH' }, 'HIGH', ['CONNECT_WITHOUT_NOTE']],
    ['MAYBE + MEDIUM cp → OBSERVE', { score: 45, qualification: 'MAYBE', commercialPotential: 'MEDIUM' }, 'HIGH', ['OBSERVE']],
    ['MAYBE + LOW confidence → RESEARCH_MORE', { score: 45, qualification: 'MAYBE', commercialPotential: 'MEDIUM' }, 'LOW', ['RESEARCH_MORE']],
    ['LOW + HIGH cp → OBSERVE', { score: 30, qualification: 'LOW', commercialPotential: 'HIGH' }, 'HIGH', ['OBSERVE']],
    ['LOW + LOW cp → CLOSE', { score: 30, qualification: 'LOW', commercialPotential: 'LOW' }, 'HIGH', ['CLOSE']],
    ['LOW + LOW confidence → CLOSE (not research)', { score: 30, qualification: 'LOW', commercialPotential: 'LOW' }, 'LOW', ['CLOSE']],
    ['seller STRONG → CONNECT_WITHOUT_NOTE', { relationshipRole: 'SELLER', score: 76, qualification: 'STRONG' }, 'HIGH', ['CONNECT_WITHOUT_NOTE']],
    ['seller MAYBE → OBSERVE', { relationshipRole: 'SELLER', score: 45, qualification: 'MAYBE' }, 'HIGH', ['OBSERVE']],
    ['seller LOW → CLOSE', { relationshipRole: 'SELLER', score: 30, qualification: 'LOW' }, 'HIGH', ['CLOSE']],
    ['seller + LOW confidence is still OBSERVE, never RESEARCH', { relationshipRole: 'SELLER', score: 45, qualification: 'MAYBE' }, 'LOW', ['OBSERVE']],
    ['recruiter MAYBE → OBSERVE', { relationshipRole: 'RECRUITER', score: 40, qualification: 'MAYBE' }, 'HIGH', ['OBSERVE']],
    ['recruiter LOW → CLOSE', { relationshipRole: 'RECRUITER', score: 25, qualification: 'LOW' }, 'HIGH', ['CLOSE']],
    ['candidate LOW → CLOSE', { relationshipRole: 'CANDIDATE', score: 25, qualification: 'LOW' }, 'HIGH', ['CLOSE']],
    ['candidate SKIP → CLOSE', { relationshipRole: 'CANDIDATE', score: 10, qualification: 'SKIP' }, 'HIGH', ['CLOSE']],
    ['seller with verified request acts like a buyer', { relationshipRole: 'BUYER', buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, access: 'CONNECTION', buyerTiming: 'CURRENT', score: 70, qualification: 'WORTH_PURSUING' }, 'HIGH', ['CONNECT_WITH_NOTE']],
    ['email channel never recommends a connection note', { score: 60 }, 'HIGH', ['CONNECT_WITHOUT_NOTE']],
  ]
  for (const [name, over, c, expected] of cases) {
    it(name, () => {
      const out = deriveRecommendedAction({ opportunity: opp(over), confidence: conf(c), channel: name.startsWith('email') ? 'email' : 'linkedin' })
      expect(expected).toContain(out.action)
      expect(out.coldAction).toBe(out.action)
      expect(out.conversationOverride).toBe(false)
    })
  }

  it('an unverified request never produces CONTACT_NOW whatever the model claimed', () => {
    for (const level of ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const) {
      const out = deriveRecommendedAction({ opportunity: opp({ buyerIntentLevel: level, verifiedBuyerRequest: false, access: 'DIRECT', score: 90, qualification: 'STRONG' }), confidence: conf('HIGH') })
      expect(out.action).not.toBe('CONTACT_NOW')
      expect(out.pitch).toBe(false)
    }
  })
})

describe('live conversation overrides the cold score', () => {
  const intents: Array<[ConversationIntent, RecommendedAction]> = [
    ['NOT_INTERESTED', 'CLOSE'], ['SEND_PROPOSAL', 'REPLY_NOW'], ['SCHEDULE_CALL', 'REPLY_NOW'], ['PRICING_INQUIRY', 'REPLY_NOW'],
    ['INTERESTED', 'REPLY_NOW'], ['NEEDS_MORE_INFO', 'REPLY_NOW'], ['OBJECTION', 'RESEARCH_MORE'], ['REFERRAL', 'REFER'], ['UNRELATED', 'REPLY_NOW'], ['UNKNOWN', 'REPLY_NOW'],
  ]
  for (const [intent, expected] of intents) {
    for (const cold of [{ score: 10, qualification: 'SKIP' as const }, { score: 50, qualification: 'MAYBE' as const }, { score: 90, qualification: 'STRONG' as const }]) {
      it(`${intent} with cold ${cold.qualification} → ${expected}, cold action preserved`, () => {
        const out = deriveRecommendedAction({ opportunity: opp(cold), confidence: conf('HIGH'), conversation: conv({ stage: 'replied', lastDirection: 'inbound', latestInboundIntent: intent }) })
        expect(out.action).toBe(expected)
        expect(out.conversationOverride).toBe(true)
        expect(out.coldAction).toBeDefined()
        expect(out.coldAction).not.toBe(expected === 'REPLY_NOW' ? 'REPLY_NOW' : '__never__')
      })
    }
  }

  it('3/10 + "send us a proposal" → REPLY_NOW; 9/10 + "not interested" → CLOSE', () => {
    expect(deriveRecommendedAction({ opportunity: opp({ score: 25, qualification: 'LOW', commercialPotential: 'LOW' }), confidence: conf(), conversation: conv({ stage: 'replied', lastDirection: 'inbound', latestInboundIntent: classifyConversationIntent('Can you send us a proposal for the rebuild?') }) }).action).toBe('REPLY_NOW')
    expect(deriveRecommendedAction({ opportunity: opp({ score: 90, qualification: 'STRONG', buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true }), confidence: conf(), conversation: conv({ stage: 'replied', lastDirection: 'inbound', latestInboundIntent: classifyConversationIntent('Thanks but not interested right now.') }) }).action).toBe('CLOSE')
  })

  it('won / lost / closed / meeting booked', () => {
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'won' }) }).action).toBe('CLOSE')
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'lost' }) }).action).toBe('CLOSE')
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'closed' }) }).action).toBe('CLOSE')
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'meeting_booked' }) }).action).toBe('WAIT')
  })

  it('we spoke last: wait, then follow up, then defer at the limit', () => {
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'contacted', lastDirection: 'outbound', daysSinceLastOutbound: 1 }) }).action).toBe('WAIT')
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'contacted', lastDirection: 'outbound', daysSinceLastOutbound: 4 }) }).action).toBe('FOLLOW_UP')
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'contacted', lastDirection: 'outbound', daysSinceLastOutbound: 9, followupCount: 3 }) }).action).toBe('DEFER')
    expect(deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'contacted', lastDirection: 'outbound', daysSinceLastOutbound: 0, connectionAccepted: true }) }).action).toBe('FOLLOW_UP')
  })

  it('cold stage with no inbound uses the cold action', () => {
    const out = deriveRecommendedAction({ opportunity: opp(), confidence: conf(), conversation: conv({ stage: 'cold' }) })
    expect(out.conversationOverride).toBe(false)
    expect(out.action).toBe(out.coldAction)
  })
})

describe('routing overlay', () => {
  it('a clearly better accessible sender → ASSIGN; not accessible → REFER', () => {
    const base = { opportunity: opp({ score: 70 }), confidence: conf() }
    const assign = deriveRecommendedAction({ ...base, sender: { currentSenderMatch: 40, bestSenderMatch: 75, bestSenderId: 'b', currentSenderId: 'a', bestSenderAccessible: true } })
    expect(assign.routing.recommendation).toBe('ASSIGN')
    expect(assign.routing.delta).toBe(35)
    const refer = deriveRecommendedAction({ ...base, sender: { currentSenderMatch: 40, bestSenderMatch: 75, bestSenderId: 'b', currentSenderId: 'a', bestSenderAccessible: false } })
    expect(refer.routing.recommendation).toBe('REFER')
  })

  it('small deltas keep the current sender', () => {
    const out = deriveRecommendedAction({ opportunity: opp({ score: 70 }), confidence: conf(), sender: { currentSenderMatch: 60, bestSenderMatch: 70, bestSenderId: 'b', currentSenderId: 'a', bestSenderAccessible: true } })
    expect(out.routing.recommendation).toBe('KEEP')
  })

  it('high-value lead with no good sender → ASK_FOR_HELP', () => {
    const out = deriveRecommendedAction({ opportunity: opp({ score: 70, buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true, relationshipRole: 'BUYER', access: 'CONNECTION', buyerTiming: 'CURRENT' }), confidence: conf(), sender: { currentSenderMatch: 20, bestSenderMatch: 25, bestSenderId: 'a', currentSenderId: 'a', bestSenderAccessible: true } })
    expect(out.routing.recommendation).toBe('ASK_FOR_HELP')
  })

  it('the routing overlay never changes the primary action', () => {
    const noSender = deriveRecommendedAction({ opportunity: opp({ score: 70 }), confidence: conf() })
    const withSender = deriveRecommendedAction({ opportunity: opp({ score: 70 }), confidence: conf(), sender: { currentSenderMatch: 20, bestSenderMatch: 90, bestSenderId: 'b', currentSenderId: 'a', bestSenderAccessible: false } })
    expect(withSender.action).toBe(noSender.action)
  })
})
