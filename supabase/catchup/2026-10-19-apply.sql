-- =============================================================================
-- RELAY — DATABASE CATCH-UP (generated 2026-10-19 from supabase/migrations)
-- Covers migrations 20261004000000 → 20261019000003, in order.
--
-- • Safe to run more than once: every statement is "if not exists" / "or
--   replace" / "drop … if exists" first. Re-running changes nothing.
-- • All-or-nothing: one transaction. Any error rolls everything back.
-- • Schema only, plus these existing-row changes (all idempotent):
--     leads               scores above 12 move to canonical_score (20261006)
--     messages            DUPLICATE "connection" rows per lead are DELETED,
--                         keeping the earliest one (20261016) — preview with
--                         the query at the bottom of check.sql first
--     messages            email-webhook replies relabelled inbound (20261017)
--     action_events       idempotency keys backfilled (20261008, collision-safe)
--     organization_rulebooks  default performance weights (no-op if set)
-- • No seed data, no demo rows.
-- Run in: Supabase Dashboard → SQL Editor → paste → Run.
-- =============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════
-- 20261004000000_profile_enrichment.sql
-- ════════════════════════════════════════════════════════════════════
-- 20261004000000: Profile Enrichment + Safe Profile Merge
--
-- INVARIANT: PROFILE IDENTITY IS PERMANENT. IMPORT ENRICHES THE PROFILE.
-- IMPORT NEVER DESTROYS RELATIONSHIPS.
--
-- Strictly additive:
--   * new nullable columns on existing tables (no defaults that rewrite data
--     semantics, no drops, no type changes)
--   * new tables (enrichment runs, experience history, merge audit log)
--   * partial unique indexes on NEW fingerprint columns only (every existing
--     row has NULL there, so they cannot collide with production data)
--   * two transactional RPCs callable only by service_role
--
-- No DELETE / TRUNCATE / cascade changes / FK clearing on existing data.
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. Columns on existing tables
-- ============================================================================

-- profiles.updated_at is written by application code but was never created by
-- any migration in this repo. Added here for optimistic-concurrency + audit.
alter table profiles add column if not exists updated_at timestamptz default now();
-- Set only by merge_profiles() on the archived duplicate (B → A).
alter table profiles add column if not exists merged_into_profile_id uuid references profiles(id) on delete restrict;

alter table profile_sources add column if not exists updated_at timestamptz default now();
alter table profile_sources add column if not exists enrichment_run_id uuid;
alter table profile_sources add column if not exists content_fingerprint text;
alter table profile_sources add column if not exists extraction_result jsonb;

-- Claims become the provenance ledger for every imported fact.
alter table profile_claims add column if not exists authority text
  check (authority in ('human_verified','trusted_source_fact','ai_extracted_fact','strong_inference','weak_inference'));
alter table profile_claims add column if not exists merge_action text
  check (merge_action in ('new_fact','update','duplicate','conflict','unknown','historical','human_edit'));
alter table profile_claims add column if not exists claim_status text
  check (claim_status in ('active','conflict','historical','superseded','unknown'));
alter table profile_claims add column if not exists previous_value text;
alter table profile_claims add column if not exists enrichment_run_id uuid;
alter table profile_claims add column if not exists source_filename text;
alter table profile_claims add column if not exists claim_fingerprint text;
alter table profile_claims add column if not exists corroborating_source_ids uuid[] not null default '{}';
alter table profile_claims add column if not exists approved_by uuid;
create unique index if not exists profile_claims_fingerprint_uniq
  on profile_claims (profile_id, claim_fingerprint) where claim_fingerprint is not null;

alter table portfolio_projects add column if not exists content_fingerprint text;
alter table portfolio_projects add column if not exists source_id uuid references profile_sources(id) on delete set null;
alter table portfolio_projects add column if not exists enrichment_run_id uuid;
alter table portfolio_projects add column if not exists client_company text;
alter table portfolio_projects add column if not exists start_date text;
alter table portfolio_projects add column if not exists end_date text;
alter table portfolio_projects add column if not exists outcome text;
alter table portfolio_projects add column if not exists authority text;
create unique index if not exists portfolio_projects_fingerprint_uniq
  on portfolio_projects (profile_id, content_fingerprint) where content_fingerprint is not null;

alter table proof_cards add column if not exists content_fingerprint text;
alter table proof_cards add column if not exists source_id uuid references profile_sources(id) on delete set null;
alter table proof_cards add column if not exists enrichment_run_id uuid;
alter table proof_cards add column if not exists authority text;
create unique index if not exists proof_cards_fingerprint_uniq
  on proof_cards (profile_id, content_fingerprint) where content_fingerprint is not null;

alter table profile_reviews add column if not exists content_fingerprint text;
alter table profile_reviews add column if not exists enrichment_run_id uuid;
alter table profile_reviews add column if not exists authority text;
create unique index if not exists profile_reviews_fingerprint_uniq
  on profile_reviews (profile_id, content_fingerprint) where content_fingerprint is not null;

-- ============================================================================
-- 2. Enrichment runs (dry-run proposal + immutable-once-applied audit)
-- ============================================================================

create table if not exists profile_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- RESTRICT: an audited profile can never be silently deleted.
  profile_id uuid not null references profiles(id) on delete restrict,
  import_batch_id uuid references profile_import_batches(id) on delete set null,
  status text not null default 'uploaded'
    check (status in ('uploaded','extracting','proposed','applying','applied','failed','discarded')),
  source_ids uuid[] not null default '{}',
  actor_rep_id uuid references reps(id) on delete set null,
  proposal jsonb,
  decisions jsonb,
  audit jsonb,
  profile_snapshot_before jsonb,
  relationship_counts_before jsonb,
  relationship_counts_after jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  proposed_at timestamptz,
  applied_at timestamptz
);
-- Existing table with an older shape: add any missing columns.
alter table profile_enrichment_runs add column if not exists organization_id uuid;
alter table profile_enrichment_runs add column if not exists profile_id uuid;
alter table profile_enrichment_runs add column if not exists import_batch_id uuid;
alter table profile_enrichment_runs add column if not exists status text default 'uploaded';
alter table profile_enrichment_runs add column if not exists source_ids uuid[] default '{}';
alter table profile_enrichment_runs add column if not exists actor_rep_id uuid;
alter table profile_enrichment_runs add column if not exists proposal jsonb;
alter table profile_enrichment_runs add column if not exists decisions jsonb;
alter table profile_enrichment_runs add column if not exists audit jsonb;
alter table profile_enrichment_runs add column if not exists profile_snapshot_before jsonb;
alter table profile_enrichment_runs add column if not exists relationship_counts_before jsonb;
alter table profile_enrichment_runs add column if not exists relationship_counts_after jsonb;
alter table profile_enrichment_runs add column if not exists error_message text;
alter table profile_enrichment_runs add column if not exists created_at timestamptz default now();
alter table profile_enrichment_runs add column if not exists updated_at timestamptz default now();
alter table profile_enrichment_runs add column if not exists proposed_at timestamptz;
alter table profile_enrichment_runs add column if not exists applied_at timestamptz;
create index if not exists enrichment_runs_profile_idx on profile_enrichment_runs (profile_id, created_at desc);
create index if not exists enrichment_runs_org_idx on profile_enrichment_runs (organization_id, created_at desc);

alter table profile_enrichment_runs enable row level security;
drop policy if exists "enrichment_runs_select" on profile_enrichment_runs;
create policy "enrichment_runs_select" on profile_enrichment_runs for select using (organization_id = current_org_id());
-- Writes go through the service role only.

-- ============================================================================
-- 3. Experience history (chronology: old role + new role both preserved)
-- ============================================================================

