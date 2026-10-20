# Relay 360° Scoring Intelligence Program — plan review and report

Date: 2026-10-21 · Production engine: `relay_decision_v3.3.0` (unchanged) · Candidate layer: `src/lib/scoring-v4/`

This is the Phase 36 deliverable: diagnosis, dataset health, ground-truth coverage, research, candidate architectures, experiment results and the recommended path. Nothing in this document changed what reps see. The verdict is at the end.

## 1. Executive diagnosis

Relay's production score collapses to the middle because the formula adds seven bounded dimensions and most LinkedIn prospects have **unknown intent**, so buyer intent (weight 0.25) contributes almost nothing and the other six dimensions, each bounded and each near its centre for an "active founder", sum to 45–54. The live database on 2026-10-21 shows it:

| Corpus | Scored rows | 5/10 share | MAYBE share | STRONG | WORTH_PURSUING |
| --- | --- | --- | --- | --- | --- |
| leads | 132 | 51 % | 70 % | 5 % | 9 % |
| captured prospects | 200 | 40 % | 66 % | 7 % | 9 % |

Two things are wrong, and they are different problems:

1. **Ranking inside the middle is undifferentiated.** A Series A CTO hiring four engineers and a bootstrapped eight-person shop both land in MAYBE. The score has no separate notion of *account value*; commercial potential, fit and authority are each squeezed into 0.10–0.20 of the total.
2. **The deterministic reader misses semantic requests.** On the 45 program-truth fixtures written for this review, V3's ten misses are mostly reader misses, not weight problems: a vendor evaluation with an RFP date, "looking for a Solidity team", and "the backend is on fire — we need help scaling it, we have budget" are all left at intent UNKNOWN because no first-person regex fires. A single planted seller or candidate line flips a founder's role. A closed search ("we finally found our agency") is not read as closed.

The golden set cannot see either problem: its 223 expectations were written to V3's own calibration, so V3 passes 223/223 by construction and every candidate trained on it converges to V3. Human labels on real opportunities are the missing ground truth. The program's own rule applies: do not tune weights first.

## 2. Inventory (Phase 1) — exact counts, 2026-10-21, live database

Read with count-only queries (ids, numbers, timestamps; no names or text): `scripts/scoring/audit-dataset.ts --counts`.

| Store | Rows | Notes |
| --- | --- | --- |
| organizations / reps | 11 / 18 | |
| leads (with raw source / with canonical score) | 134 (133 / 132) | `canonical_intelligence.v3DecisionPacket` holds the packet |
| captured_prospects (status captured) | 200 | same packet shape, `sender_profile_id` is text |
| upwork_jobs / upwork_messages | 16 / 34 | `upwork_score_v1`, separate pipeline |
| messages (sent / inbound) | 168 (168 / 16) | drafts are separate rows; no draft→sent link |
| outcomes | 16 | only stage `replied` is ever written |
| leads won / lost / replied | 2 / 1 / 7 | meeting and proposal live only in `conversation_states.stage` |
| conversation_states / action_events | 115 / 293 | |
| scoring_feedback | 15 | 9 types, versions attached |
| intelligence_samples / events | 149 / 539 | the dataset funnel (see health notes) |
| profiles / revenue_identities | 14 / 11 | |
| proof_cards / proof_items / portfolio_projects / profile_claims | 39 / 0 / 54 / 186 | |
| ai_traces / extraction_runs / edit_learning | 545 / 170 / 610 | no prompt or response bodies stored |
| scoring_labels / scoring_shadow_decisions | 0 / 0 | new tables, migration below |

Unique-opportunity count (Phase 3) is computed by `audit-dataset.ts --db` from the sha256 of the normalised source (`opportunityKey`). That mode reads prospect text and is therefore team-run; it was not run from this session (organisation data rules). The one historical snapshot in the repo (2026-09-29) listed 291 leads and 753 prospects, so the live tables have since been pruned or re-scoped; the audit should be re-run by the team on the current data.

## 3. Dataset health (Phase 2)

What the master audit row needs exists, but several joins are weak:

