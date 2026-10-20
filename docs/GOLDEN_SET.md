# Golden Set

The golden set is the calibration contract for the canonical score. Every
fixture is a synthetic LinkedIn-style source (no real people, companies or
posts) with an expected range for score, qualification, buyer intent, role,
action, industry and confidence, plus strings that must never appear as
positive evidence.

Location: `tests/golden/`. Runner: `tests/golden/golden-set.test.ts` and
`scripts/scoring/calibrate.ts`. Both run fully offline: events come from the
deterministic extractor and the decision from the fixture's simulated model
answer (or the deterministic fallback when none is given).

## Inventory (223 fixtures)

| File | Count | What it protects |
| --- | --- | --- |
| `fixtures-buyers.ts` | 13 | Explicit first-person requests: agency, contractor, RFP, Upwork-style, budget and deadline variants, stale requests |
| `fixtures-founders.ts` | 14 | Technical / non-technical founders, funded, bootstrapped, enterprise, multi-company, stale founders, strong fit with no intent |
| `fixtures-nonbuyers.ts` | 18 | Service providers, competitors, product sellers, recruiters, candidates, job seekers, cold executives, enterprise employees, consultants |
| `fixtures-multilingual.ts` | 16 | EN / DE / FR / ES / TR and mixed-language buyers, sellers, recruiters and candidates |
| `fixtures-adversarial.ts` | 114 | 112 provenance attacks cloned from one founder profile (third-party budget, reposts, hypothetical posts, customer size, past roles, closed requests, negated requests, seller language, hiring-as-buying, injected urgency, planted industries) plus 2 base controls |
| `fixtures-variants.ts` | 8 | Same opportunity with many posts / no posts / incomplete profile / different date formats |

Categories are listed per fixture (`category:`); the calibrate script prints
pass counts and mean score per category.

## Expectations format

```ts
li({
  id: 'buyer-agency-react-budget-deadline',
  category: 'explicit_buyer',
  notes: 'First-person request with budget and deadline — the strongest cold signal.',
  rawText: ...,
  model: { relationship: 'BUYER', buyerRequestProbability: 0.9, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
  expect: { scoreRange: [80, 95], qualification: ['STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], action: ['CONTACT_NOW'], confidence: ['HIGH'] },
  mustNotCredit: ['Model claimed'],
})
```

`scoreRange` is inclusive. `mustNotCredit` strings must not appear in
`reasons` (they may appear in `watchOut`).

## Current calibration (relay_decision_v3.2.0, 2026-10-20)

223 / 223 pass.

Distinct profiles (111, excluding the 112 attack clones):

| Display | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Share | 3% | 22% | 10% | 15% | 16% | 12% | 13% | 10% |

| Qualification | STRONG | WORTH_PURSUING | MAYBE | LOW |
| --- | --- | --- | --- | --- |
| Share | 23% | 28% | 25% | 24% |

Actions: CLOSE 24% · CONNECT_WITH_NOTE 22% · CONTACT_NOW 22% · OBSERVE 23% · RESEARCH_MORE 4% · WAIT 4% · CONNECT_WITHOUT_NOTE 2%.
Confidence: HIGH 80% · MEDIUM 5% · LOW 14%.

Category means: explicit buyers 79, contractors 81, funded startup 70, agency
request 68, current hiring 64, strong-fit-no-intent 64, technical founder 57,
active builders 57, company hiring employees 56, multilingual 48, service
providers 41, competitor 39, historical hiring/launch 36–37, stale founders
37, enterprise employee 33, cold executives 32, recruiters 29, candidates 27,
job seeker 24, incomplete profile 24.

The attack clones all land where the base profile lands (WORTH_PURSUING,
display 6), which is the point: no attack moves the score up or down.

## Adding a fixture

1. Reproduce the miss as a synthetic source. Never paste a real profile.
2. Pick the narrowest expectation that captures the business truth; leave a
   range of about ten points so model jitter does not make the set brittle.
3. Add `mustNotCredit` for any phrase that was wrongly credited.
4. Run `scripts/scoring/calibrate.ts`; if other fixtures move, decide whether
   the rule or the expectation is wrong — do not widen ranges to pass.
5. Update the inventory table above.
