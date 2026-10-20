# Relay end-to-end audit: data, scoring, dataset, routing, messaging and shadow learning

Date: 2026-10-22 · Production scorer: `relay_decision_v3.3.0` (unchanged) · Companion: [SCORING_V4_PROGRAM.md](SCORING_V4_PROGRAM.md)

Verdict first: **GO FOR SHADOW. NO-GO for any candidate promotion.** The shadow engines are enabled in the local environment, every migration they need is applied, and the governance holes that made the dataset unsafe to export are closed in code. Nothing a rep sees has changed. The promotion gate is unmet because the human-labelled set has zero rows.

## 1. Security and GRC

Audited: git remote, ignore rules, tracked files, every dataset route, the sample service, exports, hashing, RLS.

| Finding | Status |
| --- | --- |
| Git remote URL embeds a credential in `.git/config` (local, not committed; masked in this audit) | **Open, team action.** Reset the remote to a plain URL, use a credential helper or SSH, rotate the token. |
| 39 production dump files (41 MB) tracked under `audit-reports/historical-intelligence/`, first committed 2026-09-29 across three commits; prospect pastes, messages, reps, profiles | **Open, GRC/Security.** Not opened by this audit. Remediation below. |
| `api/dataset/export` returned every organisation's samples (`'all-orgs'`) | **Fixed.** Scoped to the caller's organisation; ANONYMIZED needs admin or owner; REDACTED stays the default. |
| `api/dataset/capture` accepted any `sample_id` without an organisation check | **Fixed.** 404 unless the sample belongs to the caller's organisation. |
| `api/dataset/samples` listed raw sources to any signed-in rep | **Fixed.** Admin, owner or manager only. |
| `api/dataset/sync` created samples for every tenant | **Fixed** (previous pass) and now uses the canonical band and display mapping. |
| Conversation compose / send / inbound looked samples up across organisations | **Fixed.** Scoped through the auth context. |
| `raw_input_hash` stored the first 100 characters of the paste | **Fixed in code**: SHA-256 of the normalised source, equal to the scoring program's `opportunityKey`. 149 existing rows still hold the legacy value; `scripts/scoring/rehash-samples.ts --apply` (team-run, reads text) rewrites them. |
| ANONYMIZED exports returned text unredacted and used a per-call counter, so anonymous ids were not stable | **Fixed.** Every mode redacts emails, phones and URLs globally; ids are keyed HMAC-SHA256 per organisation (`DATASET_ANON_SALT` optional), stable across exports, never reversible from the file. |
| `intelligence_samples` RLS compared `reps.id` to `auth.uid()` (everything else maps through `reps.auth_user_id`), so every user-session read failed and two capture hooks failed silently | **Fixed** in migration `20261022110000_dataset_governance.sql`, pending apply. |
| Retention | No retention policy exists for samples or shadow rows. Recommend 365 days for `scoring_shadow_decisions` and sample `raw_input` pruning once `raw_input_hash` plus the lead row cover training needs. |

**Dump remediation (do not do automatically):**
1. Confirm with GRC which files are personal data (file names say prospects, leads, messages, reps, profiles).
2. Remove the directory from the working tree in one commit (`git rm -r audit-reports/historical-intelligence`) and add the path to `.gitignore`.
3. Rewrite history with `git filter-repo --path audit-reports/historical-intelligence --invert-paths` on a fresh clone, force-push with the team's agreement, and have every clone re-fetch. GitHub cached views of the old commits need a support request to purge.
4. Rotate the credential in the remote URL at the same time, since the same history is where it would surface.

## 2. Data inventory (live, 2026-10-22, counts only)

| Store | Rows |
| --- | --- |
| organizations / reps | 11 / 18 |
| leads (with source / scored / with decisionHistory) | 134 (133 / 132 / 127) |
| captured prospects (status captured / converted to a lead) | 200 (200 / 0) |
| upwork jobs / upwork messages | 16 / 34 |
| messages (sent / inbound) | 168 (168 / 16) |
| outcomes · leads won / lost / replied | 16 · 2 / 1 / 7 |
| action_events: CONNECTION_SENT / RECOMMENDATION_SHOWN / RECOMMENDATION_ACTED / CLIENT_WON / LEAD_REFERRED | 89 / 50 / 0 / 2 / 1 |
| ai_traces / extraction_runs / edit_learning | 545 / 170 / 610 |
| intelligence_samples / sample events | 149 / 539 |
| scoring_feedback | 15 |
| profiles / revenue_identities / proof_cards / proof_items / portfolio_projects / profile_claims | 14 / 11 / 39 / 0 / 54 / 186 |
| scoring_labels / scoring_shadow_decisions | 0 / 0 |

