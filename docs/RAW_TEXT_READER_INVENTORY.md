# Raw-text reader inventory & gap map

Date: 2026-10-22 · Scope: LinkedIn/Upwork intelligence path (production engine `relay_decision_v3.3.0`).

This is the Phase A deliverable: where raw source text is read today, which
readers are canonical, and which downstream paths still re-parse raw text.

## 1. Canonical semantic reader

| Role | Module | Function | Produces |
| --- | --- | --- | --- |
| **THE reader** | `src/lib/intelligence-v3/source-facts-model.ts` | `readSourceFacts(rawText, options)` | `SourceFacts` (= `VerifiedOpportunityFacts`) |
| Canonical features | `src/lib/scoring-v4/opportunity-features.ts` | `buildOpportunityFeatures` / `featuresFromPacket` | `OpportunityFeatures` |
| Canonical decision | `src/lib/intelligence-v3/decision/decision-assembler.ts` | `assembleDecisionPacket` | `V3LeadDecisionPacket` |

`SourceFacts` already carries the schema the rebuild asked for: identity,
current/past orgs, authority, industry, activity, hiring, seller/candidate,
buyer request + age, budget, timeline, explicit dates, terminal state, access,
capability needs, funding, rejected signals (actor / organization /
temporalClass / sourceLine), completeness.

`OpportunityFeatures` already separates the four axes: `accountValue`,
`fit` (semantic capability families), `intent`, `access`, plus
`accountValue.outsourcingPlausibility`.

## 2. Raw readers found, classified

| Module | Reader | Class | In production path? |
| --- | --- | --- | --- |
| `intelligence-v3/source-facts-model.ts` | `readSourceFacts` | **canonical** | yes |
| `intelligence-v3/source-facts.ts` | `detectCommercialRequest`, `classifyLine`, `extractStatedBudget`, `extractStatedTimeline`, `extractExplicitDates`, `detectSellerOwnership`, `isRecruiterProfile` | reader helpers | yes (called by `readSourceFacts`) |
| `intelligence-v3/current-org.ts` | `splitCurrentAndPastLines`, `resolveCurrentOrgContext`, `resolveCurrentIndustry` | reader helpers | yes |
| `intelligence-v3/buyer-intent.ts` | `readBuyerSourceFacts`, `resolveBuyerIntentFromSource` | reader helper | yes (called by `readSourceFacts`) |
| `scoring/signal-extractor.ts` | `extractSignals` | reader helper | yes |
| `scoring/signal-attribution.ts` | `parseAccessSignals`, `verifyBudgetProvenance`, `verifyHiringProvenance`, `classifyTemporalProvenance` | reader helpers | yes |
| `prospect/paste-normalize.ts` | `normalizeProspectPaste` | ingestion | yes |
| `prospect/qualification-gate.ts` | `scoreRawInput`, `classifyInput` | ingestion / input sanity | yes |
| `intelligence-v2/commercial-reading.ts` | `deriveCommercialReading` | **legacy second reader** | yes (bridge) |
| `relay/routing-context.ts` | `summarizeFromRaw` → `readSourceFacts` | **downstream re-read (routing)** | yes |
| `scoring-v4/opportunity-features.ts` | `readSourceFacts(input.rawText)` fallback | **downstream re-read (features)** | yes (shadow) |
| `intelligence-v3/scoring/score-v3.ts` | `sourceFactsFor` / `buyerIntentFor` fallback | downstream re-read (scorer) | only when facts not passed |
| `relay/revenue-strategy.ts` | raw regex on `source.rawText` (recruiter, external purchase) | **downstream raw parse (message)** | yes |
| `upwork-v2.ts` | Upwork extraction | separate pipeline | yes (Upwork only) |
| `profile-intelligence/pipeline.ts` | CV/portfolio extraction | different source | yes (onboarding) |
| `demo-extract.ts`, `content/onboarding-*.ts` | misc extraction | ingestion | yes (non-decision) |

## 3. Downstream bypasses (the invariant violations)

These are the paths Phase B must remove. Each re-interprets raw text with its
own parser instead of consuming `SourceFacts` / `OpportunityFeatures`.

| # | Path | What it does today | Facts that already exist |
| --- | --- | --- | --- |
| B1 | `decision-assembler.ts` `guardBoundedDecision(decision, rawText, episode)` | re-runs `detectCommercialRequest`, `isCandidateSeeking`, `findContactInstruction` on raw text | `facts.buyer.externalServiceRequest`, `facts.buyer.employmentHiring`, `facts.candidateSeeking`, `facts.access.contactLine` |
| B2 | `routing-context.ts` `buildRoutingLeadContext` | `summarizeFromRaw(lead.rawInput)` and `readSourceFacts(lead.rawInput).proofCandidates` when the packet is absent | `packet.sourceFacts.capabilityNeeds`, `.proofCandidates`, `.currentIndustry` |
| B3 | `scoring-v4/opportunity-features.ts` `buildOpportunityFeatures` | `readSourceFacts(input.rawText)` when only the summary is stored | `SourceFactsSummary` is lossy; needs enrichment |
| B4 | `relay/revenue-strategy.ts` | regex over `source.rawText` for recruiter / external purchase | `source.recruiterProfile`, `source.externalNeed` |
| B5 | `bridge.ts` `deriveCommercialReading(rawText)` | V2 commercial reading re-parses raw text | `SourceFacts` |
| B6 | `intelligence-v3/scoring/score-v3.ts` fallbacks | re-reads when `sourceFacts` / `buyerIntent` not passed | caller passes them |

