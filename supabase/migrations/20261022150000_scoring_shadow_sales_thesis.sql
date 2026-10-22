-- Sales Thesis Engine (Phase C): store the commercial thesis beside every
-- shadow decision so the admin QA / training-data surfaces can show it next to
-- the production and candidate scores. Admin-only, never shown to reps, never
-- changes a score.
alter table scoring_shadow_decisions
  add column if not exists sales_thesis jsonb,
  add column if not exists sales_thesis_version text;

comment on column scoring_shadow_decisions.sales_thesis is 'Deterministic sales thesis (why this account, likely problems as hypotheses, why we can help, entry point). Built from verified facts only.';
