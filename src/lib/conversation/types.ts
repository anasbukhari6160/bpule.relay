/**
 * Conversation layer — one thread per lead, read by every message writer.
 *
 * The thread is the ordered list of turns (Me / Client). Memory is the
 * compact, persisted understanding of the deal so far: a rolling summary of
 * turns that fell out of the verbatim window, plus structured deal facts.
 * Keeping the old turns as a summary (updated only when the window moves) is
 * what keeps every draft call small.
 */

export type TurnRole = 'me' | 'client'

export type TurnKind = 'connection' | 'dm' | 'followup' | 'reply' | 'email' | 'upwork' | 'inbound_first'

export interface ConversationTurn {
  id: string
  role: TurnRole
  kind: TurnKind
  text: string
  at: string | null
}

/** Where the deal is. Each stage has one job for the next message. */
export type DealStage =
  | 'not_connected'
  | 'connected'
  | 'opened'
  | 'engaged'
  | 'qualifying'
  | 'call_proposed'
  | 'call_booked'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'

export interface DealFacts {
  need: string | null
  timeline: string | null
  budget: string | null
  decisionMaker: string | null
  /** Questions the client asked that we have not answered yet. */
  openQuestions: string[]
  objections: string[]
  /** Things we already told them — never repeat. */
  alreadyShared: string[]
  buyingSignals: string[]
  /** What the client said about meeting/calls, availability, preferred channel. */
  nextStepNotes: string | null
}

export interface ClientTurnAnalysis {
  intent: 'interested' | 'question' | 'objection' | 'not_now' | 'not_interested' | 'referral' | 'meeting_request' | 'pricing' | 'neutral' | 'auto_reply'
  sentiment: 'positive' | 'neutral' | 'negative'
  questions: string[]
  buyingSignals: string[]
  summary: string
}

export interface ConversationMemory {
  version: 1
  /** Summary of turns older than the verbatim window. */
  rollingSummary: string
  /** Id of the newest turn folded into rollingSummary. */
  summarizedThroughId: string | null
  facts: DealFacts
  stage: DealStage
  /** Analysis of the latest client turn, keyed by its id. */
  lastClientAnalysis: (ClientTurnAnalysis & { turnId: string }) | null
  updatedAt: string
}

export type ComposeIntent = 'connection' | 'dm' | 'followup' | 'reply' | 'custom'

export interface ComposeRationale {
  goal: string
  stage: DealStage
  answers: string[]
  nextStep: string
  /** Why this message, in one line, for the rep. */
  why: string
}

/** The rep's working draft for a lead, persisted so it survives reloads. */
export interface ComposerDraft {
  intent: ComposeIntent
  text: string
  /** The AI's original text, kept so edits can be learned from on send. */
  originalText: string | null
  rationale: ComposeRationale | null
  updatedAt: string
}

export function emptyDealFacts(): DealFacts {
  return {
    need: null,
    timeline: null,
    budget: null,
    decisionMaker: null,
    openQuestions: [],
    objections: [],
    alreadyShared: [],
    buyingSignals: [],
    nextStepNotes: null,
  }
}

export function emptyMemory(): ConversationMemory {
  return {
    version: 1,
    rollingSummary: '',
    summarizedThroughId: null,
    facts: emptyDealFacts(),
    stage: 'not_connected',
    lastClientAnalysis: null,
    updatedAt: new Date(0).toISOString(),
  }
}
