/**
 * Conversation Override Tests
 *
 * Validates that live conversation intent overrides cold score.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveAction,
  classifyConversationIntent,
  type ConversationState,
} from '@/lib/relay/conversation-override'

function makeConversation(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    latestInboundIntent: 'UNKNOWN',
    lastInboundAt: '2026-01-15T10:00:00Z',
    stage: 'contacted',
    messageCount: 3,
    lastInboundQuote: null,
    ...overrides,
  }
}

describe('Conversation Override', () => {
  describe('no conversation → cold score wins', () => {
    it('uses cold score when no conversation exists', () => {
      const result = resolveEffectiveAction(65, 'CONNECT_WITH_NOTE', null)

      expect(result.effectiveAction).toBe('CONNECT_WITH_NOTE')
      expect(result.conversationOverride).toBe(false)
      expect(result.reason).toContain('cold score')
    })

    it('uses cold score when stage is cold', () => {
      const conv = makeConversation({ stage: 'cold' })
      const result = resolveEffectiveAction(45, 'OBSERVE', conv)

      expect(result.effectiveAction).toBe('OBSERVE')
      expect(result.conversationOverride).toBe(false)
    })
  })

  describe('conversation overrides cold score', () => {
    it('NOT_INTERESTED overrides high cold score', () => {
      const conv = makeConversation({ latestInboundIntent: 'NOT_INTERESTED' })
      const result = resolveEffectiveAction(85, 'CONTACT_NOW', conv)

      expect(result.effectiveAction).toBe('CLOSED')
      expect(result.conversationOverride).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('SEND_PROPOSAL overrides low cold score', () => {
      const conv = makeConversation({ latestInboundIntent: 'SEND_PROPOSAL' })
      const result = resolveEffectiveAction(15, 'SKIP', conv)

      expect(result.effectiveAction).toBe('REPLY_NOW')
      expect(result.conversationOverride).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('PRICING_INQUIRY creates buying signal', () => {
      const conv = makeConversation({ latestInboundIntent: 'PRICING_INQUIRY' })
      const result = resolveEffectiveAction(30, 'OBSERVE', conv)

      expect(result.effectiveAction).toBe('ENGAGE')
      expect(result.conversationOverride).toBe(true)
    })

    it('INTERESTED overrides OBSERVE', () => {
      const conv = makeConversation({ latestInboundIntent: 'INTERESTED' })
      const result = resolveEffectiveAction(25, 'OBSERVE', conv)

      expect(result.effectiveAction).toBe('ENGAGE')
      expect(result.conversationOverride).toBe(true)
    })
  })

  describe('cold score preserved in trace', () => {
    it('always preserves cold score', () => {
      const conv = makeConversation({ latestInboundIntent: 'NOT_INTERESTED' })
      const result = resolveEffectiveAction(90, 'CONTACT_NOW', conv)

      expect(result.coldScore).toBe(90)
      expect(result.preserveColdScore).toBe(true)
    })
  })

  describe('classifyConversationIntent', () => {
    it.each([
      ['We are not interested, thanks', 'NOT_INTERESTED'],
      ['Not a fit right now', 'NOT_INTERESTED'],
      ['Send us a proposal', 'SEND_PROPOSAL'],
      ['Please send us your pricing', 'SEND_PROPOSAL'],
      ['How much does it cost?', 'PRICING_INQUIRY'],
      ['What are your rates?', 'PRICING_INQUIRY'],
      ['Tell me more about your services', 'NEEDS_MORE_INFO'],
      ['Sounds good, let us talk', 'INTERESTED'],
      ['We are too expensive for our budget', 'OBJECTION'],
      ['Talk to Sarah she handles this', 'REFERRAL'],
    ])('classifies "%s" as %s', (text, expected) => {
      expect(classifyConversationIntent(text)).toBe(expected)
    })

    it('returns UNKNOWN for unclear messages', () => {
      expect(classifyConversationIntent('')).toBe('UNKNOWN')
      expect(classifyConversationIntent('k')).toBe('UNKNOWN')
    })
  })
})
