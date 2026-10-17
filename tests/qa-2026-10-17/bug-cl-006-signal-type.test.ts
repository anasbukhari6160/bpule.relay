/** BUG-CL-006 — a selected signal scores only when the research supports it. */
import { describe, expect, it } from 'vitest'
import { verifySignal, supportedSignals } from '@/lib/evidence/provenance'
import { computeScore } from '@/lib/score/rubric'
import { RULEBOOK as DEFAULT_RULEBOOK } from './helpers'
import type { ExtractedLead, SignalId } from '@/lib/domain/types'

const AGENCY_BRIEF = `Sarah Lane
CTO at Fieldnote Apps
Location: Austin, Texas, USA
We are looking for a software development agency to rebuild our mobile app.`

const signalRow = (signalType: SignalId, raw: string) => {
  const lead = { name: 'S', title: 'CTO', company: 'F', url: null, locationRaw: null, signalType, signalEvidence: 'x', verbatimQuote: null } as unknown as ExtractedLead
  return computeScore(lead, DEFAULT_RULEBOOK, { sourceText: raw, signalOrigin: 'USER_ENTERED' })
}

describe('BUG-CL-006 unsupported signal type', () => {
  it('reported: "Raised money" on an agency brief with no funding → 0 points + warning', () => {
    const result = signalRow(3, AGENCY_BRIEF)
    const row = result.breakdown.find((r) => r.category === 'signal')!
    expect(row.points).toBe(0)
    expect(row.verification).toBe('UNSUPPORTED')
    expect(result.gates.join(' ')).toMatch(/not supported by the research/)
    // The supported choice keeps its weight.
    expect(signalRow(7, AGENCY_BRIEF).breakdown.find((r) => r.category === 'signal')!.points).toBe(7)
  })

  const CASES: Array<[SignalId, string, string]> = [
    [1, "We're hiring two backend engineers.", 'We sell handmade candles.'],
    [2, "I'm a solo founder building this alone.", 'We are a 200-person company.'],
    [3, 'We just raised a $3M seed round.', 'We have 2 million users.'],
    [4, 'Our app is outdated and has not been updated since 2021.', 'We ship weekly.'],
    [5, 'We are migrating off our legacy PHP monolith.', 'Our stack is modern.'],
    [6, 'We keep missing deadlines and the backlog keeps growing.', 'Everything is going well.'],
    [7, 'Looking for a dev shop to take over our mobile app.', 'Happy with our in-house team.'],
  ]
  it.each(CASES)('signal %i: supported text verifies, unrelated text does not', (id, yes, no) => {
    expect(verifySignal(id, yes).signalVerification).toBe('USER_SELECTED_VERIFIED')
    expect(verifySignal(id, no).signalVerification).toBe('USER_SELECTED_UNVERIFIED')
  })

  // Independent-review break attempt: ordinary profiles must not "verify" signals.
  it.each([
    'Priya Shah\nSenior Engineer at Shopify\nSmall team of 4 engineers building checkout.\nFixed bugs and improved customer problems resolution.',
    'Leo Martin\nSolutions Architect\nLed migration of legacy CRMs for enterprise clients.',
    'Ana Costa\nDesigner\nLast updated my portfolio in May.\nJoin our team at Figma community events!',
    'Tom Becker\nTechnical Recruiter at TalentCo\nLooking for developers for multiple clients.',
  ])('generic profile verifies no signal: %#', (profile) => {
    expect(supportedSignals(profile)).toEqual([])
  })

  it('extraction proposes only supported signals; user selection never mutates the research', () => {
    expect(supportedSignals(AGENCY_BRIEF)).toContain(7)
    expect(supportedSignals(AGENCY_BRIEF)).not.toContain(3)
    const before = AGENCY_BRIEF
    signalRow(3, AGENCY_BRIEF)
    expect(AGENCY_BRIEF).toBe(before)
  })
})
