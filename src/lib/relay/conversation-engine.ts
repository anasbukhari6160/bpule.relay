import { classifyClientMessage } from '@/lib/conversation/intent'
import type { ConversationStage, Message, OutreachStrategy } from '@/lib/domain/types'
import {
  emptyConversationKnowledge,
  type CommercialField,
  type ConversationKnowledge,
  type ConversationMove,
  type MessageJob,
} from '@/lib/relay/revenue-strategy'

/**
 * Conversation Engine
 *
 * Manages conversation state transitions, reply drafting, and context tracking.
 * This cannot end after the first DM — Relay must handle the full lifecycle.
 */

export interface ReplyContext {
  leadId: string
  leadCompany: string
  contactName: string | null
  replyText: string
  priorMessages: Message[]
  conversationStage: ConversationStage
  senderProfileId: string | null
}

export interface ReplyAnalysis {
  intent: 'interested' | 'objection' | 'question' | 'pricing' | 'not_interested' | 'meeting_request' | 'unclear'
  sentiment: 'positive' | 'neutral' | 'negative'
  questions: string[]
  objections: string[]
  buyingSignal: boolean
  requestedInformation: string[]
  nextBestAction: string
  knowledge: ConversationKnowledge
}

export function buildDeterministicConversationSummary(context: ReplyContext): string {
  const prior = [...context.priorMessages]
    .filter((m) => m.sentText)
    .sort((a, b) => (a.sentAt ?? a.createdAt).localeCompare(b.sentAt ?? b.createdAt))
  const lastOutbound = prior.at(-1)?.sentText?.trim() ?? ''
  const questions = (context.replyText.match(/[^?\n]+\?/g) ?? [])
    .map((q) => q.trim())
    .filter((q) => q.length > 4)
    .slice(0, 3)
  const establishedFacts = Array.from(
    new Set(
      prior
        .flatMap((m) => splitSentences(m.sentText ?? ''))
        .filter((s) => /\b(i|we)\b/i.test(s))
        .filter((s) => /\b(experience|years|worked|built|shipped|portfolio|project)\b/i.test(s))
        .map((s) => clipSentence(s, 140)),
    ),
  ).slice(0, 3)

  const lines = [
    `- Stage now: ${context.conversationStage}`,
    `- Prior outbound count: ${prior.length}`,
    `- Direct questions in latest message: ${questions.length}`,
  ]

  if (lastOutbound) {
    lines.push(`- Last outbound message: ${clipSentence(lastOutbound, 160)}`)
  }
  if (questions.length > 0) {
    lines.push(`- Questions to answer first: ${questions.join(' | ')}`)
  }
  if (establishedFacts.length > 0) {
    lines.push(`- Already shared bio/proof facts: ${establishedFacts.join(' | ')}`)
  }

  return lines.join('\n')
}

/**
 * Analyze an incoming reply from a prospect.
 */
