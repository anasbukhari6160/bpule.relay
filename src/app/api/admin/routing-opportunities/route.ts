/**
 * Admin Routing Opportunities API
 *
 * Returns leads where the current sender is not the best sender, computed
 * with the SAME inputs and the SAME engine as the rep's lead detail view
 * (routing-context.ts → rankSendersForLead). The mismatch threshold is the
 * action policy's, so admin and rep agree on what "mismatch" means.
 *
 * GET /api/admin/routing-opportunities
 */

import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { getAuthContext } from '@/lib/auth/organization'
import { loadSenderProfiles, parsePacket, routeLead } from '@/lib/relay/routing-context'
import { ROUTING_MISMATCH_DELTA } from '@/lib/intelligence-v3/action/recommended-action'
import { QUALIFICATION_BANDS } from '@/lib/scoring/qualification'

export const dynamic = 'force-dynamic'

export async function GET() {
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const store = await createScoutStore()
  const client = store.getSupabaseClient()

  // Leads worth routing: MAYBE and above (the canonical band, not a local number).
  const minScore = QUALIFICATION_BANDS.find((b) => b.qualification === 'MAYBE')!.min
  const { data: leads, error: leadsError } = await client
    .from('leads')
    .select('id, company, contact_name, contact_title, raw_input, canonical_score, canonical_intelligence, sender_profile_id, owner_rep_id, status')
    .eq('organization_id', authCtx.orgId)
    .not('canonical_score', 'is', null)
    .gte('canonical_score', minScore)
    .in('status', ['new', 'contacted', 'followed_up', 'replied'])
    .order('canonical_score', { ascending: false })
    .limit(50)

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })
  if (!leads || leads.length === 0) return NextResponse.json({ opportunities: [], routingVersion: null })

  const senderProfiles = await loadSenderProfiles(client, authCtx.orgId, authCtx.repId)

  const opportunities = []
  let routingVersion: string | null = null
  for (const lead of leads) {
    const packet = parsePacket(lead.canonical_intelligence)
    const routing = routeLead(
      { company: lead.company, contactName: lead.contact_name, contactTitle: lead.contact_title, rawInput: lead.raw_input, senderProfileId: lead.sender_profile_id },
      packet,
      senderProfiles,
    )
    routingVersion = routing.routingVersion

    if (routing.mismatchDelta !== null && routing.mismatchDelta >= ROUTING_MISMATCH_DELTA) {
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
        bestSenderAccessible: best?.accessibleToRep ?? false,
        holders: best?.holders ?? [],
        mismatchDelta: routing.mismatchDelta,
        reasons: best?.reasons ?? [],
        routingVersion: routing.routingVersion,
      })
    }
  }

  opportunities.sort((a, b) => b.mismatchDelta - a.mismatchDelta)

  return NextResponse.json({ opportunities, routingVersion, mismatchThreshold: ROUTING_MISMATCH_DELTA })
}
