/** BUG-LEAD-005 — one display policy: same stored lead, same score everywhere. */
import { describe, expect, it } from 'vitest'
import { getLeadDisplayScore, displayScoreFromCanonical } from '@/lib/scoring/display-score'
import { displayScoreForCanonical, qualificationForDisplayValue, qualifyCanonicalScore } from '@/lib/scoring/qualification'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { LeadScoreRing } from '@/components/score-ring'

const V3 = 'relay_decision_v3.2.0'

describe('BUG-LEAD-005 score consistency', () => {
  it('reported: the same stored lead shows the same /10 on list rows, detail and ring', () => {
    const listRow = { canonicalScore: 42, score: 9, displayQualification: 'maybe', displayIntelligenceVersion: V3 }
    const detail = { canonicalScore: 42, score: 9, canonicalIntelligence: { qualification: 'maybe', intelligenceVersion: V3 } }
    const asJsonString = { canonicalScore: 42, score: 9, canonicalIntelligence: JSON.stringify({ qualification: 'maybe', intelligenceVersion: V3 }) }
    const expected = `${displayScoreForCanonical(42)}/10`
    for (const lead of [listRow, detail, asJsonString]) expect(getLeadDisplayScore(lead).text).toBe(expected)
    const html = renderToStaticMarkup(createElement(LeadScoreRing, { lead: listRow, size: 38 }))
    expect(html).toContain(`>${displayScoreForCanonical(42)}<`)
  })

  it.each([
    [0, 1], [14, 1], [15, 2], [24, 2], [25, 3], [34, 3], [35, 4], [44, 4], [45, 5], [54, 5],
    [55, 6], [64, 6], [65, 7], [74, 7], [75, 8], [82, 8], [83, 9], [91, 9], [92, 10], [100, 10],
  ])('canonical %i → %i/10 regardless of the stored qualification string', (canonical, expected) => {
    expect(getLeadDisplayScore({ canonicalScore: canonical, displayQualification: 'maybe', displayIntelligenceVersion: V3 }).value).toBe(expected)
    expect(getLeadDisplayScore({ canonicalScore: canonical, displayIntelligenceVersion: 'relay_qualification_v2' }).value).toBe(expected)
    expect(displayScoreFromCanonical({ canonicalScore: canonical })).toBe(expected)
  })

  it('a /10 value never spans two qualification bands', () => {
    for (let s = 0; s <= 100; s++) {
      const v = displayScoreForCanonical(s)
      expect(qualificationForDisplayValue(v)).toBe(qualifyCanonicalScore(s).qualification)
    }
  })

  it('display is monotonic in the canonical score', () => {
    let prev = -1
    for (let s = 0; s <= 100; s++) {
      const v = displayScoreForCanonical(s)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('a stale stored qualification is flagged, not trusted', () => {
    const d = getLeadDisplayScore({ canonicalScore: 80, displayQualification: 'maybe', displayIntelligenceVersion: V3 })
    expect(d.qualification).toBe('STRONG')
    expect(d.staleQualification).toBe(true)
  })

  it('control: legacy-only lead shows its 0-12 rubric score; unscored shows —', () => {
    expect(getLeadDisplayScore({ canonicalScore: null, score: 8 }).text).toBe('8/12')
    expect(getLeadDisplayScore({ canonicalScore: null, score: null }).text).toBe('—')
  })
})
