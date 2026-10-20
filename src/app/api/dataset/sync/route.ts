/**
 * POST /api/dataset/sync
 *
 * Manual sync: creates intelligence samples for all leads/jobs that don't
 * have one yet. Triggered by the "Sync All" button on the admin dataset page.
 *
 * Body: { action: 'sync_all' }
 * Returns: { synced: number, errors: number }
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) {
    return NextResponse.json({ error: 'Admin or owner access required.' }, { status: 403 })
  }

  const client = createServiceSupabase()
  let synced = 0
  let errors = 0

  // ── Find leads without samples ─────────────────────────────────────
  const { data: leads } = await client
    .from('leads')
    .select('id, organization_id, company, contact_name, canonical_score, sender_profile_id, status, raw_input, canonical_intelligence')
    .not('canonical_intelligence', 'is', null)
    .limit(500)

  if (leads) {
    for (const lead of leads) {
      try {
        // Check if sample already exists
        const { data: existing } = await client
          .from('intelligence_samples')
          .select('id')
          .eq('lead_id', lead.id)
          .maybeSingle()

        if (existing) continue

        // Create sample
        const ci = (lead.canonical_intelligence ?? {}) as Record<string, unknown>
        const v3Packet = (ci.v3DecisionPacket ?? {}) as Record<string, unknown>
        const orgContext = (v3Packet.orgContext ?? {}) as Record<string, unknown>
        const buyerIntent = (v3Packet.buyerIntent ?? {}) as Record<string, unknown>
        const sourceFacts = (v3Packet.sourceFacts ?? {}) as Record<string, unknown>

        const { data: inserted } = await client
          .from('intelligence_samples')
          .insert({
            organization_id: lead.organization_id,
            lead_id: lead.id,
            platform: 'linkedin',
            version: 1,
            raw_input: lead.raw_input ?? null,
            raw_input_hash: lead.raw_input ? `${lead.raw_input.length}:${lead.raw_input.slice(0, 100)}` : null,
            extracted_identity: {
              name: lead.contact_name ?? null,
              title: (sourceFacts as any)?.person?.title ?? null,
              company: lead.company ?? null,
              industry: orgContext?.currentIndustry ?? null,
            },
            canonical_score: lead.canonical_score ?? null,
            display_score: lead.canonical_score != null ? Math.round(lead.canonical_score / 10) : null,
            qualification: lead.canonical_score != null ? qualify(lead.canonical_score) : null,
            score_dimensions: ((ci.scoreBreakdown as any)?.dimensions as any[]) ?? [],
            source_facts: sourceFacts ?? null,
            evidence_ledger: (ci.evidenceLedger as any[]) ?? [],
            model_raw_output: v3Packet ?? null,
            resolved_decision: (v3Packet.decision as any) ?? null,
            confidence: (v3Packet.confidence as number) ?? null,
            best_sender_id: lead.sender_profile_id ?? null,
            current_sender_id: lead.sender_profile_id ?? null,
            funnel_stage: 'SCORE',
            label_status: 'AI_ONLY',
            label_source: 'ai',
          })
          .select('id')
          .single()

        if (inserted) {
          synced++

          // Add SCORE_CAPTURED event
          await client.from('intelligence_sample_events').insert({
            sample_id: inserted.id,
            event_type: 'SCORE_CAPTURED',
            payload: { canonical_score: lead.canonical_score, qualification: lead.canonical_score != null ? qualify(lead.canonical_score) : null },
            idempotency_key: `score:${lead.id}`,
          })

          // Add OUTCOME event if terminal
          if (['won', 'lost', 'no', 'dead'].includes(lead.status)) {
            const outcomeMap: Record<string, string> = { won: 'won', lost: 'lost', no: 'no_reply', dead: 'lost' }
            await client.from('intelligence_sample_events').insert({
              sample_id: inserted.id,
              event_type: 'OUTCOME_CHANGED',
              payload: { status: lead.status, outcome: outcomeMap[lead.status] },
              idempotency_key: `outcome:${lead.id}:${lead.status}`,
            })
            await client.from('intelligence_samples').update({
              funnel_stage: 'OUTCOME',
              final_outcome: outcomeMap[lead.status],
            }).eq('id', inserted.id)
          }
        }
      } catch {
        errors++
      }
    }
  }

  // ── Find upwork jobs without samples ───────────────────────────────
  const { data: jobs } = await client
    .from('upwork_jobs')
    .select('id, organization_id, title, canonical_score, status, raw_input')
    .limit(500)

  if (jobs) {
    for (const job of jobs) {
      try {
        const { data: existing } = await client
          .from('intelligence_samples')
          .select('id')
          .eq('upwork_job_id', job.id)
          .maybeSingle()

        if (existing) continue

        await client
          .from('intelligence_samples')
          .insert({
            organization_id: job.organization_id,
            upwork_job_id: job.id,
            platform: 'upwork',
            version: 1,
            raw_input: job.raw_input ?? null,
            extracted_identity: { company: job.title ?? null },
            canonical_score: job.canonical_score ?? null,
            display_score: job.canonical_score != null ? Math.round(job.canonical_score / 10) : null,
            qualification: job.canonical_score != null ? qualify(job.canonical_score) : null,
            funnel_stage: job.canonical_score != null ? 'SCORE' : 'RAW_INPUT',
            label_status: job.canonical_score != null ? 'AI_ONLY' : 'UNLABELED',
            label_source: job.canonical_score != null ? 'ai' : null,
            final_outcome: job.status === 'awarded' ? 'won' : job.status === 'rejected' ? 'lost' : null,
          })
        synced++
      } catch {
        errors++
      }
    }
  }

  return NextResponse.json({ synced, errors })
}

function qualify(score: number): string {
  if (score >= 75) return 'STRONG'
  if (score >= 55) return 'WORTH_PURSUING'
  if (score >= 35) return 'MAYBE'
  if (score >= 15) return 'LOW'
  return 'SKIP'
}
