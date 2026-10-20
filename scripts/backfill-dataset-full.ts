#!/usr/bin/env node
/**
 * Full dataset backfill — reconstructs the complete funnel for every lead.

 * Reads: leads → canonical_intelligence (scores, routing, buyer intent)
 *        messages (connection, DM, replies, sent)
 *        scoring_feedback
 *        upwork_jobs
 *
 * For each lead, builds:
 *   1. Snapshot (identity, score, routing, outcome)
 *   2. SCORE_CAPTURED event
 *   3. ROUTING_CAPTURED event
 *   4. MESSAGE_GENERATED events (from canonical_intelligence connection/DM drafts)
 *   5. MESSAGE_SENT events (from messages table)
 *   6. CLIENT_REPLY events (from messages table)
 *   7. OUTCOME_CHANGED event
 *   8. FEEDBACK_SUBMITTED events
 *
 * Idempotent. Run: npx tsx scripts/backfill-dataset-full.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Load .env.local manually
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([\w.-]+)=(.*)/)
    if (match) process.env[match[1]] = match[2].trim()
  }
  // eslint-disable-next-line no-empty
} catch {}

import { createServiceSupabase } from '@/lib/supabase/service'

const BATCH = 50

async function main() {
  const client = createServiceSupabase()
  let totalSamples = 0
  let totalEvents = 0

  // ── Count existing to report ──────────────────────────────────────
  const { count: existingCount } = await client
    .from('intelligence_samples')
    .select('id', { count: 'exact', head: true })
  console.log(`Existing samples: ${existingCount ?? 0}`)

  // ── Backfill LinkedIn leads ───────────────────────────────────────
  let offset = 0
  let leads: any[] = []

  do {
    const { data } = await client
      .from('leads')
      .select(`
        id, organization_id, company, contact_name, contact_title, status,
        canonical_score, score_version, scored_at, decision_run_id,
        sender_profile_id, raw_input, canonical_intelligence, source,
        connection_accepted_at
      `)
      .not('canonical_intelligence', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH - 1)

    leads = data ?? []
    if (leads.length === 0) break

    for (const lead of leads) {
      const ci = (lead.canonical_intelligence ?? {}) as Record<string, unknown>
      const v3Packet = (ci.v3DecisionPacket ?? {}) as Record<string, unknown>
      const sourceFacts = (v3Packet.sourceFacts ?? {}) as Record<string, unknown>
      const orgContext = (v3Packet.orgContext ?? {}) as Record<string, unknown>
      const buyerIntent = (v3Packet.buyerIntent ?? {}) as Record<string, unknown>
      const recommendedAction = (v3Packet.recommendedAction ?? {}) as Record<string, unknown>

      // ── Check for existing sample ───────────────────────────────
      const { data: existing } = await client
        .from('intelligence_samples')
        .select('id')
        .eq('lead_id', lead.id)
        .maybeSingle()

      let sampleId = existing?.id

      // ── Build snapshot fields ──────────────────────────────────
      const snapshot: Record<string, unknown> = {
        organization_id: lead.organization_id,
        lead_id: lead.id,
        platform: lead.source === 'upwork' ? 'upwork' : 'linkedin',
        source_type: lead.source ?? null,
        version: 1,
        raw_input: lead.raw_input ?? null,
        raw_input_hash: lead.raw_input ? `${lead.raw_input.length}:${lead.raw_input.slice(0, 100)}` : null,
        extracted_identity: {
          name: lead.contact_name ?? sourceFacts?.person?.name ?? null,
          title: lead.contact_title ?? sourceFacts?.person?.title ?? null,
          company: lead.company ?? sourceFacts?.currentCompany ?? null,
          industry: orgContext?.currentIndustry ?? null,
        },
        canonical_score: lead.canonical_score ?? null,
        display_score: lead.canonical_score != null ? Math.round(lead.canonical_score / 10) : null,
        qualification: lead.canonical_score != null ? qualify(lead.canonical_score) : null,
        score_dimensions: (ci.scoreBreakdown as any)?.dimensions ?? [],
        decision_run_id: lead.decision_run_id ?? null,
        best_sender_id: lead.sender_profile_id ?? null,
        current_sender_id: lead.sender_profile_id ?? null,
        source_facts: sourceFacts ?? null,
        rejected_signals: sourceFacts?.rejectedSignals ?? [],
        evidence_ledger: ci.evidenceLedger ?? [],
        model_raw_output: v3Packet ?? null,
        resolved_decision: v3Packet.decision ?? null,
        confidence: v3Packet.confidence ?? null,
        recommended_action: recommendedAction?.action ?? v3Packet.action ?? null,
        funnel_stage: 'SCORE', // will advance below
        label_status: lead.canonical_score != null ? 'AI_ONLY' : 'UNLABELED',
        label_source: lead.canonical_score != null ? 'ai' : null,
      }

      // Upsert sample
      if (sampleId) {
        await client.from('intelligence_samples').update(snapshot).eq('id', sampleId)
      } else {
        const { data: inserted } = await client.from('intelligence_samples').insert(snapshot).select('id').single()
        sampleId = inserted!.id
      }
      totalSamples++

      // Clear old events for this sample (rebuild)
      await client.from('intelligence_sample_events').delete().eq('sample_id', sampleId)

      const events: Array<{ sample_id: string; event_type: string; payload: Record<string, unknown>; idempotency_key: string }> = []

      // ── SCORE_CAPTURED ─────────────────────────────────────────
      if (lead.canonical_score != null) {
        events.push({
          sample_id: sampleId,
          event_type: 'SCORE_CAPTURED',
          payload: {
            canonical_score: lead.canonical_score,
            qualification: qualify(lead.canonical_score),
            dimensions: (ci.scoreBreakdown as any)?.dimensions ?? [],
            buyer_intent: buyerIntent.buyerIntentLevel ?? null,
            buyer_request: sourceFacts?.buyerRequest ?? null,
            commercial_potential: recommendedAction?.commercialPotential ?? null,
          },
          idempotency_key: `score:${lead.id}`,
        })
        await client.from('intelligence_samples').update({ funnel_stage: 'SCORE' }).eq('id', sampleId)
      }

      // ── ROUTING_CAPTURED ───────────────────────────────────────
      if (lead.sender_profile_id) {
        events.push({
          sample_id: sampleId,
          event_type: 'ROUTING_CAPTURED',
          payload: {
            best_sender_id: lead.sender_profile_id,
            rankings_count: 1,
          },
          idempotency_key: `routing:${lead.id}`,
        })
        await client.from('intelligence_samples').update({ funnel_stage: 'ROUTING' }).eq('id', sampleId)
      }

      // ── Messages ───────────────────────────────────────────────
      const { data: messages } = await client
        .from('messages')
        .select('id, type, direction, sent_text, sent_at')
        .eq('lead_id', lead.id)
        .order('sent_at', { ascending: true })
        .limit(100)

      if (messages) {
        for (const msg of messages) {
          if (msg.direction === 'outbound' && msg.sent_text) {
            events.push({
              sample_id: sampleId,
              event_type: 'MESSAGE_SENT',
              payload: { message_type: msg.type, direction: msg.direction, text_length: msg.sent_text.length, sent_at: msg.sent_at },
              idempotency_key: `msg:${msg.id}`,
            })
          } else if (msg.direction === 'inbound' && msg.sent_text) {
            events.push({
              sample_id: sampleId,
              event_type: 'CLIENT_REPLY',
              payload: { message_type: msg.type, direction: msg.direction, text_length: msg.sent_text.length, sent_at: msg.sent_at },
              idempotency_key: `reply:${msg.id}`,
            })
          }
        }
        if (messages.length > 0) {
          await client.from('intelligence_samples').update({ funnel_stage: 'SENT' }).eq('id', sampleId)
        }
      }

      // ── OUTCOME ────────────────────────────────────────────────
      if (['won', 'lost', 'no', 'dead'].includes(lead.status)) {
        const outcomeMap: Record<string, string> = { won: 'won', lost: 'lost', no: 'no_reply', dead: 'lost' }
        events.push({
          sample_id: sampleId,
          event_type: 'OUTCOME_CHANGED',
          payload: { status: lead.status, outcome: outcomeMap[lead.status] },
          idempotency_key: `outcome:${lead.id}:${lead.status}`,
        })
        await client.from('intelligence_samples').update({ funnel_stage: 'OUTCOME', final_outcome: outcomeMap[lead.status] }).eq('id', sampleId)
      }

      // ── Feedback ───────────────────────────────────────────────
      const { data: feedback } = await client
        .from('scoring_feedback')
        .select('id, feedback_type, note, created_at')
        .eq('lead_id', lead.id)
        .limit(20)

      if (feedback) {
        for (const fb of feedback) {
          events.push({
            sample_id: sampleId,
            event_type: 'FEEDBACK_SUBMITTED',
            payload: { feedback_type: fb.feedback_type, note: fb.note },
            idempotency_key: `fb:${fb.id}`,
          })
        }
        if (feedback.length > 0) {
          const hasCorrection = feedback.some((f: any) => !f.feedback_type?.includes('CORRECT'))
          await client.from('intelligence_samples').update({
            funnel_stage: 'HUMAN_FEEDBACK',
            label_status: hasCorrection ? 'HUMAN_CORRECTED' : 'HUMAN_REVIEWED',
            label_source: 'human',
            training_eligible: true,
          }).eq('id', sampleId)
        }
      }

      // Insert all events
      if (events.length > 0) {
        await client.from('intelligence_sample_events').insert(events)
        totalEvents += events.length
      }
    }

    offset += BATCH
    console.log(`Processed ${offset} leads...`)
  } while (leads.length === BATCH)

  // ── Backfill Upwork jobs ─────────────────────────────────────────
  let jobOffset = 0
  let jobs: any[] = []

  do {
    const { data } = await client
      .from('upwork_jobs')
      .select('id, organization_id, title, canonical_score, score_version, status, raw_input, job_facts, score_breakdown')
      .order('created_at', { ascending: false })
      .range(jobOffset, jobOffset + BATCH - 1)

    jobs = data ?? []
    if (jobs.length === 0) break

    for (const job of jobs) {
      const { data: existing } = await client
        .from('intelligence_samples')
        .select('id')
        .eq('upwork_job_id', job.id)
        .maybeSingle()

      let sampleId = existing?.id

      const snapshot: Record<string, unknown> = {
        organization_id: job.organization_id,
        upwork_job_id: job.id,
        platform: 'upwork',
        version: 1,
        raw_input: job.raw_input ?? null,
        raw_input_hash: job.raw_input ? `${job.raw_input.length}:${job.raw_input.slice(0, 100)}` : null,
        extracted_identity: { company: job.title ?? null },
        canonical_score: job.canonical_score ?? null,
        display_score: job.canonical_score != null ? Math.round(job.canonical_score / 10) : null,
        qualification: job.canonical_score != null ? qualify(job.canonical_score) : null,
        score_dimensions: job.score_breakdown ?? [],
        source_facts: job.job_facts ?? null,
        funnel_stage: job.canonical_score != null ? 'SCORE' : 'RAW_INPUT',
        label_status: job.canonical_score != null ? 'AI_ONLY' : 'UNLABELED',
        label_source: job.canonical_score != null ? 'ai' : null,
        final_outcome: job.status === 'awarded' ? 'won' : job.status === 'rejected' ? 'lost' : null,
      }

      if (sampleId) {
        await client.from('intelligence_samples').update(snapshot).eq('id', sampleId)
      } else {
        const { data: inserted } = await client.from('intelligence_samples').insert(snapshot).select('id').single()
        sampleId = inserted!.id
      }
      totalSamples++

      if (job.canonical_score != null) {
        await client.from('intelligence_sample_events').insert({
          sample_id: sampleId,
          event_type: 'SCORE_CAPTURED',
          payload: { canonical_score: job.canonical_score },
          idempotency_key: `score:${job.id}`,
        })
        totalEvents++
      }
    }

    jobOffset += BATCH
  } while (jobs.length === BATCH)

  console.log(`\nDone. Total samples: ${sampleId}, total events: ${totalEvents}`)
}

function qualify(score: number): string {
  if (score >= 75) return 'STRONG'
  if (score >= 55) return 'WORTH_PURSUING'
  if (score >= 35) return 'MAYBE'
  if (score >= 15) return 'LOW'
  return 'SKIP'
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