create table if not exists profile_experience (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete restrict,
  role text,
  company text,
  start_date text,
  end_date text,
  is_current boolean not null default false,
  authority text,
  source_id uuid references profile_sources(id) on delete set null,
  enrichment_run_id uuid,
  content_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table profile_experience add column if not exists organization_id uuid;
alter table profile_experience add column if not exists profile_id uuid;
alter table profile_experience add column if not exists role text;
alter table profile_experience add column if not exists company text;
alter table profile_experience add column if not exists start_date text;
alter table profile_experience add column if not exists end_date text;
alter table profile_experience add column if not exists is_current boolean default false;
alter table profile_experience add column if not exists authority text;
alter table profile_experience add column if not exists source_id uuid;
alter table profile_experience add column if not exists enrichment_run_id uuid;
alter table profile_experience add column if not exists content_fingerprint text;
alter table profile_experience add column if not exists created_at timestamptz default now();
alter table profile_experience add column if not exists updated_at timestamptz default now();
create index if not exists profile_experience_profile_idx on profile_experience (profile_id);
create unique index if not exists profile_experience_fingerprint_uniq
  on profile_experience (profile_id, content_fingerprint) where content_fingerprint is not null;

alter table profile_experience enable row level security;
drop policy if exists "profile_experience_select" on profile_experience;
create policy "profile_experience_select" on profile_experience for select using (organization_id = current_org_id());

-- ============================================================================
-- 4. Immutable merge audit log
-- ============================================================================

create table if not exists profile_merge_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  -- Plain uuids (no FK) so the audit record can outlive anything.
  source_profile_id uuid not null,
  target_profile_id uuid not null,
  actor_rep_id uuid,
  identity_check jsonb,
  counts_before jsonb not null,
  counts_after jsonb not null,
  reassigned_refs jsonb not null,
  removed_duplicates jsonb not null,
  merged_fields jsonb not null,
  source_snapshot jsonb not null,
  target_snapshot_before jsonb not null,
  created_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table profile_merge_log add column if not exists organization_id uuid;
alter table profile_merge_log add column if not exists source_profile_id uuid;
alter table profile_merge_log add column if not exists target_profile_id uuid;
alter table profile_merge_log add column if not exists actor_rep_id uuid;
alter table profile_merge_log add column if not exists identity_check jsonb;
alter table profile_merge_log add column if not exists counts_before jsonb;
alter table profile_merge_log add column if not exists counts_after jsonb;
alter table profile_merge_log add column if not exists reassigned_refs jsonb;
alter table profile_merge_log add column if not exists removed_duplicates jsonb;
alter table profile_merge_log add column if not exists merged_fields jsonb;
alter table profile_merge_log add column if not exists source_snapshot jsonb;
alter table profile_merge_log add column if not exists target_snapshot_before jsonb;
alter table profile_merge_log add column if not exists created_at timestamptz default now();
alter table profile_merge_log enable row level security;
drop policy if exists "profile_merge_log_select" on profile_merge_log;
create policy "profile_merge_log_select" on profile_merge_log for select using (organization_id = current_org_id());

create or replace function profile_merge_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'profile_merge_log is append-only';
end $$;
drop trigger if exists profile_merge_log_no_update on profile_merge_log;
create trigger profile_merge_log_no_update before update or delete on profile_merge_log
  for each row execute function profile_merge_log_immutable();

-- ============================================================================
-- 5. Helpers
-- ============================================================================

-- Every column in the database that references a profile id:
--   * every single-column FK pointing at profiles(id), plus
--   * FK-less uuid columns literally named profile_id / sender_profile_id
--     (schema drift safety net: some environments were patched by hand).
-- Discovered dynamically so tables added later are automatically covered.
create or replace function profile_fk_columns()
returns table (table_name text, column_name text)
language sql stable as $$
  select distinct t, col from (
    select c.conrelid::regclass::text as t, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and array_length(c.conkey, 1) = 1
    union
    select format('%I', ic.table_name), ic.column_name::text
    from information_schema.columns ic
    join information_schema.tables it on it.table_schema = ic.table_schema and it.table_name = ic.table_name
    where ic.table_schema = 'public' and it.table_type = 'BASE TABLE'
      and ic.column_name in ('profile_id', 'sender_profile_id') and ic.data_type = 'uuid'
  ) x
  order by 1, 2
$$;

create or replace function profile_relationship_counts(p_profile_id uuid)
returns jsonb
language plpgsql stable as $$
declare
  r record;
  n bigint;
  result jsonb := '{}'::jsonb;
begin
  for r in select * from profile_fk_columns() loop
    execute format('select count(*) from %s where %I = $1', r.table_name, r.column_name)
      into n using p_profile_id;
    result := result || jsonb_build_object(r.table_name || '.' || r.column_name, n);
  end loop;
  return result;
end $$;

create or replace function profile_row_inbound_refs(p_table text, p_id uuid)
returns bigint
language plpgsql stable as $$
declare fk record; cnt bigint; total bigint := 0;
begin
  for fk in select c.conrelid::regclass::text as t, a.attname::text as col
            from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = p_table::regclass and array_length(c.conkey, 1) = 1 loop
    execute format('select count(*) from %s where %I = $1', fk.t, fk.col) into cnt using p_id;
    total := total + cnt;
  end loop;
  return total;
end $$;

create or replace function authority_rank(a text) returns int
language sql immutable as $$
  select case a
    when 'human_verified' then 5
    when 'trusted_source_fact' then 4
    when 'ai_extracted_fact' then 3
    when 'strong_inference' then 2
    when 'weak_inference' then 1
    else 0 end
$$;

-- ============================================================================
-- 6. apply_profile_enrichment — one transaction, all-or-nothing.
--
-- The plan is computed (and shown to the user as a dry-run diff) in the app.
-- This function re-validates it against live state and refuses anything that
-- is not strictly additive. Any failure raises → full rollback.
-- ============================================================================

create or replace function apply_profile_enrichment(
  p_run_id uuid,
  p_organization_id uuid,
  p_actor_rep_id uuid,
  p_plan jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run profile_enrichment_runs%rowtype;
  v_profile profiles%rowtype;
  v_profile_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_snapshot jsonb;
  v_item jsonb;
  v_field text;
  v_current text;
  v_existing jsonb;
  v_new jsonb;
  v_elem jsonb;
  v_key text;
  v_inserted int;
  v_counts jsonb := jsonb_build_object(
    'scalar_updates', 0, 'array_items_added', 0, 'projects_added', 0, 'projects_enriched', 0,
    'proofs_added', 0, 'reviews_added', 0, 'claims_recorded', 0, 'claims_corroborated', 0,
    'experience_added', 0, 'sources_linked', 0);
  -- Tables this function is allowed to add rows to. Every OTHER table that
  -- references profiles must have identical counts before and after.
  v_writable text[] := array[
    'portfolio_projects.profile_id','proof_cards.profile_id','profile_reviews.profile_id',
    'profile_claims.profile_id','profile_experience.profile_id','profile_sources.profile_id',
    'profile_enrichment_runs.profile_id'];
  v_scalar_fields text[] := array[
    'full_name','display_name','headline','current_role','company','location','bio',
    'professional_summary','seniority','years_experience','positioning'];
  v_array_fields text[] := array[
    'primary_skills','secondary_skills','technologies','industries','service_capabilities',
    'specialties','differentiators','languages'];
begin
  select * into v_run from profile_enrichment_runs where id = p_run_id for update;
  if not found then raise exception 'enrichment run % not found', p_run_id; end if;
  if v_run.organization_id <> p_organization_id then raise exception 'organization mismatch'; end if;
  if v_run.status <> 'proposed' then
    raise exception 'enrichment run % is %, expected proposed (already applied or discarded?)', p_run_id, v_run.status;
  end if;

  v_profile_id := v_run.profile_id;
  select * into v_profile from profiles where id = v_profile_id and organization_id = p_organization_id for update;
  if not found then raise exception 'profile % not found in organization', v_profile_id; end if;
  if v_profile.archived_at is not null then raise exception 'profile % is archived', v_profile_id; end if;

  v_snapshot := to_jsonb(v_profile);
  v_before := profile_relationship_counts(v_profile_id);

  -- ── Scalar fields: optimistic check against the value the diff was built on.
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'scalar_updates', '[]'::jsonb)) loop
    v_field := v_item->>'field';
    if not (v_field = any(v_scalar_fields)) then raise exception 'field % is not enrichable', v_field; end if;
    execute format('select (%I)::text from profiles where id = $1', v_field) into v_current using v_profile_id;
    if v_current is distinct from (v_item->>'expected') then
      -- numeric text forms can differ (5 vs 5.0)
      if not (v_field = 'years_experience' and v_current is not null and (v_item->>'expected') is not null
              and v_current::numeric = (v_item->>'expected')::numeric) then
        raise exception 'stale proposal: % changed since the diff was generated', v_field;
      end if;
    end if;
    if v_field = 'years_experience' then
      update profiles set years_experience = (v_item->>'value')::numeric where id = v_profile_id;
    else
      execute format('update profiles set %I = $1 where id = $2', v_field) using (v_item->>'value'), v_profile_id;
    end if;
    v_counts := jsonb_set(v_counts, '{scalar_updates}', to_jsonb((v_counts->>'scalar_updates')::int + 1));
  end loop;

  -- ── Array fields: append-only union (case-insensitive), never removes.
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'array_appends', '[]'::jsonb)) loop
    v_field := v_item->>'field';
    if not (v_field = any(v_array_fields)) then raise exception 'field % is not an enrichable list', v_field; end if;
    execute format('select coalesce(%I, ''[]''::jsonb) from profiles where id = $1', v_field) into v_existing using v_profile_id;
    v_new := v_existing;
    for v_elem in select * from jsonb_array_elements(coalesce(v_item->'items', '[]'::jsonb)) loop
      if not exists (
        select 1 from jsonb_array_elements_text(v_new) e where lower(trim(e)) = lower(trim(v_elem #>> '{}'))
      ) then
        v_new := v_new || jsonb_build_array(v_elem #>> '{}');
        v_counts := jsonb_set(v_counts, '{array_items_added}', to_jsonb((v_counts->>'array_items_added')::int + 1));
      end if;
    end loop;
    execute format('update profiles set %I = $1 where id = $2', v_field) using v_new, v_profile_id;
  end loop;

  -- ── Projects: insert new (fingerprint-deduped).
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'projects_insert', '[]'::jsonb)) loop
    insert into portfolio_projects (organization_id, profile_id, project_title, my_role, description, skills,
      technologies, source_kind, content_fingerprint, source_id, enrichment_run_id, client_company,
      start_date, end_date, outcome, authority)
    values (p_organization_id, v_profile_id, v_item->>'project_title', v_item->>'my_role', v_item->>'description',
      coalesce(array(select jsonb_array_elements_text(v_item->'technologies')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_item->'technologies')), '{}'),
      'import', v_item->>'fingerprint', nullif(v_item->>'source_id','')::uuid, p_run_id, v_item->>'client_company',
      v_item->>'start_date', v_item->>'end_date', v_item->>'outcome', v_item->>'authority')
    on conflict (profile_id, content_fingerprint) where content_fingerprint is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_counts := jsonb_set(v_counts, '{projects_added}', to_jsonb((v_counts->>'projects_added')::int + v_inserted));
  end loop;

  -- ── Projects: enrich existing — fill EMPTY fields only, union technologies.
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'projects_enrich', '[]'::jsonb)) loop
    update portfolio_projects set
      my_role = coalesce(nullif(my_role, ''), v_item->>'my_role'),
      description = coalesce(nullif(description, ''), v_item->>'description'),
      client_company = coalesce(nullif(client_company, ''), v_item->>'client_company'),
      start_date = coalesce(nullif(start_date, ''), v_item->>'start_date'),
      end_date = coalesce(nullif(end_date, ''), v_item->>'end_date'),
      outcome = coalesce(nullif(outcome, ''), v_item->>'outcome'),
      technologies = array(select distinct unnest(technologies || coalesce(array(select jsonb_array_elements_text(v_item->'technologies')), '{}'))),
      skills = array(select distinct unnest(skills || coalesce(array(select jsonb_array_elements_text(v_item->'technologies')), '{}'))),
      updated_at = now()
    where id = (v_item->>'id')::uuid and profile_id = v_profile_id;
    get diagnostics v_inserted = row_count;
    if v_inserted <> 1 then raise exception 'project % does not belong to profile', v_item->>'id'; end if;
    v_counts := jsonb_set(v_counts, '{projects_enriched}', to_jsonb((v_counts->>'projects_enriched')::int + 1));
  end loop;

  -- ── Proofs
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'proofs_insert', '[]'::jsonb)) loop
    insert into proof_cards (organization_id, profile_id, capability, strength, safe_claim, source_type,
      source_reference, tags, verified, forbidden_claims, content_fingerprint, source_id, enrichment_run_id, authority)
    values (p_organization_id, v_profile_id, v_item->>'capability', v_item->>'strength', v_item->>'safe_claim',
      v_item->>'source_type', v_item->>'source_reference',
      coalesce(array(select jsonb_array_elements_text(v_item->'tags')), '{}'),
      false, '{}', v_item->>'fingerprint', nullif(v_item->>'source_id','')::uuid, p_run_id, v_item->>'authority')
    on conflict (profile_id, content_fingerprint) where content_fingerprint is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_counts := jsonb_set(v_counts, '{proofs_added}', to_jsonb((v_counts->>'proofs_added')::int + v_inserted));
  end loop;

  -- ── Reviews
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'reviews_insert', '[]'::jsonb)) loop
    insert into profile_reviews (organization_id, profile_id, source_id, review_text, reviewer_name, reviewer_company,
      project_context, relevant_skills, evidence_type, confidence, safe_for_outreach, ownership_status,
      content_fingerprint, enrichment_run_id, authority)
    values (p_organization_id, v_profile_id, nullif(v_item->>'source_id','')::uuid, v_item->>'review_text',
      v_item->>'reviewer_name', v_item->>'reviewer_company', v_item->>'project_context',
      coalesce(v_item->'relevant_skills', '[]'::jsonb), coalesce(v_item->>'evidence_type', 'explicit_claim'),
      (v_item->>'confidence')::numeric, coalesce((v_item->>'safe_for_outreach')::boolean, false),
      coalesce(v_item->>'ownership_status', 'clear'), v_item->>'fingerprint', p_run_id, v_item->>'authority')
    on conflict (profile_id, content_fingerprint) where content_fingerprint is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_counts := jsonb_set(v_counts, '{reviews_added}', to_jsonb((v_counts->>'reviews_added')::int + v_inserted));
  end loop;

  -- ── Experience history (both old and new roles preserved).
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'experience_insert', '[]'::jsonb)) loop
    insert into profile_experience (organization_id, profile_id, role, company, start_date, end_date, is_current,
      authority, source_id, enrichment_run_id, content_fingerprint)
    values (p_organization_id, v_profile_id, v_item->>'role', v_item->>'company', v_item->>'start_date',
      v_item->>'end_date', coalesce((v_item->>'is_current')::boolean, false), v_item->>'authority',
      nullif(v_item->>'source_id','')::uuid, p_run_id, v_item->>'fingerprint')
    on conflict (profile_id, content_fingerprint) where content_fingerprint is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_counts := jsonb_set(v_counts, '{experience_added}', to_jsonb((v_counts->>'experience_added')::int + v_inserted));
  end loop;
  -- Exactly one current role, chosen by the plan (never inferred here).
  if p_plan ? 'experience_current_fingerprint' and (p_plan->>'experience_current_fingerprint') is not null then
    update profile_experience set is_current = (content_fingerprint = p_plan->>'experience_current_fingerprint'),
      updated_at = now()
    where profile_id = v_profile_id;
  end if;

  -- ── Claims (provenance ledger). Re-import of the same fact corroborates, never duplicates.
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'claims_insert', '[]'::jsonb)) loop
    if exists (select 1 from profile_claims where profile_id = v_profile_id and claim_fingerprint = v_item->>'fingerprint') then
      v_counts := jsonb_set(v_counts, '{claims_corroborated}', to_jsonb((v_counts->>'claims_corroborated')::int + 1));
    else
      v_counts := jsonb_set(v_counts, '{claims_recorded}', to_jsonb((v_counts->>'claims_recorded')::int + 1));
    end if;
    insert into profile_claims (organization_id, profile_id, source_id, claim_key, claim_value, evidence_type,
      confidence, is_inferred, user_corrected, extraction_version, authority, merge_action, claim_status,
      previous_value, enrichment_run_id, source_filename, claim_fingerprint, corroborating_source_ids, approved_by)
    values (p_organization_id, v_profile_id, nullif(v_item->>'source_id','')::uuid, v_item->>'claim_key',
      v_item->>'claim_value', coalesce(v_item->>'evidence_type', 'explicit_claim'),
      (v_item->>'confidence')::numeric, coalesce((v_item->>'is_inferred')::boolean, false),
      coalesce((v_item->>'user_corrected')::boolean, false), 'v2-enrich', v_item->>'authority',
      v_item->>'merge_action', v_item->>'claim_status', v_item->>'previous_value', p_run_id,
      v_item->>'source_filename', v_item->>'fingerprint',
      case when nullif(v_item->>'source_id','') is null then '{}'::uuid[] else array[(v_item->>'source_id')::uuid] end,
      case when coalesce((v_item->>'user_corrected')::boolean, false) then p_actor_rep_id else null end)
    on conflict (profile_id, claim_fingerprint) where claim_fingerprint is not null do update
      set corroborating_source_ids = (
            select coalesce(array_agg(distinct s), '{}') from unnest(
              profile_claims.corroborating_source_ids || excluded.corroborating_source_ids) s),
          -- a human decision can raise authority; nothing ever lowers it
          authority = case when authority_rank(excluded.authority) > authority_rank(profile_claims.authority)
                           then excluded.authority else profile_claims.authority end,
          user_corrected = profile_claims.user_corrected or excluded.user_corrected,
          claim_status = case when excluded.user_corrected then excluded.claim_status else profile_claims.claim_status end,
          updated_at = now();
  end loop;

  -- ── Superseded claims (when a human accepted a replacement value).
  for v_item in select * from jsonb_array_elements(coalesce(p_plan->'claims_supersede', '[]'::jsonb)) loop
    update profile_claims set claim_status = 'historical', updated_at = now()
    where profile_id = v_profile_id and claim_key = v_item->>'claim_key'
      and claim_status = 'active' and claim_value is distinct from v_item->>'keep_value';
  end loop;

  -- ── Link sources. Never steal a source that belongs to another profile and
  --    never link a second copy of an already-linked file.
  update profile_sources s
     set profile_id = v_profile_id, updated_at = now()
   where s.id = any(v_run.source_ids)
     and s.organization_id = p_organization_id
     and s.profile_id is null
     and not exists (
       select 1 from profile_sources o
        where o.profile_id = v_profile_id and o.id <> s.id and o.file_hash = s.file_hash and o.file_hash <> ''
     );
  get diagnostics v_inserted = row_count;
  v_counts := jsonb_set(v_counts, '{sources_linked}', to_jsonb(v_inserted));

  -- ── Derived counters
  update profiles set
    source_count = (select count(*) from profile_sources where profile_id = v_profile_id),
    proof_count = (select count(*) from proof_cards where profile_id = v_profile_id),
    updated_at = now()
  where id = v_profile_id;

  -- ── Invariant checks (raise → rollback everything).
  if not exists (select 1 from profiles where id = v_profile_id and organization_id = p_organization_id) then
    raise exception 'INVARIANT: profile id changed or vanished';
  end if;
  v_after := profile_relationship_counts(v_profile_id);
  for v_key in select jsonb_object_keys(v_before) loop
    if v_key = any(v_writable) then
      if (v_after->>v_key)::bigint < (v_before->>v_key)::bigint then
        raise exception 'INVARIANT: % shrank (% → %)', v_key, v_before->>v_key, v_after->>v_key;
      end if;
    elsif (v_after->>v_key) is distinct from (v_before->>v_key) then
      raise exception 'INVARIANT: relationship % changed (% → %)', v_key, v_before->>v_key, v_after->>v_key;
    end if;
  end loop;

  update profile_enrichment_runs set
    status = 'applied',
    decisions = p_plan->'decisions',
    audit = coalesce(p_plan->'audit', '{}'::jsonb) || jsonb_build_object('applied_counts', v_counts,
      'actor_rep_id', p_actor_rep_id, 'applied_at', now()),
    profile_snapshot_before = v_snapshot,
    relationship_counts_before = v_before,
    relationship_counts_after = v_after,
    applied_at = now(),
    updated_at = now()
  where id = p_run_id;

  return jsonb_build_object('profile_id', v_profile_id, 'counts', v_counts,
    'relationships_before', v_before, 'relationships_after', v_after);
