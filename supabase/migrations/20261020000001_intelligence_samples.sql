-- 0093: Intelligence Dataset / Training Funnel
--
-- Append-only, versioned dataset layer around existing leads/messages.
-- Every analysis run gets a permanent, exportable intelligence sample.
-- Never overwrites historic analyses — new analysis = new versioned sample.

-- ============================================================================
-- INTELLIGENCE SAMPLES
-- ============================================================================

create table if not exists intelligence_samples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  upwork_job_id uuid references upwork_jobs(id) on delete set null,

  platform text not null check (platform in ('linkedin', 'upwork')),
  source_type text,
  decision_run_id text,
  version integer not null default 1,

  -- Raw input (never lost)
  raw_input text,
  raw_input_hash text,

  -- Funnel stage: RAW_INPUT → EXTRACTION → VERIFIED_FACTS → SCORE → ROUTING
  -- → MESSAGE_GENERATION → HUMAN_EDIT → SENT → CLIENT_REPLY → OUTCOME
  funnel_stage text not null default 'RAW_INPUT'
    check (funnel_stage in (
      'RAW_INPUT', 'EXTRACTION', 'VERIFIED_FACTS', 'SCORE', 'ROUTING',
      'MESSAGE_GENERATION', 'HUMAN_EDIT', 'SENT', 'CLIENT_REPLY',
      'LIFECYCLE_CHANGE', 'OUTCOME', 'HUMAN_FEEDBACK'
    )),

  -- Extraction
  extracted_identity jsonb,
  source_facts jsonb,
  rejected_signals jsonb,
  evidence_ledger jsonb,

  -- Model + decision
  model_raw_output jsonb,
  resolved_decision jsonb,

  -- Scoring
  canonical_score integer check (canonical_score is null or (canonical_score >= 0 and canonical_score <= 100)),
  display_score integer check (display_score is null or (display_score >= 1 and display_score <= 10)),
  qualification text,
  score_dimensions jsonb,
  confidence numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  recommended_action text,

  -- Routing
  sender_rankings jsonb,
  best_sender_id uuid,
  current_sender_id uuid,

  -- Messages
  connection_note text,
  first_dm text,
  followup_drafts jsonb,
  reply_drafts jsonb,
  upwork_cover_letter text,
  screening_answers jsonb,

  -- Human edits (preference training data)
  human_edited_text jsonb,
  final_sent_text text,
  generated_text text,
  edit_distance integer,
  editor_id uuid,

  -- Client replies + outcome
  client_replies jsonb,
  final_outcome text,

  -- Feedback
  human_feedback jsonb,

  -- Versions in effect when this sample was created
  scoring_version text,
  source_facts_version text,
  buyer_intent_version text,
  attribution_version text,
  routing_version text,
  prompt_version text,
  model_version text,

  -- Data quality labels
  label_status text not null default 'AI_ONLY'
    check (label_status in ('UNLABELED', 'AI_ONLY', 'HUMAN_REVIEWED', 'HUMAN_CORRECTED', 'OUTCOME_VERIFIED')),
  training_eligible boolean not null default false,
  needs_review boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

create index if not exists int_samples_org_idx on intelligence_samples (organization_id, created_at desc);
create index if not exists int_samples_lead_idx on intelligence_samples (lead_id, version desc);
create index if not exists int_samples_upwork_idx on intelligence_samples (upwork_job_id, version desc);
create index if not exists int_samples_platform_idx on intelligence_samples (platform, created_at desc);
create index if not exists int_samples_qual_idx on intelligence_samples (organization_id, qualification);
create index if not exists int_samples_label_idx on intelligence_samples (organization_id, label_status);
create index if not exists int_samples_needs_review_idx on intelligence_samples (organization_id, needs_review) where needs_review = true;
create index if not exists int_samples_funnel_idx on intelligence_samples (organization_id, funnel_stage);
create index if not exists int_samples_outcome_idx on intelligence_samples (organization_id, final_outcome);
create index if not exists int_samples_training_idx on intelligence_samples (organization_id, training_eligible) where training_eligible = true;
create index if not exists int_samples_hash_idx on intelligence_samples (raw_input_hash);

-- ============================================================================
-- RLS — inherits organization-level access via organization_id
-- ============================================================================

alter table intelligence_samples enable row level security;

-- ============================================================================
-- LINK: leads reference their latest sample
-- ============================================================================

alter table leads add column if not exists latest_sample_id uuid;
alter table leads add column if not exists sample_count integer not null default 0;

create index if not exists leads_latest_sample_idx on leads (latest_sample_id);

-- ============================================================================
-- RPC: bump sample version for a lead
-- ============================================================================

create or replace function public.next_sample_version(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_max integer;
begin
  select coalesce(max(version), 0) into current_max
  from intelligence_samples
  where lead_id = p_lead_id;
  return current_max + 1;
end;
$$;
