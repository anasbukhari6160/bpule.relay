/** BUG-LEAD-006 — a hiring count is shown/scored only when the source states it. */
import { describe, expect, it } from 'vitest'
import { extractSignals } from '@/lib/scoring/signal-extractor'
import { computeCompositeScore } from '@/lib/scoring/composite-scorer'
import { parseHiringCount } from '@/lib/evidence/provenance'

function companyEvidence(text: string): string[] {
  const c = computeCompositeScore({ signals: extractSignals(text) })
  return c.dimensions.find((d) => d.key === 'companyQuality')!.evidence
}

describe('BUG-LEAD-006 unsupported hiring count', () => {
  it('reported class: keyword-heavy text never becomes "Hiring 10+ roles"', () => {
    const text = [
      'Senior Engineer at Northwind', 'Looking for new challenges.', 'Seeking a position in platform engineering.',
      'Open to a position in data. Looking for remote work. Seeking growth.', 'Previous position: lead.', 'Looking for mentors.',
      'Seeking feedback on my position paper.', 'We are hiring. Looking for referrals. Seeking collaborators.',
    ].join('\n')
    expect(extractSignals(text).company.hiringCount).toBe(0)
    expect(companyEvidence(text).join(' ')).not.toMatch(/\d+\+? roles/)
  })

  it.each([
    ["We're hiring!", null],
    ['Hiring a developer for our team', null],
    ['Hiring 3 developers this month', 3],
    ['We have 10 open roles across engineering', 10],
    ['Hiring for multiple roles', null],
    ['Our team is growing fast', null],
    // Independent-review break attempts.
    ['Top 10 open source contributors this year', null],
    ['5 years experience hiring 3 people', null],
    ['I have held 4 positions at startups', null],
    ['Shipped 10 jobs to production', null],
    ['Need 5 people to review my app', null],
    ['100 roles placed as recruiter', null],
    ['We have 3 new engineering positions', 3],
  ])('%s → count %s', (text, count) => {
    expect(parseHiringCount(text)?.value ?? null).toBe(count)
  })

  it('stated count is shown with provenance; generic hiring shows no number', () => {
    expect(companyEvidence('We are hiring 3 developers.\nApply now.').join(' ')).toMatch(/Hiring 3 roles \(stated in source\)/)
    const generic = companyEvidence("We're hiring a React developer to join our team.")
    expect(generic.join(' ')).toMatch(/Hiring \(no role count stated\)/)
    expect(generic.join(' ')).not.toMatch(/\d+ role/)
  })

  it('control: funding vocabulary is not a funding event', () => {
    expect(extractSignals('We serve 2 million users and venture into new markets.').company.fundingMentioned).toBe(false)
    expect(extractSignals('We raised a $4M seed round led by Acme Ventures.').company.fundingMentioned).toBe(true)
  })
})

// Fourth review: real counts on lines that mention years/experience; a stated
// opening earns hiring credit; someone else's hiring earns none.
describe('BUG-LEAD-006 stated counts in context', () => {
  function companyEvidenceWithSource(text: string): string[] {
    const c = computeCompositeScore({ signals: extractSignals(text), rawText: text })
    return c.dimensions.find((d) => d.key === 'companyQuality')!.evidence
  }

  it.each([
    ['We are hiring 5 engineers this year', 5],
    ['Hiring 4 developers. Experience with React required.', 4],
    ['We are hiring 3 engineers with 5+ years of experience', 3],
    ['We have 6 open positions', 6],
    ['5 years experience hiring 3 people', null],
    ['Filled 150+ roles for clients', null],
  ])('%s → %s', (text, value) => {
    expect(parseHiringCount(text)?.value ?? null).toBe(value)
  })

  it('a stated opening of our own earns hiring credit', () => {
    expect(companyEvidenceWithSource('Northwind Apps\nWe have 6 open positions on the mobile team.').join(' ')).toMatch(/Hiring 6 roles \(stated in source\)/)
  })

  it("someone else's hiring earns no hiring credit", () => {
    const evidence = companyEvidenceWithSource('Reposted from @founder:\nVia @founder: They are hiring 3 engineers for their fintech app.').join(' ')
    expect(evidence).not.toMatch(/Hiring \d+ roles?/)
  })
})
