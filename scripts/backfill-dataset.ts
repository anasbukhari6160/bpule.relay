#!/usr/bin/env node
/**
 * Backfill the intelligence_dataset from existing production data.
 *
 * Reads all leads, messages, scoring feedback, and upwork jobs already in
 * the database and creates intelligence_samples + intelligence_sample_events
 * for each. Idempotent — skips leads that already have a sample.
 *
 * Run: npx tsx scripts/backfill-dataset.ts
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
} catch { /* env not loaded */ }

import { createServiceSupabase } from '@/lib/supabase/service'
import { qualifyCanonicalScore, displayScoreForCanonical } from '@/lib/scoring/qualification'

/** SHA-256 of the whitespace-normalised source (same as src/lib/scoring-v4/opportunity-key.ts). */
function sha256Normalized(raw: string): string {
  const normalised = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return createHash('sha256').update(normalised).digest('hex')
}

async function main() {
  const client = createServiceSupabase()

  // ── Count existing samples (org by org) ─────────────────────────────────
  const { data: existing } = await client
    .from('intelligence_samples')
    .select('lead_id, upwork_job_id')
    .limit(10000)

  const seenLeads = new Set<string>()
  const seenJobs = new Set<string>()
  for (const s of existing ?? []) {
    if (s.lead_id) seenLeads.add(s.lead_id)
    if (s.upwork_job_id) seenJobs.add(s.upwork_job_id)
  }
  console.log(`Existing samples: ${existing?.length ?? 0}`)

  // ── Backfill LinkedIn leads ──────────────────────────────────────────────
  let sampleCount = 0
  let eventCount = 0
  let skipCount = 0

  const { data: leads } = await client
    .from('leads')
    .select('id, organization_id, company, contact_name, status, canonical_score, score_version, scored_at, decision_provider, decision_model, decision_run_id, sender_profile_id, raw_input, canonical_intelligence, extraction_completeness')
    .limit(10000)

  if (leads) {
    for (const lead of leads) {
      if (seenLeads.has(lead.id)) { skipCount++; continue }

      const ci = (lead.canonical_intelligence ?? {}) as Record<string, unknown>
      const intel = (ci.intelligence ?? {}) as Record<string, unknown>
      const person = (intel.person ?? {}) as Record<string, unknown>
      const company = (intel.company ?? {}) as Record<string, unknown>
      const scoreBreakdown = (ci.score_breakdown ?? {}) as Record<string, unknown>
      const v3Packet = (ci.v3DecisionPacket ?? {}) as Record<string, unknown>
      const orgContext = (v3Packet.orgContext ?? {}) as Record<string, unknown>

      // Create sample
      const { data: sample } = await client
        .from('intelligence_samples')
        .insert({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          platform: 'linkedin',
          version: 1,
          raw_input: lead.raw_input ?? null,
          raw_input_hash: lead.raw_input ? sha256Normalized(lead.raw_input) : null,
          extracted_identity: {
            name: person.fullName ?? lead.contact_name ?? null,
            title: person.title ?? null,
            company: company.name ?? lead.company ?? null,
            industry: orgContext.currentIndustry ?? company.industry ?? null,
          },
          canonical_score: lead.canonical_score ?? null,
          display_score: lead.canonical_score != null ? displayScoreForCanonical(lead.canonical_score) : null,
          qualification: lead.canonical_score != null ? qualifyCanonicalScore(lead.canonical_score).qualification : null,
          score_dimensions: ((scoreBreakdown.dimensions as unknown[]) ?? []),
          decision_run_id: lead.decision_run_id ?? null,
          best_sender_id: lead.sender_profile_id ?? null,
          current_sender_id: lead.sender_profile_id ?? null,
          final_outcome: mapOutcome(lead.status),
          label_status: lead.canonical_score != null ? 'AI_ONLY' : 'UNLABELED',
          label_source: lead.canonical_score != null ? 'ai' : null,
        })
        .select('id')
        .single()

      if (!sample) { console.error(`Failed to create sample for lead ${lead.id}`); continue }
      sampleCount++

      // SCORE_CAPTURED event
      if (lead.canonical_score != null) {
        await client.from('intelligence_sample_events').insert({
          sample_id: sample.id,
          event_type: 'SCORE_CAPTURED',
          payload: { canonical_score: lead.canonical_score, qualification: lead.canonical_score != null ? qualifyCanonicalScore(lead.canonical_score).qualification : null },
          idempotency_key: `score:${lead.id}`,
        })
        eventCount++
      }

      // OUTCOME event (if terminal status)
      if (['won', 'lost', 'no', 'dead'].includes(lead.status)) {
        await client.from('intelligence_sample_events').insert({
          sample_id: sample.id,
          event_type: 'OUTCOME_CHANGED',
          payload: { status: lead.status, outcome: mapOutcome(lead.status) },
          idempotency_key: `outcome:${lead.id}:${lead.status}`,
        })
        eventCount++
      }
    }
  }

  // ── Backfill messages (events) ──────────────────────────────────────────
  const { data: messages } = await client
    .from('messages')
    .select('id, lead_id, type, direction, sent_text, sent_at')
    .limit(10000)

  if (messages) {
    // Map lead_id -> sample_id
    const { data: leadSamples } = await client
      .from('intelligence_samples')
      .select('id, lead_id')
      .not('lead_id', 'is', null)
      .limit(10000)

    const leadToSample = new Map<string, string>()
    for (const s of leadSamples ?? []) leadToSample.set(s.lead_id!, s.id)

    for (const msg of messages) {
      const sampleId = leadToSample.get(msg.lead_id)
      if (!sampleId) continue

      const eventMap: Record<string, string> = {
        connection: 'MESSAGE_SENT',
        dm: 'MESSAGE_SENT',
        followup: 'MESSAGE_SENT',
        reply: msg.direction === 'inbound' ? 'CLIENT_REPLY' : 'MESSAGE_SENT',
      }
      const eventType = eventMap[msg.type] ?? 'MESSAGE_SENT'
      const isReply = eventType === 'CLIENT_REPLY'

      await client.from('intelligence_sample_events').insert({
        sample_id: sampleId,
        event_type: eventType,
        payload: {
          message_type: msg.type,
          direction: msg.direction,
          text_length: msg.sent_text?.length ?? 0,
          sent_at: msg.sent_at,
        },
        idempotency_key: `msg:${msg.id}`,
      })
      eventCount++
    }
  }

  // ── Backfill scoring feedback ──────────────────────────────────────────
  const { data: feedbacks } = await client
    .from('scoring_feedback')
    .select('id, lead_id, feedback_type, note, observed, expected, created_at')
    .limit(10000)

  if (feedbacks) {
    const { data: fbSamples } = await client
      .from('intelligence_samples')
      .select('id, lead_id')
      .not('lead_id', 'is', null)
      .limit(10000)

    const leadToSample2 = new Map<string, string>()
    for (const s of fbSamples ?? []) leadToSample2.set(s.lead_id!, s.id)

    for (const fb of feedbacks) {
      if (!fb.lead_id) continue
      const sampleId = leadToSample2.get(fb.lead_id)
      if (!sampleId) continue

      await client.from('intelligence_sample_events').insert({
        sample_id: sampleId,
        event_type: 'FEEDBACK_SUBMITTED',
        payload: { feedback_type: fb.feedback_type, note: fb.note },
        idempotency_key: `fb:${fb.id}`,
      })
      eventCount++

      // Update sample label status
      await client.from('intelligence_samples').update({
        label_status: fb.feedback_type.includes('CORRECT') ? 'HUMAN_REVIEWED' : 'HUMAN_CORRECTED',
        label_source: 'human',
        training_eligible: true,
      }).eq('id', sampleId)
    }
  }

  // ── Backfill Upwork jobs ────────────────────────────────────────────────
  const { data: jobs } = await client
    .from('upwork_jobs')
    .select('id, organization_id, title, canonical_score, score_version, status, raw_input')
    .limit(10000)

  if (jobs) {
    for (const job of jobs) {
      if (seenJobs.has(job.id)) { skipCount++; continue }

      const { data: sample } = await client
        .from('intelligence_samples')
        .insert({
          organization_id: job.organization_id,
          upwork_job_id: job.id,
          platform: 'upwork',
          version: 1,
          raw_input: job.raw_input ?? null,
          raw_input_hash: job.raw_input ? sha256Normalized(job.raw_input) : null,
          extracted_identity: { company: job.title ?? null },
          canonical_score: job.canonical_score ?? null,
          display_score: job.canonical_score != null ? Math.round(job.canonical_score / 10) : null,
          qualification: job.canonical_score != null ? qualifyCanonicalScore(job.canonical_score).qualification : null,
          final_outcome: job.status === 'awarded' ? 'won' : job.status === 'rejected' ? 'lost' : null,
          label_status: job.canonical_score != null ? 'AI_ONLY' : 'UNLABELED',
          label_source: job.canonical_score != null ? 'ai' : null,
        })
        .select('id')
        .single()

      if (!sample) continue
      sampleCount++

      if (job.canonical_score != null) {
        await client.from('intelligence_sample_events').insert({
          sample_id: sample.id,
          event_type: 'SCORE_CAPTURED',
          payload: { canonical_score: job.canonical_score },
          idempotency_key: `score:${job.id}`,
        })
        eventCount++
      }
    }
  }

  console.log(`\nDone. Created ${sampleCount} samples, ${eventCount} events. Skipped ${skipCount} already-backed-up.`)
}

function mapOutcome(status: string): string | null {
  const map: Record<string, string> = { won: 'won', lost: 'lost', no: 'no_reply', dead: 'lost', replied: 'reply', contacted: 'no_reply', followed_up: 'no_reply' }
  return map[status] ?? null
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
