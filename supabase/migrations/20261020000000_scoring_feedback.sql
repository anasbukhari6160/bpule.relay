-- Scoring program: human feedback on decisions (Phase 31).
--
-- Reps and admins can say a decision was wrong. Feedback is persisted with
-- the versions that produced the decision; it NEVER changes a model or a
-- score automatically. It feeds the next calibration pass and the admin
-- QA center.

create table if not exists scoring_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rep_id uuid not null references reps(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  captured_prospect_id uuid references captured_prospects(id) on delete cascade,
  decision_run_id text,
  feedback_type text not null check (feedback_type in (
    'SCORE_TOO_HIGH', 'SCORE_TOO_LOW', 'WRONG_INTENT', 'WRONG_SENDER',
    'WRONG_INDUSTRY', 'WRONG_ACTION', 'WRONG_COMPANY', 'WRONG_TIMING', 'CORRECT'
  )),
  note text,
  -- What the decision said at the time, so calibration can compare.
  observed jsonb not null default '{}'::jsonb,
  -- What the human says it should have been (free-form, optional).
  expected jsonb,
  versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scoring_feedback_org_created_idx on scoring_feedback (organization_id, created_at desc);
create index if not exists scoring_feedback_lead_idx on scoring_feedback (lead_id) where lead_id is not null;
create index if not exists scoring_feedback_type_idx on scoring_feedback (organization_id, feedback_type);

alter table scoring_feedback enable row level security;

drop policy if exists scoring_feedback_select on scoring_feedback;
create policy scoring_feedback_select on scoring_feedback for select
  to authenticated using (organization_id = current_org_id());

drop policy if exists scoring_feedback_insert on scoring_feedback;
create policy scoring_feedback_insert on scoring_feedback for insert
  to authenticated with check (organization_id = current_org_id() and rep_id = current_rep_id());

comment on table scoring_feedback is 'Human feedback on Relay scoring decisions. Never auto-applied; used for calibration and the admin scoring QA center.';
