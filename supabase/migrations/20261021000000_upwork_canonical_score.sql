-- Upwork canonical scoring (upwork_score_v1).
--
-- `score` stays the 0-10 display projection for existing surfaces; the
-- canonical 0-100 score, its dimension breakdown, the parsed job facts and
-- the profile ranking are stored alongside so the job detail page, the admin
-- QA center and the shadow runner read the same decision.

alter table upwork_jobs add column if not exists canonical_score integer check (canonical_score between 0 and 100);
alter table upwork_jobs add column if not exists score_version text;
alter table upwork_jobs add column if not exists score_breakdown jsonb;
alter table upwork_jobs add column if not exists job_facts jsonb;
alter table upwork_jobs add column if not exists profile_match jsonb;
alter table upwork_jobs add column if not exists scored_at timestamptz;

create index if not exists upwork_jobs_canonical_score_idx on upwork_jobs (organization_id, canonical_score desc);

comment on column upwork_jobs.canonical_score is 'Canonical 0-100 job score (upwork_score_v1). Independent of the chosen profile.';
comment on column upwork_jobs.profile_match is 'Ranked profile/sender match for this job (routing_v1). Separate from the job score.';
