/**
 * ONE action policy — deriveRecommendedAction().
 *
 * Consumes: opportunity (score, qualification, buyer intent, access, timing,
 * relationship role, commercial potential), confidence, sender match, live
 * conversation and lifecycle. Produces the single recommended action every
 * surface shows, plus an optional routing recommendation (REFER /
 * ASK_FOR_HELP) that requires human confirmation.
 *
 * Precedence:
 *   1. Live conversation — once the prospect replied, the latest inbound
 *      intent decides. The cold score is preserved, never overwritten.
 *   2. Lifecycle — a contacted lead waits for a reply or follows up; a lost
 *      or won lead is closed.
 *   3. Cold opportunity — qualification × intent × access × confidence.
 *   4. Routing overlay — a clearly better sender becomes a REFER suggestion;
 *      a high-value lead with no good sender becomes ASK_FOR_HELP.
 */

import type { ConversationIntent } from '@/lib/relay/conversation-override'
import type { CanonicalQualification } from '@/lib/scoring/qualification'
import { ACTION_POLICY_VERSION } from '../versions'

export type RecommendedAction =
  | 'CONTACT_NOW'
  | 'CONNECT_WITH_NOTE'
  | 'CONNECT_WITHOUT_NOTE'
  | 'RESEARCH_MORE'
  | 'OBSERVE'
  | 'WAIT'
  | 'REPLY_NOW'
  | 'FOLLOW_UP'
  | 'DEFER'
  | 'CLOSE'
  | 'REFER'
  | 'ASK_FOR_HELP'

export type RoutingRecommendation = 'KEEP' | 'REFER' | 'ASSIGN' | 'ASK_FOR_HELP'

export interface ActionOpportunityInput {
  score: number | null
  qualification: CanonicalQualification | 'INELIGIBLE' | null
  buyerIntentLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'NONE'
  verifiedBuyerRequest: boolean
  relationshipRole: 'BUYER' | 'BUYER_AND_SELLER' | 'SELLER' | 'BUILDER' | 'RECRUITER' | 'CANDIDATE' | 'UNKNOWN'
  access: 'DIRECT' | 'CONNECTION' | 'INDIRECT' | 'NONE'
  buyerTiming: 'NONE' | 'WEAK' | 'CURRENT' | 'URGENT'
  activityRecency: 'FRESH' | 'RECENT' | 'AGING' | 'STALE' | 'UNKNOWN'
  commercialPotential: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  episodeClosed: boolean
}

export interface ActionConversationInput {
  latestInboundIntent: ConversationIntent | null
  /** Who spoke last — if we did, we wait; if they did, we reply. */
  lastDirection: 'inbound' | 'outbound' | null
  stage: 'cold' | 'contacted' | 'replied' | 'meeting_booked' | 'closed' | 'lost' | 'won'
  daysSinceLastOutbound: number | null
  followupCount: number
  followupLimit: number
  connectionAccepted: boolean
}

export interface ActionSenderInput {
  currentSenderMatch: number | null
  bestSenderMatch: number | null
  bestSenderId: string | null
  currentSenderId: string | null
  bestSenderAccessible: boolean
}

export interface DeriveActionInput {
  opportunity: ActionOpportunityInput
  confidence: { label: 'HIGH' | 'MEDIUM' | 'LOW'; researchMore: boolean }
  conversation?: ActionConversationInput | null
  sender?: ActionSenderInput | null
  /** The channel the action will be executed on; connection notes only exist on LinkedIn. */
  channel?: 'linkedin' | 'email' | 'upwork' | 'other'
}

export interface DeriveActionOutput {
  version: string
  action: RecommendedAction
  /** Should a message be written for this action? */
  messageEligible: boolean
  /** Is this a pitch (needs sender + proof) or a relationship touch? */
  pitch: boolean
  reason: string
  /** The cold recommendation before any live override, for the trace. */
  coldAction: RecommendedAction
  conversationOverride: boolean
  routing: { recommendation: RoutingRecommendation; reason: string | null; delta: number | null }
  /** Legacy V3Action for surfaces that still read it. */
  legacyAction: 'CONTACT_NOW' | 'CONNECT_WITH_NOTE' | 'CONNECT_WITHOUT_NOTE' | 'OBSERVE' | 'WAIT' | 'SKIP' | 'HUMAN_REVIEW'
}

