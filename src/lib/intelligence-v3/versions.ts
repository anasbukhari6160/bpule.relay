/**
 * Scoring program versions — one place, all layers.
 *
 * Every persisted decision carries these, and the reuse key folds in the ones
 * that change the opportunity decision. Routing and action-policy versions
 * are recomputed on read, so they are stored for audit but do not invalidate
 * the cached opportunity decision.
 *
 * Bump rules:
 *  - SCORING_VERSION: weights, bands, dimension formulas, multipliers.
 *  - SOURCE_FACTS_VERSION: any deterministic reader (line classification,
 *    temporal provenance, access/timing/authority readers, multilingual).
 *  - BUYER_INTENT_VERSION: resolveVerifiedBuyerIntent rules (lives in
 *    buyer-intent.ts; re-exported here).
 *  - ATTRIBUTION_VERSION: evidence verification / rejected-signal rules.
 *  - ROUTING_VERSION: rankSendersForLead (lives in sender-routing-engine.ts).
 *  - ACTION_POLICY_VERSION: deriveRecommendedAction.
 *  - DISPLAY_VERSION: qualification bands → /10 mapping.
 */

import { BUYER_INTENT_VERSION } from './buyer-intent'

export const SCORING_VERSION = 'relay_decision_v3.3.0'
export const SOURCE_FACTS_VERSION = 'source_facts_v1'
export const ATTRIBUTION_VERSION = 'attribution_v2'
export const ACTION_POLICY_VERSION = 'action_policy_v2'
export const DISPLAY_VERSION = 'display_v2'
// v3: the organisation name now reaches the model (a template typo sent the
// literal text "ctx.organization.name" before). Part of the reuse key only;
// stored packets stay current (isPacketCurrent does not read the prompt).
export const V3_DECISION_PROMPT_VERSION = 'v3_decision_prompt_v3'

export { BUYER_INTENT_VERSION }

export interface ScoringVersions {
  scoringVersion: string
  sourceFactsVersion: string
  buyerIntentVersion: string
  attributionVersion: string
  routingVersion: string
  actionPolicyVersion: string
  displayVersion: string
  promptVersion: string
  /** Decision model identifier (provider + model), or 'deterministic_fallback'. */
  modelVersion: string
  analyzedAt: string
}

export function currentVersions(params: { routingVersion: string; modelVersion: string; analyzedAt?: string }): ScoringVersions {
  return {
    scoringVersion: SCORING_VERSION,
    sourceFactsVersion: SOURCE_FACTS_VERSION,
    buyerIntentVersion: BUYER_INTENT_VERSION,
    attributionVersion: ATTRIBUTION_VERSION,
    routingVersion: params.routingVersion,
    actionPolicyVersion: ACTION_POLICY_VERSION,
    displayVersion: DISPLAY_VERSION,
    promptVersion: V3_DECISION_PROMPT_VERSION,
    modelVersion: params.modelVersion,
    analyzedAt: params.analyzedAt ?? new Date().toISOString(),
  }
}

/**
 * Versions that make a stored opportunity decision stale. Routing, action
 * policy and display are projections recomputed from the stored packet.
 */
export function opportunityVersionTag(): string {
  return [
    `scoring:${SCORING_VERSION}`,
    `source_facts:${SOURCE_FACTS_VERSION}`,
    `buyer_intent:${BUYER_INTENT_VERSION}`,
    `attribution:${ATTRIBUTION_VERSION}`,
    `prompt:${V3_DECISION_PROMPT_VERSION}`,
  ].join('|')
}

/** True when a stored packet was produced under the current opportunity versions. */
export function isPacketCurrent(versions: Partial<ScoringVersions> | null | undefined): boolean {
  if (!versions) return false
  return versions.scoringVersion === SCORING_VERSION
    && versions.sourceFactsVersion === SOURCE_FACTS_VERSION
    && versions.buyerIntentVersion === BUYER_INTENT_VERSION
    && versions.attributionVersion === ATTRIBUTION_VERSION
}
