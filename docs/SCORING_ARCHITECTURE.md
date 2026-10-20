# Relay Scoring Architecture

Version: `relay_decision_v3.2.0` (see `src/lib/intelligence-v3/versions.ts`).

Relay turns a pasted LinkedIn profile, post or job ad into one commercial
decision: **how much is this opportunity worth to us, who should reach out,
and what should they do next.** Four systems answer four different questions
and are kept apart on purpose:

| System | Question | Owner | Changes when |
| --- | --- | --- | --- |
| Opportunity Score | Is this a real, current, buyable opportunity for an agency like ours? | `intelligence-v3` | The source text or scoring versions change |
| Sender Match | Which of our profiles should send? | `relay/sender-routing-engine.ts` via `relay/routing-context.ts` | Profiles, proof or industries change |
| Live Conversation State | What has the prospect actually said back? | `relay/conversation-override.ts` | A message arrives |
| Team Collaboration | Who owns it, who should help? | refer / help-request routes | A human decides |

Changing the sender never changes the opportunity score. A live reply
overrides the cold score for *action*, never for *score*.

## Pipeline (one pass, one AI decision call)

```
raw text
  └─ buildMinimalV2Canonical          identity, affiliations            (no AI)
  └─ readSourceFacts                  one canonical SourceFacts          (no AI)
  └─ events                           gpt-4o-mini extraction, or the
                                      deterministic extractor on failure
  └─ evidence graph → episodes        per organization, per need owner   (no AI)
  └─ bounded decision                 ONE structured model call
                                      (gpt-4o-mini, gpt-4.1 escalation,
                                      LongCat fallback, deterministic last)
  └─ assembleDecisionPacket
        guardBoundedDecision          model answers clamped to source facts
        resolveVerifiedBuyerIntent    the single buyer-intent authority
        scoreEpisode                  seven bounded dimensions, additive
        computeConfidence             separate from the score
        deriveRecommendedAction       cold policy + live override + routing overlay
  └─ V3LeadDecisionPacket → v3PacketToCanonical → stored on the lead / prospect
```

Files:

- `src/lib/intelligence-v3/bridge.ts` — `produceV3Intelligence`, reuse key, cache validity, `recomputePacketFromStored`.
- `src/lib/intelligence-v3/source-facts-model.ts` — `readSourceFacts`: current organisation, industry, access, activity recency, hiring, seller activity, candidate seeking, buyer request and its age, budget, timeline, authority, technology context, rejected signals.
- `src/lib/intelligence-v3/buyer-intent.ts` — `resolveVerifiedBuyerIntent`.
- `src/lib/intelligence-v3/dimensions.ts` — access, timing, authority, capability fit, commercial potential, evidence quality, confidence.
- `src/lib/intelligence-v3/scoring/score-v3.ts` — `scoreEpisode`, the only place a canonical score is computed.
- `src/lib/scoring/qualification.ts` — `qualifyCanonicalScore`, `displayScoreForCanonical`, the only place bands and display values live.
- `src/lib/intelligence-v3/action/recommended-action.ts` — `deriveRecommendedAction`, the only action policy.
- `src/lib/relay/routing-context.ts` + `sender-routing-engine.ts` — `rankSendersForLead`, deterministic, no AI.

## Source facts are the authority

The model never sees a question it can answer against the source better
than the reader can. Every model answer is bounded:

- A model `BUYER 0.9` on a profile with no first-person request becomes `UNKNOWN` with a logged contradiction.
- A model `URGENT` without a deadline or a current request in the source becomes `WEAK`.
- A model `EXCELLENT` fit with no overlapping capability is capped at `MEDIUM`; with nothing to fit at all it is capped at `WEAK`.
- A model `DIRECT` access on a 3rd-degree profile with no contact route becomes `CONNECTION`.

The reader rejects and *records* what it does not credit (`rejectedSignals`):
third-party statements, hypothetical or advice posts, reposts, past roles,
customer-size statements, closed or negated requests, seller language,
employment hiring presented as buying.

## Canonical score

```
score = Σ raw_d × weight_d × 100  − COMPETITOR_PENALTY (6, when applicable)
```

| Dimension | Weight | Raw source |
| --- | --- | --- |
| buyerIntent | 0.25 | verified request × request age factor; UNKNOWN unverified capped at 0.25 |
| commercialPotential | 0.20 | build intensity, tech relevance, capacity need, maturity, activity (no authority, no floors) |
| fit | 0.15 | capability overlap (deterministic 0.4) blended with bounded model fit (0.6) |
| authority | 0.10 | role from current affiliations / headline |
| timing | 0.10 | buyer timing (NONE/WEAK/CURRENT/URGENT) and activity recency, kept separate |
| access | 0.10 | connection degree, contact route, invitation to reach out |
| evidenceQuality | 0.10 | verbatim quotes, completeness, corroboration, freshness, ownership, consistency |

Additive. No multiplicative collapse, no status or relationship multipliers,
no hidden floors. A closed or negated episode is `SKIP`.

Bands: STRONG 75–100 · WORTH_PURSUING 55–74 · MAYBE 35–54 · LOW 15–34 · SKIP 0–14.
Display (`display_v2`): ≥92→10, ≥83→9, ≥75→8, ≥65→7, ≥55→6, ≥45→5, ≥35→4, ≥25→3, ≥15→2, else 1. Monotonic and band-aligned: every STRONG lead shows 8+, every SKIP shows 1.

## Confidence is not the score

`computeConfidence` reports how sure Relay is of the decision, never how
good the lead is. Contradictions, thin undated sources and the deterministic
fallback cap it. LOW confidence triggers `RESEARCH_MORE` where the score alone
would not.

## Versions and reuse

Every packet carries `versions` (scoring, sourceFacts, buyerIntent,
attribution, routing, actionPolicy, display, prompt, model, analyzedAt).
`isPacketCurrent` gates every cache: a packet from an older version is
recomputed on open. The reuse key is
`sha256(opportunityVersionTag + pipeline + orgCapabilities + normalized text)`
and is sender-independent by construction.

## Failure behaviour

- Event model fails → deterministic extractor, `eventSource: 'deterministic'`.
- Decision model fails → deterministic decision (`relationship UNKNOWN`, buyer probability 0.7 only with an explicit first-person request, else 0.15), `fallbackUsed: true`, confidence ≤ 0.6. Source facts are preserved; nothing defaults to a flat 2/10.
- Whole pipeline throws → deterministic rerun; never a fabricated 50.

## Surfaces

Prospect analyze, lead workspace, decision-context API, dashboard feed,
admin command center, revenue intelligence, routing opportunities, rep day
timeline, rep performance, queue engine and the Scoring QA center all read
bands from `qualifyCanonicalScore` and display values from
`displayScoreForCanonical`. There are no local thresholds.