## 3. Unique opportunities

The unique-opportunity count needs the source text for every record and is therefore team-run: `scripts/scoring/audit-dataset.ts --db --out audit.jsonl --review-set 100`. It prints RAW RECORDS, UNIQUE OPPORTUNITIES and DUPLICATES and writes ids, hashes, numbers and enums only. What is known without text: `captured_prospects.converted_lead_id` is set on 0 of 200 prospects, so today nothing links a prospect to the lead saved from it; the SHA-256 key closes that in the queue, the shadow table and the labels table.

## 4. Dataset funnel completeness

| Stage | Captured (events) | Of what | Missing path |
| --- | --- | --- | --- |
| ANALYSIS / SCORE | 132 | 132 scored leads | complete via backfill; live saves capture it |
| ROUTING | 128 | 132 | placeholder ranking (`profileMatch 0`) at save; real rankings not captured |
| CONNECTION_NOTE (MESSAGE_GENERATED) | 0 | 89 connections sent | **save route dropped the note** → fixed, now captured at save |
| FIRST_DM / FOLLOW_UP / REPLY_DRAFT | 0 | 168 sent | compose route only; the lead page's generate paths do not call it |
| HUMAN_EDIT (MESSAGE_EDITED) | 0 | unknown | **"Log Sent" path never captured** → fixed in `api/leads/[id]/contact` (HUMAN_EDIT when draft ≠ sent, then SENT) |
| FINAL_SENT (MESSAGE_SENT) | 148 | 168 | backfill only; live sends now captured on both send paths |
| CLIENT_REPLY | 19 | 16 inbound | complete |
| OUTCOME | 111 | 3 terminal leads | backfill marked `no`/`dead` as outcomes; live path wrote `won` for a booked meeting → fixed to `meeting` |
| FEEDBACK | 1 | 15 feedback rows | feedback on captured prospects cannot attach (looked up by `lead_id`); lead feedback attaches |

Sample funnel_stage distribution: OUTCOME 111, ROUTING 18, RAW_INPUT 14, SCORE 4, EXTRACTION 2. Label states: AI_ONLY 133, UNLABELED 15, HUMAN_REVIEWED 1, TRAINING_APPROVED 0.

## 5. Append-only

`intelligence_samples` is a mutable snapshot: every capture UPDATEs the row and three lifecycle arrays (`human_edited_text`, `client_replies`, `human_feedback`) grow in place. `intelligence_sample_events` is the append-only stream and already receives one event per capture with an idempotency key, but the key index was not unique. Changes: the index is now unique (duplicates removed first), `LABEL_APPROVED` is a new event type, `TRAINING_APPROVED` is a new label state set only by `approveForTraining`, and outcomes still never promote a label. Moving the arrays off the snapshot row is the next step; the events already carry what is needed to rebuild them.

## 6. Human labels and the priority queue

Label states are separate from AI output; `TRAINING_APPROVED` requires an explicit reviewer action and an event. The `/admin/training-data` queue now also prioritises wrong-sender feedback, wrong-score feedback and human-edited messages, on top of engine disagreement, unexpected outcomes, low confidence, contradictions, band-edge proximity and high value. Coverage today: 0 labels; both milestones unmet.

## 7. Production scoring health and score collapse

Live: leads 51 % at 5/10 and 70 % MAYBE; prospects 40 % and 66 %. The mechanism, measured on 156 distinct fixtures:

| Display | n | buyer intent | commercial | fit | authority | timing | access | evidence | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3/10 | 32 | 3.5 | 2.6 | 4.3 | 4.7 | 4.4 | 5.5 | 6.1 | 30.9 |
| 4/10 | 21 | 4.7 | 5.5 | 5.6 | 8.6 | 4.5 | 7.4 | 6.1 | 42.5 |
| 5/10 | 26 | 5.0 | 7.3 | 10.5 | 9.2 | 4.9 | 7.5 | 7.2 | 51.5 |
| 6/10 | 21 | 6.3 | 11.0 | 12.2 | 9.7 | 5.1 | 7.9 | 8.0 | 60.1 |
| 7/10 | 18 | 17.8 | 6.7 | 11.6 | 8.4 | 7.3 | 8.6 | 8.7 | 69.1 |
| 8/10 | 21 | 23.1 | 6.2 | 13.1 | 9.0 | 9.0 | 9.6 | 8.8 | 78.9 |

