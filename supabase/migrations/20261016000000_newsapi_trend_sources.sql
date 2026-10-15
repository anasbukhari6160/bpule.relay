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
