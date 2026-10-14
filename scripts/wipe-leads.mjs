#!/usr/bin/env node
/**
 * Remove all leads, analyze data, and related records.
 * Keeps: auth users, orgs, profiles (sender profiles), reps, voice_profiles, facts, plays.
 * Removes: leads, messages, outcomes, content_*, upwork_*, eval_*, proof_items, etc.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !serviceRole || !anonKey) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function clearTable(table) {
  const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) {
    if (error.message?.includes('Could not find the table') || error.message?.includes('does not exist')) {
      console.log(`  Skipped ${table} (does not exist)`)
      return
    }
    console.error(`  Failed ${table}:`, error.message)
    throw error
  }
  console.log(`  Cleared ${table}`)
}

async function main() {
  console.log('Wiping leads and analyze data. Keeping profiles, users, org...\n')

  // Child tables first, then parents.
  const tables = [
    // Analyze / content intelligence data
    'content_interview_answers',
    'content_interview_sessions',
    'content_evaluations',
    'content_idea_genomes',
    'content_opportunities',
    'content_memories',
    'content_draft_feedback',
    'content_drafts',
    'content_history',
    'content_research_findings',
    'content_engagement_events',
    'content_post_structures',
    'content_pillars',
    'trending_angles',
    'topic_clusters',
    'content_personas',
    'content_profiles',
    // Eval / benchmark data
    'eval_runs',
    'golden_set',
    'few_shot_wins',
    // Lead-related data
    'outcomes',
    'messages',
    'upwork_messages',
    'upwork_jobs',
    'proof_items',
    'action_events',
    'relay_events',
    'conversation_states',
    'email_messages',
    'email_delivery_events',
    'email_send_attempts',
    'email_suppressions',
    'contact_points',
    // Leads themselves
    'leads',
    // Misc
    'notification_log',
    'csv_imports',
    'push_subscriptions',
    'rate_limits',
    'daily_summaries',
  ]

  for (const t of tables) {
    await clearTable(t)
  }

  console.log('\nDone. Leads and analyze data removed. Profiles, users, org remain.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
