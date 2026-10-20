-- Dataset governance hardening (end-to-end audit, 2026-10-22).
--
-- 1. intelligence_samples / intelligence_sample_events RLS compared reps.id
--    to auth.uid(). Everywhere else the app maps auth.uid() through
--    reps.auth_user_id, so every user-session read was denied and the
--    status / inbound hooks failed silently. Policies now use the same
--    current_org_id() helper as the rest of the schema.
-- 2. label_status gains TRAINING_APPROVED (explicit review, never automatic);
--    event_type gains LABEL_APPROVED.
-- 3. The idempotency index becomes unique so a retried capture can never
--    append the same event twice.
-- 4. raw_input_hash is documented as SHA-256 of the normalised source. Rows
--    written before this migration hold a legacy "length:prefix" value; the
--    team re-hashes them with scripts/scoring/rehash-samples.ts (it must read
--    the source text, so it is not done here).

-- ── RLS: same tenant boundary as every other table ─────────────────────────

drop policy if exists "int_samples_org_read" on intelligence_samples;
drop policy if exists "int_samples_org_insert" on intelligence_samples;
drop policy if exists "int_samples_org_update" on intelligence_samples;
drop policy if exists "int_events_org_read" on intelligence_sample_events;
drop policy if exists "int_events_org_insert" on intelligence_sample_events;

create policy int_samples_org_read on intelligence_samples for select
  to authenticated using (organization_id = current_org_id());
create policy int_samples_org_insert on intelligence_samples for insert
  to authenticated with check (organization_id = current_org_id());
create policy int_samples_org_update on intelligence_samples for update
  to authenticated using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy int_events_org_read on intelligence_sample_events for select
  to authenticated using (sample_id in (select id from intelligence_samples where organization_id = current_org_id()));
create policy int_events_org_insert on intelligence_sample_events for insert
  to authenticated with check (sample_id in (select id from intelligence_samples where organization_id = current_org_id()));

-- ── Label states and event types ───────────────────────────────────────────

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'intelligence_samples'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%label_status%'
  loop
    execute format('alter table intelligence_samples drop constraint %I', c.conname);
  end loop;
  for c in
    select conname from pg_constraint
    where conrelid = 'intelligence_sample_events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format('alter table intelligence_sample_events drop constraint %I', c.conname);
  end loop;
end $$;

alter table intelligence_samples
  add constraint intelligence_samples_label_status_check
  check (label_status in ('UNLABELED', 'AI_ONLY', 'HUMAN_REVIEWED', 'HUMAN_CORRECTED', 'OUTCOME_VERIFIED', 'TRAINING_APPROVED'));

alter table intelligence_sample_events
  add constraint intelligence_sample_events_event_type_check
  check (event_type in (
    'SCORE_CAPTURED', 'ROUTING_CAPTURED', 'MESSAGE_GENERATED', 'MESSAGE_EDITED', 'MESSAGE_SENT',
    'CLIENT_REPLY', 'OUTCOME_CHANGED', 'FEEDBACK_SUBMITTED', 'LABEL_APPROVED'
  ));

-- ── Idempotency: unique, so a retry is a no-op at the database ─────────────

-- Remove any duplicates the non-unique index allowed, keeping the earliest.
delete from intelligence_sample_events e
using intelligence_sample_events d
where e.idempotency_key is not null
  and e.idempotency_key = d.idempotency_key
  and e.sample_id = d.sample_id
  and e.created_at > d.created_at;

drop index if exists int_sample_events_idem_idx;
create unique index if not exists int_sample_events_idem_uniq
  on intelligence_sample_events (sample_id, idempotency_key) where idempotency_key is not null;

comment on column intelligence_samples.raw_input_hash is 'SHA-256 (hex) of the whitespace-normalised source; equals the scoring program opportunityKey. Legacy rows may still hold "length:prefix" until re-hashed.';
