/**
 * Signal Watch API — re-check high-value leads for meaningful changes.
 *
 * POST /api/leads/signal-watch
 * Query params: ?orgId=...&limit=20
 *
 * Controlled: only checks leads with score >= 60, max 20 per call.
 * Emits signal events to action_events table for admin visibility.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { diffSignalSnapshots, buildSignalSnapshot, qualifiesForWatching } from '@/lib/relay/signal-watch'
import { emitAction } from '@/lib/action-ledger'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const store = createServiceSupabase()
  const { data: auth } = await store.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: rep } = await store
    .from('reps')
    .select('id, organization_id, role')
    .eq('user_id', auth.user.id)
    .single()

  if (!rep) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)

  // Find high-value leads that qualify for watching
  const { data: leads } = await store
    .from('leads')
    .select('id, company, contact_name, contact_title, canonical_score, canonical_intelligence, direction')
    .eq('organization_id', rep.organization_id)
    .eq('archived', false)
    .neq('status', 'won')
    .neq('status', 'lost')
    .neq('status', 'dead')
    .gte('canonical_score', 60)
    .order('canonical_score', { ascending: false })
    .limit(limit)

  if (!leads || leads.length === 0) {
    return NextResponse.json({ checked: 0, events: [] })
  }

  const allEvents: Array<{ leadId: string; type: string; title: string; severity: string }> = []
  let refreshed = 0

  for (const lead of leads) {
    try {
      // Build raw text from lead data
      const existingIntel = lead.canonical_intelligence as Record<string, unknown> | null
      const rawText = [
        lead.company,
        lead.contact_name,
        lead.contact_title,
        existingIntel?.verbatimQuote ?? '',
        existingIntel?.signalEvidence ?? '',
      ].filter(Boolean).join('. ')

      if (rawText.length < 10) continue

      // Re-run V3 pipeline
      const result = await produceV3Intelligence(rawText)
      refreshed++

      const currentSnapshot = buildSignalSnapshot(result?.v3Packet ?? null)
      // Store snapshot inside canonical_intelligence JSON (no schema change needed)
      const previousSnapshot = (existingIntel?._watchSnapshot as ReturnType<typeof buildSignalSnapshot>) ?? null

      // Only proceed if score qualifies
      if (!qualifiesForWatching(currentSnapshot.score)) continue

      // Diff and emit events
      const signalEvents = diffSignalSnapshots(lead.id, lead.company, lead.contact_name ?? null, previousSnapshot, currentSnapshot)

      // Store snapshot for next comparison (inside canonical_intelligence)
      const updatedIntel = { ...existingIntel, _watchSnapshot: currentSnapshot }
      await store
        .from('leads')
        .update({ canonical_intelligence: updatedIntel })
        .eq('id', lead.id)

      // Update score if improved
      if (currentSnapshot.score != null && lead.canonical_score != null && currentSnapshot.score > lead.canonical_score) {
        await store
          .from('leads')
          .update({
            canonical_score: currentSnapshot.score,
            canonical_intelligence: result?.intelligence ?? lead.canonical_intelligence,
          })
          .eq('id', lead.id)
      }

      // Emit notable signal events to action ledger
      for (const event of signalEvents) {
        if (event.severity === 'urgent' || event.severity === 'notable') {
          await emitAction({
            orgId: rep.organization_id,
            actionType: 'OPPORTUNITY_CREATED',
            actorType: 'system',
            leadId: lead.id,
            metadata: {
              signalType: event.type,
              signalTitle: event.title,
              previousScore: event.previousValue,
              currentScore: event.newValue,
            },
            idempotencyKey: `signal-${event.type}-${lead.id}-${event.createdAt.slice(0, 10)}`,
          })
        }
      }

      allEvents.push(...signalEvents.map(e => ({
        leadId: e.leadId,
        type: e.type,
        title: e.title,
        severity: e.severity,
      })))
    } catch (err) {
      console.error(`[signal-watch] failed for lead ${lead.id}:`, err instanceof Error ? err.message : 'unknown')
    }
  }

  return NextResponse.json({
    checked: leads.length,
    refreshed,
    events: allEvents.filter(e => e.severity === 'urgent' || e.severity === 'notable'),
  })
}