export function analyzeReply(replyText: string, _context: ReplyContext): ReplyAnalysis {
  const lower = replyText.toLowerCase()
  const analysis: ReplyAnalysis = {
    intent: 'unclear',
    sentiment: 'neutral',
    questions: [],
    objections: [],
    buyingSignal: false,
    requestedInformation: [],
    nextBestAction: 'clarify',
    knowledge: emptyConversationKnowledge(),
  }

  const questionMatches = replyText.match(/[^.!?]+\?/g) ?? []
  analysis.questions = questionMatches.map((q) => q.trim())

  // Canonical safeguards first: rejections, stop requests, deferrals and
  // goodbyes are decided before any positive pattern can match inside them.
  const canonical = classifyClientMessage(replyText)

  // Detect intent
  if (canonical.class === 'NEGATIVE') {
    analysis.intent = 'not_interested'
    analysis.sentiment = 'negative'
    analysis.nextBestAction = 'graceful_close'
  } else if (canonical.class === 'CLOSED') {
    analysis.intent = 'unclear'
    analysis.nextBestAction = 'acknowledge_and_hold'
  } else if (/\b(not interested|not a fit|no thanks|pass|not looking)\b/i.test(lower)) {
    analysis.intent = 'not_interested'
    analysis.sentiment = 'negative'
    analysis.nextBestAction = 'graceful_close'
  } else if (/\b(thanks|thank you).{0,30}(reach out|reachout|contact|need|interested)\b/i.test(lower)) {
    // Polite deflect: "thanks will reach out if we need you" — not a rejection
    // but not interest either. Acknowledge briefly, don't pitch.
    analysis.intent = 'unclear'
    analysis.sentiment = 'neutral'
    analysis.nextBestAction = 'acknowledge_and_hold'
  } else if (/\b(no need|not needed|not looking|good for now|all set)\b/i.test(lower)) {
    analysis.intent = 'not_interested'
    analysis.sentiment = 'neutral'
    analysis.nextBestAction = 'acknowledge_and_hold'
  } else if (/\b(how much|pricing|cost|rate|budget|what is your)\b/i.test(lower)) {
    analysis.intent = 'pricing'
    analysis.nextBestAction = 'share_pricing_context'
  } else if (/\b(book|schedule|call|meeting|zoom|chat about)\b/i.test(lower)) {
    analysis.intent = 'meeting_request'
    analysis.buyingSignal = true
    analysis.sentiment = 'positive'
    analysis.nextBestAction = 'move_to_meeting'
  } else if (/\b(tell me more|more info|elaborate|what do you mean)\b/i.test(lower)) {
    analysis.intent = 'interested'
    analysis.buyingSignal = true
    analysis.sentiment = 'positive'
    analysis.nextBestAction = 'provide_more_detail'
  } else if (/\b(interested|let'?s do it|move forward|sounds good|works for me)\b/i.test(lower)) {
    analysis.intent = 'interested'
    analysis.buyingSignal = true
    analysis.sentiment = 'positive'
    analysis.nextBestAction = 'provide_more_detail'
  } else if (/\b(concern|worried|not sure|skeptical|how do I know)\b/i.test(lower)) {
    analysis.intent = 'objection'
    analysis.nextBestAction = 'address_objection'
  } else if (analysis.questions.length > 0) {
    analysis.intent = 'question'
    analysis.nextBestAction = 'answer_question'
  }

  // Detect buying signals — never inside a rejection, deferral or goodbye
  // ("not interested" contains "interested").
  if (canonical.class !== 'NEGATIVE' && canonical.class !== 'DEFERRED' && canonical.class !== 'CLOSED'
    && /\b(interested|let's do it|next step|move forward|sounds good|works for me)\b/i.test(lower)) {
    analysis.buyingSignal = true
  }
  if (canonical.class === 'NEGATIVE' || canonical.class === 'DEFERRED' || canonical.class === 'CLOSED') {
    analysis.buyingSignal = false
  }

  // Detect objections
  const objectionPatterns = [
    { pattern: /\b(too expensive|out of budget|can't afford)\b/i, objection: 'pricing' },
    { pattern: /\b(not the right time|timing|too busy)\b/i, objection: 'timing' },
    { pattern: /\b(already have|already working with)\b/i, objection: 'existing_solution' },
    { pattern: /\b(need to think|let me get back)\b/i, objection: 'hesitation' },
  ]
  for (const { pattern, objection } of objectionPatterns) {
    if (pattern.test(lower)) analysis.objections.push(objection)
  }
  analysis.objections = [...new Set(analysis.objections)]

  analysis.knowledge = extractConversationFacts(replyText, analysis)
  return analysis
}

/**
 * First-party facts from a reply. Updates known/unknown without turning
 * Relay into a BANT interrogation bot — only fields the reply actually touched.
 */
export function extractConversationFacts(
  replyText: string,
  analysis: Pick<ReplyAnalysis, 'intent' | 'questions' | 'objections' | 'buyingSignal' | 'requestedInformation'>,
  prior?: ConversationKnowledge | null,
): ConversationKnowledge {
  const knowledge = prior ? cloneKnowledge(prior) : emptyConversationKnowledge()
  const lower = replyText.toLowerCase()
  const newFacts: string[] = []

  const set = (field: CommercialField, value: string, status: 'known' | 'inferred' = 'known') => {
    knowledge.fields[field] = { value, status }
    newFacts.push(value)
  }

  if (analysis.intent === 'not_interested') {
    set('need', 'They are not interested right now')
    set('objection', analysis.objections[0] ?? 'not interested')
    set('nextCommitment', 'none')
  }

  if (/\b(already hired|we hired|we('ve| have) (filled|hired)|role is filled|found someone)\b/i.test(lower)) {
    set('need', 'Already hired / role filled')
    set('timeline', 'closed')
    set('nextCommitment', 'none')
  }

  if (/\b(next quarter|later this year|not this (month|quarter)|maybe later|in a few months)\b/i.test(lower)) {
    set('timeline', clipMatch(replyText, /\b(next quarter|later this year|not this \w+|maybe later|in a few months)\b/i) ?? 'later')
    set('urgency', 'low / future')
  }

  if (analysis.intent === 'pricing' || /\b(rate|pricing|cost|how much|what do you charge)\b/i.test(lower)) {
    knowledge.fields.budget = { value: null, status: 'unknown' }
    set('proofNeeded', 'They asked for rate or commercial context')
  }

  if (/\b(example|examples|case stud|portfolio|proof|have you (done|built|shipped))\b/i.test(lower)) {
    set('proofNeeded', 'They asked for examples or proof')
  }

  if (analysis.intent === 'interested' || analysis.buyingSignal) {
    set('deliveryOpenness', 'Open to continuing the conversation', 'inferred')
  }

  if (analysis.intent === 'meeting_request') {
    set('nextCommitment', 'They asked to talk')
  }

  if (analysis.questions.length > 0) {
    knowledge.fields.scopeMaturity = knowledge.fields.scopeMaturity.status === 'unknown'
      ? { value: 'They have unanswered questions', status: 'inferred' }
      : knowledge.fields.scopeMaturity
  }

  knowledge.newFacts = unique(newFacts)
  knowledge.mostValuableUncertainty = pickMostValuableUncertainty(knowledge)
  const move = chooseConversationMove(analysis, knowledge)
  knowledge.nextMove = move.move
  knowledge.messageJob = move.job
  return knowledge
}

export function chooseConversationMove(
  analysis: Pick<ReplyAnalysis, 'intent' | 'questions' | 'objections' | 'buyingSignal'>,
  knowledge: ConversationKnowledge,
): { move: ConversationMove; job: MessageJob } {
  if (analysis.intent === 'not_interested' || knowledge.fields.need.value?.toLowerCase().includes('already hired')) {
    return { move: 'CLOSE', job: 'CLOSE_LOOP' }
  }
  if (analysis.intent === 'meeting_request') {
    return { move: 'CALL', job: 'MOVE_TO_CALL' }
  }
  if (knowledge.fields.proofNeeded.status === 'known' || analysis.intent === 'pricing') {
    return { move: 'PROVIDE_PROOF', job: 'PROVIDE_PROOF' }
  }
  if (analysis.intent === 'objection') {
    return { move: 'CLARIFY', job: 'RESOLVE_OBJECTION' }
  }
  if (analysis.questions.length > 0) {
    return { move: 'ANSWER', job: 'CLARIFY_NEXT_STEP' }
  }
  if (knowledge.fields.timeline.status === 'known' && /later|quarter|future/i.test(knowledge.fields.timeline.value ?? '')) {
    return { move: 'CLARIFY', job: 'UNDERSTAND_TIMELINE' }
  }
  if (analysis.intent === 'interested') {
    const unknown = knowledge.mostValuableUncertainty
    if (unknown === 'scope') return { move: 'ASK', job: 'UNDERSTAND_SCOPE' }
    if (unknown === 'timeline') return { move: 'ASK', job: 'UNDERSTAND_TIMELINE' }
    return { move: 'ASK', job: 'DISCOVER_NEED' }
  }
  return { move: 'CLARIFY', job: 'DISCOVER_NEED' }
}

function pickMostValuableUncertainty(knowledge: ConversationKnowledge): string | null {
  const order: CommercialField[] = ['need', 'proofNeeded', 'scope', 'timeline', 'authority', 'currentSolution', 'budget']
  for (const field of order) {
    if (knowledge.fields[field].status === 'unknown') return field
  }
  return null
}

function cloneKnowledge(prior: ConversationKnowledge): ConversationKnowledge {
  return {
    fields: { ...emptyConversationKnowledge().fields, ...Object.fromEntries(
      Object.entries(prior.fields).map(([k, v]) => [k, { ...v }]),
    ) } as ConversationKnowledge['fields'],
    newFacts: [],
    mostValuableUncertainty: prior.mostValuableUncertainty,
    nextMove: prior.nextMove,
    messageJob: prior.messageJob,
  }
}

function clipMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern)
  return match?.[0] ?? null
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

/**
 * Get the next conversation stage based on reply analysis.
 */
export function getNextStage(
  currentStage: ConversationStage,
  analysis: ReplyAnalysis,
): ConversationStage {
  if (analysis.intent === 'not_interested') return 'lost'
  if (analysis.intent === 'meeting_request') return 'meeting'
  if (analysis.buyingSignal && currentStage === 'replied') return 'qualifying'
  if (analysis.buyingSignal && currentStage === 'qualifying') return 'interested'
  if (analysis.intent === 'interested') return 'qualifying'
  return currentStage
}

/**
 * Build a reply strategy based on the analysis.
 */
export function buildReplyStrategy(
  analysis: ReplyAnalysis,
  context: ReplyContext,
  _strategy: OutreachStrategy | null,
): {
  goal: string
  approach: string
  tone: string
  ctaStrategy: string
  messageJob: MessageJob
  nextMove: ConversationMove
} {
  const job = analysis.knowledge.messageJob
  const move = analysis.knowledge.nextMove

  switch (analysis.intent) {
    case 'interested':
      return {
        goal: job === 'PROVIDE_PROOF'
          ? 'Answer the proof or rate question with one relevant fact'
          : 'Use their reply as first-party intelligence and ask only the most valuable unknown',
        approach: `Their words now outrank the original scrape. ${analysis.questions.length > 0 ? 'Answer their questions first.' : 'Do not restart a pitch.'} New facts: ${analysis.knowledge.newFacts.join('; ') || 'none extracted'}. Next uncertainty: ${analysis.knowledge.mostValuableUncertainty ?? 'none'}.`,
        tone: 'warm, direct, no pressure',
        ctaStrategy: 'One question maximum, and only if it is the most valuable unknown. No meeting pitch unless they asked.',
        messageJob: job,
        nextMove: move,
      }

    case 'objection':
      return {
        goal: 'Address the objection honestly',
        approach: `Acknowledge their concern. ${analysis.objections.includes('pricing') ? 'Share how pricing is scoped — never invent a number.' : analysis.objections.includes('timing') ? 'Make it easy to pause and resume later.' : 'Provide specific evidence that addresses their concern.'}`,
        tone: 'empathetic, honest, not pushy',
        ctaStrategy: 'No hard CTA — earn trust first',
        messageJob: job,
        nextMove: move,
      }

    case 'pricing':
      return {
        goal: 'Answer the commercial question without inventing a price',
        approach: 'If an approved rate or range exists in facts, share it. Otherwise explain that price follows scope and ask the one question needed to scope. Never invent a number.',
        tone: 'transparent, professional',
        ctaStrategy: 'Answer first. One scoping question only if required.',
        messageJob: job,
        nextMove: move,
      }

    case 'meeting_request':
      return {
        goal: 'Confirm the call because they asked — a sync is now more efficient',
        approach: 'They requested a conversation. Confirm. Do not re-pitch.',
        tone: 'professional, prepared',
        ctaStrategy: 'Confirm logistics. One expectation for the call.',
        messageJob: job,
        nextMove: move,
      }

    case 'question':
      return {
        goal: 'Answer their questions directly — before anything else',
        approach: 'Lead with the answer. Do not restart the sales pitch. If they asked for examples, share one relevant proof. If they asked about rate, do not invent a number.',
        tone: 'helpful, specific, direct',
        ctaStrategy: 'Answer first. At most one follow-up question.',
        messageJob: job,
        nextMove: move,
      }

    case 'not_interested':
      return {
        goal: 'Close the loop gracefully',
        approach: 'Acknowledge. Thank them. Stop. No future-pitch paragraph.',
        tone: 'gracious, brief',
        ctaStrategy: 'None',
        messageJob: job,
        nextMove: move,
      }

    case 'unclear':
    default:
      return {
        // BUG-09: unclear replies (polite deflects, brief acknowledgments) must
        // NOT trigger a fresh pitch. Acknowledge their message briefly and leave
        // the door open — never "came across your work" or "one practical idea".
        goal: 'Acknowledge their message briefly and leave the door open — do NOT pitch',
        approach: `Their message is unclear or polite deflection. Acknowledge it in 1 sentence, offer value if appropriate, do not ask a probing question, do not restart the pitch. Keep it short and warm.`,
        tone: 'warm, brief, no pressure',
        ctaStrategy: 'None — just acknowledge',
        messageJob: 'ACKNOWLEDGE_AND_HOLD',
        nextMove: 'WAIT',
      }
  }
}

/**
 * Build the full conversation context for the message generator.
 */
export function buildConversationContext(
  context: ReplyContext,
  analysis: ReplyAnalysis,
): string {
  const parts: string[] = []

  parts.push(`## Deterministic conversation summary (pre-generation)`)
  parts.push(buildDeterministicConversationSummary(context))
  parts.push(``)

  parts.push(`## Conversation Context`)
  parts.push(`Company: ${context.leadCompany}`)
  if (context.contactName) parts.push(`Contact: ${context.contactName}`)
  parts.push(`Stage: ${context.conversationStage}`)
  parts.push(`Their reply intent: ${analysis.intent}`)
  parts.push(`Sentiment: ${analysis.sentiment}`)

  if (context.priorMessages.length > 0) {
    parts.push(``)
    parts.push(`### What was already said:`)
    for (const msg of context.priorMessages.filter((m) => m.sentText).slice(-5)) {
      parts.push(`- [${msg.type}] ${msg.sentText}`)
    }
  }

  if (context.replyText) {
    parts.push(``)
    parts.push(`### Their latest message:`)
    parts.push(context.replyText)
  }

  if (analysis.questions.length > 0) {
    parts.push(``)
    parts.push(`### Questions to answer:`)
    for (const q of analysis.questions) {
      parts.push(`- ${q}`)
    }
  }

  if (analysis.objections.length > 0) {
    parts.push(``)
    parts.push(`### Objections to address:`)
    for (const o of analysis.objections) {
      parts.push(`- ${o}`)
    }
  }

  parts.push(``)
  parts.push(`### First-party state (updated from their reply):`)
  parts.push(`- Job: ${analysis.knowledge.messageJob}`)
  parts.push(`- Next move: ${analysis.knowledge.nextMove}`)
  if (analysis.knowledge.newFacts.length > 0) {
    parts.push(`- New facts: ${analysis.knowledge.newFacts.join('; ')}`)
  }
  if (analysis.knowledge.mostValuableUncertainty) {
    parts.push(`- Most valuable unknown: ${analysis.knowledge.mostValuableUncertainty}`)
  }
  parts.push(`- Do not restart the original pitch. Do not invent rate, scope, or proof.`)

  return parts.join('\n')
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function clipSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen - 1).trim()}...`
}
