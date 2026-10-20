/**
 * Conversation system: thread, memory, deal stage, composer, send logging
 * and turn-taking, end to end on the in-memory store. The AI runtime is
 * mocked so no paid calls run; every prompt it receives is recorded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ schemaName?: string; system: string; user: string; tier?: string }> = []
let composeQueue: Array<Record<string, unknown>> = []

vi.mock('@/lib/ai/runtime', () => ({
  generate: vi.fn(async (opts: { schemaName?: string; system: string; user: string; tier?: string }) => {
    calls.push(opts)
    if (opts.schemaName === 'client_turn_analysis') {
      const interested = /budget|timeline|call/i.test(opts.user.split('Analyze the latest')[0].split('\n').filter((l) => l.startsWith('Client')).at(-1) ?? '')
      return {
        data: {
          intent: interested ? 'interested' : 'question',
          sentiment: 'positive',
          questions: ['How long would a portal like this take?'],
          buyingSignals: interested ? ['Asked about timeline'] : [],
          summary: 'Asked how long the portal would take.',
          need: 'Customer portal in React',
          timeline: interested ? 'Start next month' : null,
          budget: null,
          decisionMaker: null,
          objections: [],
          nextStepNotes: null,
          alreadyShared: ['Built a React portal for a logistics client'],
        },
        trace: { model: 'mock-mini' },
      }
    }
    if (opts.schemaName === 'conversation_summary') {
      return { data: { summary: 'Earlier: intro and portal discussion.' }, trace: { model: 'mock-mini' } }
    }
    const next = composeQueue.shift() ?? {
      message: 'Usually 6 to 8 weeks for a portal like that, depending on the integrations. What does the portal need to connect to?',
      goal: 'Answer and qualify',
      answers: ['How long would a portal like this take?'],
      nextStep: 'They share the integrations',
      why: 'Answers their question, then learns scope.',
    }
    return { data: next, trace: { model: opts.tier === 'terra' ? 'mock-4o' : 'mock-mini' } }
  }),
}))

import { buildMockStore } from '@/lib/store/mock-store'
import { buildThread, awaitingOurReply } from '@/lib/conversation/thread'
import { deriveDealStage, goalFor } from '@/lib/conversation/stage'
import { checkMessage, cleanMessage, buildComposeUserPrompt } from '@/lib/conversation/composer'
import { refreshMemory } from '@/lib/conversation/memory'
import { composeForLead, loadConversation, logSentMessage, saveDraft } from '@/lib/conversation/service'
import { emptyMemory } from '@/lib/conversation/types'
import type { LeadDetail } from '@/lib/store/types'

const rep = {
  id: 'rep-hassan',
  name: 'Hassan (demo)',
  role: 'admin' as const,
  organizationId: 'org-demo',
  createdAt: '2024-01-01T00:00:00.000Z',
  timezone: 'UTC',
}

async function newLead(store: ReturnType<typeof buildMockStore>, extra: Record<string, unknown> = {}) {
  const created = await store.createLead({
    company: `Northstar ${Math.random().toString(36).slice(2, 7)}`,
    contactName: 'Alex Morgan',
    contactTitle: 'CTO',
    signalEvidence: 'Looking for an external agency to build a customer portal in React.',
    tags: ['react'],
    allowPotentialDuplicate: true,
    ...extra,
  } as Parameters<typeof store.createLead>[0])
  const lead = (created as { lead?: { id: string } }).lead ?? (created as unknown as { id: string })
  return lead.id
}

beforeEach(() => {
  calls.length = 0
  composeQueue = []
})

describe('thread', () => {
  it('orders both sides oldest first, labels roles, keeps no-note connections and inbound-first openers', () => {
    const lead = {
      id: 'l1',
      direction: 'inbound',
      inboundMessage: 'Hi, can you help with a Shopify rebuild?',
      createdAt: '2026-10-01T09:00:00Z',
      messages: [
        { id: 'm2', type: 'reply', direction: 'outbound', sentText: 'Yes, happy to.', sentAt: '2026-10-01T11:00:00Z' },
        { id: 'm3', type: 'reply', direction: 'inbound', sentText: 'Great, what does it cost?', sentAt: '2026-10-01T12:00:00Z' },
        { id: 'm1', type: 'connection', direction: 'outbound', sentText: '', sentAt: '2026-10-01T10:00:00Z' },
        { id: 'd1', type: 'dm', direction: 'outbound', sentText: null, draftText: 'unsent', sentAt: null },
      ],
    } as unknown as LeadDetail
    const thread = buildThread(lead)
    expect(thread.map((t) => [t.role, t.kind])).toEqual([
      ['client', 'inbound_first'],
      ['me', 'connection'],
      ['me', 'reply'],
      ['client', 'reply'],
    ])
    expect(thread[1].text).toMatch(/no note/)
    expect(awaitingOurReply(thread)).toBe(true)
  })
})

describe('legacy contact names', () => {
  it('shows the real name for leads saved with LinkedIn chrome', async () => {
    const { displayContactName } = await import('@/lib/prospect/paste-normalize')
    expect(displayContactName('View Riya Rajeev’s profile, open to work')).toBe('Riya Rajeev')
    expect(displayContactName("View John Gummadi's profile")).toBe('John Gummadi')
    expect(displayContactName('Kaan Turkmen')).toBe('Kaan Turkmen')
  })
})

describe('deal stage and goals', () => {
  it('only allows a call ask once the client has shown interest', () => {
    expect(goalFor('connected', 'dm', null).allowCallAsk).toBe(false)
    expect(goalFor('opened', 'followup', null).allowCallAsk).toBe(false)
    expect(goalFor('qualifying', 'reply', null).allowCallAsk).toBe(true)
    const memory = { ...emptyMemory(), lastClientAnalysis: { turnId: 'x', intent: 'not_interested' as const, sentiment: 'negative' as const, questions: [], buyingSignals: [], summary: '' } }
    const g = goalFor('qualifying', 'reply', memory)
    expect(g.allowCallAsk).toBe(false)
    expect(g.goal).toMatch(/gracefully/i)
  })

  it('moves up the ladder with what the client says', () => {
    const lead = { status: 'replied', connectionAcceptedAt: 'x', messages: [] } as unknown as LeadDetail
    const thread = [
      { id: 'a', role: 'me' as const, kind: 'dm' as const, text: 'hi', at: '1' },
      { id: 'b', role: 'client' as const, kind: 'reply' as const, text: 'tell me more', at: '2' },
    ]
    expect(deriveDealStage(lead, thread, { facts: emptyMemory().facts, lastClientAnalysis: null })).toBe('engaged')
    expect(deriveDealStage(lead, thread, { facts: { ...emptyMemory().facts, timeline: 'Q1' }, lastClientAnalysis: null })).toBe('qualifying')
    expect(deriveDealStage(lead, thread, { facts: { ...emptyMemory().facts, nextStepNotes: 'free for a call Tuesday' }, lastClientAnalysis: null })).toBe('call_proposed')
    expect(deriveDealStage(lead, thread, null, 'proposal')).toBe('proposal')
  })
})

describe('message checks', () => {
  const goal = goalFor('connected', 'dm', null)
  it('flags call asks before interest, dashes, clichés, unanswered questions and repeats', () => {
    const memory = { ...emptyMemory(), facts: { ...emptyMemory().facts, openQuestions: ['What does it cost?'] } }
    const thread = [
      { id: 'a', role: 'me' as const, kind: 'dm' as const, text: 'We build React portals for logistics teams quickly', at: '1' },
      { id: 'b', role: 'client' as const, kind: 'reply' as const, text: 'What does it cost?', at: '2' },
    ]
    const issues = checkMessage('Just following up — can we hop on a call? We build React portals for logistics teams quickly', 'dm', goal, memory, thread, [])
    expect(issues.join(' ')).toMatch(/call/)
    expect(issues.join(' ')).toMatch(/dash/)
    expect(issues.join(' ')).toMatch(/cliché/)
    expect(issues.join(' ')).toMatch(/does not answer/i)
    expect(issues.join(' ')).toMatch(/Repeats/)
  })

  it('flags experience claims the seller cannot back, even when the client named the tool', () => {
    const thread = [{ id: 'b', role: 'client' as const, kind: 'reply' as const, text: 'Have you worked with Stripe billing?', at: '2' }]
    const goalQ = goalFor('qualifying', 'reply', null)
    const unsupported = checkMessage('Yes, I have experience with Stripe billing.', 'reply', goalQ, emptyMemory(), thread, ['x'], 'React, Node.js, Shopify')
    expect(unsupported.join(' ')).toMatch(/not in what I can claim: Stripe/)
    const supported = checkMessage('Yes, I have experience with Stripe billing.', 'reply', goalQ, emptyMemory(), thread, ['x'], 'Stripe, React')
    expect(supported.join(' ')).not.toMatch(/claim/)
  })

  it('drops the greeting mid-thread and maps near-miss intents', async () => {
    expect(cleanMessage('Hey Jordan, happy to talk Thursday.', 'reply', true)).toBe('Happy to talk Thursday.')
    expect(cleanMessage('Hey Jordan, happy to talk Thursday.', 'dm', false)).toBe('Hey Jordan, happy to talk Thursday.')
    const { normalizeIntent } = await import('@/lib/conversation/memory')
    expect(normalizeIntent('schedule_meeting')).toBe('meeting_request')
    expect(normalizeIntent('asking_price')).toBe('pricing')
    expect(normalizeIntent('weird')).toBe('neutral')
  })

  it('cleans dashes and trims connection notes to the LinkedIn limit at a sentence end', () => {
    expect(cleanMessage('Hi Sam — great work!', 'dm')).toBe('Hi Sam, great work.')
    const long = `${'Short sentence here. '.repeat(20)}`
    expect(cleanMessage(long, 'connection').length).toBeLessThanOrEqual(120)
  })
})

describe('compose prompt', () => {
  it('labels turns by role, keeps only the recent window verbatim and summarizes the rest', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, role: (i % 2 ? 'client' : 'me') as 'me' | 'client', kind: 'reply' as const, text: `message ${i}`, at: `2026-10-0${i}` }))
    const memory = { ...emptyMemory(), rollingSummary: 'They need a portal by March.', stage: 'qualifying' as const }
    const prompt = buildComposeUserPrompt(
      { lead: { company: 'Acme', contactName: 'Sam', contactTitle: 'CTO', signalEvidence: null } as unknown as LeadDetail, thread: turns, memory, profile: null, styleCard: null, proof: [], edits: [] },
      { intent: 'reply' },
      goalFor('qualifying', 'reply', memory),
    )
    expect(prompt).toMatch(/summary of 4 older messages/)
    expect(prompt).toMatch(/They need a portal by March/)
    expect(prompt).not.toMatch(/message 3\b/)
    expect(prompt).toMatch(/Client: message 9/)
    expect(prompt).toMatch(/Me: message 8/)
    expect(prompt).toMatch(/CALL ASK: allowed/)
  })
})

describe('memory cost', () => {
  it('analyzes a client turn once and only summarizes when the window moves', async () => {
    const lead = { id: 'l', company: 'Acme', contactName: 'Sam', contactTitle: 'CTO', status: 'replied', connectionAcceptedAt: 'x', messages: [] } as unknown as LeadDetail
    const thread = [
      { id: 'a', role: 'me' as const, kind: 'dm' as const, text: 'hi', at: '1' },
      { id: 'b', role: 'client' as const, kind: 'reply' as const, text: 'How long would it take?', at: '2' },
    ]
    const first = await refreshMemory(lead, thread, null)
    expect(calls.filter((c) => c.schemaName === 'client_turn_analysis')).toHaveLength(1)
    expect(calls.filter((c) => c.schemaName === 'conversation_summary')).toHaveLength(0)
    expect(first.memory.facts.openQuestions).toEqual(['How long would a portal like this take?'])

    const again = await refreshMemory(lead, thread, first.memory)
    expect(again.changed).toBe(false)
    expect(calls.filter((c) => c.schemaName === 'client_turn_analysis')).toHaveLength(1)

    const long = [...thread, ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, role: 'me' as const, kind: 'followup' as const, text: `f${i}`, at: `3${i}` }))]
    const folded = await refreshMemory(lead, long, again.memory)
    expect(folded.memory.summarizedThroughId).toBe('b')
    expect(folded.memory.rollingSummary).toMatch(/Earlier/)
    // We wrote after their question, so it no longer counts as open.
    expect(folded.memory.facts.openQuestions).toEqual([])
  })
})

describe('end-to-end conversation on the store', () => {
  it('runs connection → DM → reply → AI reply → edit → log → second reply, with turn-taking right every round', async () => {
    const store = buildMockStore({ rep, mode: 'demo' })
    const id = await newLead(store)

    let loaded = await loadConversation(store, id)
    expect(loaded!.view.suggestedIntent).toBe('connection')

    expect((await logSentMessage(store, id, 'Hi Alex, saw the portal brief. Would be good to connect.', 'connection')).ok).toBe(true)
    await store.markConnectionAccepted(id)
    loaded = await loadConversation(store, id)
    expect(loaded!.view.suggestedIntent).toBe('dm')

    expect((await logSentMessage(store, id, 'Thanks for connecting, Alex. Is the portal mainly for customers or internal ops?', 'dm')).ok).toBe(true)
    await store.recordProspectReply(id, 'Customers. How long would a portal like this take?')

    loaded = await loadConversation(store, id)
    expect(loaded!.view.awaitingReply).toBe(true)
    expect(loaded!.view.suggestedIntent).toBe('reply')
    expect(loaded!.view.memory.facts.openQuestions.length).toBeGreaterThan(0)

    const composed = await composeForLead(store, id, { intent: 'reply' })
    expect(composed!.result.text).toMatch(/6 to 8 weeks/)
    expect(composed!.result.issues).toEqual([])
    // A live conversation reply uses the stronger tier.
    expect(calls.filter((c) => c.schemaName === 'composed_message').at(-1)?.tier).toBe('terra')
    // The prompt shows the client's words as the client's.
    expect(calls.filter((c) => c.schemaName === 'composed_message').at(-1)?.user).toMatch(/Client: Customers\. How long/)

    // The draft survives a reload.
    loaded = await loadConversation(store, id)
    expect(loaded!.view.draft?.text).toMatch(/6 to 8 weeks/)

    // Rep edits and logs it; the edit is learned and the draft cleared.
    const edited = 'Usually 6 to 8 weeks. What does the portal need to connect to on your side?'
    expect((await logSentMessage(store, id, edited, 'reply', 'k1')).ok).toBe(true)
    const edits = await store.listRecentEdits(5)
    expect(edits[0]).toMatchObject({ editedText: edited })
    loaded = await loadConversation(store, id)
    expect(loaded!.view.draft).toBeNull()
    expect(loaded!.view.nextAction.action).toBe('WAIT_REPLY')
    expect(loaded!.view.nextAction.inConversation).toBe(true)

    // Logging our own reply must not look like the client replied.
    const outcomes = (await store.getLead(id))!.outcomes.filter((o) => o.stage === 'replied')
    expect(outcomes).toHaveLength(1)

    // Round two: the client writes again → it is our move again.
    await store.recordProspectReply(id, 'Salesforce and Stripe. Budget is approved, can we talk this week about timeline?')
    loaded = await loadConversation(store, id)
    expect(loaded!.view.nextAction.action).toBe('SEND_REPLY')
    expect(['qualifying', 'call_proposed']).toContain(loaded!.view.memory.stage)

    // Same idempotency key logs once.
    await saveDraft(store, id, 'Thursday 3pm or Friday 11am work for a 20 minute call?', 'reply')
    const a = await logSentMessage(store, id, 'Thursday 3pm or Friday 11am work for a 20 minute call?', 'reply', 'k2')
    const b = await logSentMessage(store, id, 'Thursday 3pm or Friday 11am work for a 20 minute call?', 'reply', 'k2')
    expect(a.ok && b.ok).toBe(true)
    const sent = (await store.getLead(id))!.messages.filter((m) => m.idempotencyKey === 'k2')
    expect(sent).toHaveLength(1)
  })

  it('repairs a draft that asks for a call too early', async () => {
    const store = buildMockStore({ rep, mode: 'demo' })
    const id = await newLead(store)
    await logSentMessage(store, id, 'Hi Alex, good to connect.', 'connection')
    await store.markConnectionAccepted(id)
    composeQueue = [
      { message: 'Thanks for connecting. Can we hop on a quick call this week?', goal: 'x', answers: [], nextStep: '', why: '' },
      { message: 'Thanks for connecting, Alex. Is the portal for customers or internal teams?', goal: 'Open', answers: [], nextStep: 'They answer', why: 'One easy question.' },
    ]
    const composed = await composeForLead(store, id, { intent: 'dm' })
    expect(composed!.result.repaired).toBe(true)
    expect(composed!.result.text).toMatch(/customers or internal/)
    expect(composed!.result.issues).toEqual([])
    const retryPrompt = calls.filter((c) => c.schemaName === 'composed_message').at(-1)!.user
    expect(retryPrompt).toMatch(/Asks for a call before the client has shown interest/)
    // Openers stay on the cheap tier.
    expect(calls.filter((c) => c.schemaName === 'composed_message').at(-1)?.tier).toBe('luna')
  })

  it('treats an inbound-first lead as waiting on us, with the opening message in the thread', async () => {
    const store = buildMockStore({ rep, mode: 'demo' })
    const id = await newLead(store, { direction: 'inbound', inboundMessage: 'Can you quote a Shopify rebuild?' })
    const loaded = await loadConversation(store, id)
    expect(loaded!.view.thread[0]).toMatchObject({ role: 'client', kind: 'inbound_first' })
    expect(loaded!.view.nextAction.action).toBe('SEND_REPLY')
  })
})
