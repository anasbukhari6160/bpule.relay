import { generate as runtimeGenerate } from '@/lib/ai/runtime'
import { analyzeReply } from '@/lib/relay/conversation-engine'
import { classifyClientMessage, resolveConversationIntent } from './intent'
import type { LeadDetail } from '@/lib/store/types'
import {
  emptyMemory,
  type ClientTurnAnalysis,
  type ConversationMemory,
  type ConversationTurn,
  type DealFacts,
} from './types'
import { clip, renderTurns } from './thread'
import { deriveDealStage } from './stage'
import { extractExplicitDates, extractProjectNeed, extractStatedTimeline, isBuyerOwnedCommercialFactLine } from '@/lib/intelligence-v3/source-facts'
import { readBuyerSourceFacts } from '@/lib/intelligence-v3/buyer-intent'

/**
 * Conversation memory: what Relay remembers about a deal between messages.
 *
 * Cost model — the expensive part of any thread is resending it. Here only
 * the last VERBATIM_WINDOW turns are ever sent word for word; older turns are
 * folded into a short rolling summary, and the summary is only rewritten when
 * the window moves past new turns. The latest client turn is analyzed once
 * (keyed by turn id) and the result is stored, so drafting, regenerating and
 * refining the same reply never re-pay for analysis. Both calls use the cheap
 * tier; each falls back to a deterministic version when no model answers.
 */

export const VERBATIM_WINDOW = 6
const SUMMARY_MAX_WORDS = 140

const ANALYSIS_INTENTS: ClientTurnAnalysis['intent'][] = [
  'interested', 'question', 'objection', 'not_now', 'not_interested', 'referral', 'meeting_request', 'pricing', 'neutral', 'auto_reply',
]

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ANALYSIS_INTENTS },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    questions: { type: 'array', items: { type: 'string' } },
    buyingSignals: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    need: { type: ['string', 'null'] },
    timeline: { type: ['string', 'null'] },
    budget: { type: ['string', 'null'] },
    decisionMaker: { type: ['string', 'null'] },
    objections: { type: 'array', items: { type: 'string' } },
    nextStepNotes: { type: ['string', 'null'] },
    alreadyShared: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'sentiment', 'questions', 'buyingSignals', 'summary', 'need', 'timeline', 'budget', 'decisionMaker', 'objections', 'nextStepNotes', 'alreadyShared'],
  additionalProperties: false,
}

const ANALYSIS_SYSTEM = `You read a B2B sales conversation on LinkedIn between "Me" (a software development seller) and "Client" (the prospect).
Analyze the LATEST Client message in the context of the thread. Return JSON only.
- intent: the client's main intent in the latest message.
- questions: every question the client asked in the latest message, verbatim or near-verbatim. Empty if none.
- buyingSignals: concrete signals of buying interest (a need, a timeline, a budget, asking about process/price/availability). Empty if none.
- summary: one sentence on what the client said.
- need, timeline, budget, decisionMaker: only what the CLIENT stated anywhere in the thread; null if never stated. Never guess.
- objections: concerns the client raised.
- nextStepNotes: anything the client said about calls, meetings, availability or preferred channel; null if nothing.
- alreadyShared: short notes of concrete claims "Me" already made (experience, examples, offers) so they are not repeated.`

const SUMMARY_SYSTEM = `You maintain a running summary of a B2B sales conversation between "Me" (seller) and "Client" (prospect).
Update the existing summary with the new turns. Keep every fact that matters for closing: what the client needs, timeline, budget, who decides, questions asked and answered, objections, offers made, next steps agreed.
Write plain prose, past tense, at most ${SUMMARY_MAX_WORDS} words. Return JSON {"summary": "..."}.`

interface RawAnalysis extends ClientTurnAnalysis {
  need: string | null
  timeline: string | null
  budget: string | null
  decisionMaker: string | null
  objections: string[]
  nextStepNotes: string | null
  alreadyShared: string[]
}

