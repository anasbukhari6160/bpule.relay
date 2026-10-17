/** BUG-CL-005 — only quotes found in the research earn verified credit. */
import { describe, expect, it } from 'vitest'
import { verifyQuote } from '@/lib/evidence/provenance'
import { computeScore } from '@/lib/score/rubric'
import { RULEBOOK as DEFAULT_RULEBOOK } from './helpers'
import type { ExtractedLead } from '@/lib/domain/types'

const RAW = `Sarah Lane
CTO at Fieldnote Apps
"Our release cycle is killing us, we need outside help to ship faster."
We are looking for a development agency.
About
I lead a team of four engineers.`

const quotePoints = (q: string | null, raw: string | undefined = RAW) => {
  const lead = { name: 'S', title: 'CTO', company: 'F', url: null, locationRaw: null, signalType: 7, signalEvidence: 'x', verbatimQuote: q } as unknown as ExtractedLead
  return computeScore(lead, DEFAULT_RULEBOOK, { sourceText: raw }).breakdown.find((r) => r.label === 'Verbatim quote')!
}

describe('BUG-CL-005 verbatim quote', () => {
  it('reported: fabricated quote → 0 points and flagged', () => {
    const row = quotePoints('This sentence does not exist anywhere in the original research.')
    expect(row.points).toBe(0)
    expect(row.verification).toBe('UNSUPPORTED')
    expect(row.note).toMatch(/could not be found/)
  })

  it.each([
    ['Our release cycle is killing us, we need outside help to ship faster.', 'VERIFIED_EXACT'],
    ['our release cycle is KILLING us, we need outside help to ship faster.', 'VERIFIED_NORMALIZED'],
    ['Our release   cycle is killing us,\nwe need outside help', 'VERIFIED_NORMALIZED'],
    ['“Our release cycle is killing us, we need outside help to ship faster.”', 'VERIFIED_EXACT'],
    ['we need outside help to ship faster', 'VERIFIED_EXACT'],
    ['Their releases are slow and they want help', 'NOT_FOUND'],
    ['I lead a team of four engineers. We are looking', 'NOT_FOUND'],
    // Independent-review break attempts: elisions and end punctuation.
    ['Our release cycle is killing us … to ship faster.', 'VERIFIED_NORMALIZED'],
    ['Our release cycle is killing us... we need outside help', 'VERIFIED_NORMALIZED'],
    ['we need outside help to ship faster!', 'VERIFIED_NORMALIZED'],
    ['Our release cycle is killing us … we never asked anyone', 'NOT_FOUND'],
    // Found, but too short to be evidence of anything: no credit either way.
    ['ship', 'AMBIGUOUS'],
  ])('%j → %s', (quote, status) => {
    expect(verifyQuote(quote, RAW).status).toBe(status)
  })

  it('ambiguous short quotes earn no credit', () => {
    expect(quotePoints('ship').points).toBe(0)
  })

  it('verified quote scores 1; user text is kept, never rewritten', () => {
    const row = quotePoints('we need outside help to ship faster')
    expect(row.points).toBe(1)
    expect(row.sourceQuote).toBe('we need outside help to ship faster')
  })

  it('control: no source supplied → legacy behaviour; empty source → unverifiable, 0', () => {
    const lead = { name: 'S', title: 'CTO', company: 'F', url: null, locationRaw: null, signalType: 7, signalEvidence: 'x', verbatimQuote: 'anything at all here' } as unknown as ExtractedLead
    expect(computeScore(lead, DEFAULT_RULEBOOK).breakdown.find((r) => r.label === 'Verbatim quote')!.points).toBe(1)
    expect(quotePoints('anything at all here', '').points).toBe(0)
  })
})
