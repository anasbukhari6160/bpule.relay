# Scoring Release Checklist

Run top to bottom before any change to `src/lib/intelligence-v3`,
`src/lib/scoring`, `src/lib/relay/sender-routing-engine.ts`,
`src/lib/relay/routing-context.ts` or the action policy ships.

## 1. Versions

- [ ] Bump the version constant that corresponds to what changed in `src/lib/intelligence-v3/versions.ts` (`SCORING_VERSION`, `SOURCE_FACTS_VERSION`, `BUYER_INTENT_VERSION`, `ATTRIBUTION_VERSION`, `ACTION_POLICY_VERSION`, `DISPLAY_VERSION`, `V3_DECISION_PROMPT_VERSION`) or `ROUTING_VERSION` in the routing engine.
- [ ] Confirm `isPacketCurrent` will invalidate stored packets you intend to invalidate and nothing else.

## 2. Offline gates (no network)

```bash
npx tsc --noEmit -p tsconfig.typecheck.json
npx tsx --tsconfig tsconfig.json scripts/scoring/calibrate.ts      # 223/223, distinct-profile distribution healthy
npx vitest run tests/golden tests/scoring-program tests/intelligence-v3 \
  tests/intelligence-v2.test.ts tests/dashboard tests/qa-2026-10-17 \
  tests/prospect-qa-module-01.test.ts tests/buyer-intent-authority.test.ts \
  tests/signal-ownership-regression.test.ts
```

Gates:

- [ ] Golden set: every fixture inside its range; no `mustNotCredit` string in reasons.
- [ ] Distinct-profile display histogram: no value above 30%; qualification bands between 10% and 40% each.
- [ ] Ranking tests: buyers above founders above sellers/recruiters/candidates.
- [ ] Stability: 10 parallel runs identical for every sampled fixture.
- [ ] Cross-surface: no literal canonical thresholds outside `qualification.ts`.
- [ ] Sender routing: opportunity unchanged across senders; top-1 bench passes.
- [ ] Fallback: deterministic decision keeps source facts, confidence ≤ 0.6, never a flat 2/10.

## 3. Shadow run (team-run, real data)

```bash
npx tsx --tsconfig tsconfig.json scripts/scoring/shadow-run.ts --golden   # smoke test of the report
npx tsx --tsconfig tsconfig.json scripts/scoring/shadow-run.ts --db --days 30 --limit 200
```

- [ ] Run `--db` only from an account and machine cleared for prospect data; the script prints aggregates and ids only, writes nothing.
- [ ] `GATE: PASS` — zero service providers or recruiters at WORTH_PURSUING+, zero verified buyers at LOW/SKIP.
- [ ] Review the promoted / demoted lists with a rep before release.

## 4. Build and browser

```bash
npm run build
npx playwright test e2e/prospect e2e/leads   # needs a dev server and Supabase
```

- [ ] Prospect page: score, qualification, action and reason, confidence, rejected-signal inspector, routing recommendation, feedback buttons render.
- [ ] Lead workspace: "Why this decision" shows the same numbers as the prospect page for the same source.
- [ ] Admin → Scoring QA: distributions, alerts, filters, row drill-down, feedback.

## 5. Database

- [ ] Apply `supabase/migrations/20261020000000_scoring_feedback.sql` (scoring feedback table + RLS) before enabling the feedback UI.

## 6. After release

- [ ] Watch `/api/admin/scoring-monitor` for 48 hours: fallback rate < 20%, contradiction rate < 35%, no critical alerts.
- [ ] Triage `scoring_feedback` rows weekly; turn confirmed misses into golden fixtures, never into ad-hoc rules.
- [ ] Update `docs/GOLDEN_SET.md` counts when fixtures are added.