- **No routing history.** Only the latest `best_profile_id` / `profile_match_score` survive. `profile_opportunity_matches` has no writer. The dataset funnel captures a placeholder ranking at save (`profileMatch: 0, "assigned at save"`).
- **Outcomes are thin and conflated.** 16 inbound messages, 2 wins. `meeting_booked` is recorded as `won` in the status route. `contract` and `deferred` exist only as vocabulary.
- **Dedup.** No stored version-independent key linked a lead to its captured prospect; `converted_lead_id` is set only on exact-text matches. `opportunityKey` (new) closes this.
- **Dataset funnel defects found by the inventory** (not fixed here, listed for the team): RLS policies compare `reps.id` to `auth.uid()` instead of `reps.auth_user_id`; `api/dataset/export` and `api/dataset/capture` have no organisation scope; `raw_input_hash` stores the first 100 characters of the source rather than a hash; the main "Log Sent" path never captures SENT; feedback on captured prospects cannot attach to a sample; Upwork `display_score` writes a non-integer.
- **Fixed in this pass:** `api/dataset/sync` now scopes leads and jobs to the caller's organisation and uses the canonical band/display functions instead of a private threshold table.

**Escalation (GRC/Security):** `audit-reports/historical-intelligence/` contains committed production dumps (prospect pastes, messages, reps, profiles — 39 tracked files since 2026-09-29). They were not opened. They must be removed from the repository and its history by someone cleared to handle that data.

## 4. Ground-truth coverage (Phase 4)

| Source | Count | Usable as |
| --- | --- | --- |
| Golden expectations (V3 contract) | 111 distinct + 112 attack clones | regression only; leaks V3's own calibration |
| Program-truth ranking fixtures (new) | 45 | independent ranges; V3 fails 10/45 |
| Upwork golden | 101 | Upwork pipeline only |
| scoring_feedback | 15 | weak signal, no ranges |
| Outcomes | 16 replies, 2 wins | far below minimum sample |
| scoring_labels (new) | 0 | the target: ≥300 before any promotion |

Built for this: `scoring_labels` table (ranges, role, intent, CP, fit, authority, timing, access, action, best sender, labeler, label version, confidence, reason, evidence lines), `/admin/training-data` (one row per unique opportunity: raw source, production vs every candidate engine, evidence, rejected signals, messages, outcome, feedback, existing labels, label form) and an active-learning priority (Phase 23) that orders the queue by engine disagreement, unexpected outcomes, feedback, low confidence, contradictions, band-edge proximity and high value.

## 5. Internet research (Phase 7) — what matters for Relay

Full report with sources: section "Research findings" at the end. The decisions it drives:

- **The combiner, not the LLM, is the cheapest upgrade.** Per 1,000 analyses the extraction call costs $0.3–0.6; a tree or ordinal model over structured features costs under $0.01 and explains itself. Vendors (HubSpot, Salesforce Einstein, 6sense, MadKudu) all run "fit model + intent model, explained by factors", and gate predictive mode at roughly 1,000 leads / 100+ conversions — Relay has 2 wins.
- **At 300–1,000 labels the evidence favours regularised GBDT or ordinal models over structured features, with embedding kNN as a second opinion.** Fine-tuning an encoder pays only past ~1k labels with per-language coverage; cross-language gaps of 20–30 points are typical below that.
- **Range labels are interval-censored labels.** Train on them as intervals (zero loss inside the range), never on midpoints alone; XGBoost `survival:aft` does this natively if the team later moves to Python.
- **Calibrate on cross-fitted predictions with Platt/beta; isotonic only past ~1,000 labels.** Verbalised LLM confidence is a feature, not a probability.
- **OpenAI fine-tuning is closed to new users.** If a tuned model is ever wanted, the path is LoRA on Qwen3.5-4B/9B or Gemma 4 on Together/Fireworks (≈$1–2 per training run, $0.17–0.20 per 1M tokens served). Haiku 5.5 and Gemini 2.5 Flash-Lite now undercut gpt-4o-mini for the extraction call itself.
- **Labelling tooling.** Label Studio is the most complete off-the-shelf option for reviewer-tracked ranges and pairwise picks; Argilla is in maintenance mode. Since Relay needs the labels next to its own evidence, the in-app page built here is the right call, with run tracking in Langfuse if wanted.
- **Enrichment:** company-level only (Apollo org enrichment, job postings), validated by ablation on Relay's own replies before paying; person-level enrichment is a PII data class needing GRC sign-off.

## 6. Candidate architectures (Phase 14) and what was built