export const ROUTING_MISMATCH_DELTA = 20
export const HELP_MIN_SCORE = 55
export const HELP_MAX_CURRENT_MATCH = 40

const PITCH_ACTIONS: ReadonlySet<RecommendedAction> = new Set(['CONTACT_NOW', 'REPLY_NOW', 'FOLLOW_UP'])
const MESSAGE_ACTIONS: ReadonlySet<RecommendedAction> = new Set(['CONTACT_NOW', 'CONNECT_WITH_NOTE', 'REPLY_NOW', 'FOLLOW_UP'])

export function deriveRecommendedAction(input: DeriveActionInput): DeriveActionOutput {
  const cold = coldAction(input)
  let action = cold.action
  let reason = cold.reason
  let conversationOverride = false

  const conv = input.conversation ?? null
  if (conv) {
    const live = liveAction(conv, cold.action)
    if (live) {
      action = live.action
      reason = live.reason
      conversationOverride = live.override
    }
  }

  const routing = routingOverlay(input, action)

  return {
    version: ACTION_POLICY_VERSION,
    action,
    messageEligible: MESSAGE_ACTIONS.has(action),
    pitch: PITCH_ACTIONS.has(action),
    reason,
    coldAction: cold.action,
    conversationOverride,
    routing,
    legacyAction: toLegacyAction(action),
  }
}

// ── Cold policy ─────────────────────────────────────────────────────────────

