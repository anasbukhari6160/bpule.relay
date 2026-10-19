/** BUG-LEAD-005 — one display policy: same stored lead, same score everywhere. */
import { describe, expect, it } from 'vitest'
import { getLeadDisplayScore, displayScoreFromCanonical } from '@/lib/scoring/display-score'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { LeadScoreRing } from '@/components/score-ring'

const V3 = 'relay_decision_v3.1.0'

describe('BUG-LEAD-005 score consistency', () => {
  it('reported: canonical 42 + maybe shows 5/10 on list rows and detail alike', () => {
    // Pipeline/dashboard rows: list query exposes qualification via JSON path.
    const listRow = { canonicalScore: 42, score: 9, displayQualification: 'maybe', displayIntelligenceVersion: V3 }
    // Lead Detail: full canonical blob.
    const detail = { canonicalScore: 42, score: 9, canonicalIntelligence: { qualification: 'maybe', intelligenceVersion: V3 } }
    const asJsonString = { canonicalScore: 42, score: 9, canonicalIntelligence: JSON.stringify({ qualification: 'maybe', intelligenceVersion: V3 }) }
    for (const lead of [listRow, detail, asJsonString]) expect(getLeadDisplayScore(lead).text).toBe('5/10')
    // The ring renders that same number (no local /10 rounding).
    const html = renderToStaticMarkup(createElement(LeadScoreRing, { lead: listRow, size: 38 }))
    expect(html).toContain('>5<')
  })

  it.each([
    [0, 'skip', 1], [19, 'skip', 2], [20, 'skip', 2], [35, 'maybe', 4], [40, 'maybe', 4], [48, 'maybe', 6],
    [49, 'maybe', 6], [50, 'maybe', 6], [54, 'maybe', 6], [60, 'worth_pursuing', 6], [79, 'worth_pursuing', 7], [80, 'strong', 9], [100, 'strong', 10],
  ])('V3 canonical %i (%s) → %i/10', (canonical, qualification, expected) => {
    expect(getLeadDisplayScore({ canonicalScore: canonical, displayQualification: qualification, displayIntelligenceVersion: V3 }).value).toBe(expected)
  })

  it.each([[0, 0], [19, 2], [20, 2], [39, 4], [40, 4], [49, 5], [50, 5], [59, 6], [60, 6], [79, 8], [80, 8], [100, 10]])(
    'pre-V3 canonical %i → %i/10 (round /10 policy)', (canonical, expected) => {
      expect(getLeadDisplayScore({ canonicalScore: canonical, displayIntelligenceVersion: 'relay_qualification_v2' }).value).toBe(expected)
      expect(displayScoreFromCanonical({ canonicalScore: canonical })).toBe(expected)
    })

  it('control: legacy-only lead shows its 0-12 rubric score; unscored shows —', () => {
    expect(getLeadDisplayScore({ canonicalScore: null, score: 8 }).text).toBe('8/12')
    expect(getLeadDisplayScore({ canonicalScore: null, score: null }).text).toBe('—')
  })
})