end $$;

-- ============================================================================
-- 7. merge_profiles — explicit, never automatic. B (source) → A (target).
--
-- p_dry_run = true  → computes the full report, then raises a sentinel that
--                      rolls back every change (true dry-run of the real path).
-- p_dry_run = false → commits. B is ARCHIVED (merged_into_profile_id = A), not
--                      deleted.
-- ============================================================================

create or replace function merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_actor_rep_id uuid,
  p_dry_run boolean default true,
  p_identity_check jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src profiles%rowtype;
  v_tgt profiles%rowtype;
  r record;
  row_rec record;
  v_ids uuid[];
  v_counts_before jsonb := '{}'::jsonb;
  v_counts_after jsonb := '{}'::jsonb;
  v_totals_before jsonb := '{}'::jsonb;
  v_totals_after jsonb := '{}'::jsonb;
  v_reassigned jsonb := '{}'::jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_merged_fields jsonb := '{}'::jsonb;
  v_key text;
  v_n bigint;
  v_src_n bigint;
  v_tgt_n bigint;
  v_field text;
  v_val text;
  v_arr jsonb;
  v_report jsonb;
  v_log_id uuid;
  v_inbound bigint;
begin
  if p_source_profile_id = p_target_profile_id then raise exception 'cannot merge a profile into itself'; end if;

  -- Lock in deterministic order to avoid deadlocks.
  perform 1 from profiles where id in (p_source_profile_id, p_target_profile_id) order by id for update;
  select * into v_src from profiles where id = p_source_profile_id;
  select * into v_tgt from profiles where id = p_target_profile_id;
  if v_src.id is null or v_tgt.id is null then raise exception 'profile not found'; end if;
  if v_src.organization_id <> p_organization_id or v_tgt.organization_id <> p_organization_id then
    raise exception 'profiles must both belong to the organization';
  end if;
  if v_src.archived_at is not null then raise exception 'source profile is already archived'; end if;
  if v_tgt.archived_at is not null then raise exception 'target profile is archived'; end if;

  -- Counts before: per FK column for A, B, and table totals.
  for r in select * from profile_fk_columns() loop
    if r.table_name = 'profiles' then continue; end if;
    v_key := r.table_name || '.' || r.column_name;
    execute format('select count(*) filter (where %1$I = $1), count(*) filter (where %1$I = $2), count(*) from %2$s',
      r.column_name, r.table_name) into v_src_n, v_tgt_n, v_n using p_source_profile_id, p_target_profile_id;
    v_counts_before := v_counts_before || jsonb_build_object(v_key, jsonb_build_object('source', v_src_n, 'target', v_tgt_n));
    v_totals_before := v_totals_before || jsonb_build_object(r.table_name, v_n);
  end loop;

  -- Reassign every reference B → A, row by row so unique collisions are handled
  -- as duplicates (snapshotted into the log) instead of failing or cascading.
  for r in select * from profile_fk_columns() loop
    if r.table_name = 'profiles' then continue; end if; -- merged_into_profile_id handled below
    v_key := r.table_name || '.' || r.column_name;
    v_ids := '{}';
    for row_rec in execute format('select ctid as rid, to_jsonb(t) as snap from %s t where %I = $1', r.table_name, r.column_name)
                   using p_source_profile_id loop
      begin
        execute format('update %s set %I = $1 where ctid = $2', r.table_name, r.column_name)
          using p_target_profile_id, row_rec.rid;
        if row_rec.snap ? 'id' then v_ids := v_ids || (row_rec.snap->>'id')::uuid; end if;
      exception when unique_violation then
        -- A already has the equivalent row (e.g. same rep assignment / same voice).
        -- Only drop B's copy if nothing references it; otherwise abort the merge.
        if row_rec.snap ? 'id' and profile_row_inbound_refs(r.table_name, (row_rec.snap->>'id')::uuid) > 0 then
          raise exception 'merge blocked: duplicate % row % is referenced elsewhere — resolve manually',
            r.table_name, row_rec.snap->>'id';
        end if;
        v_removed := v_removed || jsonb_build_array(jsonb_build_object('table', r.table_name, 'reason', 'unique_collision', 'row', row_rec.snap));
        execute format('delete from %s where ctid = $1', r.table_name) using row_rec.rid;
      end;
    end loop;
    if array_length(v_ids, 1) > 0 then
      -- preserves historical attribution: exactly which rows were B's
      v_reassigned := v_reassigned || jsonb_build_object(v_key, to_jsonb(v_ids));
    end if;
  end loop;

  -- Content-level dedupe of evidence (same claim/title/text now twice on A).
  -- Keep the oldest; drop later copies only if unreferenced.
  for row_rec in
    select 'proof_cards' as t, id from (
      select id, row_number() over (partition by lower(trim(safe_claim)) order by created_at, id) rn
      from proof_cards where profile_id = p_target_profile_id) x where rn > 1
    union all
    select 'portfolio_projects', id from (
      select id, row_number() over (partition by lower(trim(project_title)) order by created_at, id) rn
      from portfolio_projects where profile_id = p_target_profile_id) x where rn > 1
    union all
    select 'profile_reviews', id from (
      select id, row_number() over (partition by lower(trim(review_text)) order by created_at, id) rn
      from profile_reviews where profile_id = p_target_profile_id) x where rn > 1
  loop
    v_inbound := profile_row_inbound_refs(row_rec.t, row_rec.id);
    if v_inbound = 0 then
      execute format('select to_jsonb(t) from %s t where id = $1', row_rec.t) into v_arr using row_rec.id;
      v_removed := v_removed || jsonb_build_array(jsonb_build_object('table', row_rec.t, 'reason', 'content_duplicate', 'row', v_arr));
      execute format('delete from %s where id = $1', row_rec.t) using row_rec.id;
    end if;
  end loop;

  -- Merge profile fields: fill A's EMPTY scalars from B; union list fields.
  foreach v_field in array array['display_name','headline','current_role','company','location','bio',
      'professional_summary','seniority','positioning','profile_url'] loop
    execute format('select (%I)::text from profiles where id = $1', v_field) into v_val using p_target_profile_id;
    if v_val is null or v_val = '' then
      execute format('select (%I)::text from profiles where id = $1', v_field) into v_val using p_source_profile_id;
      if v_val is not null and v_val <> '' then
        execute format('update profiles set %1$I = (select %1$I from profiles where id = $2) where id = $1', v_field)
          using p_target_profile_id, p_source_profile_id;
        v_merged_fields := v_merged_fields || jsonb_build_object(v_field, v_val);
      end if;
    end if;
  end loop;
  foreach v_field in array array['primary_skills','secondary_skills','technologies','industries',
      'service_capabilities','specialties','differentiators','languages'] loop
    execute format($q$
      update profiles t set %1$I = coalesce(t.%1$I, '[]'::jsonb) || coalesce((
        select jsonb_agg(e) from jsonb_array_elements_text(coalesce(s.%1$I, '[]'::jsonb)) e
        where not exists (select 1 from jsonb_array_elements_text(coalesce(t.%1$I, '[]'::jsonb)) x
                          where lower(trim(x)) = lower(trim(e)))), '[]'::jsonb)
      from profiles s where t.id = $1 and s.id = $2 returning t.%1$I $q$, v_field)
      into v_arr using p_target_profile_id, p_source_profile_id;
  end loop;

  -- Archive B (no hard delete).
  update profiles set archived_at = now(), merged_into_profile_id = p_target_profile_id, updated_at = now()
   where id = p_source_profile_id;
  update profiles set
    source_count = (select count(*) from profile_sources where profile_id = p_target_profile_id),
    proof_count = (select count(*) from proof_cards where profile_id = p_target_profile_id),
    updated_at = now()
   where id = p_target_profile_id;

  -- Verify: B has zero references; A has exactly before(A)+before(B)-removed.
  for r in select * from profile_fk_columns() loop
    if r.table_name = 'profiles' then continue; end if;
    v_key := r.table_name || '.' || r.column_name;
    execute format('select count(*) filter (where %1$I = $1), count(*) filter (where %1$I = $2), count(*) from %2$s',
      r.column_name, r.table_name) into v_src_n, v_tgt_n, v_n using p_source_profile_id, p_target_profile_id;
    v_counts_after := v_counts_after || jsonb_build_object(v_key, jsonb_build_object('source', v_src_n, 'target', v_tgt_n));
    v_totals_after := v_totals_after || jsonb_build_object(r.table_name, v_n);
    if v_src_n <> 0 then raise exception 'FK integrity: % still references source profile', v_key; end if;
    select count(*) into v_n from jsonb_array_elements(v_removed) e where e->>'table' = r.table_name;
    if v_tgt_n <> ((v_counts_before->v_key->>'source')::bigint + (v_counts_before->v_key->>'target')::bigint - v_n) then
      raise exception 'count verification failed for %: expected %, got %', v_key,
        (v_counts_before->v_key->>'source')::bigint + (v_counts_before->v_key->>'target')::bigint - v_n, v_tgt_n;
    end if;
  end loop;

  v_report := jsonb_build_object(
    'dry_run', p_dry_run,
    'source_profile_id', p_source_profile_id,
    'target_profile_id', p_target_profile_id,
    'counts_before', v_counts_before,
    'counts_after', v_counts_after,
    'table_totals_before', v_totals_before,
    'table_totals_after', v_totals_after,
    'reassigned_refs', v_reassigned,
    'removed_duplicates', v_removed,
    'merged_fields', v_merged_fields);

  if p_dry_run then
    -- Roll back everything; the caller gets the report from the error detail.
    raise exception using errcode = 'P0001', message = 'MERGE_DRY_RUN', detail = v_report::text;
  end if;

  insert into profile_merge_log (organization_id, source_profile_id, target_profile_id, actor_rep_id, identity_check,
    counts_before, counts_after, reassigned_refs, removed_duplicates, merged_fields, source_snapshot, target_snapshot_before)
  values (p_organization_id, p_source_profile_id, p_target_profile_id, p_actor_rep_id, p_identity_check,
    v_counts_before, v_counts_after, v_reassigned, v_removed, v_merged_fields, to_jsonb(v_src), to_jsonb(v_tgt))
  returning id into v_log_id;

  return v_report || jsonb_build_object('merge_log_id', v_log_id);
