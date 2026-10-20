/**
 * Decision Intelligence V3 — Centralized Configuration
 *
 * Single source of truth for all scoring weights, thresholds, and policy.
 * Versioned. Tuned against golden set. Never scattered across modules.
 */

import type { V3ScoringWeights } from './types'


export const V3_CONFIG_VERSION = 'relay_decision_v3.2.0'


/**
 * Seven bounded, additive dimensions. Sender-specific proof is NOT here —
 * it belongs to Sender Match, so changing the sender never changes this
 * score. See docs/SCORING_ARCHITECTURE.md for the ownership table.
 */
export const V3_SCORING_WEIGHTS: V3ScoringWeights = {
  buyerIntent: 0.25,          // Verified request to buy outside services
  commercialPotential: 0.20,  // Could this org plausibly become a customer
  fit: 0.15,                  // Org-level capability overlap
  authority: 0.10,            // Decision authority of the person
  timing: 0.10,               // Buyer timing (60%) + activity recency (40%)
  access: 0.10,               // One access authority
  evidenceQuality: 0.10,      // Verbatim support, completeness, corroboration
}

const _weightSum = Object.values(V3_SCORING_WEIGHTS).reduce((a, b) => a + b, 0)
if (Math.abs(_weightSum - 1.0) > 0.01) {
  throw new Error(`V3 scoring weights sum to ${_weightSum}, expected 1.0`)
}


export const FIT_SCORES: Record<string, number> = {
  EXCELLENT: 1.0,
  STRONG: 0.8,
  MEDIUM: 0.5,
  WEAK: 0.25,
  POOR: 0.0,
}


export const TIMING_SCORES: Record<string, number> = {
  URGENT: 1.0,
  CURRENT: 0.8,
  WEAK: 0.4,
  STALE: 0.15,
}


export const ACCESS_SCORES: Record<string, number> = {
  DIRECT: 1.0,
  CONNECTION: 0.7,
  INDIRECT: 0.3,
  NONE: 0.0,
}

// These are CONTEXT adjustments, not gates. A service provider with an
// explicit hiring event should still score well on that episode.

export const RELATIONSHIP_CONTEXT: Record<string, {
  /** Score multiplier for this relationship (applied to non-buyer episodes) */
  multiplier: number
  /** Whether this relationship allows buyer episodes */
  allowsBuyerEpisodes: boolean
  /** Default message eligibility bias */
  messageBias: number
}> = {
  BUYER: { multiplier: 1.0, allowsBuyerEpisodes: true, messageBias: 0.0 },
  // Service provider who is ALSO building a product: relationship is context,
  // not a gate. A founder with an agency building a SaaS product has legitimate
  // commercial potential on the product side. Multiplier reduced from 0.4 → 0.7
  // to avoid zeroing product-building episodes.
  SERVICE_PROVIDER: { multiplier: 0.7, allowsBuyerEpisodes: true, messageBias: -0.1 },
  // Competitor: still reduced but not zeroed — they may have a separate buyer episode
  COMPETITOR: { multiplier: 0.4, allowsBuyerEpisodes: true, messageBias: -0.2 },
  PARTNER: { multiplier: 0.7, allowsBuyerEpisodes: true, messageBias: -0.1 },
  CANDIDATE: { multiplier: 0.6, allowsBuyerEpisodes: true, messageBias: -0.1 },
  MIXED: { multiplier: 0.8, allowsBuyerEpisodes: true, messageBias: -0.05 },
  UNKNOWN: { multiplier: 0.85, allowsBuyerEpisodes: true, messageBias: -0.02 },
}


export const EPISODE_STATUS_SCORES: Record<string, number> = {
  CURRENT: 1.0,
  AGING: 0.8,
  STALE: 0.4,
  CLOSED: 0.0,
  UNKNOWN: 0.65,
}


