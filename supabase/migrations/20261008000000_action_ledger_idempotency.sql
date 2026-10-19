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
update action_events
  set idempotency_key = concat(
  organization_id::text, ':',
  action_type, ':',
  coalesce(lead_id::text, job_id::text, 'none'), ':',
  coalesce(message_id::text, 'none'), ':',
  coalesce(metadata->>'event', 'none')
)
where idempotency_key is null;
