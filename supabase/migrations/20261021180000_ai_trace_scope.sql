-- Scope each AI call to the lead, job, and rep it was about.
-- Text, not uuid: demo and local ids are not always uuids.

alter table ai_traces
  add column if not exists lead_id text,
  add column if not exists job_id text,
  add column if not exists rep_id text;

create index if not exists ai_traces_org_lead_idx on ai_traces (organization_id, lead_id);
create index if not exists ai_traces_org_feature_created_idx on ai_traces (organization_id, feature, created_at desc);

comment on column ai_traces.lead_id is 'Lead this call is about, when there is one';
comment on column ai_traces.job_id is 'Upwork job this call is about, when there is one';
comment on column ai_traces.rep_id is 'Rep who triggered the call';