end $$;

-- Wrapper so PostgREST callers get the dry-run report as a normal result.
create or replace function preview_profile_merge(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_detail text;
begin
  perform merge_profiles(p_organization_id, p_source_profile_id, p_target_profile_id, null, true, '{}'::jsonb);
  raise exception 'unreachable';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm = 'MERGE_DRY_RUN' then
    return v_detail::jsonb;
  end if;
  raise;
end $$;

revoke all on function apply_profile_enrichment(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function merge_profiles(uuid, uuid, uuid, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function preview_profile_merge(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function profile_relationship_counts(uuid) from public, anon, authenticated;
grant execute on function apply_profile_enrichment(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function merge_profiles(uuid, uuid, uuid, uuid, boolean, jsonb) to service_role;
grant execute on function preview_profile_merge(uuid, uuid, uuid) to service_role;
grant execute on function profile_relationship_counts(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════
-- 20261005000000_action_ledger_upwork.sql
-- ════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Action Ledger — append-only commercial execution history
-- ============================================================================
-- Replaces/augments activity_log with richer schema for the new operating view.

create table if not exists action_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- Who performed the action
  actor_type text not null default 'system' check (actor_type in ('rep', 'admin', 'system', 'integration')),
  actor_id uuid references reps(id) on delete set null,

  -- Which sender profile was used
  sender_profile_id uuid references profiles(id) on delete set null,

  -- Which lead/job this action is about
  lead_id uuid references leads(id) on delete set null,
  job_id uuid,  -- for upwork jobs (created below)

  -- Action classification
  action_type text not null check (action_type in (
    'LEAD_EXTRACTED',
    'CONNECTION_PREPARED',
    'CONNECTION_SENT',
    'DM_PREPARED',
    'DM_SENT',
    'FOLLOWUP_SENT',
    'REPLY_RECEIVED',
    'LEAD_REFERRED',
    'PROFILE_RECOMMENDED',
    'UPWORK_JOB_EXTRACTED',
    'UPWORK_PROPOSAL_PREPARED',
    'UPWORK_APPLIED',
    'OPPORTUNITY_CREATED',
    'CLIENT_WON'
  )),

  -- Execution state: generated vs actually sent
  execution_status text not null default 'generated' check (execution_status in ('generated', 'sent', 'delivered', 'failed')),

  -- Channel used
  channel text check (channel in ('linkedin', 'email', 'dm', 'upwork')),

  -- Referral target (when action_type = 'LEAD_REFERRED')
  referred_to_rep_id uuid references reps(id) on delete set null,
  referred_to_profile_id uuid references profiles(id) on delete set null,
  referral_reason text,

  -- Context
  message_id uuid references messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,

  -- Temporal
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table action_events add column if not exists organization_id uuid;
alter table action_events add column if not exists actor_type text default 'system';
alter table action_events add column if not exists actor_id uuid;
alter table action_events add column if not exists sender_profile_id uuid;
alter table action_events add column if not exists lead_id uuid;
alter table action_events add column if not exists job_id uuid;
alter table action_events add column if not exists action_type text;
alter table action_events add column if not exists execution_status text default 'generated';
alter table action_events add column if not exists channel text;
alter table action_events add column if not exists referred_to_rep_id uuid;
alter table action_events add column if not exists referred_to_profile_id uuid;
alter table action_events add column if not exists referral_reason text;
alter table action_events add column if not exists message_id uuid;
alter table action_events add column if not exists metadata jsonb default '{}'::jsonb;
alter table action_events add column if not exists occurred_at timestamptz default now();
alter table action_events add column if not exists created_at timestamptz default now();

-- Indexes for the operating ledger queries
create index if not exists ae_org_time_idx on action_events (organization_id, occurred_at desc);
create index if not exists ae_org_actor_time_idx on action_events (organization_id, actor_id, occurred_at desc);
create index if not exists ae_org_type_time_idx on action_events (organization_id, action_type, occurred_at desc);
create index if not exists ae_lead_idx on action_events (lead_id);
create index if not exists ae_actor_date_idx on action_events (actor_id, ((occurred_at at time zone 'UTC')::date));

-- RLS: org-scoped. Admins see all. Reps see own + referred-to-them.
alter table action_events enable row level security;
drop policy if exists "ae_select" on action_events;
create policy "ae_select" on action_events for select using (
  organization_id = current_org_id() and (
    public.is_admin()
    or actor_id = public.current_rep_id()
    or referred_to_rep_id = public.current_rep_id()
  )
);
drop policy if exists "ae_insert" on action_events;
create policy "ae_insert" on action_events for insert with check (organization_id = current_org_id());

-- ============================================================================
-- Profile Opportunity Match — reusable match score between a profile and opportunity
-- ============================================================================

create table if not exists profile_opportunity_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- The opportunity (polymorphic: lead or upwork job)
  opportunity_type text not null check (opportunity_type in ('lead', 'upwork_job')),
  lead_id uuid references leads(id) on delete cascade,
  job_id uuid,  -- references upwork_jobs.id

  -- The profile being evaluated
  profile_id uuid not null references profiles(id) on delete cascade,

  -- Match dimensions
  match_score integer not null check (match_score between 0 and 100),
  matching_capabilities jsonb not null default '[]'::jsonb,
  missing_capabilities jsonb not null default '[]'::jsonb,
  relevant_proof jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0.5 check (confidence between 0 and 1),
  reason text,

  -- Source tracking
  opportunity_hash text,  -- hash of opportunity content for cache invalidation
  match_version integer not null default 1,

  created_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table profile_opportunity_matches add column if not exists organization_id uuid;
alter table profile_opportunity_matches add column if not exists opportunity_type text;
alter table profile_opportunity_matches add column if not exists lead_id uuid;
alter table profile_opportunity_matches add column if not exists job_id uuid;
alter table profile_opportunity_matches add column if not exists profile_id uuid;
alter table profile_opportunity_matches add column if not exists match_score integer;
alter table profile_opportunity_matches add column if not exists matching_capabilities jsonb default '[]'::jsonb;
alter table profile_opportunity_matches add column if not exists missing_capabilities jsonb default '[]'::jsonb;
alter table profile_opportunity_matches add column if not exists relevant_proof jsonb default '[]'::jsonb;
alter table profile_opportunity_matches add column if not exists confidence numeric default 0.5;
alter table profile_opportunity_matches add column if not exists reason text;
alter table profile_opportunity_matches add column if not exists opportunity_hash text;
alter table profile_opportunity_matches add column if not exists match_version integer default 1;
alter table profile_opportunity_matches add column if not exists created_at timestamptz default now();

create index if not exists pom_org_lead_idx on profile_opportunity_matches (organization_id, lead_id);
create index if not exists pom_org_job_idx on profile_opportunity_matches (organization_id, job_id);
create index if not exists pom_profile_idx on profile_opportunity_matches (profile_id);
create index if not exists pom_opportunity_hash_idx on profile_opportunity_matches (opportunity_hash);

alter table profile_opportunity_matches enable row level security;
drop policy if exists "pom_select" on profile_opportunity_matches;
create policy "pom_select" on profile_opportunity_matches for select using (organization_id = current_org_id());
drop policy if exists "pom_insert" on profile_opportunity_matches;
create policy "pom_insert" on profile_opportunity_matches for insert with check (organization_id = current_org_id());

-- ============================================================================
-- Upwork Jobs + Applications
-- ============================================================================

create table if not exists upwork_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_rep_id uuid references reps(id) on delete set null,

  -- Raw extracted data
  title text not null,
  description text not null,
  skills jsonb not null default '[]'::jsonb,
  budget numeric,
  budget_type text check (budget_type in ('fixed', 'hourly')),
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  experience_level text,
  project_length text,
  location_restrictions jsonb not null default '[]'::jsonb,
  client_name text,
  client_rating numeric,
  client_spend text,
  client_hires integer,
  posted_at timestamptz,
  url text,
  raw_content_hash text unique,  -- dedup by content

  -- Screening questions (extracted from job post)
  screening_questions jsonb not null default '[]'::jsonb,

  -- Status
  status text not null default 'extracted' check (status in ('extracted', 'analyzed', 'applied', 'archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table upwork_jobs add column if not exists organization_id uuid;
alter table upwork_jobs add column if not exists owner_rep_id uuid;
alter table upwork_jobs add column if not exists title text;
alter table upwork_jobs add column if not exists description text;
alter table upwork_jobs add column if not exists skills jsonb default '[]'::jsonb;
alter table upwork_jobs add column if not exists budget numeric;
alter table upwork_jobs add column if not exists budget_type text;
alter table upwork_jobs add column if not exists hourly_rate_min numeric;
alter table upwork_jobs add column if not exists hourly_rate_max numeric;
alter table upwork_jobs add column if not exists experience_level text;
alter table upwork_jobs add column if not exists project_length text;
alter table upwork_jobs add column if not exists location_restrictions jsonb default '[]'::jsonb;
alter table upwork_jobs add column if not exists client_name text;
alter table upwork_jobs add column if not exists client_rating numeric;
alter table upwork_jobs add column if not exists client_spend text;
alter table upwork_jobs add column if not exists client_hires integer;
alter table upwork_jobs add column if not exists posted_at timestamptz;
alter table upwork_jobs add column if not exists url text;
alter table upwork_jobs add column if not exists raw_content_hash text;
alter table upwork_jobs add column if not exists screening_questions jsonb default '[]'::jsonb;
alter table upwork_jobs add column if not exists status text default 'extracted';
alter table upwork_jobs add column if not exists created_at timestamptz default now();
alter table upwork_jobs add column if not exists updated_at timestamptz default now();

create index if not exists uj_org_time_idx on upwork_jobs (organization_id, created_at desc);
create index if not exists uj_status_idx on upwork_jobs (organization_id, status);
create index if not exists uj_hash_idx on upwork_jobs (raw_content_hash);

alter table upwork_jobs enable row level security;
drop policy if exists "uj_select" on upwork_jobs;
create policy "uj_select" on upwork_jobs for select using (organization_id = current_org_id());
drop policy if exists "uj_insert" on upwork_jobs;
create policy "uj_insert" on upwork_jobs for insert with check (organization_id = current_org_id());

-- Upwork applications (cover letter + answers)
create table if not exists upwork_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references upwork_jobs(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete set null,
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_rep_id uuid references reps(id) on delete set null,

  -- Application content
  cover_letter text not null,
  question_answers jsonb not null default '[]'::jsonb,  -- [{question, answer}]

  -- Analysis snapshot at time of application
  fit_score integer,
  fit_reason text,
  risks jsonb not null default '[]'::jsonb,

  -- Status
  status text not null default 'draft' check (status in ('draft', 'ready', 'submitted')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table upwork_applications add column if not exists job_id uuid;
alter table upwork_applications add column if not exists profile_id uuid;
alter table upwork_applications add column if not exists organization_id uuid;
alter table upwork_applications add column if not exists owner_rep_id uuid;
alter table upwork_applications add column if not exists cover_letter text;
alter table upwork_applications add column if not exists question_answers jsonb default '[]'::jsonb;
alter table upwork_applications add column if not exists fit_score integer;
alter table upwork_applications add column if not exists fit_reason text;
alter table upwork_applications add column if not exists risks jsonb default '[]'::jsonb;
alter table upwork_applications add column if not exists status text default 'draft';
alter table upwork_applications add column if not exists created_at timestamptz default now();
alter table upwork_applications add column if not exists updated_at timestamptz default now();

create index if not exists ua_job_idx on upwork_applications (job_id);
create index if not exists ua_org_time_idx on upwork_applications (organization_id, created_at desc);

alter table upwork_applications enable row level security;
drop policy if exists "ua_select" on upwork_applications;
create policy "ua_select" on upwork_applications for select using (organization_id = current_org_id());
drop policy if exists "ua_insert" on upwork_applications;
create policy "ua_insert" on upwork_applications for insert with check (organization_id = current_org_id());

-- ============================================================================
-- Lead Referrals
-- ============================================================================

-- Add referral columns to existing leads table
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'leads' and column_name = 'referred_by_rep_id') then
    alter table leads add column referred_by_rep_id uuid references reps(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'leads' and column_name = 'referred_to_rep_id') then
    alter table leads add column referred_to_rep_id uuid references reps(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'leads' and column_name = 'referred_by_profile_id') then
    alter table leads add column referred_by_profile_id uuid references profiles(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'leads' and column_name = 'referral_reason') then
    alter table leads add column referral_reason text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'leads' and column_name = 'referral_at') then
    alter table leads add column referral_at timestamptz;
  end if;
end $$;

create index if not exists leads_referred_to_idx on leads (referred_to_rep_id) where referred_to_rep_id is not null;

-- ════════════════════════════════════════════════════════════════════
-- 20261006000000_score_observability.sql
-- ════════════════════════════════════════════════════════════════════
-- 20261006000000: Score observability + data cleanup
--
-- 1. Add observability columns for full score traceability
-- 2. Fix existing data where canonical scores were stored in the legacy score column

-- Observability columns
alter table leads add column if not exists decision_provider text;
alter table leads add column if not exists decision_model text;
alter table leads add column if not exists decision_run_id text;
alter table leads add column if not exists selected_episode_id text;
alter table leads add column if not exists profile_match_score integer check (profile_match_score between 0 and 100);
alter table leads add column if not exists profile_match_version text;
alter table leads add column if not exists best_profile_id uuid references profiles(id);
alter table leads add column if not exists best_profile_match_score integer check (best_profile_match_score between 0 and 100);
alter table leads add column if not exists intelligence_input_hash text;
alter table leads add column if not exists v3_reuse_key text;
alter table leads add column if not exists fallback_reason text;

-- Fix existing data: score column must hold legacy 0-12 only.
--
-- Case 1: score > 12 AND canonical_score IS NULL
--   → canonical value was stored in score column only. Move it.
update leads
set canonical_score = score,
    score = null,
    score_version = 'relay_decision_v3.0.0',
    scored_at = coalesce(scored_at, now())
where score > 12
  and canonical_score is null;

-- Case 2: score > 12 AND canonical_score = score (same value in both columns)
--   → canonical was duplicated into score column. Clear score (canonical_score is authority).
update leads
set score = null
where score > 12
  and canonical_score is not null
  and canonical_score = score;

-- Case 3: score > 12 AND canonical_score IS NOT NULL AND canonical_score != score
--   → conflicting values. Keep canonical_score (authority), clear score.
--   This should not happen, but if it does, canonical wins.
update leads
set score = null
where score > 12
  and canonical_score is not null
  and canonical_score != score;

-- Indexes for deterministic reuse lookups
create index if not exists idx_leads_intelligence_input_hash
  on leads(intelligence_input_hash)
  where intelligence_input_hash is not null;

create index if not exists idx_leads_v3_reuse_key
  on leads(v3_reuse_key)
  where v3_reuse_key is not null;

-- ── 20261006000001_verify_score_migration.sql: skipped (assertions only; moved to check.sql)

-- ════════════════════════════════════════════════════════════════════
-- 20261006000002_new_trend_sources.sql
-- ════════════════════════════════════════════════════════════════════
-- Add new trend source types (reddit, lobsters, producthunt) to check constraint
do $$
begin
  alter table trend_sources drop constraint if exists trend_sources_source_type_check;
  alter table trend_sources add constraint trend_sources_source_type_check
    check (source_type in ('hackernews', 'devto', 'github', 'reddit', 'lobsters', 'producthunt', 'stackoverflow', 'rss', 'arxiv', 'newsapi'));
end$$;

-- Register new trend source adapters
insert into trend_sources (source_key, source_type, display_name, base_url, fetch_interval_minutes) values
  ('reddit-programming', 'reddit', 'Reddit r/programming+ML+DevOps', 'https://reddit.com', 120),
  ('reddit-technews', 'reddit', 'Reddit r/technology+Futurology', 'https://reddit.com', 120),
  ('lobsters-hot', 'lobsters', 'Lobste.rs Hot', 'https://lobste.rs', 180),
  ('lobsters-newest', 'lobsters', 'Lobste.rs Newest', 'https://lobste.rs', 180),
  ('producthunt-today', 'producthunt', 'Product Hunt Today', 'https://producthunt.com', 360)
on conflict (source_key) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- 20261007000000_fix_onboarding_rls.sql
-- ════════════════════════════════════════════════════════════════════
-- Fix content_personas RLS: allow insert if rep_id matches auth user and org is set
-- The issue is current_org_id() may not be available during onboarding

drop policy if exists content_personas_insert on content_personas;
create policy content_personas_insert on content_personas for insert
  to authenticated with check (
    rep_id = auth.uid()
    and organization_id is not null
  );

-- Also fix content_profiles RLS
drop policy if exists content_profiles_insert on content_profiles;
create policy content_profiles_insert on content_profiles for insert
  to authenticated with check (
    organization_id in (select organization_id from content_personas where id = content_profiles.persona_id)
  );

-- Fix daily_content_briefs RLS
drop policy if exists daily_content_briefs_insert on daily_content_briefs;
create policy daily_content_briefs_insert on daily_content_briefs for insert
  to authenticated with check (
    organization_id in (select organization_id from content_personas where id = daily_content_briefs.persona_id)
  );

-- Fix daily_content_ideas RLS
drop policy if exists daily_content_ideas_insert on daily_content_ideas;
create policy daily_content_ideas_insert on daily_content_ideas for insert
  to authenticated with check (
    organization_id in (select organization_id from content_personas where id = daily_content_ideas.persona_id)
  );

-- ════════════════════════════════════════════════════════════════════
-- 20261008000000_action_ledger_fix_check.sql
-- ════════════════════════════════════════════════════════════════════
-- Fix: REPLY_SENT and LEAD_ARCHIVED were emitted by code but missing from CHECK constraint
-- causing silent insert failures for outbound replies and auto-archivals.

alter table action_events
  drop constraint if exists action_events_action_type_check;

alter table action_events
  add constraint action_events_action_type_check
  check (action_type in (
    'LEAD_EXTRACTED',
    'CONNECTION_PREPARED',
    'CONNECTION_SENT',
    'DM_PREPARED',
    'DM_SENT',
    'FOLLOWUP_SENT',
    'REPLY_SENT',
    'REPLY_RECEIVED',
    'LEAD_REFERRED',
    'PROFILE_RECOMMENDED',
    'UPWORK_JOB_EXTRACTED',
    'UPWORK_PROPOSAL_PREPARED',
    'UPWORK_APPLIED',
    'OPPORTUNITY_CREATED',
    'CLIENT_WON',
    'LEAD_ARCHIVED'
  ));

-- ════════════════════════════════════════════════════════════════════
-- 20261008000000_action_ledger_idempotency.sql
-- ════════════════════════════════════════════════════════════════════
-- =============================================================================
-- ACTION LEDGER IDEMPOTENCY — One business action = one canonical event
-- =============================================================================

-- Add idempotency key column with unique constraint
alter table action_events
  add column if not exists idempotency_key text;

-- Unique constraint: one idempotency_key = one event
create unique index if not exists action_events_idempotency_key_uniq
  on action_events (organization_id, idempotency_key)
  where idempotency_key is not null;

-- Backfill: generate idempotency keys for existing events based on stable fields
-- This prevents duplicates when the same event is re-emitted
with keyed as (
  select id, organization_id,
    concat(organization_id::text, ':', action_type, ':', coalesce(lead_id::text, job_id::text, 'none'), ':',
           coalesce(message_id::text, 'none'), ':', coalesce(metadata->>'event', 'none')) as k
  from action_events
  where idempotency_key is null
), ranked as (
  select keyed.*, row_number() over (partition by organization_id, k order by id) as rn from keyed
)
update action_events ae
set idempotency_key = case
  when r.rn = 1 and not exists (
    select 1 from action_events x where x.organization_id = ae.organization_id and x.idempotency_key = r.k
  ) then r.k
  else r.k || ':' || ae.id::text
end
from ranked r
where ae.id = r.id;

-- ════════════════════════════════════════════════════════════════════
-- 20261008000000_studio_v3_visual_director_enhancement.sql
-- ════════════════════════════════════════════════════════════════════
-- Studio V3: Enhanced Visual Director
-- Adds richer creative direction fields to daily_content_ideas

alter table daily_content_ideas
  add column if not exists visual_communication_goal text,
  add column if not exists visual_subject text,
  add column if not exists visual_scene text,
  add column if not exists visual_lighting text,
  add column if not exists visual_palette text,
  add column if not exists visual_mood text,
  add column if not exists visual_style text,
  add column if not exists visual_avoid text;

comment on column daily_content_ideas.visual_communication_goal is 'What the viewer understands in 3 seconds';
comment on column daily_content_ideas.visual_subject is 'The literal thing shown in the visual';
comment on column daily_content_ideas.visual_scene is 'Environment/setting description';
comment on column daily_content_ideas.visual_lighting is 'Type and quality of light';
comment on column daily_content_ideas.visual_palette is 'Specific color palette';
comment on column daily_content_ideas.visual_mood is 'Feeling/tone of the visual';
comment on column daily_content_ideas.visual_style is 'Medium style: editorial, isometric, flat vector, etc';
comment on column daily_content_ideas.visual_avoid is 'Comma-separated list of visual clichés to avoid';

-- ════════════════════════════════════════════════════════════════════
-- 20261009000000_semantic_content_memory.sql
-- ════════════════════════════════════════════════════════════════════
-- Semantic Content Memory — pgvector embeddings for anti-repetition
-- User priority #1: prevent Studio from becoming repetitive after 30-60 days

-- 1. Ensure pgvector extension (idempotent)
create extension if not exists vector;

-- 2. Add embedding column to content_memories
alter table content_memories
  add column if not exists embedding vector(384),
  add column if not exists content_fingerprint text;

comment on column content_memories.embedding is '384-dim embedding of topic+angle+hook for semantic dedup';
comment on column content_memories.content_fingerprint is 'Content hash for exact dedup guard';

-- 3. HNSW index for fast cosine similarity search
create index if not exists content_memories_embedding_idx
  on content_memories
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- 4. Index for persona-scoped lookups
create index if not exists content_memories_persona_type_idx
  on content_memories (persona_id, memory_type, created_at desc);

-- 5. Semantic match function (mirrors match_proofs_by_embedding)
create or replace function match_memories_by_embedding(
  query_embedding vector(384),
  match_persona_id uuid,
  match_threshold float default 0.75,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  memory_type text,
  similarity float,
  created_at timestamptz
)
language sql
security invoker
set search_path = public, extensions
as $$
  select
    m.id,
    m.content,
    m.memory_type,
    1 - (m.embedding <=> query_embedding) as similarity,
    m.created_at
  from content_memories m
  where m.persona_id = match_persona_id
    and m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) >= match_threshold
  order by m.embedding <=> query_embedding
  limit match_count
$$;

comment on function match_memories_by_embedding is 'Find semantically similar content memories for anti-repetition';

-- ════════════════════════════════════════════════════════════════════
-- 20261009000001_fix_content_rls.sql
-- ════════════════════════════════════════════════════════════════════
-- Fix: content_personas RLS used auth.uid() instead of current_rep_id()
-- This caused "new row violates row-level security policy" on persona creation

DROP POLICY IF EXISTS "content_personas_owner" ON content_personas;
CREATE POLICY "content_personas_owner" ON content_personas
  FOR ALL USING (
    rep_id = current_rep_id()
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  )
  WITH CHECK (
    rep_id = current_rep_id()
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

-- Fix related tables that also use the wrong pattern
DROP POLICY IF EXISTS "content_pillars_owner" ON content_pillars;
CREATE POLICY "content_pillars_owner" ON content_pillars
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "content_profiles_owner" ON content_profiles;
CREATE POLICY "content_profiles_owner" ON content_profiles
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "content_taste_profiles_owner" ON content_taste_profiles;
CREATE POLICY "content_taste_profiles_owner" ON content_taste_profiles
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "content_journey_owner" ON content_journey;
CREATE POLICY "content_journey_owner" ON content_journey
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "content_memories_owner" ON content_memories;
CREATE POLICY "content_memories_owner" ON content_memories
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "content_quick_captures_owner" ON content_quick_captures;
CREATE POLICY "content_quick_captures_owner" ON content_quick_captures
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "content_opportunities_owner" ON content_opportunities;
CREATE POLICY "content_opportunities_owner" ON content_opportunities
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "topic_clusters_owner" ON topic_clusters;
CREATE POLICY "topic_clusters_owner" ON topic_clusters
  FOR ALL USING (
    persona_id IN (SELECT id FROM content_personas WHERE rep_id = current_rep_id())
    OR auth.uid() IN (SELECT id FROM reps WHERE role = 'admin')
  );

-- ════════════════════════════════════════════════════════════════════
-- 20261009000001_upwork_extraction_enhancements.sql
-- ════════════════════════════════════════════════════════════════════
-- Upwork extraction enhancements: add structured fields for screening questions,
-- application requirements, engagement details, and experience level.

alter table upwork_jobs add column if not exists screening_questions text[] default '{}';
alter table upwork_jobs add column if not exists application_requirements text[] default '{}';
alter table upwork_jobs add column if not exists engagement_type text;
alter table upwork_jobs add column if not exists weekly_hours text;
alter table upwork_jobs add column if not exists duration text;
alter table upwork_jobs add column if not exists experience_level text;

-- ════════════════════════════════════════════════════════════════════
-- 20261009000002_studio_v3_quality_columns.sql
-- ════════════════════════════════════════════════════════════════════
-- Studio V3: Quality scoring + visual direction columns

ALTER TABLE daily_content_ideas
  ADD COLUMN IF NOT EXISTS quality_result jsonb,
  ADD COLUMN IF NOT EXISTS visual_realism text;

comment on column daily_content_ideas.quality_result is 'Post quality scoring result (overall, dimensions, failures)';
comment on column daily_content_ideas.visual_realism is 'Visual realism level (photorealistic, stylized, editorial)';

-- ════════════════════════════════════════════════════════════════════
-- 20261016000000_newsapi_trend_sources.sql
-- ════════════════════════════════════════════════════════════════════
-- NewsAPI trend source adapter registration
-- Self-contained: works whether trend_sources already exists or not

-- Step 1: Create table if it doesn't exist (fresh database)
create table if not exists trend_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_type text not null check (source_type in ('hackernews', 'devto', 'github', 'reddit', 'lobsters', 'producthunt', 'stackoverflow', 'rss', 'arxiv', 'newsapi')),
  display_name text not null,
  base_url text,
  enabled boolean not null default true,
  fetch_interval_minutes integer not null default 60,
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  rate_limit_remaining integer,
  rate_limit_reset_at timestamptz,
  config jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing table with an older shape: add any missing columns.
alter table trend_sources add column if not exists source_key text;
alter table trend_sources add column if not exists source_type text;
alter table trend_sources add column if not exists display_name text;
alter table trend_sources add column if not exists base_url text;
alter table trend_sources add column if not exists enabled boolean default true;
alter table trend_sources add column if not exists fetch_interval_minutes integer default 60;
alter table trend_sources add column if not exists last_fetched_at timestamptz;
alter table trend_sources add column if not exists last_success_at timestamptz;
alter table trend_sources add column if not exists last_error text;
alter table trend_sources add column if not exists consecutive_failures integer default 0;
alter table trend_sources add column if not exists rate_limit_remaining integer;
alter table trend_sources add column if not exists rate_limit_reset_at timestamptz;
alter table trend_sources add column if not exists config jsonb default '{}'::jsonb;
alter table trend_sources add column if not exists created_at timestamptz default now();
alter table trend_sources add column if not exists updated_at timestamptz default now();

-- Step 2: Update check constraint if table already existed with old constraint
do $$
begin
  if exists (select 1 from information_schema.table_constraints where table_name = 'trend_sources' and constraint_name = 'trend_sources_source_type_check') then
    alter table trend_sources drop constraint trend_sources_source_type_check;
  end if;
  alter table trend_sources add constraint trend_sources_source_type_check
    check (source_type in ('hackernews', 'devto', 'github', 'reddit', 'lobsters', 'producthunt', 'stackoverflow', 'rss', 'arxiv', 'newsapi'));
exception when others then
  -- Constraint may already exist with correct definition; ignore
  null;
end$$;

-- Step 3: Register NewsAPI adapters (free tier: 1000 req/day)
insert into trend_sources (source_key, source_type, display_name, base_url, fetch_interval_minutes) values
  ('newsapi-technology', 'newsapi', 'NewsAPI Technology', 'https://newsapi.org', 180),
  ('newsapi-business', 'newsapi', 'NewsAPI Business', 'https://newsapi.org', 240)
on conflict (source_key) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- 20261016000001_one_connection_per_lead.sql
-- ════════════════════════════════════════════════════════════════════
-- A lead has one logged connection request. A second "Sent Connection"
-- while the first is still pending is the same event.
delete from messages newer
using messages earlier
where newer.type = 'connection'
  and earlier.type = 'connection'
  and newer.lead_id = earlier.lead_id
  and newer.id <> earlier.id
  and (
    newer.sent_at > earlier.sent_at
    or (newer.sent_at is not distinct from earlier.sent_at and newer.created_at > earlier.created_at)
    or (newer.sent_at is null and earlier.sent_at is not null)
  );

create unique index if not exists messages_one_connection_per_lead
  on messages (lead_id)
  where type = 'connection';

-- ════════════════════════════════════════════════════════════════════
-- 20261017000000_conversation_memory.sql
-- ════════════════════════════════════════════════════════════════════
-- Conversation layer: per-lead rolling memory (summary + deal facts) and the
-- rep's unsent composer draft. Both live on the existing one-row-per-lead
-- conversation_states table, so no new RLS surface is introduced.
alter table conversation_states
  add column if not exists memory jsonb,
  add column if not exists composer_draft jsonb;

comment on column conversation_states.memory is
  'Rolling conversation memory: summary of turns outside the verbatim window, deal facts, deal stage, latest client-turn analysis.';
comment on column conversation_states.composer_draft is
  'Unsent draft in the lead conversation composer: text, original AI text (for edit learning), rationale.';

-- Inbound email replies were inserted without a direction and defaulted to
-- outbound. Repair existing rows written by the email webhook.
update messages
set direction = 'inbound'
where model_used = 'email_webhook'
  and type = 'reply'
  and direction = 'outbound';

-- ════════════════════════════════════════════════════════════════════
-- 20261019000000_performance_config.sql
-- ════════════════════════════════════════════════════════════════════
-- Weighted Action Performance System — configuration storage
-- Adds performance_weights and sla_config to organization_rulebooks.

alter table organization_rulebooks
  add column if not exists performance_weights jsonb not null default '{
    "CONNECTION_SENT": 1.0,
    "FIRST_DM_SENT": 1.5,
    "FOLLOWUP_SENT": 1.3,
    "REPLY_SENT": 2.0,
    "MEETING_BOOKED": 4.0,
    "LEAD_WON": 8.0,
    "UPWORK_APPLIED": 1.2,
    "UPWORK_REPLY": 2.0,
    "UPWORK_INTERVIEW": 4.0,
    "UPWORK_WON": 8.0
  }'::jsonb;

alter table organization_rulebooks
  add column if not exists sla_config jsonb not null default '{
    "replyUrgentMs": 7200000,
    "replyOverdueMs": 14400000,
    "followupOverdueMs": 86400000,
    "connectionDmWaitingMs": 43200000,
    "capRatio": 1.25,
    "funnelBalanceThreshold": 0.4
  }'::jsonb;

-- Seed existing bpulse org with defaults
update organization_rulebooks
set performance_weights = '{
  "CONNECTION_SENT": 1.0,
  "FIRST_DM_SENT": 1.5,
  "FOLLOWUP_SENT": 1.3,
  "REPLY_SENT": 2.0,
  "MEETING_BOOKED": 4.0,
  "LEAD_WON": 8.0,
  "UPWORK_APPLIED": 1.2,
  "UPWORK_REPLY": 2.0,
  "UPWORK_INTERVIEW": 4.0,
  "UPWORK_WON": 8.0
}'::jsonb
where organization_id = '11111111-1111-1111-1111-111111111111'
  and performance_weights = '{
    "CONNECTION_SENT": 1.0,
    "FIRST_DM_SENT": 1.5,
    "FOLLOWUP_SENT": 1.3,
    "REPLY_SENT": 2.0,
    "MEETING_BOOKED": 4.0,
    "LEAD_WON": 8.0,
    "UPWORK_APPLIED": 1.2,
    "UPWORK_REPLY": 2.0,
    "UPWORK_INTERVIEW": 4.0,
    "UPWORK_WON": 8.0
  }'::jsonb;

-- ════════════════════════════════════════════════════════════════════
-- 20261019000001_signal_events.sql
-- ════════════════════════════════════════════════════════════════════
-- Signal Events table — stores verified signal changes for queryable history
-- Referenced by: src/app/api/leads/signal-watch/route.ts, src/lib/relay/signal-events-store.ts

CREATE TABLE IF NOT EXISTS public.signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'notable', 'urgent')),
  previous_value text,
  new_value text,
  evidence text,
  confidence double precision DEFAULT 0.5,
  source text DEFAULT 'v3_intelligence',
  verified boolean DEFAULT true,
  actor text,
  organization text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Existing table with an older shape: add any missing columns.
alter table public.signal_events add column if not exists organization_id uuid;
alter table public.signal_events add column if not exists lead_id uuid;
alter table public.signal_events add column if not exists signal_type text;
alter table public.signal_events add column if not exists severity text default 'info';
alter table public.signal_events add column if not exists previous_value text;
alter table public.signal_events add column if not exists new_value text;
alter table public.signal_events add column if not exists evidence text;
alter table public.signal_events add column if not exists confidence double precision default 0.5;
alter table public.signal_events add column if not exists source text default 'v3_intelligence';
alter table public.signal_events add column if not exists verified boolean default true;
alter table public.signal_events add column if not exists actor text;
alter table public.signal_events add column if not exists organization text;
alter table public.signal_events add column if not exists detected_at timestamptz default now();
alter table public.signal_events add column if not exists created_at timestamptz default now();

CREATE INDEX IF NOT EXISTS idx_signal_events_lead_id ON public.signal_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_signal_events_org_id ON public.signal_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_signal_events_detected_at ON public.signal_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_events_type ON public.signal_events(signal_type);

ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signal events readable by org members" ON public.signal_events;
CREATE POLICY "Signal events readable by org members" ON public.signal_events
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.reps WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Signal events insertable by service role" ON public.signal_events;
CREATE POLICY "Signal events insertable by service role" ON public.signal_events
  FOR INSERT WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════
-- 20261019000002_performance_config.sql
-- ════════════════════════════════════════════════════════════════════
-- Performance Config table — stores per-org performance tracking configuration
-- Referenced by: src/app/api/admin/performance/config/route.ts

CREATE TABLE IF NOT EXISTS public.performance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tracking_enabled boolean DEFAULT true,
  workdays text[] DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  timezone text DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing table with an older shape: add any missing columns.
alter table public.performance_config add column if not exists organization_id uuid;
alter table public.performance_config add column if not exists tracking_enabled boolean default true;
alter table public.performance_config add column if not exists workdays text[] default ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
alter table public.performance_config add column if not exists timezone text default 'UTC';
alter table public.performance_config add column if not exists created_at timestamptz default now();
alter table public.performance_config add column if not exists updated_at timestamptz default now();

CREATE INDEX IF NOT EXISTS idx_performance_config_org_id ON public.performance_config(organization_id);

ALTER TABLE public.performance_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Performance config readable by org admins" ON public.performance_config;
CREATE POLICY "Performance config readable by org admins" ON public.performance_config
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.reps
      WHERE auth_user_id = auth.uid() AND (role = 'admin' OR role = 'owner')
    )
  );

