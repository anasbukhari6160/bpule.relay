/**
 * V3 Decision Reuse — deterministic cache key for DecisionPacket.
 *
 * Same canonical inputs + same versions = same DecisionPacket.
 * No model call needed.
 *
 * Cache key includes:
 * - normalized input hash (from V2 input-hash module)
 * - V3 config/score version
 * - V3 prompt version (decision system prompt)
 * - selected profile ID (sender context)
 * - profile intelligence version
 */

import { createHash } from 'node:crypto'
import { V3_CONFIG_VERSION } from './config'
import { INTELLIGENCE_PIPELINE_VERSION, normalizeForHash } from '../intelligence-v2/input-hash'
import { BUYER_INTENT_VERSION } from './buyer-intent'

export const V3_DECISION_PROMPT_VERSION = 'v3_decision_prompt_v2'

// Attribution guard version — increment when signal attribution rules change
// to invalidate cached decisions that used old attribution logic
export const ATTRIBUTION_VERSION = 'v1'

export interface V3ReuseKeyParams {
  rawText: string
  profileId?: string | null
  profileIntelligenceVersion?: string | null
  senderCapabilities?: string[]
}

export function buildV3ReuseKey(params: V3ReuseKeyParams): string {
  const normalized = normalizeForHash(params.rawText)
  const profileId = params.profileId ?? 'none'
  const profileVersion = params.profileIntelligenceVersion ?? 'none'
  const capabilities = (params.senderCapabilities ?? []).sort().join(',')

  const preimage = [
    `v3_config:${V3_CONFIG_VERSION}`,
    `v3_prompt:${V3_DECISION_PROMPT_VERSION}`,
    `attribution:${ATTRIBUTION_VERSION}`,
    `buyer_intent:${BUYER_INTENT_VERSION}`,
    `pipeline:${INTELLIGENCE_PIPELINE_VERSION}`,
    `profile:${profileId}`,
    `profile_ver:${profileVersion}`,
    `caps:${capabilities}`,
    `text_len:${normalized.length}`,
    `text:${normalized}`,
  ].join('\n---\n')

  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

export function buildV3ReuseCacheKey(reuseKey: string): string {
  return `v3decision:${reuseKey}`
}
