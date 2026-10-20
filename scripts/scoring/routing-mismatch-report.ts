/**
 * Read-only split of WRONG_SENDER rows. Does not change scores or assignments.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/routing-mismatch-report.ts --days 365
 */

import { createServiceSupabase } from '../../src/lib/supabase/service'
import { recomputePacketFromStored } from '../../src/lib/intelligence-v3/bridge'
import { parsePacket, loadSenderProfiles, routeLead } from '../../src/lib/relay/routing-context'
import { ROUTING_MISMATCH_DELTA } from '../../src/lib/intelligence-v3/action/recommended-action'

const days = Number(process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : 365)

type Bucket = 'true_routing' | 'intentional_owner' | 'inaccessible_best' | 'platform_mismatch' | 'stale_assignment'

async function main() {
  const client = createServiceSupabase()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data: leads } = await client.from('leads').select('id, organization_id, owner_rep_id, sender_profile_id, revenue_identity_id, raw_input, canonical_intelligence, canonical_score').gte('created_at', since).order('created_at', { ascending: false }).limit(500)
  const { data: identities } = await client.from('revenue_identities').select('id, profile_id')
  const identityProfile = new Map<string, string | null>()
  for (const row of (identities ?? []) as Array<{ id: string; profile_id: string | null }>) identityProfile.set(row.id, row.profile_id)

  const counts: Record<Bucket, number> = { true_routing: 0, intentional_owner: 0, inaccessible_best: 0, platform_mismatch: 0, stale_assignment: 0 }
  let mismatched = 0
  let considered = 0
  const senderCache = new Map<string, Awaited<ReturnType<typeof loadSenderProfiles>>>()

  for (const r of (leads ?? []) as Array<Record<string, unknown>>) {
    const raw = typeof r.raw_input === 'string' ? r.raw_input : ''
    const packet = parsePacket(r.canonical_intelligence)
    if (!packet || raw.length < 40) continue
    considered++
    const orgId = r.organization_id as string
    const repId = (r.owner_rep_id as string) ?? ''
    const key = `${orgId}:${repId}`
    if (!senderCache.has(key)) {
      try { senderCache.set(key, await loadSenderProfiles(client, orgId, repId)) } catch { senderCache.set(key, []) }
    }
    const senders = senderCache.get(key) ?? []
    if (senders.length === 0) continue
    let fresh = packet
    try { fresh = await recomputePacketFromStored(raw, packet) } catch { /* stored packet still routes */ }
    const routing = routeLead({ rawInput: raw, company: null, contactName: null, canonicalIntelligence: r.canonical_intelligence, senderProfileId: (r.sender_profile_id as string) ?? null }, fresh, senders)
    if ((routing.mismatchDelta ?? 0) < ROUTING_MISMATCH_DELTA) continue
    mismatched++
    const current = routing.rankings.find((x) => x.senderId === r.sender_profile_id)
    const best = routing.rankings.find((x) => x.senderId === routing.bestSenderId) ?? routing.rankings[0]
    const workspaceProfile = r.revenue_identity_id ? identityProfile.get(r.revenue_identity_id as string) : null
    let bucket: Bucket
    if (!current) bucket = 'stale_assignment'
    else if (current.platform && best?.platform && current.platform !== best.platform) bucket = 'platform_mismatch'
    else if (best && !best.accessibleToRep) bucket = 'inaccessible_best'
    else if (workspaceProfile && workspaceProfile === r.sender_profile_id) bucket = 'intentional_owner'
    else bucket = 'true_routing'
    counts[bucket]++
  }

  const pct = (n: number) => (mismatched ? `${Math.round((n / mismatched) * 100)}%` : '0%')
  console.log(`\nROUTING MISMATCH — ${mismatched} of ${considered} leads, gap >= ${ROUTING_MISMATCH_DELTA}\n`)
  for (const [k, n] of Object.entries(counts)) console.log(`${k.padEnd(22)} ${String(n).padStart(4)}  ${pct(n)}`)
  console.log(`true routing issue %              ${pct(counts.true_routing)}`)
  console.log(`intentional/current-owner %       ${pct(counts.intentional_owner)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
