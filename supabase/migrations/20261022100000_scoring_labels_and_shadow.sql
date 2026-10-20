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