function uniq(list: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const v = item.trim()
    const k = v.toLowerCase()
    if (!v || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out.slice(-max)
}

function mergeFacts(prev: DealFacts, a: RawAnalysis | null, latestIsClient: boolean): DealFacts {
  if (!a) {
    return { ...prev, openQuestions: latestIsClient ? prev.openQuestions : [] }
  }
  return {
    need: a.need?.trim() || prev.need,
    timeline: a.timeline?.trim() || prev.timeline,
    budget: a.budget?.trim() || prev.budget,
    decisionMaker: a.decisionMaker?.trim() || prev.decisionMaker,
    // Questions are open until we send the next message.
    openQuestions: latestIsClient ? uniq(a.questions, 6) : [],
    objections: uniq([...prev.objections, ...a.objections], 8),
    alreadyShared: uniq([...prev.alreadyShared, ...a.alreadyShared], 12),
    buyingSignals: uniq([...prev.buyingSignals, ...a.buyingSignals], 8),
    nextStepNotes: a.nextStepNotes?.trim() || prev.nextStepNotes,
  }
}

export function normalizeIntent(raw: unknown): ClientTurnAnalysis['intent'] {
  const v = String(raw ?? '').toLowerCase().trim()
  if ((ANALYSIS_INTENTS as string[]).includes(v)) return v as ClientTurnAnalysis['intent']
  if (/auto|out_of_office|ooo/.test(v)) return 'auto_reply'
  // Negations before positives: "not interested" must never fall into /interest/.
  if (/not[_ -]?(?:really[_ -]?)?interest|uninterest|disinterest|no[_ -]?interest|declin|reject|refus|no[_ -]?thanks|unsubscribe|not[_ -]?a[_ -]?fit|negative|stop/.test(v)) return 'not_interested'
  if (/not_?now|later|timing|busy|postpone/.test(v)) return 'not_now'
  if (/meet|call|schedul|book|demo|talk/.test(v)) return 'meeting_request'
  if (/pric|cost|budget|quote|rate/.test(v)) return 'pricing'
  if (/refer|intro|colleague/.test(v)) return 'referral'
  if (/object|concern|hesita|doubt/.test(v)) return 'objection'
  if (/interest|positive|yes|agree|keen/.test(v)) return 'interested'
  if (/question|ask|clarif|info/.test(v)) return 'question'
  return 'neutral'
}

function deterministicAnalysis(lead: LeadDetail, turn: ConversationTurn): RawAnalysis {
  const r = analyzeReply(turn.text, {
    leadId: lead.id,
    leadCompany: lead.company,
    contactName: lead.contactName,
    replyText: turn.text,
    priorMessages: [],
    conversationStage: 'replied',
    senderProfileId: null,
  })
  const canonical = classifyClientMessage(turn.text)
  const intent: ClientTurnAnalysis['intent'] = canonical.explicit
    ? canonical.intent
    : r.intent === 'unclear' ? 'neutral' : r.intent
  return {
    intent,
    sentiment: r.sentiment,
    questions: r.questions,
    buyingSignals: r.buyingSignal ? ['Positive buying language'] : [],
    summary: clip(turn.text, 160),
    need: null,
    timeline: null,
    budget: null,
    decisionMaker: null,
    objections: r.objections,
    nextStepNotes: /\b(call|meet|zoom|calendar|available)\b/i.test(turn.text) ? clip(turn.text, 160) : null,
    alreadyShared: [],
  }
}

async function analyzeClientTurn(lead: LeadDetail, thread: ConversationTurn[], turn: ConversationTurn): Promise<RawAnalysis> {
  const window = thread.slice(-VERBATIM_WINDOW)
  try {
    const res = await runtimeGenerate<RawAnalysis>({
      task: 'FAST_STRUCTURED',
      tier: 'luna',
      system: ANALYSIS_SYSTEM,
      user: `Client: ${lead.contactName ?? 'unknown'}${lead.contactTitle ? `, ${lead.contactTitle}` : ''} at ${lead.company}\n\nThread (oldest first):\n${renderTurns(window)}\n\nAnalyze the latest Client message.`,
      schema: ANALYSIS_SCHEMA,
      schemaName: 'client_turn_analysis',
      maxTokens: 700,
      timeoutMs: 15_000,
      temperature: 0,
      promptVersion: 'conversation-analysis-v1',
      callSite: 'conversation/memory:analyzeClientTurn',
      feature: 'conversation_memory',
    })
    const a = res.data
    if (!a || typeof a !== 'object') return deterministicAnalysis(lead, turn)
    // JSON mode does not enforce the enum ("schedule_meeting"); map near
    // misses instead of discarding the facts the model extracted.
    return {
      ...a,
      intent: normalizeIntent(a.intent),
      sentiment: (() => {
        const v = String(a.sentiment ?? '').toLowerCase()
        return v === 'positive' || v === 'negative' ? v : 'neutral'
      })(),
      summary: typeof a.summary === 'string' && a.summary.trim() ? a.summary : clip(turn.text, 160),
      questions: Array.isArray(a.questions) ? a.questions.map(String) : [],
      buyingSignals: Array.isArray(a.buyingSignals) ? a.buyingSignals.map(String) : [],
      objections: Array.isArray(a.objections) ? a.objections.map(String) : [],
      alreadyShared: Array.isArray(a.alreadyShared) ? a.alreadyShared.map(String) : [],
    }
  } catch {
    return deterministicAnalysis(lead, turn)
  }
}

/**
 * Explicit client meaning beats the model, and the whole conversation beats
 * the latest message: "ok bye" after "not interested" is still a rejection.
 */
function applyIntentSafeguards(analysis: RawAnalysis, thread: ConversationTurn[], latest: ConversationTurn): RawAnalysis {
  const conversation = resolveConversationIntent(thread.filter((t) => t.role === 'client').map((t) => t.text))
  if (conversation.declined) {
    return { ...analysis, intent: 'not_interested', sentiment: 'negative', buyingSignals: [] }
  }
  if (conversation.deferred) {
    return { ...analysis, intent: 'not_now', buyingSignals: [] }
  }
  const canonical = classifyClientMessage(latest.text)
  if (canonical.explicit && canonical.intent !== analysis.intent && (canonical.class !== 'NEUTRAL' || canonical.intent === 'auto_reply')) {
    return { ...analysis, intent: canonical.intent }
  }
  return analysis
}

async function foldIntoSummary(previous: string, turns: ConversationTurn[]): Promise<string> {
  if (turns.length === 0) return previous
  try {
    const res = await runtimeGenerate<{ summary: string }>({
      task: 'FAST_STRUCTURED',
      tier: 'luna',
      system: SUMMARY_SYSTEM,
      user: `Existing summary:\n${previous || '(none yet)'}\n\nNew turns to fold in (oldest first):\n${renderTurns(turns, 500)}`,
      schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
      schemaName: 'conversation_summary',
      maxTokens: 400,
      timeoutMs: 15_000,
      temperature: 0,
      promptVersion: 'conversation-summary-v1',
      callSite: 'conversation/memory:foldIntoSummary',
      feature: 'conversation_memory',
    })
    const summary = res.data?.summary?.trim()
    if (summary) return summary
  } catch {
    // fall through to deterministic
  }
  const added = turns.map((t) => `${t.role === 'me' ? 'I' : 'They'} said: ${clip(t.text, 120)}`).join(' ')
  return clip(`${previous} ${added}`.trim(), SUMMARY_MAX_WORDS * 7)
}

/**
 * Bring memory up to date with the thread. Only pays for model calls when
 * something new happened: a new client turn to analyze, or turns that left
 * the verbatim window and need folding into the summary.
 */
export async function refreshMemory(
  lead: LeadDetail,
  thread: ConversationTurn[],
  existing: ConversationMemory | null | undefined,
  conversationStage?: string | null,
): Promise<{ memory: ConversationMemory; changed: boolean }> {
  const prev = existing?.version === 1 ? existing : emptyMemory()
  let changed = !existing
  const memory: ConversationMemory = { ...prev, facts: { ...prev.facts } }

  // 1. Fold turns that left the verbatim window.
  const older = thread.slice(0, Math.max(0, thread.length - VERBATIM_WINDOW))
  const lastOlder = older.at(-1)
  if (lastOlder && lastOlder.id !== prev.summarizedThroughId) {
    const startIdx = prev.summarizedThroughId ? older.findIndex((t) => t.id === prev.summarizedThroughId) + 1 : 0
    const toFold = older.slice(Math.max(0, startIdx))
    memory.rollingSummary = await foldIntoSummary(prev.rollingSummary, toFold)
    memory.summarizedThroughId = lastOlder.id
    changed = true
  }

  // 2. Analyze the latest client turn once.
  const latestClient = [...thread].reverse().find((t) => t.role === 'client') ?? null
  const latestIsClient = thread.at(-1)?.role === 'client'
  if (latestClient && prev.lastClientAnalysis?.turnId !== latestClient.id) {
    const analysis = applyIntentSafeguards(await analyzeClientTurn(lead, thread, latestClient), thread, latestClient)
    memory.facts = mergeFacts(prev.facts, analysis, latestIsClient)
    if (analysis.intent === 'not_interested' || analysis.intent === 'not_now') {
      // A declined or deferred thread has no live buying signals.
      memory.facts = { ...memory.facts, buyingSignals: [] }
    }
    memory.lastClientAnalysis = {
      turnId: latestClient.id,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      questions: analysis.questions,
      buyingSignals: analysis.buyingSignals,
      summary: analysis.summary,
    }
    changed = true
  } else if (!latestIsClient && memory.facts.openQuestions.length > 0) {
    // We replied since — those questions are answered.
    memory.facts = mergeFacts(prev.facts, null, false)
    changed = true
  }

  // Facts the lead's own post already states count until the client says otherwise.
  // For inbound leads, the opening message lives on lead.inboundMessage (not in
  // signalEvidence/rawInput which are null), so include it as a fact source.
  const source = [lead.signalEvidence, lead.rawInput, lead.inboundMessage].filter(Boolean).join('\n')
  const buyerFacts = readBuyerSourceFacts(source)
  const verifiedBuyerRequest = buyerFacts.externalServiceRequest
  if (!memory.facts.budget) {
    const budget = verifiedBuyerRequest ? buyerFacts.statedBudget : null
    if (budget) {
      memory.facts = { ...memory.facts, budget: `${budget.amount}${budget.approved ? ' approved' : ''} (from their post)` }
      changed = true
    }
  }
  if (!memory.facts.timeline) {
    const timeline = verifiedBuyerRequest ? extractStatedTimeline(source) : null
    if (timeline && isBuyerOwnedCommercialFactLine(timeline.line)) {
      memory.facts = { ...memory.facts, timeline: `${timeline.label} (from their post)` }
      changed = true
    }
  }
  // Absolute dates (month/year, quarters, exact calendar dates) are not matched
  // by extractStatedTimeline (relative durations only). Fall back to the
  // canonical explicit-dates reader so "February 2027", "Q1 2027", "March 15"
  // surface in the Deal panel.
  if (!memory.facts.timeline && verifiedBuyerRequest) {
    const dates = extractExplicitDates(source)
    const absLabel = dates.buyerStartDate ?? dates.deadline
    if (absLabel) {
      const qualifier = dates.buyerStartDate ? 'start' : dates.deadline ? 'deadline' : 'stated'
      memory.facts = { ...memory.facts, timeline: `${absLabel} (${qualifier}, from their post)` }
      changed = true
    }
  }

  // Derive project need from the inbound message when not already set.
  // This extracts the core project description so the Deal panel shows a
  // meaningful need even without AI analysis.
  if (!memory.facts.need && verifiedBuyerRequest) {
    const need = extractProjectNeed(verifiedBuyerRequest.line) ?? verifiedBuyerRequest.line
    if (need) {
      memory.facts = { ...memory.facts, need }
      changed = true
    }
  }

  const stage = deriveDealStage(lead, thread, memory, conversationStage)
  if (stage !== memory.stage) {
    memory.stage = stage
    changed = true
  }
  if (changed) memory.updatedAt = new Date().toISOString()
  return { memory, changed }
}