DROP POLICY IF EXISTS "Performance config writable by org admins" ON public.performance_config;
CREATE POLICY "Performance config writable by org admins" ON public.performance_config
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.reps
      WHERE auth_user_id = auth.uid() AND (role = 'admin' OR role = 'owner')
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 20261019000003_help_requests.sql
-- ════════════════════════════════════════════════════════════════════
-- Team Help Workflow — collaboration requests between reps on a lead.
--
-- Status state machine: IDLE (not stored) → HELP_REQUESTED → HELP_ACCEPTED → HELP_COMPLETED
-- Rows are only created when a request is made. Completed rows persist for audit.

create table if not exists help_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null references leads(id) on delete cascade,
  from_rep_id uuid not null references reps(id),
  to_rep_id uuid not null references reps(id),
  help_type text not null check (help_type in (
    'TECHNICAL_PROOF', 'BETTER_SENDER', 'MESSAGE_REVIEW', 'PRICING_GUIDANCE', 'CLOSING_HELP'
  )),
  status text not null default 'HELP_REQUESTED'
    check (status in ('HELP_REQUESTED', 'HELP_ACCEPTED', 'HELP_COMPLETED')),
  reason text not null,
  context jsonb not null default '{}'::jsonb,
  resolution text,
  created_at timestamptz default now(),
  responded_at timestamptz,
  completed_at timestamptz
);
-- Existing table with an older shape: add any missing columns.
alter table help_requests add column if not exists org_id uuid;
alter table help_requests add column if not exists lead_id uuid;
alter table help_requests add column if not exists from_rep_id uuid;
alter table help_requests add column if not exists to_rep_id uuid;
alter table help_requests add column if not exists help_type text;
alter table help_requests add column if not exists status text default 'HELP_REQUESTED';
alter table help_requests add column if not exists reason text;
alter table help_requests add column if not exists context jsonb default '{}'::jsonb;
alter table help_requests add column if not exists resolution text;
alter table help_requests add column if not exists created_at timestamptz default now();
alter table help_requests add column if not exists responded_at timestamptz;
alter table help_requests add column if not exists completed_at timestamptz;

