/**
 * Lead Decision Context API
 *
 * Returns the full runtime context for a lead:
 * - Opportunity score + dimensions (from V3 packet)
 * - Sender routing (ranked senders with match %)
 * - Conversation override (if client replied)
 * - Mismatch detection
 *
 * No AI calls — deterministic from stored data + sender profiles.
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { loadSenderCandidates } from '@/lib/relay/sender-suggestion'
import { rankSendersForLead, type SenderProfile } from '@/lib/relay/sender-routing-engine'
import { resolveEffectiveAction, classifyConversationIntent } from '@/lib/relay/conversation-override'
import type { ConversationState } from '@/lib/relay/conversation-override'
import { computeHistoricalOutcomes, toRoutingFormat } from '@/lib/relay/historical-outcomes'

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

  // Load all org sender profiles with proof
  const senderCandidates = await loadSenderCandidates(
    store.getSupabaseClient(),
    lead.organizationId,
    lead.ownerRepId ?? '',
  )
  // Historical outcomes — bounded evidence, only for senders with 5+ leads
  const historicalMap = await computeHistoricalOutcomes(store.getSupabaseClient(), lead.organizationId)

  const senderProfiles: SenderProfile[] = senderCandidates.map((c) => ({
    ...c,
    industries: [],
    historicalOutcomes: toRoutingFormat(historicalMap.get(c.id)),
  }))

  // Parse V3 decision packet
  const ci = parseCanonicalIntelligence(lead.canonicalIntelligence)
  const v3Packet = (ci?.v3DecisionPacket ?? (ci as Record<string, unknown>)?.v3DecisionPacket) as Record<string, unknown> | null
  const decision = (v3Packet?.decision as Record<string, unknown> | null) ?? null

  const capabilities = extractCapabilities(v3Packet)
  const industries: string[] = []
  if (ci) {
    const intel = (ci.intelligence as Record<string, unknown> | null)
    if (intel?.company) {
      const company = intel.company as Record<string, unknown>
      if (typeof company.industry === 'string') industries.push(company.industry)
    }
  }

  const routing = rankSendersForLead(
    {
      capabilities,
      industries,
      buyerRequestProbability: (decision?.buyerRequestProbability as number) ?? 0.5,
      fitLevel: (decision?.fitLevel as string) ?? 'MEDIUM',
      rawTerms: buildRawTerms(lead, ci),
      platform: null,
    },
    senderProfiles,
    lead.senderProfileId ?? null,
  )

  // Conversation state
  const conversation = buildConversationState(lead)
  const coldScore = (v3Packet?.score as number) ?? lead.canonicalScore ?? null
  const coldAction = (v3Packet?.action as string) ?? null
  const override = resolveEffectiveAction(coldScore, coldAction, conversation)

  return NextResponse.json({
    leadId: lead.id,
    company: lead.company,
    contactName: lead.contactName,
    opportunityScore: coldScore,
    qualification: ci?.qualification ?? null,
    label: (v3Packet?.label as string) ?? null,
    buyerRequestProbability: (decision?.buyerRequestProbability as number) ?? 0,
    fitLevel: (decision?.fitLevel as string) ?? 'UNKNOWN',
    coldAction,
    dimensions: extractDimensions(v3Packet),
    routing,
    conversationOverride: override.conversationOverride,
    effectiveAction: override.effectiveAction,
    actionReason: override.reason,
    actionConfidence: override.confidence,
    lastInboundIntent: conversation?.latestInboundIntent ?? null,
    hasMismatch: (routing.mismatchDelta ?? 0) >= 20,
    mismatchDelta: routing.mismatchDelta,
    scoringVersion: (v3Packet?.scoreVersion as string) ?? 'unknown',
    routingVersion: routing.routingVersion,
    generatedAt: new Date().toISOString(),
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCanonicalIntelligence(ci: unknown): Record<string, unknown> | null {
  if (!ci) return null
  if (typeof ci === 'object') return ci as Record<string, unknown>
  if (typeof ci === 'string') {
    try { return JSON.parse(ci) as Record<string, unknown> } catch { return null }
  }
  return null
}

function extractCapabilities(v3Packet: Record<string, unknown> | null): string[] {
  if (!v3Packet) return []
  const episodes = (v3Packet.episodes as Array<Record<string, unknown>>) ?? []
  const caps = new Set<string>()
  for (const ep of episodes) {
    const reqCaps = ep.requestedCapabilities as string[] ?? []
    reqCaps.forEach((c: string) => caps.add(c))
  }
  return [...caps]
}

function buildRawTerms(lead: { company?: string | null; contactName?: string | null; contactTitle?: string | null }, ci: Record<string, unknown> | null): string[] {
  const terms: string[] = []
  if (lead.company) terms.push(lead.company)
  if (lead.contactName) terms.push(lead.contactName)
  if (lead.contactTitle) terms.push(lead.contactTitle)
  if (ci) {
    const intel = (ci.intelligence as Record<string, unknown> | null) ?? ci
    if (intel?.opportunity) {
      const opp = intel.opportunity as Record<string, unknown>
      if (Array.isArray(opp.signals)) terms.push(...(opp.signals as string[]))
    }
  }
  return terms
}

function buildConversationState(lead: { messages?: Array<{ direction?: string; sentText?: string | null; sentAt?: string | null }> }): ConversationState | null {
  const messages = lead.messages ?? []
  if (messages.length === 0) return null

  const inboundMessages = messages.filter((m) => m.direction === 'inbound')
  const lastInbound = [...inboundMessages].sort((a, b) =>
    (b.sentAt ?? '').localeCompare(a.sentAt ?? '')
  )[0] ?? null

  if (!lastInbound) return null

  const intent = lastInbound.sentText
    ? classifyConversationIntent(lastInbound.sentText)
    : 'UNKNOWN'

  return {
    latestInboundIntent: intent,
    lastInboundAt: lastInbound.sentAt ?? null,
    stage: 'replied',
    messageCount: messages.length,
    lastInboundQuote: lastInbound.sentText ?? null,
  }
}

function extractDimensions(v3Packet: Record<string, unknown> | null): Array<{ key: string; label: string; contribution: number; raw: number; note: string }> {
  if (!v3Packet) return []
  const dims = (v3Packet.dimensions as Array<Record<string, unknown>>) ?? []
  return dims.map((d) => ({
    key: (d.key as string) ?? '',
    label: (d.label as string) ?? '',
    contribution: (d.contribution as number) ?? 0,
    raw: (d.raw as number) ?? 0,
    note: (d.note as string) ?? '',
  })).filter((d) => d.key)
}

// Re-export for type consumers
export type { SenderProfile }
