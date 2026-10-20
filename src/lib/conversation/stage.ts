import { resolveConversationIntent } from './intent'
import type { LeadDetail } from '@/lib/store/types'
import type { ComposeIntent, ConversationMemory, ConversationTurn, DealStage } from './types'

/**
 * Deal stage ladder. Every message has exactly one job: move the lead one
 * rung up — connect, open a conversation, qualify, get a call, close.
 */
export function deriveDealStage(
  lead: Pick<LeadDetail, 'status' | 'connectionAcceptedAt' | 'messages'>,
  thread: ConversationTurn[],
  memory: Pick<ConversationMemory, 'facts' | 'lastClientAnalysis'> | null,
  conversationStage?: string | null,
): DealStage {
  if (lead.status === 'won') return 'won'
  if (lead.status === 'lost' || lead.status === 'no' || lead.status === 'dead') return 'lost'
  if (conversationStage === 'negotiation') return 'negotiation'
  if (conversationStage === 'proposal') return 'proposal'
  if (conversationStage === 'meeting') return 'call_booked'

  const clientTurns = thread.filter((t) => t.role === 'client')
  // The client's latest explicit meaning: a rejection ends the deal.
  if (resolveConversationIntent(clientTurns.map((t) => t.text)).declined) return 'lost'
  const myTurns = thread.filter((t) => t.role === 'me' && t.kind !== 'connection')
  const connection = thread.some((t) => t.kind === 'connection')

  if (clientTurns.length === 0) {
    if (myTurns.length > 0) return 'opened'
    if (connection) return lead.connectionAcceptedAt ? 'connected' : 'not_connected'
    return 'not_connected'
  }

  const analysis = memory?.lastClientAnalysis
  const facts = memory?.facts
  const meetingTalk = analysis?.intent === 'meeting_request'
    || /\b(call|meeting|zoom|meet|talk|chat|calendar|book|slot|available)\b/i.test(facts?.nextStepNotes ?? '')
  if (meetingTalk) return 'call_proposed'

  const known = [facts?.need, facts?.timeline, facts?.budget, facts?.decisionMaker].filter(Boolean).length
  if (known >= 1 || (analysis && ['interested', 'pricing', 'question'].includes(analysis.intent))) return 'qualifying'
  return 'engaged'
}

export interface StageGoal {
  goal: string
  /** Whether proposing a call / next step is allowed in this message. */
  allowCallAsk: boolean
  wordBudget: { min: number; max: number }
}

/**
 * The job of the next message. Asking for a call is allowed once the client
 * has replied and shown interest — before that it reads as a pitch.
 */
export function goalFor(stage: DealStage, intent: ComposeIntent, memory: ConversationMemory | null): StageGoal {
  const analysis = memory?.lastClientAnalysis
  const facts = memory?.facts

  if (intent === 'connection') {
    return { goal: 'Earn the connection. One genuine, specific reason to connect. No pitch, no question, no CTA. Hard cap 120 characters.', allowCallAsk: false, wordBudget: { min: 14, max: 20 } }
  }

  if (analysis?.intent === 'not_interested') {
    return { goal: 'Close gracefully. Thank them, accept the no without pushing, leave one easy door open for later.', allowCallAsk: false, wordBudget: { min: 15, max: 45 } }
  }
  if (analysis?.intent === 'not_now') {
    return { goal: 'Respect the timing. Ask one light question about when it would make sense to reconnect, or permission to check back.', allowCallAsk: false, wordBudget: { min: 15, max: 50 } }
  }
  if (analysis?.intent === 'referral') {
    return { goal: 'Thank them and make the referral easy: ask for the right person or a one-line intro, with the reason in one sentence.', allowCallAsk: false, wordBudget: { min: 20, max: 60 } }
  }
  if (analysis?.intent === 'auto_reply') {
    return { goal: 'Do not answer the auto-reply. Wait or write a short note for when they are back.', allowCallAsk: false, wordBudget: { min: 10, max: 35 } }
  }

  switch (stage) {
    case 'not_connected':
    case 'connected':
      return { goal: 'Open a real conversation. One relevant observation tied to their situation and one specific, easy-to-answer question. No pitch, no call ask.', allowCallAsk: false, wordBudget: { min: 25, max: 60 } }
    case 'opened':
      return intent === 'followup'
        ? { goal: 'Follow up with ONE new reason to reply (a useful insight, a relevant result, or a sharper question). Never "just following up", never guilt, never repeat the last message.', allowCallAsk: false, wordBudget: { min: 15, max: 50 } }
        : { goal: 'Open a real conversation with one specific question.', allowCallAsk: false, wordBudget: { min: 25, max: 60 } }
    case 'engaged':
      return {
        goal: 'Answer what they asked first, then learn their actual need: what they are trying to get done and why now. End with one question that moves the deal forward.',
        allowCallAsk: (analysis?.buyingSignals.length ?? 0) > 0 || analysis?.intent === 'interested',
        wordBudget: { min: 30, max: 90 },
      }
    case 'qualifying': {
      const missing = [
        !facts?.need && 'what they need built and why',
        !facts?.timeline && 'their timeline',
        !facts?.decisionMaker && 'who decides',
        !facts?.budget && 'budget range',
      ].filter(Boolean)
      return {
        goal: `Answer their questions first. Then move to a short call: propose 15-20 minutes with two concrete time options, framed around their problem. ${missing.length ? `If a call is premature, ask about ${missing[0]} instead — only one question.` : ''}`.trim(),
        allowCallAsk: true,
        wordBudget: { min: 30, max: 100 },
      }
    }
    case 'call_proposed':
      return { goal: 'Lock the call: confirm a specific time (offer two options or accept theirs), the channel, and one line on what you will cover. Make saying yes effortless.', allowCallAsk: true, wordBudget: { min: 20, max: 70 } }
    case 'call_booked':
      return { goal: 'Confirm the call logistics and send a short agenda. Ask one prep question that makes the call more useful for them.', allowCallAsk: true, wordBudget: { min: 20, max: 80 } }
    case 'proposal':
      return { goal: 'Move the proposal to a decision: address their open questions or objections directly and propose the concrete next step (sign-off, scope call, start date).', allowCallAsk: true, wordBudget: { min: 30, max: 110 } }
    case 'negotiation':
      return { goal: 'Resolve the remaining objection honestly and propose a clear path to start. No pressure tactics.', allowCallAsk: true, wordBudget: { min: 30, max: 110 } }
    case 'won':
      return { goal: 'Keep the relationship warm: confirm next steps for kickoff.', allowCallAsk: true, wordBudget: { min: 20, max: 80 } }
    case 'lost':
      return { goal: 'Close politely and leave the door open.', allowCallAsk: false, wordBudget: { min: 15, max: 45 } }
  }
}

export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  opened: 'Opened',
  engaged: 'In conversation',
  qualifying: 'Qualifying',
  call_proposed: 'Call proposed',
  call_booked: 'Call booked',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
}