All candidates consume one canonical `OpportunityFeatures` object (Phase 6) built from the packet: verified intent kept separate from account value (Phase 9/10), semantic capability families instead of token overlap (Phase 11/12), six-level fit, supply-side flags, closed/fallback flags, and a 51-dimension numeric projection. Every engine ends in the same visible guards (Phase 30): closed episode, candidate, recruiter, supply-side without a verified buy, verified request for a need outside our capabilities, and a floor for a verified current request with budget.

| Candidate | Implementation | Trained on |
| --- | --- | --- |
| A `v3` | production score, wrapped | — |
| B `calibrated_v4` | deterministic: intent × account × fit × authority × access × timing × evidence, weights fitted by coordinate search on a ranking objective | train split |
| C `ordinal_logit` | proportional-odds ordinal regression, latent → score through the fitted band cuts | train split |
| D `gbdt_pairwise` | depth-2 boosted trees, RankNet pairwise objective, early stopping on validation | train split |
| E `knn_features` | weighted kNN in feature space (no embedding API) | train split |
| G hybrid | semantic extraction → features → ranker → guards | this is the shape A–E already share; the missing piece is the extraction layer (section 9) |

Sender routing v2 (Phase 5/12/13/20/21): `SenderCapabilityProfile` (capability families, proven and verified families, industries, Bayesian-smoothed reply/meeting rates with a minimum sample) and `rankSendersV2`, which reports ORG_CAPABILITY_MATCH, SENDER_MATCH and PROOF_MATCH separately with reasons and risks. It is built, tested and not yet wired into surfaces (the v1 engine still serves them).

## 7. Experiment design and results (Phases 15, 16, 25, 26)

Rows: 223 golden + 45 ranking fixtures = 268; 156 distinct profiles split deterministically by hashed id into train 79 / validation 41 / locked 36; the 112 attack clones are never training rows and are used for the invariance check. Locked was read only by the evaluation step. Runner: `scripts/scoring/experiments/run-candidates.ts`; report: `docs/scoring-v4/experiments/2026-10-21-candidates.json`.

**Locked set (36 rows, never used for fitting)**

| Engine | Spearman | Pairwise | NDCG@10 | Top-decile | In range | MAE to range | Band exact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v3 | 0.89 | 0.99 | 0.96 | 0.75 | 0.97 | 0.4 | 0.58 |
| calibrated_v4 | 0.89 | 0.98 | 0.94 | 0.75 | 0.89 | 0.7 | 0.64 |
| ordinal_logit | 0.89 | 0.99 | 0.95 | 0.75 | 0.78 | 0.8 | 0.58 |
| gbdt_pairwise | 0.84 | 0.95 | 0.86 | 0.75 | 0.81 | 2.2 | 0.61 |
| knn_features | 0.87 | 0.98 | 0.93 | 0.75 | 0.83 | 1.3 | 0.67 |

Reading: on labels that were written to V3, nothing beats V3 and nothing should. The ties are the label-leakage finding, not a model finding.

**Program-truth ranking benchmark (45 fixtures, independent ranges; ~55 % of them were in the train split, so this is partly in-sample for C–E)**

| Engine | In range | Spearman | Pairwise | Top-decile |
| --- | --- | --- | --- | --- |
| v3 | 35/45 | 0.80 | 0.95 | 0.40 |
| calibrated_v4 | 27/45 | 0.78 | 0.93 | 0.20 |
| ordinal_logit | 32/45 | 0.88 | 0.99 | 0.80 |
| gbdt_pairwise | 34/45 | 0.85 | 0.94 | 0.60 |
| knn_features | 34/45 | 0.89 | 0.96 | 0.80 |

Reading: the trained models order the program-truth set better than V3 (top-decile 0.6–0.8 vs 0.4) and the deterministic candidate does not. But the only misses that matter are shared by all five, because they are upstream: the three unrecognised requests, the misread seller, the unclosed episode. No combiner fixes a reader miss.

**Invariance (112 attack clones):** no engine raises a clone more than a band above the clone median; every engine lowers 12–25 clones by more than 3 points because the V3 reader re-reads the role from one planted seller/candidate line. Recorded, not hidden, in `tests/scoring-v4/engines.test.ts`.

**V3 misses on program truth (the root causes, Phase 37 classes):**

