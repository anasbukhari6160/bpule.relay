# Scoring Invariants

These hold for every decision Relay produces. Each has a test that fails when
it is broken; the test files are listed so a reviewer can go straight to them.

| # | Invariant | Where enforced | Tests |
| --- | --- | --- | --- |
| 1 | **Unknown ≠ negative.** Missing evidence lowers confidence and caps a dimension; it never produces a negative adjustment. | `dimensions.ts`, `score-v3.ts` (no negative raws, one penalty) | `tests/intelligence-v3/scoring-v3.test.ts`, golden `incomplete_profile`, `no_posts` |
| 2 | **Recent activity ≠ urgent buying.** `activityRecency` and `buyerTiming` are separate fields; timing raw blends them and a model `URGENT` needs a source deadline. | `resolveTiming` | `tests/scoring-program/action-policy.test.ts`, golden `active_builder` |
| 3 | **Founder ≠ buyer.** Authority is its own 10% dimension; buyer intent requires a first-person request. | `resolveVerifiedBuyerIntent`, `resolveAuthorityDimension` | golden `technical_founder`, `enterprise_founder`, `stale_founder` |
| 4 | **Hiring employees ≠ buying services.** Employment hiring sets `verifiedHiringNeed`, never `verifiedBuyerRequest`. | `isEmploymentHiringNotPurchase`, source-facts `HIRING` scan | golden `company_hiring_employees`, `tests/qa-2026-10-17/*` |
| 5 | **Seller language ≠ buyer request.** First-person seller forms, services menus, rate cards and "we build X for clients" mark `sellerActivity`; a software-services seller without a verified request gets the competitor penalty and a fit cap. | `source-facts.ts` SELLER_OWNERSHIP, `isSoftwareServicesSeller` | golden `service_provider`, `competitor`, `product_seller` |
| 6 | **Candidate ≠ hiring.** Open-to-work, "send me a job" and recruiter-targeted language set `candidateSeeking`; role CANDIDATE caps fit 0.2, access 0.35, commercial potential 0.25. | `source-facts-model.ts`, `dimensions.ts` | golden `candidate`, `job_seeker` |
| 7 | **Historical ≠ current.** Past roles, past-tense launches and old posts are `prospect_past` rejected signals; a request older than 90 days decays, older than 180 days is flagged. | `postAgeDaysForLine`, `requestAgeFactor`, `resolveTiming` | golden `historical_*`, `buyer-stale-request-six-months`, `tests/intelligence-v3/episode-builder.test.ts` |
| 8 | **Target customer size ≠ prospect size.** "We serve enterprises" is a seller statement; company-size signals about customers are rejected with `actor: customer`. | source-facts rejected-signal scan | golden adversarial `customer_size_*` |
| 9 | **Strong fit ≠ intent.** Fit is 15%; with UNKNOWN intent the buyer-intent dimension is capped at 0.25 regardless of overlap. | `buyerIntentRaw` | golden `strong_fit_no_intent` |
| 10 | **Opportunity ≠ sender match.** The packet has no sender input; the reuse key is sender-independent; `rankSendersForLead` reads the packet and never writes to it. | `bridge.ts`, `routing-context.ts` | `tests/scoring-program/sender-routing.test.ts` ("changing sender never changes the opportunity") |
| 11 | **Cold ≠ live.** A live conversation can change the *action* (REPLY_NOW, CLOSE, FOLLOW_UP); it never changes the canonical score. | `deriveRecommendedAction` | `tests/scoring-program/action-policy.test.ts` |
| 12 | **Unverified ≠ strongest evidence.** Reasons list only verified facts; model claims the source does not state are `watchOut`, not reasons. | `score-v3.ts` reasons/watchOut | golden `mustNotCredit` checks |
| 13 | **Changing sender ≠ changing score.** Same source, any sender: identical canonical score, qualification, action and dimensions. | `tests/scoring-program/sender-routing.test.ts` | same |
| 14 | **No evidence ≠ certainty.** Thin or undated sources cap confidence at 0.44; the deterministic fallback caps at 0.6; two contradictions cap at 0.44. | `computeConfidence` | `tests/scoring-program/fallback.test.ts`, golden `incomplete_profile` |
| 15 | **Determinism.** Same source + same versions → identical packet across 10 parallel runs. Event timestamps anchor to the reference date; episode order and best-episode selection break ties on content, never on generated ids or the clock. | `bridge.ts`, `episode-builder.ts`, `orchestrator.ts` | `tests/scoring-program/stability.test.ts` |
| 16 | **One formula, one band table, one display table.** No surface compares a canonical score to a literal. | `qualification.ts` | `tests/scoring-program/cross-surface.test.ts` (greps `src/` for literal thresholds) |
| 17 | **One AI decision call.** Event extraction plus one bounded decision; sender ranking, action, confidence and display are deterministic. | `orchestrator.ts`, `routing-context.ts` | `tests/scoring-program/versions-cache.test.ts` |
| 18 | **Feedback never retrains.** Human feedback is persisted with versions and read by humans; no code path reads it into a score. | `scoring_feedback` table, `/api/scoring-feedback` | `tests/scoring-program/scoring-qa.test.ts` |

## Boundary notes

- A score exactly on a band edge belongs to the upper band (75 is STRONG).
- Small model jitter (±0.1 on probabilities) may move the canonical score by a
  point or two and can cross a band edge; it never flips intent or role
  because those come from source facts.
- The competitor penalty is the only subtraction and is applied once.
