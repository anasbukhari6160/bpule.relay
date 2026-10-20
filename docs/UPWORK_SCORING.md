# Upwork Scoring

Version: `upwork_score_v1` (`src/lib/upwork/score.ts`), facts `upwork_facts_v1` (`src/lib/upwork/facts.ts`), application gate `upwork_application_gate_v1` (`src/lib/upwork/application-gate.ts`).

Upwork jobs are not LinkedIn prospects. A job post is already an explicit
request, so "buyer intent" is not the question. The questions are: is this a
real, well-paid, winnable job for us, and who should write the proposal.
Those are two numbers, kept apart:

```
Job quality:   82/100 (STRONG → apply)
Aneeb match:   91%
Zaira match:   64%
```

Changing the selected profile never changes the job score.

## Facts come from the paste

`readUpworkJobFacts(rawText)` reads the raw paste before any cleaning and
is the authority for every number. The AI extraction (`upwork-v2.ts`) only
fills descriptive fields such as the title and summary.

| Fact | Handles |
| --- | --- |
| Rate | `$25 - $60 Hourly`, `$25\n-\n$60\nHourly`, `Hourly: $40-$75`, `$45 per hour`, `$1,500.00\nFixed-price`, `Fixed price - Est. Budget: $800`, `Budget: $900`, `$4,000/month`; German, Spanish, French, Turkish markers. A lone `$49` without a marker is recorded as a rejected signal, never a budget. The client's "avg hourly rate paid" is never the job rate. |
| Duration / hours | `1 to 3 months`, `More than 6 months`, `2-4 weeks`, `Less than 30 hrs/week`, `30+ hrs/week` |
| Experience | Entry / Intermediate / Expert, or inferred from "6+ years of experience" |
| Proposals | `Less than 5`, `5 to 10`, `20 to 50`, `50+`, number on the next line |
| Connects | Required connects only; "Available Connects" is the rep's balance and is ignored |
| Client | payment verified / unverified, total spent (`$48K`), hire rate, jobs posted, hires, rating, reviews, avg hourly paid, hours billed, member since, new-client flag |
| Screening questions | Numbered lists after "Screening questions" / "You will be asked…", or question lines in the body |
| Start timing | asap / soon / scheduled / ongoing / none |
| Posted | "Posted 3 hours ago", "yesterday", "2 weeks ago" |
| Suspicious | off-platform contact, unpaid test work, identity or bank documents, guaranteed earnings, install-our-app, implausible rate for the level |
| Scope | word count, deliverables, timeline, tech specifics, vague flag |
| Completeness | which of rate, description, skills, experience, duration, proposals, client history, posted date are present |

## Score

Nine bounded, additive dimensions (weights sum to 1):

| Dimension | Weight | What raises it | What lowers it |
| --- | --- | --- | --- |
| Job quality | 0.12 | ≥80 words, deliverables, bullets, screening questions | vague post; any suspicious signal caps it at 0.15 |
| Commercial value | 0.18 | hourly ≥$60 or fixed ≥$10k, long duration, 30+ h/wk | hourly <$15, fixed <$500, no rate (0.35, unknown ≠ negative) |
| Technical fit | 0.18 | required skills overlap org capabilities | no overlap; off-stack work (video editing, Unity, Salesforce…) capped at 0.15 |
| Client quality | 0.14 | payment verified, spend, hire rate, rating, avg paid | unverified payment caps at 0.3; new client is 0.35, not negative |
| Competition | 0.10 | <5 proposals | 50+ proposals |
| Timing | 0.08 | asap / soon, posted today | posted >7 days ago; "urgent" plus suspicious → 0.4 |
| Scope clarity | 0.08 | deliverables, tech specifics, timeline | vague |
| Proof match | 0.06 | org proof tags cover required skills | none supplied → 0.4 (unverified) |
| Evidence quality | 0.06 | completeness of the paste | missing client block, rate, dates |

Hard caps bound the total when one fact disqualifies the job regardless of
the rest: suspicious 34, fixed <$300 → 40, hourly <$15 → 40, vague → 45,
off-stack → 50, no stack overlap → 60, payment unverified → 60, very low
hire rate → 60, hourly <$25 → 60, fixed <$1,000 → 62, posted >2 weeks →
65, 50+ proposals → 65, no rate → 72. The cap and its reason are returned
(`cap`) and shown as a watch-out.

Bands reuse the canonical table: STRONG 75+, WORTH_PURSUING 55+, MAYBE 35+,
LOW 15+, SKIP. Verdict: STRONG / WORTH_PURSUING → `apply`, MAYBE →
`apply_if_connects`, LOW / SKIP → `skip`. The legacy `score` column keeps the
/10 display projection (`displayScoreForCanonical`); the canonical score,
breakdown, facts and profile match are stored by
`20261021000000_upwork_canonical_score.sql`.

## Profile match

`matchProfilesToJob(facts, senders)` builds a routing context (required
skills, detected industries, title terms) and calls the same
`rankSendersForLead` engine LinkedIn uses. A sender skill matches a job term
only as a whole word of equal arity: "react" is not "react native", "java"
is not "javascript".

## Application gate

`evaluateCoverLetter` and `evaluateScreeningAnswers` run on every generated
application in `/api/upwork/jobs/[id]/generate` and are returned as
`draft.quality`. They block: letters outside 50–150 words, generic openers,
banned phrases, biography dumps, fewer than two references to the job,
invented numbers, placeholders; answers that do not answer (a yes/no
question without yes/no, an availability question without a time or number,
a technical question sharing no terms with the question), ungrounded
first-person delivery claims, answers that copy the letter, over-long
answers (truncated), and missing answers to asked questions. Unknown
product names and unused proof are warnings.

## Verification

```bash
npx vitest run tests/upwork-golden                 # 101 fixtures + extraction + gate
npx tsx --tsconfig tsconfig.json scripts/scoring/upwork-calibrate.ts
E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/scoring-upwork-flow.spec.ts --project=desktop-chrome
```

Adding a fixture: synthetic only; add to `tests/upwork-golden/fixtures.ts`
with the narrowest expectation that captures the business truth.