Two thirds of fixtures (106/156) have unknown intent; for them buyer intent is capped at 6.25 points, so the whole profile lives in the other six dimensions, each bounded, each with a spread of at most 9.4 points among the 47 fixtures at 4–5/10. Commercial potential is not even monotone in the display (7.3 → 11.0 → 6.7 → 6.2): it is highest at 6/10 and drops for buyers, because buyers are often small requests. Only buyer intent moves the score across bands. That is why 5/10 dominates: account value has no room to separate accounts.

Shared upstream errors (every engine misses them, Phase 21): vendor-evaluation and RFP phrasing, capability-named team requests, help-request-plus-budget, one line flipping a founder's role, closed searches not read as closed, third-party funding (fixed in features). Fix these in extraction before touching any ranker.

## 8. Fit quality

Fit audit on 156 fixtures: 7 fits rest only on ambiguous tokens, 14 include a token from a past-role line, 2 are lifted by the model with no overlap at all, 21 have nothing to fit, and V3's level differs from the semantic family level by three or more steps on 22. The semantic taxonomy (families, context rules for `go`, `security`, `integration`, `mobile`) is what the candidates and routing v2 use.

## 9. Buyer and role quality

Against fixture expectations: buyer precision 0.98, recall 0.92, F1 0.95; role macro-F1 0.98. These are shared by every engine because they come from the packet, and they are optimistic: the fixtures were written to the reader. The program-truth set shows the recall gap (three unrecognised requests out of 45).

## 10. Sender routing

v1 vs v2 on 156 fixtures with four synthetic identities: top-1 agreement 117/156. On the 61 fixtures with an explicit need, v1 picked a sender with no coverage of that need 7 times; v2 never did, and its top pick was backed by verified proof 56 times. Routing v2 stays unwired until the shadow table holds real production comparisons; the real profiles have 39 proof cards, 0 proof items and 54 portfolio projects, so proof backfill is the prerequisite.

## 11. Message quality and human edits

Not measured on real messages from this session (text). `scripts/scoring/production-audit.ts` (team-run) now classifies every sent and drafted message PASS / WEAK / FAIL / FABRICATED through the message gate, lists the repeated gate reasons, counts human-edited sends and reports the mean edit distance. Zero MESSAGE_EDITED events exist today, so the preference signal starts accumulating only after the contact-route fix ships.

## 12. Outcome linking

16 replies and 2 wins; every sender rate is below the minimum sample, so routing history uses Bayesian smoothing toward the prior and is marked unreliable. No causal claims.

## 13. Shadow engines

Enabled locally: `SCORING_ENGINE=v3`, `SCORING_SHADOW_ENGINES=calibrated_v4,ordinal_logit,gbdt_pairwise,knn_features`. Every save and every new capture writes four rows to `scoring_shadow_decisions` with production and candidate score, band, action, sender, confidence, account value, intent value, guards and features. Set the same two variables on Vercel to enable it in production. Offline results on the locked fixture split and the program-truth benchmark are in the companion document; new since then:

| Engine | Action accuracy | Confidence ECE |
| --- | --- | --- |
| v3 | 1.00 (by construction) | 0.457 |
| calibrated_v4 | 0.94 | 0.320 |
| ordinal_logit | 1.00 | 0.230 |
| gbdt_pairwise | 0.79 | 0.224 |
| knn_features | 0.99 | 0.357 |

V3's confidence is the least calibrated against "was the band right"; the ordinal model's band probabilities are the best calibrated.

## 14. Human-labelled locked set

`scripts/scoring/experiments/human-locked-set.ts` (team-run) builds it from `scoring_labels`, locks by hashed key, reports coverage per role / platform / language / band and evaluates every engine against human ranges only. Today: 0 rows.

## 15. Internet research

Unchanged from the companion document: GBDT or ordinal over structured features at this label count, embedding kNN as a second opinion, Platt/beta calibration, in-app labelling, OpenAI fine-tuning closed, company-level enrichment only after ablation.

## 16. Best candidate architecture

Unchanged hypothesis, now with measurements behind it: semantic extraction (verbatim-grounded) → OpportunityFeatures → ordinal or tree ranker trained on human ranges → visible guards → canonical score → routing v2 → action policy. The ranker is not the bottleneck; extraction is.

