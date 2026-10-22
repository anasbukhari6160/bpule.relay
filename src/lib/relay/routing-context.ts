/**
 * One way to build the inputs for rankSendersForLead() from a stored lead /
 * decision packet, and one way to load the org's sender profiles. The
 * analyze route, the lead decision-context route and the admin routing panel
 * all go through here, so the best sender is the same on every screen.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSenderCandidates } from './sender-suggestion'
import { computeHistoricalOutcomes, toRoutingFormat } from './historical-outcomes'
import { rankSendersForLead, type RoutingLeadContext, type RoutingResult, type SenderProfile } from './sender-routing-engine'
import type { V3LeadDecisionPacket } from '@/lib/intelligence-v3/types'
import type { SourceFactsSummary } from '@/lib/intelligence-v3/source-facts-model'

export interface RoutingLeadLike {
  company?: string | null
  contactName?: string | null
  contactTitle?: string | null
  rawInput?: string | null
  canonicalIntelligence?: unknown
  senderProfileId?: string | null
}

export function parsePacket(ci: unknown): V3LeadDecisionPacket | null {
  let obj = ci
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj) } catch { return null }
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  // Stored canonical intelligence wraps the packet; tests, the QA center and
  // the shadow runner may hand over a bare packet.
  const packet = rec.v3DecisionPacket ?? (rec.decision || rec.version === 'relay_decision_v3' ? obj : null)
  return (packet as V3LeadDecisionPacket | null) ?? null
}

/**
 * Lead-side routing context: capabilities the prospect asked for, their
 * stack, their industry and the terms a sender's proof can match. Reads the
 * packet's SourceFacts only — never the raw source.
 */
export function buildRoutingLeadContext(lead: RoutingLeadLike, packet: V3LeadDecisionPacket | null, platform: string | null = null): RoutingLeadContext {
  const facts = packet?.sourceFacts ?? null
  const capabilities = new Set<string>()
  for (const c of facts?.capabilityNeeds ?? []) capabilities.add(c)
  for (const ep of packet?.episodes ?? []) for (const c of ep.requestedCapabilities ?? []) capabilities.add(c)

  const industries = new Set<string>()
  const industry = packet?.orgContext?.currentIndustry ?? facts?.currentIndustry ?? null
  if (industry) industries.add(industry)

  const rawTerms = new Set<string>()
  if (lead.company) rawTerms.add(lead.company)
  if (lead.contactTitle) rawTerms.add(lead.contactTitle)
  for (const c of capabilities) rawTerms.add(c)
  for (const i of industries) rawTerms.add(i)
  for (const t of facts?.proofCandidates ?? []) rawTerms.add(t)

  return {
    capabilities: [...capabilities],
    industries: [...industries],
    buyerRequestProbability: packet?.decision?.buyerRequestProbability ?? 0,
    fitLevel: packet?.resolved?.fit ?? packet?.decision?.fit ?? 'UNKNOWN',
    rawTerms: [...rawTerms],
    platform,
  }
}

/**
 * Source facts from a stored canonical blob, when it carries a V3 packet.
 * Downstream layers (messaging, revenue strategy) read these instead of raw text.
 */
export function factsFromCanonical(ci: unknown): SourceFactsSummary | null {
  const packet = parsePacket(ci)
  return packet?.sourceFacts ?? null
}

/** Every active sender profile in the org, with proof, industries and bounded historical outcomes. */
export async function loadSenderProfiles(client: SupabaseClient, orgId: string, repId: string): Promise<SenderProfile[]> {
  const [candidates, historicalMap] = await Promise.all([
    loadSenderCandidates(client, orgId, repId),
    computeHistoricalOutcomes(client, orgId).catch(() => new Map()),
  ])
  const { data: industryRows } = await client
    .from('profiles')
    .select('id, industries')
    .eq('organization_id', orgId)
    .is('archived_at', null)
  const industriesById = new Map<string, string[]>()
  for (const row of (industryRows ?? []) as Array<{ id: string; industries?: string[] | null }>) {
    industriesById.set(row.id, (row.industries ?? []).filter((x): x is string => typeof x === 'string'))
  }
  return candidates.map((c) => ({
    ...c,
    industries: industriesById.get(c.id) ?? [],
    historicalOutcomes: toRoutingFormat(historicalMap.get(c.id)),
  }))
}

/** Rank the org's senders for a stored lead. The one call every surface makes. */
export function routeLead(lead: RoutingLeadLike, packet: V3LeadDecisionPacket | null, senders: SenderProfile[], platform: string | null = null): RoutingResult {
  return rankSendersForLead(buildRoutingLeadContext(lead, packet, platform), senders, lead.senderProfileId ?? null)
}
