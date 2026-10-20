-- COMBINED MIGRATION: Paste this entire file into Supabase SQL Editor
-- Contains the 2 missing migrations that haven't been applied yet.

-- ============================================================================
-- 1. Upwork canonical scoring (upwork_score_v1)
-- ============================================================================

alter table upwork_jobs add column if not exists canonical_score integer check (canonical_score between 0 and 100);
alter table upwork_jobs add column if not exists score_version text;
alter table upwork_jobs add column if not exists score_breakdown jsonb;
alter table upwork_jobs add column if not exists job_facts jsonb;
alter table upwork_jobs add column if not exists profile_match jsonb;
alter table upwork_jobs add column if not exists scored_at timestamptz;

create index if not exists upwork_jobs_canonical_score_idx on upwork_jobs (organization_id, canonical_score desc);

comment on column upwork_jobs.canonical_score is 'Canonical 0-100 job score (upwork_score_v1). Independent of the chosen profile.';
comment on column upwork_jobs.profile_match is 'Ranked profile/sender match for this job (routing_v1). Separate from the job score.';