## 17. Migration status

117 tables declared in `supabase/migrations`, 117 APPLIED, 0 MISSING, including `scoring_labels`, `scoring_shadow_decisions`, `intelligence_samples`, `intelligence_sample_events`, `scoring_feedback`, `ai_traces`, `action_events`, `help_requests`, `profile_opportunity_matches`. All 13 probed columns present. The new governance migration `20261022110000` is written and not yet applied.

## 18. Build, tests, browser

- **Typecheck:** clean.
- **`next build`:** passes (`--webpack`, in an isolated rsync copy with a symlinked `node_modules`; Turbopack refuses the out-of-root symlink). The new admin page and both training-data API routes are in the build output.
- **Targeted suites** (dataset, scoring-v4, scoring-program): 291 tests pass. Golden calibration 223/223.
- **Full suite:** 2,969 pass, 10 fail in `tests/hardening-regression-{avigail,brian,daria,elijah,ved}.test.ts`; the same tests fail identically on an untouched checkout of HEAD (verified earlier via a scratch worktree), so they predate this work. The live `intelligence-golden-set` test passed on this run and failed on the previous one: it calls the model.
- **Browser** (Playwright, desktop Chrome, demo mode, `/api/**` mocked, scratch-only preview route): training-data page renders the queue, the production-vs-candidate table, raw source, evidence, messages and outcome, and a label submission posts the opportunity key, the chosen range and the observed decision; Scoring QA renders the candidate columns and the shadow table on an opened decision. 2/2 pass; screenshots were reviewed. Not browser-tested: dataset center, prospect analyze, save/reopen, sender routing, feedback (they need real Supabase data, which this audit does not use). The spec is in `e2e/scoring-v4-admin.spec.ts`, skipped unless `E2E_PREVIEW=1` because it relies on an uncommitted preview route.
- **Lint:** `npm run lint` fails at configuration load before reading any file (pre-existing).

## 19. Files changed in this pass

Security and dataset: `src/app/api/dataset/{export,capture,samples,sync}/route.ts`, `src/lib/dataset/{export,service,types}.ts`, `src/app/api/leads/[id]/{contact,status}/route.ts`, `src/app/api/leads/[id]/conversation/{compose,send,inbound}/route.ts`, `src/app/api/prospect/save/route.ts` (note capture), `scripts/backfill-dataset*.ts`, `scripts/scoring/rehash-samples.ts`, `supabase/migrations/20261022110000_dataset_governance.sql`, `tests/dataset/governance.test.ts`.

Audit and shadow tooling: `scripts/scoring/audit-dataset.ts` (`--counts`, `--migrations`, `--db` flags, `--review-set`), `scripts/scoring/production-audit.ts` (message classes, edit deltas), `scripts/scoring/experiments/{collapse-diagnosis,fit-audit,routing-compare,human-locked-set,run-candidates}.ts`, `src/lib/scoring-v4/metrics.ts` (precision/recall/F1, macro-F1), `src/lib/admin/training-data.ts` (queue signals), `.env.local` (shadow flags only).

## 20. Risks and what remains unproven

- Unproven: that any candidate beats V3 on human labels (none exist); that routing v2 beats v1 on real profiles; message quality on real sends; the unique-opportunity count on live data.
- Risk: the dump removal needs a history rewrite and a credential rotation; until then the repository itself is the exposure.
- Risk: the governance migration changes RLS on two tables; apply it in a maintenance window and re-run `audit-dataset.ts --migrations`.
- Risk: fixtures remain the only evaluation data; every "accuracy" number above is against expectations written by the same team that wrote the reader.

## 21. Commit boundary (Phase 26)

Three commits, in this order, none pushed without approval:
1. `fix(security): scope dataset routes to the organisation, SHA-256 sample hashes, stable anonymised exports, sample RLS` — the files under "Security and dataset" above.
2. `feat(scoring-v4): candidate engines, shadow mode, human labels, training-data queue` — everything under `src/lib/scoring-v4`, `src/lib/admin/training-data.ts`, the admin page and API, the QA center changes, migration `20261022100000`, `tests/scoring-v4`, `tests/golden/fixtures-ranking.ts`.
3. `chore(scoring): audit and experiment tooling, docs` — `scripts/scoring/**`, `docs/**`, `.env.local.example`, the prompt-template fix and the routing-confidence fix (or split those two into their own `fix:` commit).

Unrelated and left out: nothing else is modified in the tree.
