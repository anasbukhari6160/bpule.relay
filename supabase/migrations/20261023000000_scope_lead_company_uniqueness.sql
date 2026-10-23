-- Scope active lead company uniqueness to an organization.
--
-- Preflight is intentionally fail-closed: if an organization already has
-- duplicate non-dead company keys, the migration aborts before replacing the
-- existing global index. Resolve those rows explicitly, then rerun.
-- Deployment note: SHARE ROW EXCLUSIVE blocks concurrent lead writes while
-- the preflight and index replacement run. Aneeb should schedule/monitor this
-- migration during an appropriate deployment window; it is not applied here.
begin;

-- Prevent a concurrent insert from racing the preflight/index replacement.
lock table public.leads in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.leads
    where status != 'dead' and coalesce(archived, false) = false
    group by organization_id, company_key
    having count(*) > 1
  ) then
    raise exception 'Cannot scope leads_company_key_unique: duplicate active company keys exist within an organization';
  end if;
end
$$;

drop index if exists public.leads_company_key_unique;

create unique index leads_company_key_unique
  on public.leads (organization_id, company_key)
  where status != 'dead' and coalesce(archived, false) = false;

commit;

-- Verification after apply:
-- select indexdef
-- from pg_indexes
-- where schemaname = 'public' and indexname = 'leads_company_key_unique';
-- Expected key columns: (organization_id, company_key), predicate status <> 'dead'
-- and archived rows excluded.
--
-- Rollback (only if the database is intentionally returning to global tenancy):
-- First verify that no active company key now exists in multiple organizations:
-- select company_key, count(*) from public.leads
-- where status != 'dead' group by company_key having count(*) > 1;
-- Reconcile any returned rows before recreating the global index, or rollback
-- will fail and global uniqueness would again block valid cross-tenant data.
-- drop index if exists public.leads_company_key_unique;
-- create unique index leads_company_key_unique
--   on public.leads (company_key) where status != 'dead';
