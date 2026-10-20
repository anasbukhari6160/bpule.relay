-- RECOMMENDATION_SHOWN and RECOMMENDATION_ACTED are emitted by
-- src/lib/action-ledger.ts (emitRecommendation) and read by the admin
-- intelligence surfaces, but the CHECK constraint from
-- 20261008000000_action_ledger_fix_check.sql does not list them, so every
-- such insert fails silently. This brings the constraint back in line with
-- the code union (tests/action-ledger-schema-parity.test.ts keeps them equal).

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
    'LEAD_ARCHIVED',
    'RECOMMENDATION_SHOWN',
    'RECOMMENDATION_ACTED'
  ));
