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
