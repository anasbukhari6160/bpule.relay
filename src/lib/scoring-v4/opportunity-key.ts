/**
 * Unique underlying-opportunity key (Phase 3).
 *
 * A lead and the captured prospect it was saved from carry the same pasted
 * source. The key is a sha256 of the whitespace-normalised source text and
 * nothing else — no versions, no sender, no org — so every saved
 * representation of one paste collapses to one opportunity in audits,
 * labels, shadow comparisons and training exports. Unlike
 * `intelligence_samples.raw_input_hash`, it never stores source text.
 */

import { createHash } from 'node:crypto'
import { normalizeForHash } from '@/lib/intelligence-v2/input-hash'

export function opportunityKey(rawText: string | null | undefined): string | null {
  const normalised = normalizeForHash(rawText ?? '')
  if (normalised.length < 40) return null
  return createHash('sha256').update(normalised).digest('hex')
}
