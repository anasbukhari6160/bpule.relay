/**
 * Unique underlying-opportunity key (Phase 3).
 *
 * A lead and the captured prospect it was saved from carry the same pasted
 * source. The key is a sha256 of the normalised source text and nothing else —
 * no versions, no sender, no org — so every saved representation of one paste
 * collapses to one opportunity in audits, labels, shadow comparisons and
 * training exports. Unlike `intelligence_samples.raw_input_hash`, it never
 * stores source text.
 *
 * Stable across cosmetic variation: whitespace runs, LinkedIn UI chrome
 * ("Message", "Follow", "Contact info") and connection/follower counts.
 */
import { createHash } from 'node:crypto'
import { isLinkedInChromeText } from '@/lib/intelligence-v2/role-signals'

const CONNECTION_COUNT = /^\d[\d,]*\+?\s*(connections?|followers?)$/i

export function opportunityKey(rawText: string | null | undefined): string | null {
  const lines = (rawText ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false
      if (isLinkedInChromeText(l)) return false
      if (CONNECTION_COUNT.test(l)) return false
      return true
    })
  const normalised = lines.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalised.length < 40) return null
  return createHash('sha256').update(normalised).digest('hex')
}
