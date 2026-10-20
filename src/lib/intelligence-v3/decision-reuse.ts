/**
 * V3 Decision Reuse — deterministic cache key for the opportunity decision.
 *
 * Same normalized source + same opportunity versions = same DecisionPacket.
 * No model call needed.
 *
 * What is NOT in the key, on purpose: the selected sender/profile and sender
 * capabilities. The opportunity decision is sender-independent (changing the
 * sender re-routes, it never re-scores), and keying on the profile made the
 * writer (save with the best sender) and the reader (analyze with the
 * requested profile) disagree, so the cache never hit.
 */

import { createHash } from 'node:crypto'
import { INTELLIGENCE_PIPELINE_VERSION, normalizeForHash } from '../intelligence-v2/input-hash'
import { ATTRIBUTION_VERSION, V3_DECISION_PROMPT_VERSION, opportunityVersionTag } from './versions'

export { ATTRIBUTION_VERSION, V3_DECISION_PROMPT_VERSION }

export interface V3ReuseKeyParams {
  rawText: string
  /** @deprecated ignored — sender context is not part of the opportunity decision. */
  profileId?: string | null
  /** @deprecated ignored. */
  profileIntelligenceVersion?: string | null
  /** @deprecated ignored. */
  senderCapabilities?: string[]
  /** Organization capability set, when an org overrides the default fit vocabulary. */
  orgCapabilities?: string[]
}

export function buildV3ReuseKey(params: V3ReuseKeyParams): string {
  const normalized = normalizeForHash(params.rawText)
  const orgCaps = (params.orgCapabilities ?? []).map((c) => c.toLowerCase()).sort().join(',')

  const preimage = [
    opportunityVersionTag(),
    `pipeline:${INTELLIGENCE_PIPELINE_VERSION}`,
    `org_caps:${orgCaps}`,
    `text_len:${normalized.length}`,
    `text:${normalized}`,
  ].join('\n---\n')

  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

export function buildV3ReuseCacheKey(reuseKey: string): string {
  return `v3decision:${reuseKey}`
}
