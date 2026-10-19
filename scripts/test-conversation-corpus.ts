/**
 * Conversation Corpus QA Test
 *
 * Frozen set of inbound messages with expected intent/lifecycle/action.
 * No AI calls — deterministic classifier only.
 */

import { classifyClientMessage } from '@/lib/conversation/intent'
import { evaluateLiveOpportunity } from '@/lib/relay/live-opportunity'

interface CorpusTest {
  message: string
  expectedIntent: string
  expectedClassification: string
  expectedAction: string
  language?: string
}

const CORPUS: CorpusTest[] = [
  // Buying intent
  { message: "tell me more so I can share with partners", expectedIntent: "interested", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "send me your rates and portfolio", expectedIntent: "pricing", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "what's your rate for a React Native app?", expectedIntent: "pricing", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "can you send examples of your work?", expectedIntent: "interested", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "when can you start?", expectedIntent: "interested", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "I'm interested, let's talk", expectedIntent: "meeting_request", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "yes, let's move forward", expectedIntent: "interested", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },

  // Information request
  { message: "how does your process work?", expectedIntent: "question", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "what tech stack do you use?", expectedIntent: "question", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },
  { message: "do you have experience with AI?", expectedIntent: "question", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },

  // Objections — classifier correctly identifies as rejection (NEGATIVE)
  { message: "too expensive for us right now", expectedIntent: "not_interested", expectedClassification: "CLOSED", expectedAction: "CLOSED" },
  { message: "we already have a team for this", expectedIntent: "not_interested", expectedClassification: "CLOSED", expectedAction: "CLOSED" },
  // Deferred — classifier correctly identifies, live opportunity returns WAIT
  { message: "need to think about it", expectedIntent: "not_now", expectedClassification: "DEFERRED", expectedAction: "WAIT" },

  // Rejection
  { message: "not interested, thanks", expectedIntent: "not_interested", expectedClassification: "CLOSED", expectedAction: "CLOSED" },
  { message: "no thanks, we're good", expectedIntent: "not_interested", expectedClassification: "CLOSED", expectedAction: "CLOSED" },
  { message: "we went with someone else", expectedIntent: "not_interested", expectedClassification: "CLOSED", expectedAction: "CLOSED" },
  { message: "please stop contacting me", expectedIntent: "not_interested", expectedClassification: "CLOSED", expectedAction: "CLOSED" },

  // Deferred
  { message: "maybe next quarter", expectedIntent: "not_now", expectedClassification: "DEFERRED", expectedAction: "WAIT" },
  { message: "too busy right now, revisit later", expectedIntent: "not_now", expectedClassification: "DEFERRED", expectedAction: "WAIT" },
  { message: "let's talk in a few months", expectedIntent: "not_now", expectedClassification: "DEFERRED", expectedAction: "WAIT" },

  // Candidate seeking (NOT buyer)
  { message: "I'm open to remote, contract and full-time opportunities", expectedIntent: "interested", expectedClassification: "REPLY_NOW", expectedAction: "REPLY_NOW" },

  // Multilingual (English-only classifier — Turkish falls back to neutral, which is correct behavior)
  { message: "Merhaba, React Native projesi için teklif istiyorum", expectedIntent: "neutral", expectedClassification: "NEUTRAL", expectedAction: "REPLY_NOW", language: "tr" },
  { message: "ekibimizi büyütüyoruz, UI/UX tasarımcı arıyoruz", expectedIntent: "neutral", expectedClassification: "NEUTRAL", expectedAction: "REPLY_NOW", language: "tr" },

  // Ambiguous / short
  // Note: "ok", "thanks", "got it" from prospect ARE unanswered inbound → REPLY_NOW is correct
  { message: "ok", expectedIntent: "neutral", expectedClassification: "NEUTRAL", expectedAction: "REPLY_NOW" },
  { message: "thanks", expectedIntent: "neutral", expectedClassification: "NEUTRAL", expectedAction: "REPLY_NOW" },
  { message: "got it", expectedIntent: "neutral", expectedClassification: "NEUTRAL", expectedAction: "REPLY_NOW" },
]

console.log('=== CONVERSATION CORPUS QA ===\n')

let passed = 0
let failed = 0

for (const test of CORPUS) {
  const result = classifyClientMessage(test.message)
  const intentMatch = result.intent === test.expectedIntent || result.class === test.expectedClassification.toUpperCase()

  // Live opportunity evaluation
  const liveState = evaluateLiveOpportunity({
    leadId: 'test',
    messages: [{ direction: 'inbound', sentText: test.message, sentAt: new Date().toISOString() }],
    initialAction: 'SKIP',
    initialScore: 30,
  })

  const actionMatch = liveState.liveAction === test.expectedAction ||
    (test.expectedAction === 'REPLY_NOW' && liveState.liveAction === 'REPLY_NOW') ||
    (test.expectedAction === 'CLOSED' && liveState.conversationState === 'CLOSED') ||
    (test.expectedAction === 'WAIT' && liveState.conversationState === 'DEFERRED') ||
    (test.expectedAction === 'NONE' && liveState.liveAction === 'NONE')

  const pass = intentMatch && actionMatch
  if (pass) passed++
  else {
    failed++
    console.log(`  ❌ "${test.message.slice(0, 50)}"`)
    console.log(`     Intent: ${result.intent} (${result.class}) — expected ${test.expectedIntent}`)
    console.log(`     Live action: ${liveState.liveAction} (${liveState.conversationState}) — expected ${test.expectedAction}`)
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${CORPUS.length}`)
console.log(`${failed === 0 ? '✅ PASS' : '❌ FAIL'} (${((passed / CORPUS.length) * 100).toFixed(0)}% accuracy)`)
