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
import { getAuthContext } from '@/lib/auth/organization'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { diffSignalSnapshots, buildSignalSnapshot, qualifiesForWatching } from '@/lib/relay/signal-watch'
import { emitAction } from '@/lib/action-ledger'
import { persistSignalEvent } from '@/lib/relay/signal-events-store'
import { normalizeProspectPaste } from '@/lib/prospect/paste-normalize'
import { QUALIFICATION_BANDS, qualifyCanonicalScore, verdictForQualification } from '@/lib/scoring/qualification'

export const maxDuration = 60
/** Leads worth watching: the canonical WORTH_PURSUING band and above. */
const WATCH_MIN_SCORE = QUALIFICATION_BANDS.find((b) => b.qualification === 'WORTH_PURSUING')!.min

export async function POST(req: NextRequest) {
  // Browser-triggered: resolve the signed-in rep from the request session, not
  // a service-role client (QA RQA-016).
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const store = createServiceSupabase()
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)

  // Find high-value leads that qualify for watching
  const { data: leads } = await store
    .from('leads')
    .select('id, company, contact_name, contact_title, raw_input, canonical_score, canonical_intelligence, direction')
    .eq('organization_id', auth.orgId)
    .eq('archived', false)
    .neq('status', 'won')
    .neq('status', 'lost')
    .neq('status', 'dead')
    .gte('canonical_score', WATCH_MIN_SCORE)
    .order('canonical_score', { ascending: false })
    .limit(limit)

  if (!leads || leads.length === 0) {
    return NextResponse.json({ checked: 0, events: [] })
  }

  const allEvents: Array<{ leadId: string; type: string; title: string; severity: string }> = []
  let refreshed = 0

  for (const lead of leads) {
    try {
      // Re-run on the ORIGINAL research only. A stub of name + title has no
      // evidence; re-scoring it would invent or erase signals.
      const existingIntel = lead.canonical_intelligence as Record<string, unknown> | null
      const storedRaw = typeof lead.raw_input === 'string' && lead.raw_input.trim()
        ? lead.raw_input
        : (((existingIntel?.rawSource as Record<string, unknown> | undefined)?.rawInput as string | undefined) ?? '')
      const rawText = normalizeProspectPaste(storedRaw)
      if (rawText.length < 80) continue

      // Re-run V3 pipeline
      const result = await produceV3Intelligence(rawText, { forceReanalyze: true })
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

      // A re-analysis of the same research under the current versions is the
      // truth in both directions; a score and its intelligence always move together.
      if (result?.intelligence && currentSnapshot.score != null && currentSnapshot.score !== lead.canonical_score) {
        await store
          .from('leads')
          .update({
            canonical_score: currentSnapshot.score,
            canonical_intelligence: { ...(result.intelligence as unknown as Record<string, unknown>), _watchSnapshot: currentSnapshot },
            score_breakdown: result.intelligence.scoreBreakdown ?? null,
            score_version: result.intelligence.scoreVersion ?? null,
            scored_at: new Date().toISOString(),
            verdict: verdictForQualification(qualifyCanonicalScore(currentSnapshot.score).qualification),
          })
          .eq('id', lead.id)
      }

      // Emit notable signal events to action ledger AND persist to signal_events
      for (const event of signalEvents) {
        if (event.severity === 'urgent' || event.severity === 'notable') {
          await emitAction({
            orgId: auth.orgId,
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

          // Persist to signal_events for queryable history
          await persistSignalEvent(store, {
            id: event.id,
            organizationId: auth.orgId,
            leadId: event.leadId,
            signalType: event.type,
            severity: event.severity,
            previousValue: event.previousValue,
            newValue: event.newValue,
            evidence: event.evidence,
            confidence: event.confidence,
            source: event.source,
            verified: event.verified,
            actor: event.actor,
            organization: event.organization,
            detectedAt: event.createdAt,
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