create index if not exists help_requests_lead_idx on help_requests (lead_id);
create index if not exists help_requests_to_rep_idx on help_requests (to_rep_id) where status = 'HELP_REQUESTED';
create index if not exists help_requests_from_rep_idx on help_requests (from_rep_id);
create index if not exists help_requests_org_status_idx on help_requests (org_id, status);

-- RLS: org members can read requests they're part of
alter table help_requests enable row level security;

drop policy if exists help_requests_select on help_requests;
create policy help_requests_select on help_requests for select
  to authenticated using (
    exists (
      select 1 from reps r
      where r.auth_user_id = auth.uid()
      and r.organization_id = help_requests.org_id
    )
  );

drop policy if exists help_requests_insert on help_requests;
create policy help_requests_insert on help_requests for insert
  to authenticated with check (
    from_rep_id = current_rep_id()
    and exists (
      select 1 from reps r
      where r.auth_user_id = auth.uid()
      and r.organization_id = help_requests.org_id
    )
  );

drop policy if exists help_requests_update on help_requests;
create policy help_requests_update on help_requests for update
  to authenticated using (
    to_rep_id = current_rep_id()
    or from_rep_id = current_rep_id()
  )
  with check (
    to_rep_id = current_rep_id()
    or from_rep_id = current_rep_id()
  );