| Class | Example fixture | What the reader does |
| --- | --- | --- |
| Vendor evaluation / RFP phrasing not a request | `rank-enterprise-vp-eng-vendor-evaluation` (50, truth 64–88) | no first-person "looking for an agency" regex fires; model BUYER 0.9 is rejected |
| Capability-named team request | `rank-buyer-web3-solidity-weak-fit` (42, truth 45–66) | "looking for a Solidity team" not recognised |
| Help request + budget + DM | `rank-launch-yesterday-scaling-need-node` (62, truth 66–90) | help request without a vendor noun stays UNKNOWN |
| One line flips role | 22 attack clones; `rank-agency-owner-selling-only` (47, truth ≤40 and role BUILDER) | seller/candidate detection is line-level, not profile-level |
| Closed search not CLOSED | `rank-request-closed-found-agency` (40, truth ≤30) | "the search is closed" is not a negation pattern |
| Stack overlap inflates a non-buyer | `rank-enterprise-ic-engineer-no-authority` (45, truth ≤34) | fit and CP credit a senior IC with no authority |
| Recruiter inside the MAYBE ceiling | `rank-recruiter-agency-react-roles` (53, truth ≤30) | supply-side ceiling (54) is too generous for recruiters (fixed in v4 guards) |
| Verified request for a need we do not serve | `rank-buyer-marketing-agency-not-software` (66, truth ≤50) | intent credited regardless of fit (fixed in v4 guards) |
| Third-party funding credited | `attack-portfolio-company-raised` | "our portfolio company raised" read as own funding (fixed in features) |

## 8. Shadow mode (Phase 27) and the QA surface (Phase 34)

- `SCORING_SHADOW_ENGINES=calibrated_v4,ordinal_logit,gbdt_pairwise,knn_features` makes every save (`/api/prospect/save`) and every new capture (`/api/prospect/analyze`) write one `scoring_shadow_decisions` row per engine: production score / band / action / sender beside candidate score / band / action / confidence / account value / intent value / guards, plus the features. Best-effort, never blocks, never changes a score. Tested with a fake client.
- The admin Scoring QA center now shows a production-vs-candidates table per decision; `/admin/training-data` shows the same per unique opportunity with the label form.
- `scripts/scoring/audit-dataset.ts --db` produces the master audit table (Phase 2) and the ranked disagreement queue (Phase 28) as JSONL with ids, hashes, numbers and enums only. `scripts/scoring/shadow-run.ts --db` was broken (read the wrong packet key on every row) and is fixed.
- The shadow run on ≥200 real opportunities has **not** been run from this session; it reads prospect text and is team-run.

## 9. Recommended approach

1. **Turn shadow on now** with all four candidates. Cost is zero (no model calls). Within two to three weeks of normal use the table holds 200+ real comparisons.
2. **Label from `/admin/training-data`, highest priority first**, aiming for 300 labels across both reps and both languages groups (EN and non-EN). Ranges, not numbers; reason and evidence lines every time. This is the ground truth the program lacks; nothing else on this list is worth tuning before it exists.
3. **Fix the reader classes above as classes**, each with a synthetic fixture: vendor-evaluation and RFP phrasing, capability-named team requests, help-request-plus-budget, profile-level role resolution (a founder with a current company stays a founder when one post sells), closed-search negation. The source-facts version bumps once for all of them.
4. **Add verbatim-grounded semantic extraction** (the Phase 30 hypothesis, and the one change that attacks recall without giving up safety): the bounded model returns the request *quote*; code verifies the quote exists verbatim in the source and only then credits it as a verified request. The deterministic reader stays the authority for what it can read; the model extends it only with grounded quotes.
5. **Retrain C–E on human labels (train/validation), evaluate on the locked set, and re-run the ranking benchmark.** Promote only if a candidate beats V3 on the locked set *and* on the shadow disagreement review, with no buyer-safety or seller regression. If the winner is the ordinal model (likely at 300–600 labels: explainable, calibrated by its cuts, fast), ship it as `SCORING_ENGINE=ordinal_logit` with the guards unchanged; `calibrated_v4` stays as the deterministic fallback.
6. **Wire sender routing v2** behind its own flag once the proof library is backfilled (0 proof items today; 39 proof cards).

Display and bands (Phases 17/18): unchanged on purpose. The histogram will move when ranking moves; forcing it now would be the "prettier distribution" the program forbids.

## 10. Cost (Phase 32), per 1,000 analyses

