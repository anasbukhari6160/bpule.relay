/**
 * Lead Decision Context API
 *
 * Returns the full runtime context for a lead:
 * - Opportunity (from the stored V3 packet — never recomputed here)
 * - Sender routing (rankSendersForLead through routing-context, like admin)
 * - Live conversation state
 * - The one recommended action (deriveRecommendedAction) with the cold
 *   action preserved, plus the routing overlay (REFER / ASSIGN / ASK_FOR_HELP)
 *
 * No AI calls. Deterministic from stored data + sender profiles.
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { loadSenderProfiles, parsePacket, routeLead } from '@/lib/relay/routing-context'
import { classifyConversationIntent, type ConversationState } from '@/lib/relay/conversation-override'
import { deriveRecommendedAction } from '@/lib/intelligence-v3/action/recommended-action'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'
import { ROUTING_MISMATCH_DELTA } from '@/lib/intelligence-v3/action/recommended-action'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const store = await createScoutStore()

  const lead = await store.getLead(id)
  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const senderProfiles = await loadSenderProfiles(store.getSupabaseClient(), lead.organizationId, lead.ownerRepId ?? '')
  const packet = parsePacket(lead.canonicalIntelligence)
  const routing = routeLead(
    { company: lead.company, contactName: lead.contactName, contactTitle: lead.contactTitle, rawInput: lead.rawInput, senderProfileId: lead.senderProfileId ?? null },
    packet,
    senderProfiles,
  )

  const conversation = buildConversationState(lead)
  const coldScore = packet?.score ?? lead.canonicalScore ?? null
  const band = coldScore === null ? null : qualifyCanonicalScore(coldScore)
  const best = routing.rankings[0] ?? null
  const current = routing.rankings.find((r) => r.senderId === lead.senderProfileId) ?? null

  const action = deriveRecommendedAction({
    opportunity: {
      score: coldScore,
      qualification: band?.qualification ?? null,
      buyerIntentLevel: packet?.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN',
      verifiedBuyerRequest: packet?.buyerIntent?.verifiedBuyerRequest ?? false,
      relationshipRole: packet?.buyerIntent?.relationshipRole ?? 'UNKNOWN',
      access: packet?.resolved?.access ?? 'CONNECTION',
      buyerTiming: packet?.resolved?.buyerTiming ?? 'NONE',
      activityRecency: packet?.resolved?.activityRecency ?? 'UNKNOWN',
      commercialPotential: packet?.resolved?.commercialPotential ?? 'LOW',
      episodeClosed: false,
    },
    confidence: { label: packet?.confidenceDetail?.label ?? 'LOW', researchMore: packet?.confidenceDetail?.researchMore ?? false },
    conversation,
    sender: {
      currentSenderMatch: current?.profileMatch ?? null,
      bestSenderMatch: best?.profileMatch ?? null,
      bestSenderId: best?.senderId ?? null,
      currentSenderId: lead.senderProfileId ?? null,
      bestSenderAccessible: best?.accessibleToRep ?? false,
    },
    channel: 'linkedin',
  })

  return NextResponse.json({
    leadId: lead.id,
    company: lead.company,
    contactName: lead.contactName,
    // === OPPORTUNITY (independent of sender) ===
    opportunityScore: coldScore,
    displayScore: coldScore === null ? null : displayScoreForCanonical(coldScore),
    qualification: band?.qualification ?? null,
    qualificationLabel: band?.label ?? null,
    label: packet?.label ?? band?.label ?? null,
    buyerIntent: packet?.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN',
    relationshipRole: packet?.buyerIntent?.relationshipRole ?? 'UNKNOWN',
    commercialPotential: packet?.resolved?.commercialPotential ?? null,
    fit: packet?.resolved?.fit ?? packet?.decision?.fit ?? 'UNKNOWN',
    access: packet?.resolved?.access ?? null,
    buyerTiming: packet?.resolved?.buyerTiming ?? null,
    activityRecency: packet?.resolved?.activityRecency ?? null,
    confidence: packet?.confidenceDetail?.label ?? null,
    confidenceReasons: packet?.confidenceDetail?.reasons ?? [],
    buyerRequestProbability: packet?.decision?.buyerRequestProbability ?? 0,
    fitLevel: packet?.resolved?.fit ?? packet?.decision?.fit ?? 'UNKNOWN',
    coldAction: action.coldAction,
    dimensions: (packet?.dimensions ?? []).map((d) => ({ key: d.key, label: d.label, contribution: d.contribution, raw: d.raw, note: d.note })),
    rejectedSignals: packet?.sourceFacts?.rejectedSignals ?? [],
    // === SENDER ROUTING (independent of opportunity) ===
    routing,
    hasMismatch: (routing.mismatchDelta ?? 0) >= ROUTING_MISMATCH_DELTA,
    mismatchDelta: routing.mismatchDelta,
    // === ACTION (one policy; live > cold) ===
    effectiveAction: action.action,
    actionReason: action.reason,
    conversationOverride: action.conversationOverride,
    routingRecommendation: action.routing,
    messageEligible: action.messageEligible,
    lastInboundIntent: conversation?.latestInboundIntent ?? null,
    // === VERSIONS ===
    scoringVersion: packet?.versions?.scoringVersion ?? packet?.scoreVersion ?? 'unknown',
    versions: packet?.versions ?? null,
    routingVersion: routing.routingVersion,
    actionPolicyVersion: action.version,
    generatedAt: new Date().toISOString(),
  })
}

function buildConversationState(lead: {
  status?: string | null
  connectionAcceptedAt?: string | null
  followupCount?: number
  messages?: Array<{ direction?: string; sentText?: string | null; sentAt?: string | null; type?: string | null }>
}): (ConversationState & { lastDirection: 'inbound' | 'outbound' | null; daysSinceLastOutbound: number | null; followupCount: number; followupLimit: number; connectionAccepted: boolean }) | null {
  const messages = (lead.messages ?? []).filter((m) => m.sentAt)
  const terminal = lead.status === 'won' || lead.status === 'lost' || lead.status === 'dead'
  if (messages.length === 0 && !terminal && !lead.connectionAcceptedAt) return null

  const sorted = [...messages].sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
  const last = sorted[sorted.length - 1] ?? null
  const lastInbound = [...sorted].reverse().find((m) => m.direction === 'inbound') ?? null
  const lastOutbound = [...sorted].reverse().find((m) => m.direction !== 'inbound') ?? null
  const intent = lastInbound?.sentText ? classifyConversationIntent(lastInbound.sentText) : 'UNKNOWN'
  const stage: ConversationState['stage'] = lead.status === 'won' ? 'closed' : lead.status === 'lost' || lead.status === 'dead' ? 'lost'
    : lastInbound ? 'replied' : lastOutbound || lead.connectionAcceptedAt ? 'contacted' : 'cold'
  const daysSinceLastOutbound = lastOutbound?.sentAt ? Math.floor((Date.now() - new Date(lastOutbound.sentAt).getTime()) / 86_400_000) : null

  return {
    latestInboundIntent: intent,
    lastInboundAt: lastInbound?.sentAt ?? null,
    stage,
    messageCount: messages.length,
    lastInboundQuote: lastInbound?.sentText ?? null,
    lastDirection: last ? (last.direction === 'inbound' ? 'inbound' : 'outbound') : null,
    daysSinceLastOutbound,
    followupCount: lead.followupCount ?? 0,
    followupLimit: 3,
    connectionAccepted: Boolean(lead.connectionAcceptedAt),
  }
}
