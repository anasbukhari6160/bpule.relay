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