function coldAction(input: DeriveActionInput): { action: RecommendedAction; reason: string } {
  const o = input.opportunity
  const q = o.qualification
  const conf = input.confidence

  if (o.episodeClosed) return { action: 'CLOSE', reason: 'The opportunity episode is closed or negated.' }
  if (o.score === null || q === null) return { action: 'RESEARCH_MORE', reason: 'No scored opportunity yet.' }
  if (q === 'INELIGIBLE') return { action: 'CLOSE', reason: 'Not eligible for outreach.' }

  const nonBuyerRole = o.relationshipRole === 'SELLER' || o.relationshipRole === 'RECRUITER' || o.relationshipRole === 'CANDIDATE'
  const intentHigh = o.buyerIntentLevel === 'HIGH'
  const intentMedium = o.buyerIntentLevel === 'MEDIUM'
  const reachable = o.access === 'DIRECT' || o.access === 'CONNECTION'

  // Verified buyer request: act, scaled by access and timing.
  if (o.verifiedBuyerRequest && (intentHigh || intentMedium)) {
    if (o.buyerTiming === 'WEAK' && o.activityRecency === 'STALE') {
      return { action: 'WAIT', reason: 'Verified request, but it is stale — confirm it is still open before reaching out.' }
    }
    if (conf.label === 'LOW' && !intentHigh) {
      return { action: 'RESEARCH_MORE', reason: 'A request is in the source but confidence is low — verify before pitching.' }
    }
    if (o.access === 'DIRECT') return { action: 'CONTACT_NOW', reason: `Verified request${o.buyerTiming === 'URGENT' ? ' with a stated deadline' : ''} and a direct route to the decision-maker.` }
    if (o.access === 'CONNECTION') return { action: 'CONNECT_WITH_NOTE', reason: 'Verified request; connection note referencing their ask is the route.' }
    return { action: 'CONNECT_WITHOUT_NOTE', reason: 'Verified request but no warm route — earn the connection first.' }
  }

  // No verified request from here on. Never pitch.
  if (q === 'SKIP') return { action: 'CLOSE', reason: 'No commercial reason to act on this profile.' }

  // A seller, recruiter or candidate is not "uncertain" — their role is
  // known; low confidence about buyer intent does not make them research
  // targets.
  if (nonBuyerRole) {
    // Commercial maturity never becomes CONTACT_NOW or a silent pursuit.
    // A reachable seller with real potential gets a relationship note.
    // Otherwise observe. A verified buy is handled above, as BUYER.
    if (!o.verifiedBuyerRequest && (q === 'STRONG' || q === 'WORTH_PURSUING' || q === 'MAYBE')) {
      const reachable = o.access === 'DIRECT' || o.access === 'CONNECTION'
      const mature = o.commercialPotential === 'HIGH' || o.commercialPotential === 'VERY_HIGH'
      if (q !== 'MAYBE' && reachable && mature && conf.label !== 'LOW') {
        return { action: 'CONNECT_WITH_NOTE', reason: `${roleWord(o.relationshipRole)} with commercial potential and a route — relationship note, not a pitch.` }
      }
      return { action: 'OBSERVE', reason: `${roleWord(o.relationshipRole)} — not a buyer today; keep on the watch list.` }
    }
    if (q === 'MAYBE') return { action: 'OBSERVE', reason: `${roleWord(o.relationshipRole)} — not a buyer today; keep on the watch list.` }
    return { action: 'CLOSE', reason: `${roleWord(o.relationshipRole)} with weak commercial potential.` }
  }

  if (conf.researchMore && q !== 'LOW') {
    return { action: 'RESEARCH_MORE', reason: 'Score is plausible but confidence is low — research before spending outreach effort.' }
  }

  if (q === 'STRONG' || q === 'WORTH_PURSUING') {
    if (reachable && input.channel !== 'email' && input.channel !== 'upwork') {
      return { action: 'CONNECT_WITH_NOTE', reason: 'High commercial potential without an explicit request — relationship note, no pitch.' }
    }
    return { action: 'CONNECT_WITHOUT_NOTE', reason: 'High commercial potential; earn the connection before any message.' }
  }
  if (q === 'MAYBE') {
    if (o.commercialPotential === 'HIGH' || o.commercialPotential === 'VERY_HIGH') return { action: 'CONNECT_WITHOUT_NOTE', reason: 'Plausible fit and active organization — connect without a note.' }
    return { action: 'OBSERVE', reason: 'Plausible but unproven — observe for a trigger.' }
  }
  // LOW
  if (o.commercialPotential === 'HIGH' || o.commercialPotential === 'VERY_HIGH') return { action: 'OBSERVE', reason: 'Weak overall, but the organization is active — observe.' }
  return { action: 'CLOSE', reason: 'Weak fit and no buying signal.' }
}

function roleWord(role: ActionOpportunityInput['relationshipRole']): string {
  switch (role) {
    case 'BUYER_AND_SELLER': return 'Buyer who also sells'
    case 'SELLER': return 'Service provider'
    case 'RECRUITER': return 'Recruiter'
    case 'CANDIDATE': return 'Candidate'
    default: return 'Contact'
  }
}

// ── Live policy ─────────────────────────────────────────────────────────────

