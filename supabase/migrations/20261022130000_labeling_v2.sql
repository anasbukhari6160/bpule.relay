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
