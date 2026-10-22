-- =============================================================================
-- Relay scoring/labeling V2 — apply on Supabase (SQL Editor)
-- Re-runnable: safe to run even if some of these already applied.
-- Order matters: base tables first, then the Phase F/H additions.
-- =============================================================================

-- ── 20261022100000_scoring_labels_and_shadow.sql ──
-- 360° scoring program: human ground truth + shadow candidate decisions.
--
-- scoring_labels            Phase 4   one reviewer's reading of one unique
--                                     opportunity (ranges, not exact scores)
-- scoring_shadow_decisions  Phase 27  candidate-engine results stored beside
--                                     every production decision; never shown
--                                     to reps, never changes a score
--
-- Both tables are append-only from the app's point of view. Nothing in
-- either table is read by production scoring.

-- ── Human labels ────────────────────────────────────────────────────────────

create table if not exists scoring_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The unique underlying opportunity (sha256 of the normalised source), so a
  -- lead and the captured prospect it came from share one label set.
  opportunity_key text not null,
  lead_id uuid references leads(id) on delete set null,
  captured_prospect_id uuid references captured_prospects(id) on delete set null,
  upwork_job_id uuid references upwork_jobs(id) on delete set null,
  platform text not null check (platform in ('linkedin', 'upwork')),
  decision_run_id text,

  labeler_rep_id uuid not null references reps(id) on delete cascade,
  label_version text not null default 'label_v1',
  -- What Relay said when the label was written, for drift analysis.
  observed jsonb not null default '{}'::jsonb,

  relationship_role text check (relationship_role in ('BUYER', 'BUYER_AND_SELLER', 'SELLER', 'BUILDER', 'RECRUITER', 'CANDIDATE', 'UNKNOWN')),
  buyer_intent text check (buyer_intent in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'NONE')),
  commercial_potential text check (commercial_potential in ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')),
  fit text check (fit in ('NONE', 'WEAK', 'ADJACENT', 'GOOD', 'STRONG', 'EXCEPTIONAL')),
  authority text check (authority in ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
  timing text check (timing in ('NONE', 'WEAK', 'CURRENT', 'URGENT')),
  access text check (access in ('DIRECT', 'CONNECTION', 'INDIRECT', 'NONE')),
  -- Expected canonical range, inclusive, on the 0-100 scale.
  expected_score_min smallint check (expected_score_min between 0 and 100),
  expected_score_max smallint check (expected_score_max between 0 and 100),
  expected_action text,
  best_sender_profile_id uuid references profiles(id) on delete set null,
  labeler_confidence text check (labeler_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  reason text,
  evidence_lines jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  constraint scoring_labels_range_order check (expected_score_min is null or expected_score_max is null or expected_score_min <= expected_score_max)
);

create index if not exists scoring_labels_org_key_idx on scoring_labels (organization_id, opportunity_key);
create index if not exists scoring_labels_org_created_idx on scoring_labels (organization_id, created_at desc);
create index if not exists scoring_labels_lead_idx on scoring_labels (lead_id) where lead_id is not null;
create index if not exists scoring_labels_prospect_idx on scoring_labels (captured_prospect_id) where captured_prospect_id is not null;

alter table scoring_labels enable row level security;

drop policy if exists scoring_labels_select on scoring_labels;
create policy scoring_labels_select on scoring_labels for select
  to authenticated using (organization_id = current_org_id());

drop policy if exists scoring_labels_insert on scoring_labels;
create policy scoring_labels_insert on scoring_labels for insert
  to authenticated with check (organization_id = current_org_id() and is_org_admin());

comment on table scoring_labels is 'Human ground-truth labels for Relay opportunities (ranges, roles, best sender). Never read by production scoring; training and calibration input only.';

-- ── Shadow candidate decisions ──────────────────────────────────────────────

create table if not exists scoring_shadow_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  opportunity_key text not null,
  lead_id uuid references leads(id) on delete cascade,
  captured_prospect_id uuid references captured_prospects(id) on delete cascade,
  decision_run_id text,
  platform text not null default 'linkedin' check (platform in ('linkedin', 'upwork')),

  production_engine text not null,
  production_score smallint,
  production_qualification text,
  production_action text,
  production_sender_id uuid,

  candidate_engine text not null,
  candidate_version text not null,
  candidate_score smallint,
  candidate_qualification text,
  candidate_action text,
  candidate_sender_id uuid,
  candidate_confidence numeric(4,3),
  -- Full candidate output (account value, intent value, guards, reasons) and the features it scored.
  candidate_detail jsonb not null default '{}'::jsonb,
  features jsonb,
  features_version text,

  created_at timestamptz not null default now()
);

create index if not exists scoring_shadow_org_created_idx on scoring_shadow_decisions (organization_id, created_at desc);
create index if not exists scoring_shadow_run_idx on scoring_shadow_decisions (decision_run_id) where decision_run_id is not null;
create index if not exists scoring_shadow_key_idx on scoring_shadow_decisions (organization_id, opportunity_key);

alter table scoring_shadow_decisions enable row level security;

drop policy if exists scoring_shadow_select on scoring_shadow_decisions;
create policy scoring_shadow_select on scoring_shadow_decisions for select
  to authenticated using (organization_id = current_org_id() and is_org_admin());

comment on table scoring_shadow_decisions is 'Candidate scoring-engine results recorded beside production decisions (SCORING_SHADOW_ENGINES). Admin-only, never shown to reps, never changes a score.';

-- ── 20261022110000_dataset_governance.sql ──
-- Dataset governance hardening (end-to-end audit, 2026-10-22).
--
-- 1. intelligence_samples / intelligence_sample_events RLS compared reps.id
--    to auth.uid(). Everywhere else the app maps auth.uid() through
--    reps.auth_user_id, so every user-session read was denied and the
--    status / inbound hooks failed silently. Policies now use the same
--    current_org_id() helper as the rest of the schema.
-- 2. label_status gains TRAINING_APPROVED (explicit review, never automatic);
--    event_type gains LABEL_APPROVED.
-- 3. The idempotency index becomes unique so a retried capture can never
--    append the same event twice.
-- 4. raw_input_hash is documented as SHA-256 of the normalised source. Rows
--    written before this migration hold a legacy "length:prefix" value; the
--    team re-hashes them with scripts/scoring/rehash-samples.ts (it must read
--    the source text, so it is not done here).

-- ── RLS: same tenant boundary as every other table ─────────────────────────

drop policy if exists "int_samples_org_read" on intelligence_samples;
drop policy if exists "int_samples_org_insert" on intelligence_samples;
drop policy if exists "int_samples_org_update" on intelligence_samples;
drop policy if exists "int_events_org_read" on intelligence_sample_events;
drop policy if exists "int_events_org_insert" on intelligence_sample_events;

create policy int_samples_org_read on intelligence_samples for select
  to authenticated using (organization_id = current_org_id());
create policy int_samples_org_insert on intelligence_samples for insert
  to authenticated with check (organization_id = current_org_id());
create policy int_samples_org_update on intelligence_samples for update
  to authenticated using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy int_events_org_read on intelligence_sample_events for select
  to authenticated using (sample_id in (select id from intelligence_samples where organization_id = current_org_id()));
create policy int_events_org_insert on intelligence_sample_events for insert
  to authenticated with check (sample_id in (select id from intelligence_samples where organization_id = current_org_id()));

-- ── Label states and event types ───────────────────────────────────────────

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'intelligence_samples'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%label_status%'
  loop
    execute format('alter table intelligence_samples drop constraint %I', c.conname);
  end loop;
  for c in
    select conname from pg_constraint
    where conrelid = 'intelligence_sample_events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format('alter table intelligence_sample_events drop constraint %I', c.conname);
  end loop;
end $$;

alter table intelligence_samples
  add constraint intelligence_samples_label_status_check
  check (label_status in ('UNLABELED', 'AI_ONLY', 'HUMAN_REVIEWED', 'HUMAN_CORRECTED', 'OUTCOME_VERIFIED', 'TRAINING_APPROVED'));

alter table intelligence_sample_events
  add constraint intelligence_sample_events_event_type_check
  check (event_type in (
    'SCORE_CAPTURED', 'ROUTING_CAPTURED', 'MESSAGE_GENERATED', 'MESSAGE_EDITED', 'MESSAGE_SENT',
    'CLIENT_REPLY', 'OUTCOME_CHANGED', 'FEEDBACK_SUBMITTED', 'LABEL_APPROVED'
  ));

-- ── Idempotency: unique, so a retry is a no-op at the database ─────────────

-- Remove any duplicates the non-unique index allowed, keeping the earliest.
delete from intelligence_sample_events e
using intelligence_sample_events d
where e.idempotency_key is not null
  and e.idempotency_key = d.idempotency_key
  and e.sample_id = d.sample_id
  and e.created_at > d.created_at;

drop index if exists int_sample_events_idem_idx;
create unique index if not exists int_sample_events_idem_uniq
  on intelligence_sample_events (sample_id, idempotency_key) where idempotency_key is not null;

comment on column intelligence_samples.raw_input_hash is 'SHA-256 (hex) of the whitespace-normalised source; equals the scoring program opportunityKey. Legacy rows may still hold "length:prefix" until re-hashed.';

-- ── 20261022120000_data_integrity_opportunity_key.sql ──
-- =============================================================================
-- DATA INTEGRITY — opportunity key + test-data isolation
-- P0-1 (stable opportunity key + dedupe) and P0-2 (test-data isolation).
-- Additive only: no column drops, no deletes, no historical rewrites.
-- =============================================================================

-- 1. STABLE OPPORTUNITY KEY ---------------------------------------------------
-- One canonical implementation (opportunityKey / normalizeForHash) collapses a
-- lead and the captured prospect it came from to the same underlying
-- opportunity. Nullable during backfill; old rows still load (P0-9).
alter table captured_prospects add column if not exists opportunity_key text;
alter table leads add column if not exists opportunity_key text;
alter table intelligence_samples add column if not exists opportunity_key text;

create index if not exists cp_opportunity_key_idx on captured_prospects (organization_id, opportunity_key);
create index if not exists leads_opportunity_key_idx on leads (organization_id, opportunity_key);
create index if not exists samples_opportunity_key_idx on intelligence_samples (organization_id, opportunity_key);

-- 2. TEST / DEMO / E2E ISOLATION ----------------------------------------------
-- Runtime classification must be explicit, never name-based.
alter table captured_prospects add column if not exists is_test boolean not null default false;
alter table captured_prospects add column if not exists source_kind text not null default 'PRODUCTION';
alter table leads add column if not exists is_test boolean not null default false;
alter table leads add column if not exists source_kind text not null default 'PRODUCTION';
alter table intelligence_samples add column if not exists is_test boolean not null default false;
alter table intelligence_samples add column if not exists source_kind text not null default 'PRODUCTION';
alter table scoring_shadow_decisions add column if not exists is_test boolean not null default false;

-- 3. BACKFILL opportunity_key from the stored raw source ----------------------
-- Deterministic: same normalised source -> same key. History is preserved.
update captured_prospects
set opportunity_key = encode(sha256(convert_to(lower(regexp_replace(coalesce(raw_input, ''), '[[:space:]]+', ' ', 'g')), 'UTF8')), 'hex')
where opportunity_key is null
  and length(regexp_replace(coalesce(raw_input, ''), '[[:space:]]+', ' ', 'g')) >= 40;

update leads
set opportunity_key = encode(sha256(convert_to(lower(regexp_replace(coalesce(raw_input, ''), '[[:space:]]+', ' ', 'g')), 'UTF8')), 'hex')
where opportunity_key is null
  and length(regexp_replace(coalesce(raw_input, ''), '[[:space:]]+', ' ', 'g')) >= 40;

update intelligence_samples
set opportunity_key = encode(sha256(convert_to(lower(regexp_replace(coalesce(raw_input, ''), '[[:space:]]+', ' ', 'g')), 'UTF8')), 'hex')
where opportunity_key is null
  and length(regexp_replace(coalesce(raw_input, ''), '[[:space:]]+', ' ', 'g')) >= 40;

-- 4. BACKFILL test/demo fixtures (high-confidence only, never real users) -----
-- Only the known E2E fixture naming pattern used by this repo's QA harness.
update captured_prospects
set is_test = true, source_kind = 'E2E'
where is_test = false and extracted_company ~ '(NorthPeak [0-9]{10,}|BPulse Test)';
update leads
set is_test = true, source_kind = 'E2E'
where is_test = false and company ~ '(NorthPeak [0-9]{10,}|BPulse Test)';
update intelligence_samples
set is_test = true, source_kind = 'E2E'
where is_test = false and raw_input ~ '(NorthPeak [0-9]{10,}|BPulse Test)';

-- ── 20261022130000_labeling_v2.sql ──
-- Human Labeling V2 (Phase F): a fast quick-label path (<15s per label) and
-- pairwise ranking labels.
--
-- Quick labels answer the questions a reviewer can answer at a glance, next to
-- the existing detailed label. Pairwise labels ("work A before B") are the
-- signal a learning-to-rank model actually trains on, and are far easier for
-- a human than inventing an exact score.
--
-- All of it is append-only, versioned, attributed to the labeler, and never
-- read by production scoring.

alter table scoring_labels
  add column if not exists prospect_quality text check (prospect_quality in ('GREAT', 'GOOD', 'MAYBE', 'POOR', 'NEVER_CONTACT')),
  add column if not exists likely_opportunity text check (likely_opportunity in ('YES', 'MAYBE', 'NO')),
  add column if not exists quick_action text check (quick_action in ('CONTACT_NOW', 'CONNECT', 'RESEARCH', 'OBSERVE', 'CLOSE')),
  add column if not exists decision_correct text check (decision_correct in ('YES', 'NO'));

comment on column scoring_labels.prospect_quality is 'Fast reviewer judgement of how good a prospect this is.';
comment on column scoring_labels.likely_opportunity is 'Fast reviewer judgement of whether real software work is likely.';
comment on column scoring_labels.quick_action is 'Fast reviewer judgement of the action BD should take.';
comment on column scoring_labels.decision_correct is 'Whether the production decision (score/band/action) was right.';

create table if not exists scoring_pairwise_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  opportunity_key_a text not null,
  opportunity_key_b text not null,
  winner text not null check (winner in ('A', 'B', 'TIE')),
  labeler_rep_id uuid not null references reps(id) on delete cascade,
  label_version text not null default 'label_v1',
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists scoring_pairwise_org_created_idx on scoring_pairwise_labels (organization_id, created_at desc);
create index if not exists scoring_pairwise_org_a_idx on scoring_pairwise_labels (organization_id, opportunity_key_a);

alter table scoring_pairwise_labels enable row level security;

drop policy if exists scoring_pairwise_select on scoring_pairwise_labels;
create policy scoring_pairwise_select on scoring_pairwise_labels for select
  to authenticated using (organization_id = current_org_id());

drop policy if exists scoring_pairwise_insert on scoring_pairwise_labels;
create policy scoring_pairwise_insert on scoring_pairwise_labels for insert
  to authenticated with check (organization_id = current_org_id() and is_org_admin());

comment on table scoring_pairwise_labels is 'Pairwise preferences (work A before B). Directly usable as learning-to-rank supervision; never read by production scoring.';

-- ── 20261022140000_scoring_shadow_routing.sql ──
-- Routing v1 ↔ v2 comparison (Phase H): store both routers' answers beside the
-- shadow decision so the admin QA center can show what the semantic router
-- would change, and why. Admin-only, never shown to reps, never changes a score.
alter table scoring_shadow_decisions
  add column if not exists routing_v1 jsonb,
  add column if not exists routing_v2 jsonb;

comment on column scoring_shadow_decisions.routing_v1 is 'Production router (v1) sender + score for this opportunity.';
comment on column scoring_shadow_decisions.routing_v2 is 'Semantic router (v2) ranking summary, proof used, eligibility and whether it would change the sender.';

-- ── 20261022150000_scoring_shadow_sales_thesis.sql ──
-- Sales Thesis Engine (Phase C): store the commercial thesis beside every
-- shadow decision so the admin QA / training-data surfaces can show it next to
-- the production and candidate scores. Admin-only, never shown to reps, never
-- changes a score.
alter table scoring_shadow_decisions
  add column if not exists sales_thesis jsonb,
  add column if not exists sales_thesis_version text;

comment on column scoring_shadow_decisions.sales_thesis is 'Deterministic sales thesis (why this account, likely problems as hypotheses, why we can help, entry point). Built from verified facts only.';