| Option | Cost | Status |
| --- | --- | --- |
| gpt-4o-mini bounded call (today) | $0.31–0.62 | kept |
| Claude Haiku 5.5 / Gemini 2.5 Flash-Lite, same call | $0.41–0.45 | drop-in if provider swap wanted |
| calibrated_v4 / ordinal / GBDT / kNN over features | < $0.01 | built, CPU, no network |
| Fine-tuned Qwen3.5-9B LoRA (Together) | ≈$0.31 + ≈$1–4 training | not recommended before 1k labels |
| Cross-encoder reranker for sender routing | $0.16–0.40 API, ≈$0 self-hosted | not recommended; v2 ranker is explainable and free |

## 11. Migration and rollback (Phase 33)

- Apply `supabase/migrations/20261022100000_scoring_labels_and_shadow.sql`.
- `SCORING_ENGINE` (default `v3`) and `SCORING_SHADOW_ENGINES` (default empty) in the environment. Rollback is the env var; stored packets keep their V3 score; candidate results live in their own table.
- Preserved untouched: SourceFacts, the buyer-intent authority, provenance, the Action Ledger, sender identities, workspace ownership, the Decision Trace, the dataset system, the band table and the display mapping.

## 12. Files changed

New: `src/lib/scoring-v4/**` (features, taxonomy, metrics, engines, guards, registry, models, trainers, shadow, sender profile + ranker, opportunity key), `src/lib/admin/training-data.ts`, `src/app/api/admin/training-data/**`, `src/app/(app)/admin/training-data/page.tsx`, `src/components/admin/training-data-center.tsx`, `scripts/scoring/audit-dataset.ts`, `scripts/scoring/experiments/{run-candidates,ranking-benchmark}.ts`, `supabase/migrations/20261022100000_scoring_labels_and_shadow.sql`, `tests/golden/fixtures-ranking.ts`, `tests/scoring-v4/*.test.ts` (8 files), `docs/scoring-v4/experiments/2026-10-21-candidates.json`, this document.

Modified: `src/app/api/prospect/{save,analyze}/route.ts` (shadow hook), `src/lib/admin/scoring-qa.ts` + `src/components/admin/scoring-qa-center.tsx` (production vs candidates), `src/components/app-rail.tsx` (nav), `src/app/api/dataset/sync/route.ts` (org scope, canonical bands), `scripts/scoring/shadow-run.ts` (packet key), `src/lib/relay/sender-routing-engine.ts` (confidence precedence bug), `src/lib/intelligence-v3/decision/bounded-questions.ts` (organisation name now reaches the model; prompt version → `v3_decision_prompt_v3`), `docs/GOLDEN_SET.md`, `docs/SCORING_ARCHITECTURE.md`, `.env.local.example`.

## 13. Tests

