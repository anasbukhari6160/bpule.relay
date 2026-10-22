/**
 * Outcome taxonomy: a reply is never automatically success.
 */
import { describe, expect, it } from 'vitest'
import {
  bestOutcome,
  classifyInboundReply,
  currentOutcome,
  isBetterOutcome,
  outcomeFromConversationStage,
  outcomeFromLeadStatus,
  outcomeFromStoredStage,
} from '@/lib/sales/outcomes'

describe('sales outcome taxonomy', () => {
  it('orders outcomes from WON down to DO_NOT_CONTACT', () => {
    expect(isBetterOutcome('WON', 'MEETING')).toBe(true)
    expect(isBetterOutcome('DO_NOT_CONTACT', 'NO_RESPONSE')).toBe(false)
    expect(bestOutcome(['NO_RESPONSE', 'MEETING', 'POSITIVE_REPLY'])).toBe('MEETING')
    expect(bestOutcome([])).toBeNull()
  })

  it('maps lead status without treating a reply as success', () => {
    expect(outcomeFromLeadStatus('won')).toBe('WON')
    expect(outcomeFromLeadStatus('replied')).toBe('POSITIVE_REPLY')
    expect(outcomeFromLeadStatus('dead')).toBe('DO_NOT_CONTACT')
    expect(outcomeFromLeadStatus('new')).toBe('NO_RESPONSE')
  })

  it('maps conversation stages', () => {
    expect(outcomeFromConversationStage('proposal')).toBe('PROPOSAL')
    expect(outcomeFromConversationStage('qualifying')).toBe('QUALIFIED_OPPORTUNITY')
    expect(outcomeFromConversationStage('interested')).toBe('POSITIVE_COMMERCIAL_REPLY')
    expect(outcomeFromConversationStage('lost')).toBe('LOST')
  })

  it('maps the stored outcome stages', () => {
    expect(outcomeFromStoredStage('replied')).toBe('POSITIVE_REPLY')
    expect(outcomeFromStoredStage('meeting')).toBe('MEETING')
    expect(outcomeFromStoredStage(null)).toBe('POSITIVE_REPLY')
  })

  it('classifies a hostile reply as DO_NOT_CONTACT, not a reply', () => {
    expect(classifyInboundReply('Please stop messaging me')).toBe('DO_NOT_CONTACT')
    expect(classifyInboundReply('Not interested, thanks')).toBe('NEGATIVE')
    expect(classifyInboundReply('Can you share pricing and a start date?')).toBe('POSITIVE_COMMERCIAL_REPLY')
    expect(classifyInboundReply('Thanks!')).toBe('POSITIVE_REPLY')
    expect(classifyInboundReply('')).toBe('NO_RESPONSE')
  })

  it('takes the best signal across every source', () => {
    expect(currentOutcome({
      leadStatus: 'replied',
      conversationStage: 'meeting',
      storedStages: ['replied'],
      inboundReplies: ['stop messaging me'],
    })).toBe('MEETING')
    expect(currentOutcome({ leadStatus: 'new' })).toBe('NO_RESPONSE')
    expect(currentOutcome({})).toBe('NO_RESPONSE')
  })
})
