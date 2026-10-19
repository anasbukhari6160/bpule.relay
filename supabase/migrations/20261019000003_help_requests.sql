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

create index help_requests_lead_idx on help_requests (lead_id);
create index help_requests_to_rep_idx on help_requests (to_rep_id) where status = 'HELP_REQUESTED';
create index help_requests_from_rep_idx on help_requests (from_rep_id);
create index help_requests_org_status_idx on help_requests (org_id, status);

-- RLS: org members can read requests they're part of
alter table help_requests enable row level security;

create policy help_requests_select on help_requests for select
  to authenticated using (
    exists (
      select 1 from reps r
      where r.auth_user_id = auth.uid()
      and r.organization_id = help_requests.org_id
    )
  );

create policy help_requests_insert on help_requests for insert
  to authenticated with check (
    from_rep_id = current_rep_id()
    and exists (
      select 1 from reps r
      where r.auth_user_id = auth.uid()
      and r.organization_id = help_requests.org_id
    )
  );

create policy help_requests_update on help_requests for update
  to authenticated using (
    to_rep_id = current_rep_id()
    or from_rep_id = current_rep_id()
  )
  with check (
    to_rep_id = current_rep_id()
    or from_rep_id = current_rep_id()
  );
