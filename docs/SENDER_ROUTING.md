# Sender Routing

Sender routing answers one question: **given this opportunity, which of our
profiles is the best sender?** It never answers "how good is the
opportunity" — that is the canonical score, computed before any sender is
considered.

## Entry point

`rankSendersForLead(leadContext, senders, currentSenderId)` in
`src/lib/relay/sender-routing-engine.ts`, always reached through
`src/lib/relay/routing-context.ts`:

- `buildRoutingLeadContext(lead, packet)` derives the lead side from the stored
  packet's source facts: requested capabilities, technology terms, current
  industry, buyer-request probability, fit level.
- `loadSenderProfiles(client, orgId, repId)` loads the org's profiles with
  skills, industries, proof items and **bounded** historical outcomes
  (`relay/historical-outcomes`): wins and reply rates can move a match by at
  most a few points and never create a match from nothing.
- `routeLead(lead, packet, senders)` returns `RoutingResult`:
  `rankings[]` (profileMatch 0–100, confidence, reasons, risks, holders,
  accessibleToRep, primaryProof), `bestSenderId`, `bestSenderMatch`,
  `currentSenderRank`, `currentSenderMatch`, `mismatchDelta`, `routingVersion`.

Deterministic: no model calls, no clock, stable tie-breaks. `ROUTING_VERSION`
is `routing_v1` and is stamped on every packet.

## Match ingredients

1. Capability overlap between the lead's requested capabilities / stack and the sender's skills and proof tags.
2. Industry overlap between the lead's current industry and the sender's industries.
3. Proof strength: verified, strong proof items that match the lead's terms raise the match and are surfaced as `primaryProof`.
4. Platform fit: a LinkedIn lead prefers LinkedIn-native profiles.
5. Bounded history: prior wins / replies for similar leads, capped.

Reasons and risks are returned for every ranking so a rep can see why.

## Team routing overlay

`deriveRecommendedAction` adds a routing recommendation on top of the cold or
live action (`ROUTING_VERSION` stays `routing_v1`, `ACTION_POLICY_VERSION`
`action_policy_v1`):

| Situation | Recommendation |
| --- | --- |
| Current sender is best, or delta < 20 | `KEEP` |
| Another sender the rep can use is ≥ 20 points better | `ASSIGN` (switch sender) |
| A sender held by another rep is ≥ 20 points better | `REFER` |
| Opportunity ≥ 55 and best available match < 40 | `ASK_FOR_HELP` |

Every recommendation needs a human confirmation. The UI (prospect page, lead
workspace, admin routing opportunities) shows the recommendation; refer and
help requests are explicit buttons that call `/api/leads/[id]/refer` and the
help-request routes.

## Surfaces

- `/api/prospect/analyze` — `senderRouting`, `routingRecommendation`, `bestSender` (top accessible ranking or the rep's explicit choice), `senderSuggestion` when a better profile belongs to someone else.
- `/api/leads/[id]/decision-context` — full rankings plus the effective action.
- `/api/admin/routing-opportunities` — org-wide mismatches ≥ `ROUTING_MISMATCH_DELTA`.
- `/api/inbound/analyze` — same engine for inbound.

## Guarantees and tests

- Same source, different sender → identical canonical score, qualification, action and dimensions (`tests/scoring-program/sender-routing.test.ts`).
- Top-1 accuracy over the synthetic sender bench is tested case by case in the same file; history is bounded there too.
- Cached packets are keyed without the sender, so switching sender never triggers a rescore and never returns another sender's packet.
