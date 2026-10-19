/**
 * Intelligence Input Hash — stable reuse boundary
 *
 * Relay hardening sprint, Phase 6.
 *
 * Problem this solves: produceCanonicalIntelligence() was invoked fresh on
 * every request with no memory of prior runs. Re-pasting the exact same
 * source text (a retry, re-opening the same profile days later, a duplicate
 * request) always re-ran the full LLM extraction pipeline, fully exposed to
 * provider/model/sampling variance — violating "same canonical evidence +
 * same versions = same canonical intelligence."
 *
 * This module computes a deterministic hash of what legitimately affects the
 * canonical result. Two calls with the same hash (and matching pipeline/score
 * versions) should produce the identical canonical intelligence — so the
 * second call can reuse the first's persisted result instead of invoking AI
 * again.
 *
 * IMPORTANT — what does NOT go in the hash:
 * - Timestamps, run IDs, request IDs — these are metadata about a run, not
 *   inputs to it, and including them would make every hash unique (defeating
 *   the whole point).
 * - UI state (which tab is open, selected profile in the UI, etc.) unless it
 *   is actually passed into the scoring input (see below).
 *
 * What DOES go in the hash today:
 * - Normalized source text (see normalizeForHash — conservative whitespace
 *   normalization only; this is NOT semantic evidence canonicalization,
 *   which is a separate, harder problem (Phase 5) that this module does not
 *   attempt. Wording changes that alter meaning correctly produce a
 *   different hash and a fresh extraction.)
 * - The intelligence pipeline version (extraction + normalization + prompts
 *   bundled as one version today — see INTELLIGENCE_PIPELINE_VERSION below;
 *   split into separate extraction/normalization/prompt versions later if
 *   they ever need to change independently of each other).
 * - The scoring version (SCORE_VERSION from scoring-engine.ts).
 *
 * What SHOULD go in the hash but doesn't yet, because it doesn't yet
 * legitimately affect the score: organization config and Revenue Identity
 * context. As of this sprint, OrchestratorOptions like hasCredibleIdentity /
 * hasRelevantProof are never actually passed by any call site — they're
 * always inferred from the extracted content itself (see orchestrator.ts's
 * infer* functions), so they're not independent inputs yet. If/when a real
 * org-config or Revenue-Identity-dependent input is wired in, it MUST be
 * added to buildIntelligenceInputHash's parameters and folded into the hash,
 * or reuse will silently ignore a real source of variance.
 */

import { createHash } from 'node:crypto'
import { SCORE_VERSION } from './scoring-engine'
import { BUYER_INTENT_VERSION } from '@/lib/intelligence-v3/buyer-intent'

/**
 * Bumps whenever Pass A/B/C extraction logic, prompts, or schemas change in
 * a way that could produce different canonical evidence for the same input.
 * Increment this — do not silently change extraction behavior under the same
 * version number, or historical reuse will incorrectly serve pre-change
 * results as if they reflected current logic.
 */
// Buyer-intent rules feed the commercial reading, so a buyer-intent bump
// must invalidate reused V2 results too.
export const INTELLIGENCE_PIPELINE_VERSION = `intelligence_pipeline_v1+${BUYER_INTENT_VERSION}`

/**
 * Conservative whitespace-only normalization. Deliberately does NOT lowercase,
 * strip punctuation, reorder lines, or attempt any semantic canonicalization —
 * that would risk conflating inputs that are actually different (e.g. two
 * different job posts that happen to share a lot of boilerplate). Only
 * collapses variation that is unambiguously cosmetic:
 * - leading/trailing whitespace on the whole text and each line
 * - runs of blank lines down to a single blank line
 * - runs of horizontal whitespace down to a single space
 * - line-ending style (CRLF/CR -> LF)
 */
export function normalizeForHash(rawText: string): string {
  return rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface IntelligenceInputHashParams {
  rawText: string
  /** Bundled extraction+normalization+prompt version. Defaults to the current pipeline version. */
  pipelineVersion?: string
  /** Scoring model version. Defaults to the current score version. */
  scoreVersion?: string
}

/**
 * Deterministic sha256 hash of the normalized input + relevant versions.
 * Same rawText (modulo whitespace) + same versions => same hash => safe to
 * reuse a persisted canonical intelligence result instead of re-extracting.
 */
export function buildIntelligenceInputHash(params: IntelligenceInputHashParams): string {
  const pipelineVersion = params.pipelineVersion ?? INTELLIGENCE_PIPELINE_VERSION
  const scoreVersion = params.scoreVersion ?? SCORE_VERSION
  const normalized = normalizeForHash(params.rawText)

  // Explicit field separators + lengths prevent trivial collision between
  // e.g. rawText ending in "v1" and a version field starting with "1" —
  // not a real cryptographic concern at sha256, but keeps the preimage
  // unambiguous for debugging.
  const preimage = [
    `pipeline:${pipelineVersion}`,
    `score:${scoreVersion}`,
    `text_len:${normalized.length}`,
    `text:${normalized}`,
  ].join('\n---\n')

  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}
