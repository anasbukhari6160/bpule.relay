-- Conversation layer: per-lead rolling memory (summary + deal facts) and the
-- rep's unsent composer draft. Both live on the existing one-row-per-lead
-- conversation_states table, so no new RLS surface is introduced.
alter table conversation_states
  add column if not exists memory jsonb,
  add column if not exists composer_draft jsonb;

comment on column conversation_states.memory is
  'Rolling conversation memory: summary of turns outside the verbatim window, deal facts, deal stage, latest client-turn analysis.';
comment on column conversation_states.composer_draft is
  'Unsent draft in the lead conversation composer: text, original AI text (for edit learning), rationale.';

-- Inbound email replies were inserted without a direction and defaulted to
-- outbound. Repair existing rows written by the email webhook.
update messages
set direction = 'inbound'
where model_used = 'email_webhook'
  and type = 'reply'
  and direction = 'outbound';