function liveAction(conv: ActionConversationInput, cold: RecommendedAction): { action: RecommendedAction; reason: string; override: boolean } | null {
  if (conv.stage === 'won' || conv.stage === 'lost' || conv.stage === 'closed') {
    return { action: 'CLOSE', reason: `Lead is ${conv.stage}.`, override: true }
  }
  if (conv.stage === 'meeting_booked') {
    return { action: 'WAIT', reason: 'Meeting booked — prepare, do not re-message.', override: true }
  }

  const intent = conv.latestInboundIntent
  if (conv.lastDirection === 'inbound' && intent) {
    switch (intent) {
      case 'NOT_INTERESTED': return { action: 'CLOSE', reason: 'They said no — close regardless of the cold score.', override: true }
      case 'SEND_PROPOSAL': return { action: 'REPLY_NOW', reason: 'They asked for a proposal — reply now.', override: true }
      case 'SCHEDULE_CALL': return { action: 'REPLY_NOW', reason: 'They asked for a call — reply now.', override: true }
      case 'PRICING_INQUIRY': return { action: 'REPLY_NOW', reason: 'They asked about pricing — active buying signal.', override: true }
      case 'INTERESTED': return { action: 'REPLY_NOW', reason: 'They expressed interest — reply now.', override: true }
      case 'NEEDS_MORE_INFO': return { action: 'REPLY_NOW', reason: 'They want more information — reply with relevant proof.', override: true }
      case 'OBJECTION': return { action: 'RESEARCH_MORE', reason: 'They raised an objection — research before responding.', override: true }
      case 'REFERRAL': return { action: 'REFER', reason: 'They pointed to someone else — route the lead.', override: true }
      case 'UNRELATED':
      case 'UNKNOWN':
      default:
        return { action: 'REPLY_NOW', reason: 'Inbound message awaiting a reply.', override: true }
    }
  }

  if (conv.stage === 'contacted' || conv.lastDirection === 'outbound') {
    if (conv.followupCount >= conv.followupLimit) return { action: 'DEFER', reason: 'Follow-up limit reached — defer.', override: true }
    const days = conv.daysSinceLastOutbound ?? 0
    if (conv.connectionAccepted && conv.followupCount === 0 && cold !== 'CLOSE') {
      return { action: 'FOLLOW_UP', reason: 'Connection accepted — send the first message.', override: true }
    }
    if (days >= 3) return { action: 'FOLLOW_UP', reason: `No reply for ${days} days — follow up.`, override: true }
    return { action: 'WAIT', reason: 'Message sent recently — wait for a reply.', override: true }
  }

  return null
}

// ── Routing overlay ─────────────────────────────────────────────────────────

function routingOverlay(input: DeriveActionInput, action: RecommendedAction): DeriveActionOutput['routing'] {
  const s = input.sender ?? null
  const score = input.opportunity.score ?? 0
  if (!s || s.bestSenderMatch === null) return { recommendation: 'KEEP', reason: null, delta: null }
  const current = s.currentSenderMatch
  const delta = current === null ? null : s.bestSenderMatch - current
  const outreachAction = action === 'CONTACT_NOW' || action === 'CONNECT_WITH_NOTE' || action === 'REPLY_NOW' || action === 'FOLLOW_UP'

  if (delta !== null && delta >= ROUTING_MISMATCH_DELTA && s.bestSenderId && s.bestSenderId !== s.currentSenderId) {
    return {
      recommendation: s.bestSenderAccessible ? 'ASSIGN' : 'REFER',
      reason: `Best sender matches ${s.bestSenderMatch}% vs current ${current}% (+${delta}). ${s.bestSenderAccessible ? 'Switch sender.' : 'Refer to the holder or ask an admin.'}`,
      delta,
    }
  }
  if (outreachAction && score >= HELP_MIN_SCORE && (current ?? s.bestSenderMatch) < HELP_MAX_CURRENT_MATCH) {
    return {
      recommendation: 'ASK_FOR_HELP',
      reason: `High-value lead (${score}/100) but no sender matches above ${HELP_MAX_CURRENT_MATCH}% — ask the team for proof or a better sender.`,
      delta,
    }
  }
  return { recommendation: 'KEEP', reason: null, delta }
}

export function toLegacyAction(action: RecommendedAction): DeriveActionOutput['legacyAction'] {
  switch (action) {
    case 'CONTACT_NOW':
    case 'REPLY_NOW':
    case 'FOLLOW_UP':
      return action === 'CONTACT_NOW' ? 'CONTACT_NOW' : 'CONTACT_NOW'
    case 'CONNECT_WITH_NOTE': return 'CONNECT_WITH_NOTE'
    case 'CONNECT_WITHOUT_NOTE': return 'CONNECT_WITHOUT_NOTE'
    case 'OBSERVE': return 'OBSERVE'
    case 'RESEARCH_MORE': return 'HUMAN_REVIEW'
    case 'WAIT':
    case 'DEFER': return 'WAIT'
    case 'REFER':
    case 'ASK_FOR_HELP': return 'CONNECT_WITH_NOTE'
    case 'CLOSE':
    default:
      return 'SKIP'
  }
}