-- ════════════════════════════════════════════════════════════════════
-- 20261019000003_org_settings.sql
-- ════════════════════════════════════════════════════════════════════
-- Organization settings: daily send ceilings and other per-org config.
-- Allows admins to customize daily limits without env var changes.

alter table organizations
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Add comment
comment on column organizations.settings is 'Per-org configuration: dailyConnectionLimit, dailySendLimit, feature flags, etc.';

-- Function to get org-specific daily connection limit
create or replace function get_org_connection_limit(org_id uuid)
returns integer as $$
  declare
    org_limit integer;
    default_limit integer;
  begin
    default_limit := greatest(1, least(200, coalesce(current_setting('scout.daily_connection_limit', true)::integer, 20)));

    select (settings->>'dailyConnectionLimit')::integer
    into org_limit
    from organizations
    where id = org_id;

    return coalesce(org_limit, default_limit);
  end;
$$ language plpgsql stable;

-- Function to get org-specific daily send limit (dm/followup/reply)
create or replace function get_org_send_limit(org_id uuid)
returns integer as $$
  declare
    org_limit integer;
    default_limit integer;
  begin
    default_limit := greatest(1, least(200, coalesce(current_setting('scout.daily_send_limit', true)::integer, 15)));

    select (settings->>'dailySendLimit')::integer
    into org_limit
    from organizations
    where id = org_id;

    return coalesce(org_limit, default_limit);
  end;
$$ language plpgsql stable;

-- Tell PostgREST about new columns/tables right away (otherwise ~1 min lag).
notify pgrst, 'reload schema';

commit;