## 4. Gaps vs the target architecture

**Present:** canonical reader, canonical features, four axes, capability
taxonomy, sender capability profile, shadow engines, human-label table +
admin page, metrics, locked golden split, real-lead regression fixtures.

**Missing / not wired:**

| Gap | Where | Status |
| --- | --- | --- |
| Static architecture guard | — | **does not exist** |
| B1–B6 bypasses | above | **open** |
| Sales Thesis Engine | — | **does not exist** |
| Research Router | — | **does not exist** |
| Outcome taxonomy (`QUALIFIED_OPPORTUNITY`, `CONNECTION_ACCEPTED`, …) | — | **does not exist**; only `replied` is ever written |
| Pairwise labels | `training-data.ts` | **does not exist** |
| Sender routing v2 wired | `sender-ranker.ts` `rankSendersV2` | built, **no production caller** |
| Rep UI (priority, not 5/10) | lead/prospect pages | score-first |
| Human labels | `scoring_labels` | **0 rows** — the promotion blocker |

## 5. Shadow wiring (confirmed)

`recordShadowDecisions` is called from `/api/prospect/analyze` (line 663) and
`/api/prospect/save` (line 292), gated by `SCORING_SHADOW_ENGINES`. It writes
`scoring_shadow_decisions` with production + candidate score/band/action and
the full `OpportunityFeatures`. It never blocks and never changes what reps see.

## 6. Phase B — enforced (2026-10-22)

The invariant is now machine-checked by `tests/raw-text-reader-guard.test.ts`,
which fails if any scoring / routing / action / message / UI-reasoning module
calls a raw parser or `readSourceFacts`.

| Bypass | Fix |
| --- | --- |
| B1 `guardBoundedDecision(decision, rawText, episode)` | now takes `facts: SourceFacts`; the safety rules read `facts.buyer.externalServiceRequest` / `.employmentHiring` / `.candidateSeeking` and `facts.access.contactLine` |
| B2 `routing-context.ts` `summarizeFromRaw` + `readSourceFacts(lead.rawInput)` | removed; routing reads `packet.sourceFacts` only |
| B3 `buildOpportunityFeatures` re-read `readSourceFacts(input.rawText)` | removed; `SourceFactsSummary` now carries the full fact set, and `featuresFromPacket` takes no raw text |
| B6 `scoreEpisode` / `assembleDecisionPacket` fallbacks | `sourceFacts` and `buyerIntent` are required; `scoreEpisode` no longer reads raw text; `isEmploymentHiringNotPurchase` / `isCandidateSeeking` / `scoreSourceWithoutModel` deleted |
| B4 `revenue-strategy.ts` raw regex over `source.rawText` | **known remaining** — Phase J |
| B5 `bridge.ts` `deriveCommercialReading(rawText)` | **known remaining** — Phase J |

Both remaining reads are listed in the guard's `KNOWN_REMAINING` map so the
guard stays green and fails if any *other* module starts reading raw text.

`readSourceFacts` is now invoked from exactly one place in the decision path:
`bridge.ts` (`produceV3Intelligence`), which passes the facts into
`assembleDecisionPacket` and `buildOpportunityFeatures`.

The guard's `KNOWN_REMAINING` map is now **empty**: `deriveCommercialReading` is
replaced by `commercialReadingFromFacts`, and `revenue-strategy.ts` reads the
canonical `recruiterProfile` / `externalNeed` flags instead of its own regex.

## 7. Phase F — human labeling V2 (2026-10-22)

Ground truth is the promotion blocker: `scoring_labels` was 0 rows. The
labelling surface now has three modes.

| Mode | Fields | Purpose |
| --- | --- | --- |
| **Quick** (default) | prospect quality (GREAT/GOOD/MAYBE/POOR/NEVER CONTACT) · likely opportunity (YES/MAYBE/NO) · best action (CONTACT_NOW/CONNECT/RESEARCH/OBSERVE/CLOSE) · decision correct (YES/NO) · optional sender + one-line note | <15 seconds per label |
| **Detailed** | the original role/intent/potential/fit/authority/timing/access + score range + sender + confidence | when the reviewer wants to be precise |
| **Pairwise** | two opportunities, "work A first / B first / tie" | direct learning-to-rank supervision; no invented scores |

Beside the form the reviewer sees the raw source, V3 decision, every shadow
candidate, evidence + rejected signals, messages, outcome, feedback and any
existing labels. Rows are ordered by the existing active-learning priority
(engine disagreement, low confidence, contradictions, band-edge, feedback,
unexpected outcome).

Storage (migration `20261022130000_labeling_v2.sql`):
`scoring_labels` gains `prospect_quality` / `likely_opportunity` /
`quick_action` / `decision_correct`; new append-only `scoring_pairwise_labels`
table. Both are admin-only and never read by production scoring.

## 8. Phase H — routing v1 ↔ v2 persisted (2026-10-22)

`recordShadowDecisions` now loads the rep's sender profiles and stores
`routing_v1` (production sender + score) and `routing_v2` (best sender, match,
org capability match, sender changed, delta, confidence, proof used,
eligibility) beside every shadow decision. Migration
`20261022140000_scoring_shadow_routing.sql`.
