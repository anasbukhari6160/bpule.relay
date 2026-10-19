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
