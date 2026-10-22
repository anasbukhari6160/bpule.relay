-- Routing v1 ↔ v2 comparison (Phase H): store both routers' answers beside the
-- shadow decision so the admin QA center can show what the semantic router
-- would change, and why. Admin-only, never shown to reps, never changes a score.
alter table scoring_shadow_decisions
  add column if not exists routing_v1 jsonb,
  add column if not exists routing_v2 jsonb;

comment on column scoring_shadow_decisions.routing_v1 is 'Production router (v1) sender + score for this opportunity.';
comment on column scoring_shadow_decisions.routing_v2 is 'Semantic router (v2) ranking summary, proof used, eligibility and whether it would change the sender.';