export const NEED_OWNER_BUYER_RELEVANCE: Record<string, number> = {
  SELF_NEED: 1.0,
  HIRING_NEED: 0.9,
  ORGANIZATION_NEED: 0.8,
  CUSTOMER_NEED: 0.3,
  PRODUCT_PROBLEM: 0.7,
  MARKET_PROBLEM: 0.2,
  SERVICE_OFFERING: 0.1,
  UNKNOWN: 0.4,
}


export const ACTION_THRESHOLDS = {
  /** Score >= this + explicit buyer request + direct access → CONTACT_NOW */
  CONTACT_NOW_MIN: 70,
  /** Score >= this + buyer signal → CONNECT_WITH_NOTE */
  CONNECT_WITH_NOTE_MIN: 50,
  /** Score >= this → CONNECT_WITHOUT_NOTE or OBSERVE */
  CONNECT_MIN: 35,
  /** Score >= this → OBSERVE */
  OBSERVE_MIN: 15,
  /** Below this → SKIP */
  SKIP_MAX: 14,
} as const


export const ACCESS_INTENT_ACTION_MATRIX: Record<string, Record<string, string>> = {
  // access: DIRECT
  DIRECT: {
    high_intent: 'CONTACT_NOW',
    medium_intent: 'CONNECT_WITH_NOTE',
    low_intent: 'CONNECT_WITHOUT_NOTE',
    no_intent: 'OBSERVE',
  },
  // access: CONNECTION
  CONNECTION: {
    high_intent: 'CONNECT_WITH_NOTE',
    medium_intent: 'CONNECT_WITHOUT_NOTE',
    low_intent: 'OBSERVE',
    no_intent: 'OBSERVE',
  },
  // access: INDIRECT
  INDIRECT: {
    high_intent: 'CONNECT_WITHOUT_NOTE',
    medium_intent: 'OBSERVE',
    low_intent: 'WAIT',
    no_intent: 'WAIT',
  },
  // access: NONE
  NONE: {
    high_intent: 'CONNECT_WITHOUT_NOTE',
    medium_intent: 'WAIT',
    low_intent: 'SKIP',
    no_intent: 'SKIP',
  },
}


export const V3_MESSAGE_POLICY = {
  /** Minimum composite score to message */
  MIN_SCORE: 40,
  /** Minimum buyer request probability */
  MIN_BUYER_PROBABILITY: 0.25,
  /** Minimum model message_eligible */
  MIN_MODEL_ELIGIBLE: 0.35,
  /** Minimum fit level (0-1) */
  MIN_FIT: 0.3,
  /** Maximum relationship penalty before blocking */
  MAX_RELATIONSHIP_PENALTY: 0.5,
} as const


export const V3_SHADOW_CONFIG = {
  enabled: process.env.V3_SHADOW_MODE === 'true',
  /** Log all disagreements */
  logDisagreements: true,
  /** Minimum score delta to flag */
  flagThreshold: 15,
} as const


export const V3_DECISION_PROVIDER_CONFIG = {
  primary: process.env.V3_DECISION_PROVIDER || 'openai_structured',
  fallback: 'longcat_structured',
} as const


/**
 * When true, V3 becomes the authoritative lead decision system.
 * When false, V2 remains canonical and V3 runs in shadow only.
 */
export const V3_CANONICAL = process.env.V3_CANONICAL === 'true'

/**
 * Model escalation chain:
 * Primary: gpt-4o-mini (fast, cheap, good enough for most cases)
 * Escalation: gpt-4.1 (for uncertain cases, SP conflicts, mixed roles)
 */
export const V3_PRIMARY_MODEL = process.env.V3_OPENAI_MODEL || 'gpt-4o-mini'
export const V3_ESCALATION_MODEL = process.env.V3_ESCALATION_MODEL || 'gpt-4.1'

/**
 * Cascade escalation: when primary model is uncertain, use escalation model.
 */
export const V3_CASCADE_ENABLED = process.env.V3_CASCADE_ENABLED !== 'false'
