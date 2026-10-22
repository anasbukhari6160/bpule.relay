/**
 * Static architecture guard: raw source text may be interpreted once.
 *
 * The canonical reader is `readSourceFacts` (src/lib/intelligence-v3/source-facts-model.ts).
 * Every module in the scoring / routing / action / message / UI-reasoning paths
 * must consume the facts it produces. This test fails if any of those modules
 * calls a raw parser or the canonical reader again, so a future "quick fix"
 * cannot silently reintroduce a second interpretation of the profile.
 *
 * Allowed raw readers (excluded from the scan):
 *   - the reader and its helpers: source-facts-model, source-facts, current-org,
 *     buyer-intent, source-segmenter, multilingual
 *   - reader helpers: scoring/signal-extractor, scoring/signal-attribution,
 *     evidence/provenance
 *   - ingestion / input sanity: prospect/paste-normalize, prospect/qualification-gate
 *   - the legacy V2 pipeline, Upwork, onboarding and CV extraction
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

/** Downstream modules that must never read raw source text. */
const FORBIDDEN_PREFIXES = [
  'lib/intelligence-v3/scoring',
  'lib/intelligence-v3/decision',
  'lib/intelligence-v3/action',
  'lib/intelligence-v3/dimensions.ts',
  'lib/intelligence-v3/bridge.ts',
  'lib/scoring-v4',
  'lib/relay',
  'lib/scoring',
  'components',
]

/** Reader helpers that live under lib/scoring but belong to the canonical reader. */
const READER_HELPERS = new Set([
  'lib/scoring/signal-extractor.ts',
  'lib/scoring/signal-attribution.ts',
])

/**
 * The canonical read point. `readSourceFacts` is invoked exactly once per
 * analysis, here; every other module receives the facts it returns.
 */
const CANONICAL_READ_POINTS = new Set(['lib/intelligence-v3/bridge.ts'])

/** The canonical reader and every independent raw parser it owns. */
const RAW_READERS = [
  'readSourceFacts(',
  'readBuyerSourceFacts(',
  'resolveBuyerIntentFromSource(',
  'detectCommercialRequest(',
  'isCandidateSeeking(',
  'isEmploymentHiringNotPurchase(',
  'findContactInstruction(',
  'deriveCommercialReading(',
  'extractSignals(',
  'detectSellerOwnership(',
  'resolveCurrentOrgContext(',
  'splitCurrentAndPastLines(',
  'classifyLine(',
  'extractStatedBudget(',
  'extractStatedTimeline(',
  'extractExplicitDates(',
  'detectFunding(',
  'parseAccessSignals(',
  'verifyBudgetProvenance(',
  'verifyHiringProvenance(',
  'analyzeCustomerSegment(',
  'isRecruiterProfile(',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

function isForbidden(rel: string): boolean {
  return FORBIDDEN_PREFIXES.some((f) => rel === f || rel.startsWith(`${f}/`))
}

describe('architecture: one raw-text reader', () => {
  it('no downstream module parses raw source text', () => {
    const files = walk(SRC)
      .map((p) => p.slice(SRC.length + 1))
      .filter(isForbidden)
      .filter((rel) => !READER_HELPERS.has(rel))

    const violations: string[] = []
    for (const rel of files) {
      const source = readFileSync(join(SRC, rel), 'utf8')
      for (const reader of RAW_READERS) {
        if (reader === 'readSourceFacts(' && CANONICAL_READ_POINTS.has(rel)) continue
        if (source.includes(reader)) violations.push(`${rel}: ${reader.trim()}`)
      }
    }

    expect(violations).toEqual([])
  })
})
