/**
 * Lead Decision Context — single object that answers the 10 business questions.
 *
 * Combines:
 * 1. Opportunity score (from V3 packet — how worthwhile is this prospect?)
 * 2. Sender routing (from sender-routing-engine — who is the best sender?)
 * 3. Conversation state (from conversation-override — what's happening now?)
 *
 * These three dimensions remain INDEPENDENT.
 * A great opportunity + wrong sender = still a great opportunity.
 */

import { rankSendersForLead, type RoutingResult, type SenderProfile, type RoutingLeadContext } from './sender-routing-engine'
import { resolveEffectiveAction, classifyConversationIntent, type ConversationState } from './conversation-override'

export interface LeadDecisionContextInput {
  leadId: string
  company: string | null
  contactName: string | null
  opportunityScore: number | null        // V3 score 0-100
  opportunityQualification: string | null // STRONG | WORTH_PURSUING | MAYBE | LOW | SKIP
  opportunityLabel: string | null
  opportunityDimensions: Array<{
    key: string
    label: string
    contribution: number
    raw: number
    note: string
  }>
  coldAction: string | null
  buyerRequestProbability: number
  fitLevel: string
  capabilities: string[]
  industries: string[]
  senderProfiles: SenderProfile[]
  currentSenderId: string | null
  conversation: ConversationState | null
  scoringVersion: string
}

export interface LeadDecisionContext {
  leadId: string
  company: string | null

  // === OPPORTUNITY (independent of sender) ===
  opportunityScore: number | null
  opportunityQualification: string | null
  opportunityLabel: string | null
  opportunityDimensions: LeadDecisionContextInput['opportunityDimensions']

  // === SENDER ROUTING (independent of opportunity) ===
  senderRouting: RoutingResult

  // === CONVERSATION OVERRIDE ===
  conversationOverride: boolean
  effectiveAction: string
  actionReason: string
  actionConfidence: 'high' | 'medium' | 'low'

  // === COMPOSITE VIEWS ===
  shouldRefer: boolean
  referReason: string | null
  shouldAskHelp: boolean
  helpReason: string | null

  // === MISSING EVIDENCE ===
  missingEvidence: string[]

  // === VERSIONS ===
  scoringVersion: string
  routingVersion: string

  generatedAt: string
}

/**
 * Build the complete decision context for a lead.
 * Single call — no separate orchestration needed.
 */
export function buildLeadDecisionContext(input: LeadDecisionContextInput): LeadDecisionContext {
  const routing = rankSendersForLead(
    {
      capabilities: input.capabilities,
      industries: input.industries,
      buyerRequestProbability: input.buyerRequestProbability,
      fitLevel: input.fitLevel,
      rawTerms: buildRawTerms(input),
    },
    input.senderProfiles,
    input.currentSenderId,
  )

  const override = resolveEffectiveAction(
    input.opportunityScore,
    input.coldAction,
    input.conversation,
  )

  const shouldRefer = shouldRecommendRefer(routing)
  const shouldAskHelp = shouldRecommendHelp(routing, input)
  const missingEvidence = identifyMissingEvidence(input)

  return {
    leadId: input.leadId,
    company: input.company,
    opportunityScore: input.opportunityScore,
    opportunityQualification: input.opportunityQualification,
    opportunityLabel: input.opportunityLabel,
    opportunityDimensions: input.opportunityDimensions,
    senderRouting: routing,
    conversationOverride: override.conversationOverride,
    effectiveAction: override.effectiveAction,
    actionReason: override.reason,
    actionConfidence: override.confidence,
    shouldRefer,
    referReason: shouldRefer ? buildReferReason(routing) : null,
    shouldAskHelp,
    helpReason: shouldAskHelp ? buildHelpReason(routing, input) : null,
    missingEvidence,
    scoringVersion: input.scoringVersion,
    routingVersion: routing.routingVersion,
    generatedAt: new Date().toISOString(),
  }
}

function shouldRecommendRefer(routing: RoutingResult): boolean {
  if (routing.mismatchDelta === null) return false
  if (routing.currentSenderRank === null) return false
  // Recommend refer when best sender is >20 points better AND not current
  return routing.mismatchDelta >= 20 && routing.currentSenderRank !== 1
}

function buildReferReason(routing: RoutingResult): string {
  const best = routing.rankings[0]
  const currentRank = routing.currentSenderRank ?? '?'
  return `Best sender is rank 1 (${best?.name ?? 'unknown'}, ${best?.profileMatch ?? 0}% match). ` +
    `Current sender is rank ${currentRank} (${routing.currentSenderMatch ?? 0}% match). ` +
    `Delta: +${routing.mismatchDelta}%.`
}

function shouldRecommendHelp(routing: RoutingResult, input: LeadDecisionContextInput): boolean {
  // High-value lead with sender mismatch and no conversation yet
  if (input.conversation && input.conversation.stage !== 'cold') return false
  if (input.opportunityScore === null) return false
  return input.opportunityScore >= 55 && (routing.mismatchDelta ?? 0) >= 15
}

function buildHelpReason(routing: RoutingResult, input: LeadDecisionContextInput): string {
  return `High-value lead (${input.opportunityScore}/100) with sender mismatch. ` +
    `Best sender: ${routing.rankings[0]?.name ?? 'unknown'} (${routing.bestSenderMatch}%). ` +
    `Ask for technical support or sender handoff.`
}

function identifyMissingEvidence(input: LeadDecisionContextInput): string[] {
  const missing: string[] = []
  if (input.buyerRequestProbability < 0.3) missing.push('No verified buyer request')
  if (input.fitLevel === 'MEDIUM' || input.fitLevel === 'WEAK' || input.fitLevel === 'POOR') missing.push('Capability fit unverified')
  if (input.opportunityScore !== null && input.opportunityScore < 40) missing.push('Limited evidence overall')
  if (!input.conversation || input.conversation.stage === 'cold') missing.push('No conversation initiated')
  return missing
}

function buildRawTerms(input: LeadDecisionContextInput): string[] {
  const terms: string[] = []
  if (input.company) terms.push(input.company)
  if (input.contactName) terms.push(input.contactName)
  terms.push(...input.capabilities)
  terms.push(...input.industries)
  return terms
}

// Re-export for convenience
export { classifyConversationIntent }
