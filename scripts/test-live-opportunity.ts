/**
 * Live Conversation Override Test
 *
 * Validates that active conversation state supersedes cold prospect score.
 */

import { evaluateLiveOpportunity, getEffectiveAction } from '../src/lib/relay/live-opportunity'
import { validateReply } from '../src/lib/relay/hallucination-guard'

console.log('=== LIVE CONVERSATION OVERRIDE TEST ===\n')

interface TestCase {
  name: string
  initialScore: number
  initialAction: string
  messages: Array<{ direction: string; sentText: string; sentAt: string }>
  expectedLiveAction: string
  expectedEffectiveAction: string
}

const tests: TestCase[] = [
  {
    name: 'Initial SKIP + "tell me more"',
    initialScore: 30,
    initialAction: 'SKIP',
    messages: [
      { direction: 'outbound', sentText: 'Hi, I build AI tools', sentAt: '2024-01-01T10:00:00Z' },
      { direction: 'inbound', sentText: 'tell me more so I can share with partners', sentAt: '2024-01-02T10:00:00Z' },
    ],
    expectedLiveAction: 'REPLY_NOW',
    expectedEffectiveAction: 'REPLY_NOW',
  },
  {
    name: 'Initial SKIP + "send me your rates"',
    initialScore: 25,
    initialAction: 'SKIP',
    messages: [
      { direction: 'outbound', sentText: 'Hi, check out our work', sentAt: '2024-01-01T10:00:00Z' },
      { direction: 'inbound', sentText: 'send me your rates', sentAt: '2024-01-02T10:00:00Z' },
    ],
    expectedLiveAction: 'REPLY_NOW',
    expectedEffectiveAction: 'REPLY_NOW',
  },
  {
    name: 'Initial SKIP + "share this with my partner"',
    initialScore: 30,
    initialAction: 'SKIP',
    messages: [
      { direction: 'outbound', sentText: 'Hi, here\'s what we do', sentAt: '2024-01-01T10:00:00Z' },
      { direction: 'inbound', sentText: 'share this with my partner', sentAt: '2024-01-02T10:00:00Z' },
    ],
    expectedLiveAction: 'REPLY_NOW',
    expectedEffectiveAction: 'REPLY_NOW',
  },
  {
    name: 'Initial HIGH + "not interested"',
    initialScore: 70,
    initialAction: 'CONNECT_WITH_NOTE',
    messages: [
      { direction: 'inbound', sentText: 'not interested, thanks', sentAt: '2024-01-02T10:00:00Z' },
    ],
    expectedLiveAction: 'CLOSE',
    expectedEffectiveAction: 'CLOSED',
  },
  {
    name: 'Initial MEDIUM + "maybe next quarter"',
    initialScore: 50,
    initialAction: 'OBSERVE',
    messages: [
      { direction: 'inbound', sentText: 'maybe next quarter', sentAt: '2024-01-02T10:00:00Z' },
    ],
    expectedLiveAction: 'WAIT',
    expectedEffectiveAction: 'WAIT',
  },
  {
    name: 'We replied last — waiting',
    initialScore: 30,
    initialAction: 'SKIP',
    messages: [
      { direction: 'inbound', sentText: 'tell me more', sentAt: '2024-01-01T10:00:00Z' },
      { direction: 'outbound', sentText: 'Here is what we do...', sentAt: '2024-01-02T10:00:00Z' },
    ],
    expectedLiveAction: 'NONE',
    expectedEffectiveAction: 'SKIP', // Falls back to initial since we replied
  },
]

let allPass = true

for (const test of tests) {
  const liveState = evaluateLiveOpportunity({
    leadId: 'test-lead',
    messages: test.messages,
    initialAction: test.initialAction,
    initialScore: test.initialScore,
  })

  const effectiveAction = getEffectiveAction({
    initialAction: test.initialAction,
    initialScore: test.initialScore,
    liveState,
  })

  const passLive = liveState.liveAction === test.expectedLiveAction
  const passEffective = effectiveAction === test.expectedEffectiveAction
  const pass = passLive && passEffective

  if (!pass) allPass = false

  console.log(`${pass ? '✅' : '❌'} ${test.name}`)
  console.log(`  Initial: ${test.initialAction} (${test.initialScore}/100)`)
  console.log(`  Live: ${liveState.liveAction} ${passLive ? '✅' : '❌'} (expected: ${test.expectedLiveAction})`)
  console.log(`  Effective: ${effectiveAction} ${passEffective ? '✅' : '❌'} (expected: ${test.expectedEffectiveAction})`)
  console.log(`  Reason: ${liveState.reason}`)
  console.log()
}

// Hallucination guard test
console.log('=== HALLUCINATION GUARD ===\n')

const hallTests = [
  {
    name: 'Clean reply',
    reply: 'Hi Salih, we build AI-powered tools with React and Node. Our team has shipped products for companies like Acme Corp. Would you like to see examples?',
    sender: { fullName: 'Aneeq Iqbal', title: 'Founder', organizationName: 'Relay', capabilities: ['ai', 'react', 'node'] },
    proof: [{ title: 'AI Dashboard', clientName: 'Acme Corp', capabilities: ['react', 'ai'] }],
    prospect: { company: 'Odana AI', contactName: 'Salih', industry: 'AI', sourceEvidence: ['Founder of Odana AI', '15+ AI tools'] },
    expectedPass: true,
  },
  {
    name: 'FayndMe hallucination',
    reply: 'Hi, check out FayndMe — our AI-powered platform.',
    sender: { fullName: 'Aneeq Iqbal', title: 'Founder', organizationName: 'Relay', capabilities: ['ai', 'react'] },
    proof: [],
    prospect: { company: 'Acme', contactName: 'John', industry: 'Tech', sourceEvidence: [] },
    expectedPass: false,
  },
]

for (const test of hallTests) {
  const result = validateReply({
    generatedReply: test.reply,
    senderProfile: test.sender,
    proofLibrary: test.proof,
    prospectContext: test.prospect,
  })

  const pass = result.passed === test.expectedPass
  if (!pass) allPass = false

  console.log(`${pass ? '✅' : '❌'} ${test.name}`)
  console.log(`  Passed: ${result.passed} ${pass ? '✅' : '❌'} (expected: ${test.expectedPass})`)
  if (result.violations.length > 0) {
    console.log(`  Violations: ${result.violations.join(', ')}`)
  }
  console.log()
}

console.log(`=== FINAL VERDICT: ${allPass ? '✅ PASS' : '❌ FAIL'} ===`)
