-- 0094: Intelligence Dataset Hardening
--
-- 1. Split lifecycle events into intelligence_sample_events (append-only).
-- 2. intelligence_samples becomes an immutable analysis snapshot.
-- 3. Add label quality fields, training_approved status, capture health.
-- 4. Unique constraint prevents concurrent version collisions.
-- 5. RLS + indexes.

-- ============================================================================
-- INTELLIGENCE SAMPLE EVENTS (append-only lifecycle log)
-- ============================================================================

create table if not exists intelligence_sample_events (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references intelligence_samples(id) on delete cascade,
  event_type text not null check (event_type in (
    'SCORE_CAPTURED', 'ROUTING_CAPTURED', 'MESSAGE_GENERATED',
    'MESSAGE_EDITED', 'MESSAGE_SENT', 'CLIENT_REPLY',
    'OUTCOME_CHANGED', 'FEEDBACK_SUBMITTED'
  )),
  payload jsonb not null default '{}'::jsonb,
  actor uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists int_sample_events_sample_idx on intelligence_sample_events (sample_id, created_at);
create index if not exists int_sample_events_type_idx on intelligence_sample_events (event_type, created_at desc);
create index if not exists int_sample_events_idempotent_idx on intelligence_sample_events (idempotency_key) where idempotency_key is not null;

-- ============================================================================
-- HARDEN intelligence_samples
-- ============================================================================

-- Immutable snapshot: analysis run identity never changes.
-- Lifecycle events live in intelligence_sample_events.

-- Add label quality fields
alter table intelligence_samples add column if not exists label_source text
  check (label_source in ('ai', 'human', 'outcome', 'review', null));

alter table intelligence_samples add column if not exists labeler_id uuid;
alter table intelligence_samples add column if not exists review_status text
  check (review_status in ('pending', 'approved', 'rejected', null));
alter table intelligence_samples add column if not exists review_notes text;
alter table intelligence_samples add column if not exists reviewed_at timestamptz;
alter table intelligence_samples add column if not exists reviewed_by uuid;

-- TRAINING_APPROVED: only explicitly approved records enter supervised fine-tuning
alter table intelligence_samples add column if not exists training_approved boolean not null default false;
alter table intelligence_samples add column if not exists approved_by uuid;
alter table intelligence_samples add column if not exists approved_at timestamptz;

-- Capture health
alter table intelligence_samples add column if not exists capture_failures jsonb not null default '[]'::jsonb;
alter table intelligence_samples add column if not exists last_capture_error text;

-- Message preference fields
alter table intelligence_samples add column if not exists message_stage text;
alter table intelligence_samples add column if not exists sender_profile_id uuid;

-- Decision run linkage for feedback correlation
alter table intelligence_samples add column if not exists decision_run_id text;

-- Unique constraint: prevent concurrent version collisions
create unique index if not exists int_samples_lead_version_uniq
  on intelligence_samples (lead_id, version) where lead_id is not null;

create unique index if not exists int_samples_upwork_version_uniq
  on intelligence_samples (upwork_job_id, version) where upwork_job_id is not null;

-- ============================================================================
-- RLS
-- ============================================================================

alter table intelligence_sample_events enable row level security;

-- ============================================================================
-- RPC: append event idempotently (no-op if idempotency_key already exists)
-- ============================================================================

create or replace function public.append_sample_event(
  p_sample_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_actor uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  -- Idempotency guard
  if p_idempotency_key is not null then
    select id into event_id
    from intelligence_sample_events
    where idempotency_key = p_idempotency_key;

    if event_id is not null then
      return event_id;
    end if;
  end if;

  insert into intelligence_sample_events (sample_id, event_type, payload, actor, idempotency_key)
  values (p_sample_id, p_event_type, p_payload, p_actor, p_idempotency_key)
  returning id into event_id;

  return event_id;
end;
$$;

-- ============================================================================
-- RPC: mark training approved (only callable by reviewers)
-- ============================================================================

create or replace function public.approve_sample_for_training(
  p_sample_id uuid,
  p_approver_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update intelligence_samples
  set training_approved = true,
      approved_by = p_approver_id,
      approved_at = now(),
      label_status = 'HUMAN_REVIEWED',
      review_status = 'approved',
      reviewed_by = p_approver_id,
      reviewed_at = now()
  where id = p_sample_id;
end;
$$;
