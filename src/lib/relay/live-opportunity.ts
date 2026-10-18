import { resolveConversationIntent, classifyClientMessage, type IntentClass } from '@/lib/conversation/intent'

export type ConversationState = 'ACTIVE' | 'DEFERRED' | 'CLOSED' | 'WAITING'
export type LiveAction = 'REPLY_NOW' | 'WAIT' | 'CLOSE' | 'NONE'

export interface LiveOpportunityState {
  leadId: string
  conversationState: ConversationState
  liveAction: LiveAction
  latestInboundAt: string | null
  latestInboundText: string | null
  conversationIntent: IntentClass
  conversationStrength: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
  supersedesInitialScore: boolean
  reason: string
  detectedAt: string
}

/**
 * Evaluate live conversation opportunity from inbound messages.
 * This supersedes the initial cold prospect score when the prospect is actively engaged.
 */
export function evaluateLiveOpportunity(params: {
  leadId: string
  messages: Array<{
    direction: string
    sentText: string | null
    sentAt: string | null
  }>
  initialAction: string
  initialScore: number
}): LiveOpportunityState {
  const { leadId, messages, initialAction, initialScore } = params

  // Get all inbound messages in order
  const inboundMessages = messages
    .filter(m => m.direction === 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))

  const outboundMessages = messages
    .filter(m => m.direction !== 'inbound' && m.sentText && m.sentAt)
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))

  const latestInbound = inboundMessages.at(-1)
  const latestOutbound = outboundMessages.at(-1)

  // No conversation yet
  if (!latestInbound) {
    return {
      leadId,
      conversationState: 'WAITING',
      liveAction: 'NONE',
      latestInboundAt: null,
      latestInboundText: null,
      conversationIntent: 'NEUTRAL',
      conversationStrength: 'NONE',
      supersedesInitialScore: false,
      reason: 'No inbound messages',
      detectedAt: new Date().toISOString(),
    }
  }

  // Classify the latest inbound message
  const intent = classifyClientMessage(latestInbound.sentText ?? '')
  const threadIntent = resolveConversationIntent(inboundMessages.map(m => m.sentText!))

  // Determine if our last message is newer than theirs (we already replied)
  const unanswered = !latestOutbound || (latestOutbound.sentAt ?? '') <= (latestInbound.sentAt ?? '')

  // Closed
  if (threadIntent.declined || intent.class === 'NEGATIVE' || intent.class === 'CLOSED') {
    return {
      leadId,
      conversationState: 'CLOSED',
      liveAction: 'CLOSE',
      latestInboundAt: latestInbound.sentAt,
      latestInboundText: latestInbound.sentText,
      conversationIntent: intent.class,
      conversationStrength: 'NONE',
      supersedesInitialScore: true,
      reason: threadIntent.declined
        ? `Client declined: "${(threadIntent.decidingText ?? '').slice(0, 60)}"`
        : 'Client closed conversation',
      detectedAt: new Date().toISOString(),
    }
  }

  // Deferred
  if (threadIntent.deferred || intent.class === 'DEFERRED') {
    return {
      leadId,
      conversationState: 'DEFERRED',
      liveAction: 'WAIT',
      latestInboundAt: latestInbound.sentAt,
      latestInboundText: latestInbound.sentText,
      conversationIntent: intent.class,
      conversationStrength: 'LOW',
      supersedesInitialScore: true,
      reason: threadIntent.deferred
        ? `Client deferred: "${(threadIntent.decidingText ?? '').slice(0, 60)}"`
        : 'Client asked to revisit later',
      detectedAt: new Date().toISOString(),
    }
  }

  // Active conversation — prospect engaged
  if (unanswered) {
    const strength = assessConversationStrength(intent.class, latestInbound.sentText ?? '')

    return {
      leadId,
      conversationState: 'ACTIVE',
      liveAction: 'REPLY_NOW',
      latestInboundAt: latestInbound.sentAt,
      latestInboundText: latestInbound.sentText,
      conversationIntent: intent.class,
      conversationStrength: strength,
      supersedesInitialScore: true,
      reason: `Prospect replied: "${(latestInbound.sentText ?? '').slice(0, 80)}" — ${intent.class} intent, ${strength} strength`,
      detectedAt: new Date().toISOString(),
    }
  }

  // We replied last — waiting for their response
  return {
    leadId,
    conversationState: 'WAITING',
    liveAction: 'NONE',
    latestInboundAt: latestInbound.sentAt,
    latestInboundText: latestInbound.sentText,
    conversationIntent: intent.class,
    conversationStrength: 'NONE',
    supersedesInitialScore: false,
    reason: 'Waiting for prospect response after our last message',
    detectedAt: new Date().toISOString(),
  }
}

/**
 * Assess conversation strength from intent class and message content.
 */
function assessConversationStrength(intentClass: IntentClass, text: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const lower = text.toLowerCase()

  // High strength: explicit buying signals
  if (
    /tell me more|send me|share (?:this|with|details|pricing|rates)|what'?s your (?:rate|price|process)|can you (?:send|share|explain)|interested|let'?s (?:talk|chat|move forward)|when can you start/i.test(lower)
  ) {
    return 'HIGH'
  }

  // Medium strength: engagement signals
  if (
    /tell me more|more info|details|examples|portfolio|pricing|rates|cost|how much|timeline|process/i.test(lower)
  ) {
    return 'MEDIUM'
  }

  return 'LOW'
}

/**
 * Determine the effective action: live conversation supersedes cold prospect score.
 */
export function getEffectiveAction(params: {
  initialAction: string
  initialScore: number
  liveState: LiveOpportunityState
}): string {
  const { initialAction, initialScore, liveState } = params

  // Live conversation ALWAYS supersedes cold prospect state
  if (liveState.supersedesInitialScore) {
    switch (liveState.liveAction) {
      case 'REPLY_NOW':
        return 'REPLY_NOW'
      case 'CLOSE':
        return 'CLOSED'
      case 'WAIT':
        return 'WAIT'
      case 'NONE':
        break // Fall through to initial action
    }
  }

  return initialAction
}
