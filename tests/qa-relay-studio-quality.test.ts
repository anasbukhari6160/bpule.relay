/**
 * QA RELAY — Studio post quality gate (BUG-11-11).
 *
 * Deterministic: a generated post must never surface malformed phrases, the
 * model's writing instructions, template markers, or unsupported metric claims.
 */
import { describe, expect, it } from 'vitest'
import { evaluatePostQuality } from '@/lib/content/intelligence/v2/daily-brief-engine'

const BASE = `We rebuilt our deploy pipeline last quarter.

The old script took 40 minutes and failed silently half the time.

We measured the new path at 6 minutes and stopped the silent failures.

If you run a similar setup, the same measurement approach works.`

describe('Studio post quality gate — QA BUG-11-11', () => {
  it('accepts a clean, grounded post', () => {
    const r = evaluatePostQuality(BASE)
    expect(r.failures.filter((f) => ['INSTRUCTION_LEAKAGE', 'TEMPLATE_MARKER', 'UNVERIFIED_METRIC'].includes(f))).toEqual([])
  })

  it('rejects writing-instruction leakage', () => {
    const r = evaluatePostQuality(`${BASE}\n\nHere is the post. Let me know if you want a shorter version.`)
    expect(r.failures).toContain('INSTRUCTION_LEAKAGE')
  })

  it('rejects template markers and placeholders', () => {
    const r = evaluatePostQuality(`${BASE}\n\nI helped [Your Company] ship faster. {{client_name}} saw results.`)
    expect(r.failures).toContain('TEMPLATE_MARKER')
  })

  it('rejects an unsupported outcome metric', () => {
    const r = evaluatePostQuality(`${BASE}\n\nTeams that adopt this see 80% faster delivery and 50% fewer bugs.`)
    expect(r.failures).toContain('UNVERIFIED_METRIC')
  })

  it('accepts a metric the persona measured themselves', () => {
    const r = evaluatePostQuality(`${BASE}\n\nWe measured 6 minutes per deploy, down from 40.`)
    expect(r.failures).not.toContain('UNVERIFIED_METRIC')
  })
})