`npx vitest run tests/scoring-v4 tests/golden tests/scoring-program tests/upwork-golden tests/dataset`: 24 files, 655 tests, all passing. Golden calibration 223/223 unchanged. Typecheck clean. Full suite: 2,963 passing, 11 failing in 6 files (`tests/hardening-regression-{avigail,brian,daria,elijah,ved}.test.ts`, `tests/intelligence-golden-set.test.ts`); the same 11 fail identically on an untouched checkout of HEAD, so they are pre-existing (live-model and identity-extraction tests, not touched by this work). Not run: `next build` (the owner's dev server holds `.next`), browser flows for the new admin page (typechecked only), and `npm run lint`, which fails at configuration load on this machine before any file is read (`react-hooks/*` rules without the plugin wired) — pre-existing.

## 14. Risks

- The shadow hook adds four synchronous feature builds per save; they are microseconds, but `recordShadowDecisions` runs fire-and-forget, so a Supabase outage shows up only in logs.
- `/admin/training-data` shows raw pasted sources to admins. That is the product's existing admin scope, but every label row carries the labeler id, so reviewers are accountable.
- The bounded model now sees the organisation name. Decisions on new analyses may differ slightly from cached ones until the reuse key rolls (it includes the prompt version; stored packets are not invalidated).
- Trained model files are generated artefacts committed as TypeScript; the ordinal model's weights show the overfitting a 79-row train set invites. They are shadow-only.

## 15. What was not changed

Production scoring, bands, display mapping, action policy, routing v1, the Upwork pipeline, the dataset funnel's RLS and export scoping (listed for the team), the committed data dumps (escalated), and the golden expectations.

## 16. Verdict

**CONDITIONAL GO** for shadow mode and the labelling loop. **NO-GO** for promoting any candidate to production today: on the only labels that exist, no candidate beats V3, because those labels are V3. The gates for a promotion review are 300 human labels, a locked-set win, a shadow review of the top 50–100 disagreements, and no buyer-safety or seller regression.

---

## Research findings (Phase 7, condensed; prices verified 2026-10-21)

**Learning-to-rank at small N.** No published minimum for lambdarank; XGBoost's own guidance for small data is `rank:pairwise` / `rank:ndcg` with `lambdarank_pair_method="mean"` and more pairs per sample. The per-item 0–100 score is pointwise, so a regularised GBDT or ordinal model fits it; the 3–6 sender candidates per analysis are a textbook small-group LTR problem (`qid` = analysis). Pairwise human preferences and pointwise outcome labels are complementary (Bradley-Terry loss is bounded by pointwise MSE, arXiv 2507.07375); BT-σ (arXiv 2602.16610) infers per-reviewer reliability. The one peer-reviewed B2B lead-scoring study (Frontiers in AI, 2025, 16.6k CRM leads) found gradient boosting best with process fields as top features; the one practitioner write-up with method (Nortinia, May 2026) used LightGBM + SHAP with the LLM re-ranking only a borderline band at ±5, reporting 2.3× top-20 % lift.

**Ordinal and calibration.** CORAL/CORN heads and cumulative-link models (`statsmodels.OrderedModel`) are the standard ordinal options; `ordinalgbt`, GBNet and XGBOrdinal exist for trees. ORCU (arXiv 2410.15658) is the current ordinal-aware calibration method; report QWK, MAE and SCE/ACE rather than accuracy. Platt beats isotonic below ~2,000 calibration points. Interval labels train natively with XGBoost `survival:aft`.

**Small fine-tuned classifiers vs kNN vs GBDT.** The 2025 32-dataset multilingual head-to-head (arXiv 2502.11830): few-shot FastFit beats zero-shot GPT-4 on multi-class tasks, logistic regression on `gte-multilingual-base` embeddings is competitive, full fine-tuning wins only with full data, and cross-language spread is 22–29 points for small tuned models vs 11–15 for zero-shot LLMs. Qwen3-Embedding (0.6B–8B, Apache-2.0, 100+ languages) leads open multilingual embeddings; Qwen3-Reranker-0.6B is the pragmatic open cross-encoder.

**Fine-tuning tooling and prices.** TRL is the reference layer (RewardTrainer for pairwise preferences on Qwen3-0.6B), Unsloth the fast kernels, LLaMA-Factory the UI. Fireworks LoRA SFT $0.50/M training tokens, served at base price; Together SFT $0.34–0.38/M, Qwen3.5-9B $0.17/$0.25 per M in/out; OpenAI fine-tuning closed to new users; gpt-4o-mini $0.15/$0.60; Claude Haiku 5.5 $0.10/$0.50; Gemini 2.5 Flash-Lite $0.10/$0.40.

**Eval and labelling tools.** Label Studio (Pairwise and Ranking tags, reviewer assignment; Starter $99/mo), Argilla (right question types, maintenance mode), Langfuse (OSS, annotation queues, Hobby free / Core $29), LangSmith (Plus $39/seat), Braintrust (Pro $249), Phoenix (ELv2, annotation queues beta), Weave/Forge (Pro from $60). None computes NDCG/ECE natively; keep metrics in-repo (done: `src/lib/scoring-v4/metrics.ts`).

**Active learning.** Uncertainty sampling plus a free four-member committee (rules, LLM, GBDT, kNN) plus stratified random to avoid boundary bias; ActPRM-style routing halves annotation cost at equal performance. Implemented as the `/admin/training-data` priority.

**LLM confidence.** Verbalised confidence is overconfident and near chance for 4B-class models (AUROC ≈0.55); self-consistency is discriminative but 5× the cost; the 2026 pattern at this size is distillation of LLM score + confidence into soft targets for a small calibrated model. Treat the bounded model's probability as a feature only (done).

**Vendors.** HubSpot predictive scoring is a 90-day close probability shown as quartiles; Salesforce Einstein needs ≥1,000 leads per segment; 6sense and MadKudu publish no precision or calibration. Relay should match their explainability (per-factor contributions, which the ordinal and tree engines expose) rather than their volume claims.

**Enrichment.** Only vendor-sourced lift claims exist; company-level sources: Apollo org enrichment (1 credit), TheirStack / DataForSEO job postings, BuiltWith/Wappalyzer from $250–295/mo; Crunchbase basic API discontinued; Clearbit free tools sunset. Ablate before paying; person-level enrichment needs GRC.
