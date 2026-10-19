/**
 * Admin Routing Opportunities API
 *
 * Returns leads where the current sender is not the best sender,
 * computed using the SAME engine as the rep lead detail view.
 *
 * GET /api/admin/routing-opportunities
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { loadSenderCandidates } from '@/lib/relay/sender-suggestion'
import { rankSendersForLead, type SenderProfile } from '@/lib/relay/sender-routing-engine'
import { computeHistoricalOutcomes, toRoutingFormat } from '@/lib/relay/historical-outcomes'
import { getAuthContext } from '@/lib/auth/organization'

export const dynamic = 'force-dynamic'

export async function GET() {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  // Load all active leads with scores
  const { data: leads, error: leadsError } = await client
    .from('leads')
    .select('id, company, contact_name, canonical_score, canonical_intelligence, sender_profile_id, owner_rep_id, status')
    .eq('organization_id', authCtx.orgId)
    .not('canonical_score', 'is', null)
    .gte('canonical_score', 50)
    .in('status', ['new', 'contacted', 'followed_up', 'replied'])
    .order('canonical_score', { ascending: false })
    .limit(50)

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })
  if (!leads || leads.length === 0) return NextResponse.json({ opportunities: [] })

  // Load all sender profiles once
  const senderCandidates = await loadSenderCandidates(client, authCtx.orgId, '')

  // Historical outcomes
  const historicalMap = await computeHistoricalOutcomes(client, authCtx.orgId)

  const senderProfiles: SenderProfile[] = senderCandidates.map((c) => ({
    ...c,
    industries: [],
    historicalOutcomes: toRoutingFormat(historicalMap.get(c.id)),
  }))

  // Compute routing for each lead
  const opportunities = []
  for (const lead of leads) {
    const ci = parseCI(lead.canonical_intelligence)
    const v3Packet = (ci?.v3DecisionPacket ?? (ci as Record<string, unknown>)?.v3DecisionPacket) as Record<string, unknown> | null

    const capabilities = extractCaps(v3Packet)
    const routing = rankSendersForLead(
      {
        capabilities,
        industries: [],
        buyerRequestProbability: 0.5,
        fitLevel: 'MEDIUM',
        rawTerms: [lead.company, lead.contact_name].filter(Boolean) as string[],
        platform: null,
      },
      senderProfiles,
      lead.sender_profile_id,
    )

    if (routing.mismatchDelta !== null && routing.mismatchDelta >= 15) {
      const best = routing.rankings[0]
      const current = routing.rankings.find((r) => r.senderId === lead.sender_profile_id)
      opportunities.push({
        leadId: lead.id,
        company: lead.company,
        contactName: lead.contact_name,
        score: lead.canonical_score,
        currentOwnerRepId: lead.owner_rep_id,
        currentSenderId: lead.sender_profile_id,
        currentSenderName: current?.name ?? null,
        currentSenderMatch: current?.profileMatch ?? 0,
        bestSenderId: best?.senderId ?? null,
        bestSenderName: best?.name ?? null,
        bestSenderMatch: best?.profileMatch ?? 0,
        mismatchDelta: routing.mismatchDelta,
        reasons: best?.reasons ?? [],
        routingVersion: routing.routingVersion,
      })
    }
  }

  opportunities.sort((a, b) => b.mismatchDelta - a.mismatchDelta)

  return NextResponse.json({ opportunities })
}

function parseCI(ci: unknown): Record<string, unknown> | null {
  if (!ci) return null
  if (typeof ci === 'object') return ci as Record<string, unknown>
  if (typeof ci === 'string') {
    try { return JSON.parse(ci) as Record<string, unknown> } catch { return null }
  }
  return null
}

function extractCaps(v3Packet: Record<string, unknown> | null): string[] {
  if (!v3Packet) return []
  const episodes = (v3Packet.episodes as Array<Record<string, unknown>>) ?? []
  const caps = new Set<string>()
  for (const ep of episodes) {
    const reqCaps = ep.requestedCapabilities as string[] ?? []
    reqCaps.forEach((c: string) => caps.add(c))
  }
  return [...caps]
}
