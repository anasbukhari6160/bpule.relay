#!/usr/bin/env node
/**
 * Quick fix: update funnel stages and add missing events for existing samples.
 * Run: npx tsx scripts/fix-dataset-funnel.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([\w.-]+)=(.*)/)
    if (match) process.env[match[1]] = match[2].trim()
  }
} catch {}

import { createServiceSupabase } from '@/lib/supabase/service'

function qualify(score: number): string {
  if (score >= 75) return 'STRONG'
  if (score >= 55) return 'WORTH_PURSUING'
  if (score >= 35) return 'MAYBE'
  if (score >= 15) return 'LOW'
  return 'SKIP'
}

async function main() {
  const client = createServiceSupabase()
  let fixed = 0
  let eventsAdded = 0

  // Get all samples
  const { data: samples } = await client
    .from('intelligence_samples')
    .select('id, lead_id, upwork_job_id, platform, canonical_score, best_sender_id, final_outcome, funnel_stage')
    .limit(1000)

  if (!samples) { console.log('No samples found'); return }

  for (const s of samples) {
    // Determine correct funnel stage
    let stage = 'RAW_INPUT'
    if (s.canonical_score != null) stage = 'SCORE'
    if (s.best_sender_id) stage = 'ROUTING'
    if (s.final_outcome) stage = 'OUTCOME'

    // Update funnel stage if wrong
    if (s.funnel_stage !== stage) {
      await client.from('intelligence_samples').update({ funnel_stage: stage }).eq('id', s.id)
      fixed++
    }

    // Add missing SCORE_CAPTURED event
    if (s.canonical_score != null) {
      const { data: existing } = await client
        .from('intelligence_sample_events')
        .select('id')
        .eq('sample_id', s.id)
        .eq('event_type', 'SCORE_CAPTURED')
        .maybeSingle()

      if (!existing) {
        await client.from('intelligence_sample_events').insert({
          sample_id: s.id,
          event_type: 'SCORE_CAPTURED',
          payload: { canonical_score: s.canonical_score, qualification: qualify(s.canonical_score) },
          idempotency_key: `score:${s.id}`,
        })
        eventsAdded++
      }
    }

    // Add missing ROUTING_CAPTURED event
    if (s.best_sender_id) {
      const { data: existing } = await client
        .from('intelligence_sample_events')
        .select('id')
        .eq('sample_id', s.id)
        .eq('event_type', 'ROUTING_CAPTURED')
        .maybeSingle()

      if (!existing) {
        await client.from('intelligence_sample_events').insert({
          sample_id: s.id,
          event_type: 'ROUTING_CAPTURED',
          payload: { best_sender_id: s.best_sender_id, rankings_count: 1 },
          idempotency_key: `routing:${s.id}`,
        })
        eventsAdded++
      }
    }

    // Add missing OUTCOME event
    if (s.final_outcome) {
      const { data: existing } = await client
        .from('intelligence_sample_events')
        .select('id')
        .eq('sample_id', s.id)
        .eq('event_type', 'OUTCOME_CHANGED')
        .maybeSingle()

      if (!existing) {
        await client.from('intelligence_sample_events').insert({
          sample_id: s.id,
          event_type: 'OUTCOME_CHANGED',
          payload: { outcome: s.final_outcome },
          idempotency_key: `outcome:${s.id}:${s.final_outcome}`,
        })
        eventsAdded++
      }
    }

    // Add message events for LinkedIn leads
    if (s.lead_id && s.platform === 'linkedin') {
      const { data: messages } = await client
        .from('messages')
        .select('id, type, direction, sent_at')
        .eq('lead_id', s.lead_id)
        .limit(100)

      if (messages) {
        for (const msg of messages) {
          const eventType = msg.direction === 'outbound' ? 'MESSAGE_SENT' : 'CLIENT_REPLY'
          const idemKey = `${msg.direction === 'outbound' ? 'msg' : 'reply'}:${msg.id}`

          const { data: existing } = await client
            .from('intelligence_sample_events')
            .select('id')
            .eq('idempotency_key', idemKey)
            .maybeSingle()

          if (!existing) {
            await client.from('intelligence_sample_events').insert({
              sample_id: s.id,
              event_type: eventType,
              payload: { message_type: msg.type, direction: msg.direction, sent_at: msg.sent_at },
              idempotency_key: idemKey,
            })
            eventsAdded++
          }
        }
      }
    }
  }

  console.log(`Done. Fixed ${fixed} funnel stages, added ${eventsAdded} events.`)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
