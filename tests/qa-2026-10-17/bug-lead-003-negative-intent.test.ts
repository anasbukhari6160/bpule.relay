/** BUG-LEAD-003 — explicit rejection is negative and closes the sales thread. */
import { describe, expect, it } from 'vitest'
import { classifyClientMessage, resolveConversationIntent } from '@/lib/conversation/intent'
import { analyzeReply } from '@/lib/relay/conversation-engine'
import { normalizeIntent } from '@/lib/conversation/memory'
import { deriveDealStage, goalFor } from '@/lib/conversation/stage'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import { determineFollowup } from '@/lib/relay/followup-engine'
import { emptyMemory } from '@/lib/conversation/types'
import { leadDetail, msg } from './helpers'

const ctx = { leadId: 'l', leadCompany: 'Acme', contactName: 'Sam', replyText: '', priorMessages: [], conversationStage: 'replied' as const, senderProfileId: null }

describe('BUG-LEAD-003 negative intent', () => {
  it('reported: "I\'M NOT INTERESTED PLEASE TRY AGAIN" then "ok bye" → NEGATIVE, closed', () => {
    const first = analyzeReply("I'M NOT INTERESTED PLEASE TRY AGAIN", ctx)
    expect(first.intent).toBe('not_interested')
    expect(first.buyingSignal).toBe(false)
    const conv = resolveConversationIntent(["I'M NOT INTERESTED PLEASE TRY AGAIN", 'ok bye'])
    expect(conv.declined).toBe(true)
    expect(conv.class).toBe('NEGATIVE')
  })

  it.each([
    ['not interested', 'NEGATIVE'],
    ['No thanks, we are good.', 'NEGATIVE'],
    ['Please stop messaging me', 'NEGATIVE'],
    ['remove me from your list', 'NEGATIVE'],
    ['Not really interested at this point', 'NEGATIVE'],
    ["I'm no longer interested", 'NEGATIVE'],
    ['unsubscribe', 'NEGATIVE'],
    ["You have the wrong person, I don't handle this", 'NEGATIVE'],
    ['Not now, maybe later', 'DEFERRED'],
    ['maybe later', 'DEFERRED'],
    ["Let's talk next quarter", 'DEFERRED'],
    ['ok bye', 'CLOSED'],
    ['Thanks, take care', 'CLOSED'],
    ['Sure, send details', 'POSITIVE'],
    ['what is your rate?', 'QUESTION'],
    ['Can you share your portfolio', 'POSITIVE'],
    ['Please send the JD', 'POSITIVE'],
    ['Sounds interesting, tell me more', 'POSITIVE'],
  ])('%s → %s', (text, cls) => {
    expect(classifyClientMessage(text).class).toBe(cls)
  })

  // Independent-review break attempts: mixed or positive messages must never close a lead.
  it.each([
    'not interested in a full-time role but open to contract work',
    "We're all set for Tuesday's call",
    'No need to apologize, very interested!',
    "I don't need a deck, just send your rates",
    'Not looking for a freelancer, we want an agency. What are your rates?',
    'Not sure if interested, tell me more',
    'Never been more interested, call me',
    "I'm not sure I'm interested yet but tell me more",
    'No problem, send details',
  ])('not a rejection: %s', (text) => {
    expect(classifyClientMessage(text).class).not.toBe('NEGATIVE')
    expect(resolveConversationIntent([text]).declined).toBe(false)
  })

  // Re-review break attempts: a courtesy after "but" does not soften a no.
  it.each([
    ['Not interested, but thanks for asking', 'NEGATIVE'],
    ['Not interested, but thank you', 'NEGATIVE'],
    ['No thanks, but good luck!', 'NEGATIVE'],
    ["We're all set, but thanks anyway", 'NEGATIVE'],
    ['Not interested, we already have an agency, but appreciate it', 'NEGATIVE'],
    ['Not interested at this time, but feel free to reach out in the future', 'DEFERRED'],
    ['Thanks but no thanks', 'NEGATIVE'],
    ['No thanks, but happy to stay in touch', 'NEGATIVE'],
    ["No, we're not interested. Why do you ask?", 'NEGATIVE'],
    ['Honestly we are not interested. How did you get my email?', 'NEGATIVE'],
    ['Not really interested, what is your rate anyway?', 'QUESTION'],
    ['Not interested in full-time, but could you do a 3 month contract?', 'QUESTION'],
    ['No thanks for now, but send your rates and portfolio', 'QUESTION'],
    // Second re-review: courtesy wording is open-ended, so a "no" holds unless a buying cue follows.
    ['Not interested but appreciate you reaching out', 'NEGATIVE'],
    ['Not for us, but I appreciate you thinking of us', 'NEGATIVE'],
    ["We're not interested, but thanks. Cheers, John", 'NEGATIVE'],
    ['Not interested, but thanks!\nBest,\nMaria', 'NEGATIVE'],
    ['Not interested but thanks a ton', 'NEGATIVE'],
    ['Not interested, but thanks for the message, really', 'NEGATIVE'],
    ['Not interested, though our CFO says hi', 'NEGATIVE'],
    ['No thanks, but keep me posted', 'DEFERRED'],
    ['Not interested, but thanks, maybe next year', 'DEFERRED'],
    ['Thanks for reaching out, but send your rates', 'QUESTION'],
    ['No problem, but happy to hop on a call', 'POSITIVE'],
    ['No thanks, but could you send me your portfolio?', 'POSITIVE'],
    ['Not interested. Who is this?', 'NEGATIVE'],
    ['Not interested, but how did you find me?', 'NEGATIVE'],
  ])('polite refusal: %s → %s', (text, cls) => {
    expect(classifyClientMessage(text).class).toBe(cls)
  })

  // Third re-review: a client ready to buy, phrased with "don't need" / "not interested in…", is never closed.
  it.each([
    ['not a fit right now, but send over a proposal', 'POSITIVE'],
    ["We don't need anything else, please send the contract", 'POSITIVE'],
    ["We don't need to see more, we're ready to sign", 'POSITIVE'],
    ['No need for more slides, when can you start?', 'POSITIVE'],
    ["I'm not interested in waiting, can we start next week?", 'POSITIVE'],
    ['Not looking any further, you are hired', 'POSITIVE'],
    ["We don't need a demo. What are the next steps?", 'POSITIVE'],
    ['No thanks on the deck. Could you start on Monday?', 'POSITIVE'],
  ])('ready to buy: %s → %s', (text, cls) => {
    expect(classifyClientMessage(text).class).toBe(cls)
  })

  it('polite refusal, rep acknowledges, then six weeks of silence → still no follow-up', () => {
    for (const refusal of [
      'Not interested, but thanks for asking',
      'No thanks, but good luck!',
      "We're all set, but thanks anyway",
      'Not interested but appreciate you reaching out',
      "We're not interested, but thanks. Cheers, John",
      'Not for us, but I appreciate you thinking of us',
    ]) {
      const messages = [
        msg({ type: 'dm', sentText: 'Hi Sam, quick question about the app.', sentAt: '2026-09-01T10:00:00Z' }),
        msg({ type: 'reply', direction: 'inbound', sentText: refusal, sentAt: '2026-09-02T10:00:00Z' }),
        msg({ type: 'reply', sentText: 'Understood, thanks Sam.', sentAt: '2026-09-02T11:00:00Z' }),
      ]
      const lead = leadDetail(messages, { status: 'replied' })
      const now = new Date('2026-10-15T00:00:00Z')
      expect(deriveNextLeadAction(lead, now.getTime()).action).toBe('CLOSED')
      const f = determineFollowup({ lead, priorMessages: messages, conversationStage: 'replied', senderProfileId: null, followupCount: 0, lastSentAt: '2026-09-02T11:00:00Z', lastReplyAt: '2026-09-02T10:00:00Z', now })
      expect(f.shouldFollowUp).toBe(false)
      expect(resolveConversationIntent([refusal, 'ok bye']).declined).toBe(true)
    }
  })

  it('a meeting proposal is interest', () => {
    expect(classifyClientMessage("Let's meet next week").intent).toBe('meeting_request')
    expect(classifyClientMessage('Can we jump on a call next week to discuss?').intent).toBe('meeting_request')
  })

  it('latest explicit meaning wins; a later real question reopens', () => {
    expect(resolveConversationIntent(['Sure, send details', 'Actually not interested']).declined).toBe(true)
    expect(resolveConversationIntent(['not interested', 'thanks']).declined).toBe(true)
    expect(resolveConversationIntent(['not interested', 'Wait, what is your rate?']).declined).toBe(false)
    expect(resolveConversationIntent(['Sounds good', 'ok bye']).declined).toBe(false)
  })

  it('model labels with spaces never read as interested', () => {
    expect(normalizeIntent('not interested')).toBe('not_interested')
    expect(normalizeIntent('Not Really Interested')).toBe('not_interested')
    expect(normalizeIntent('uninterested')).toBe('not_interested')
    expect(normalizeIntent('interested')).toBe('interested')
  })

  it('lifecycle: no reply prompt, no follow-up, stage lost, composer closes gracefully', () => {
    const messages = [
      msg({ type: 'dm', sentText: 'Hi Sam, quick question about the app.', sentAt: '2026-10-01T10:00:00Z' }),
      msg({ type: 'reply', direction: 'inbound', sentText: "I'M NOT INTERESTED PLEASE TRY AGAIN", sentAt: '2026-10-02T10:00:00Z' }),
      msg({ type: 'reply', direction: 'inbound', sentText: 'ok bye', sentAt: '2026-10-02T10:05:00Z' }),
    ]
    const lead = leadDetail(messages, { status: 'replied' })
    const action = deriveNextLeadAction(lead, Date.parse('2026-10-20T00:00:00Z'))
    expect(action.action).toBe('CLOSED')
    expect(action.closedReason).toBe('client_declined')
    const f = determineFollowup({ lead, priorMessages: messages, conversationStage: 'replied', senderProfileId: null, followupCount: 0, lastSentAt: '2026-10-01T10:00:00Z', lastReplyAt: null, now: new Date('2026-10-20T00:00:00Z') })
    expect(f.shouldFollowUp).toBe(false)
    const thread = [
      { id: 'a', role: 'me' as const, kind: 'dm' as const, text: 'Hi', at: '1' },
      { id: 'b', role: 'client' as const, kind: 'reply' as const, text: "I'M NOT INTERESTED", at: '2' },
      { id: 'c', role: 'client' as const, kind: 'reply' as const, text: 'ok bye', at: '3' },
    ]
    expect(deriveDealStage(lead, thread, null)).toBe('lost')
    const memory = { ...emptyMemory(), lastClientAnalysis: { turnId: 'c', intent: 'not_interested' as const, sentiment: 'negative' as const, questions: [], buyingSignals: [], summary: '' } }
    const g = goalFor('lost', 'reply', memory)
    expect(g.allowCallAsk).toBe(false)
    expect(g.goal).toMatch(/gracefully|politely/i)
  })

  it('control: a positive reply still asks for our reply', () => {
    const lead = leadDetail([
      msg({ type: 'dm', sentText: 'Hi', sentAt: '2026-10-01T10:00:00Z' }),
      msg({ type: 'reply', direction: 'inbound', sentText: 'Sounds interesting, send details', sentAt: '2026-10-02T10:00:00Z' }),
    ], { status: 'replied' })
    expect(deriveNextLeadAction(lead).action).toBe('SEND_REPLY')
  })
})
