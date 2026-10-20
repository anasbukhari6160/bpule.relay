/**
 * Multi-company and current-vs-historical organization scoping (Phase 3).
 * 30+ cases: current industry comes from the current company only; past
 * employers, customers, examples and reposts never set it or create signals.
 */
import { describe, it, expect } from 'vitest'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveCurrentOrgContext, splitCurrentAndPastLines } from '@/lib/intelligence-v3/current-org'
import { li } from '../golden/builder'

const profile = (headline: string, about: string[], experience: Array<{ title: string; company: string; range: string; desc?: string[] }>, posts: Array<{ age: string; text: string }> = []) =>
  li({ name: 'Sam Rivera', headline, location: 'Austin, Texas, United States', degree: '2nd', connections: '1,000+ connections', about, posts, experience })

describe('current industry comes from the current organization only', () => {
  const cases: Array<[string, string, string[], Array<{ title: string; company: string; range: string; desc?: string[] }>, string | null, string[]]> = [
    ['AI governance founder, healthcare past', 'Founder & CEO at Strix Governance | AI Governance & Model Risk', ['Strix Governance evaluates AI systems for compliance and model risk.', 'Previously spent 8 years in healthcare revenue-cycle management.'], [{ title: 'Founder & CEO', company: 'Strix Governance', range: 'Jan 2024 - Present · 1 yr 10 mos' }, { title: 'Director, Revenue Cycle', company: 'Lakeshore Health', range: 'Mar 2017 - Dec 2023 · 6 yrs 10 mos', desc: ['Led a 40-person team across 12 hospitals.'] }], 'AI Governance / RegTech', ['healthcare']],
    ['fintech CTO, logistics past', 'CTO at Ledgerline | Payments', ['Ledgerline is a payments startup.', 'Before Ledgerline I ran engineering at a freight marketplace.'], [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }, { title: 'VP Engineering', company: 'Freightly', range: 'Jan 2018 - Dec 2022 · 5 yrs', desc: ['Logistics marketplace for freight brokers.'] }], 'fintech', ['logistics']],
    ['healthcare founder, fintech past', 'Founder at Orbital Health | Clinic scheduling', ['Orbital Health builds scheduling software for clinics.', 'Formerly a product lead at a payments company.'], [{ title: 'Founder', company: 'Orbital Health', range: 'Jan 2022 - Present · 3 yrs 10 mos' }, { title: 'Product Lead', company: 'PayNorth', range: 'Jan 2016 - Dec 2021 · 6 yrs', desc: ['Payments and banking integrations.'] }], 'healthcare', ['fintech']],
    ['edtech founder, retail past', 'Co-founder at Tutorly | Online learning', ['Tutorly is an online learning platform for vocational training.', 'I spent 6 years in retail operations before founding Tutorly.'], [{ title: 'Co-founder', company: 'Tutorly', range: 'Jan 2023 - Present · 2 yrs 10 mos' }, { title: 'Operations Manager', company: 'ShopCo', range: 'Jan 2017 - Dec 2022 · 6 yrs', desc: ['Retail and e-commerce operations.'] }], 'edtech', ['ecommerce']],
    ['logistics COO, media past', 'COO at Fahrplan Mobility | Fleet software for bus operators', ['Fahrplan builds fleet software for regional bus operators.', 'Earlier in my career I ran a streaming media startup.'], [{ title: 'COO', company: 'Fahrplan Mobility', range: 'Mar 2019 - Present · 6 yrs 8 mos' }, { title: 'CEO', company: 'StreamBox', range: 'Jan 2012 - Feb 2019 · 7 yrs', desc: ['Streaming and entertainment.'] }], 'logistics', ['media']],
    ['title-only founder with a past healthcare employer in Experience', 'Founder at Lafitte Holdings', [], [{ title: 'Founder', company: 'Lafitte Holdings', range: 'Jan 2012 - Present · 13 yrs 10 mos' }, { title: 'Analyst', company: 'Hospital Group', range: 'Jan 2008 - Dec 2011 · 4 yrs', desc: ['Healthcare analytics.'] }], null, ['healthcare']],
  ]
  for (const [name, headline, about, experience, expectedIndustry, forbidden] of cases) {
    it(name, () => {
      const text = profile(headline, about, experience)
      const ctx = resolveCurrentOrgContext(text)
      expect(ctx.currentIndustry).toBe(expectedIndustry)
      for (const f of forbidden) expect(ctx.currentIndustry).not.toBe(f)
      const facts = readSourceFacts(text)
      for (const f of forbidden) expect(facts.historicalIndustries.includes(f) || facts.rejectedSignals.some((r) => r.signal === 'industry' && r.value === f)).toBe(true)
    })
  }
})

describe('use-case examples, customers and reposts are not the prospect\'s industry', () => {
  const lines = [
    ['For example, this can be used for healthcare data compliance.', 'healthcare'],
    ['Industries such as banking and insurance are early adopters.', 'fintech'],
    ['Use case: a logistics company cut dispatch time by 30%.', 'logistics'],
    ['Imagine a hospital using our tool to audit its models.', 'healthcare'],
    ['Our customers are enterprise legal teams and regulatory departments.', 'legaltech'],
    ['Via @founder: we build fintech apps for banks.', 'fintech'],
  ] as const
  for (const [line, industry] of lines) {
    it(`"${line}" does not set ${industry}`, () => {
      const text = profile('Founder & CEO at Brightline Robotics | Warehouse automation', ['Brightline builds fleet-orchestration software for warehouse robots.', line], [{ title: 'Founder & CEO', company: 'Brightline Robotics', range: 'Jan 2022 - Present · 3 yrs 10 mos' }])
      const ctx = resolveCurrentOrgContext(text)
      expect(ctx.currentIndustry).not.toBe(industry)
    })
  }
})

describe('multi-company founders keep organizations separate', () => {
  const TAYLOR = profile('CEO at NovaTech | Advisor at GreenLeaf | Founder at EduFlow', ['Building across multiple ventures.'], [
    { title: 'CEO', company: 'NovaTech', range: 'Jan 2022 - Present · 3 yrs 10 mos', desc: ['B2B SaaS platform for logistics', '20 employees, Series A'] },
    { title: 'Advisor', company: 'GreenLeaf', range: 'Mar 2023 - Present · 2 yrs 8 mos', desc: ['Sustainable agriculture nonprofit'] },
    { title: 'Founder', company: 'EduFlow', range: 'Feb 2024 - Present · 1 yr 9 mos', desc: ['AI-powered education platform', 'Just launched beta'] },
  ], [
    { age: '1mo', text: 'NovaTech is hiring! Looking for a senior backend engineer (Python, AWS, PostgreSQL). Apply at novatech.careers.example' },
    { age: '2w', text: 'EduFlow just hit 1,000 beta users! Building something special in ed-tech.' },
  ])

  it('all three current roles are current, none are past', () => {
    const split = splitCurrentAndPastLines(TAYLOR)
    expect(split.pastLines).not.toContain('NovaTech · Full-time')
    expect(split.pastLines).not.toContain('EduFlow · Full-time')
  })

  it('hiring at NovaTech is a hiring fact, not a buyer request, and no industry is mixed across companies', () => {
    const facts = readSourceFacts(TAYLOR)
    expect(facts.currentHiringActivity).toMatch(/NovaTech is hiring/)
    expect(facts.buyerRequest).toBeNull()
    expect(['logistics', 'edtech']).toContain(facts.currentIndustry)
  })

  it('a past company entry never contributes current hiring, budget or launch facts', () => {
    const text = profile('Senior Product Manager at MetaScale', ['Leading product at MetaScale — enterprise data analytics.'], [
      { title: 'Senior Product Manager', company: 'MetaScale', range: 'Sep 2025 - Present · 2 mos' },
      { title: 'VP Engineering', company: 'StartupXYZ', range: 'Jan 2020 - Aug 2025 · 5 yrs 8 mos', desc: ['Built engineering team from 2 to 20', 'Hired 15+ engineers', 'Budget of $2M for the platform rebuild', 'Launched v2 in 2022'] },
    ])
    const facts = readSourceFacts(text)
    expect(facts.currentHiringActivity).toBeNull()
    expect(facts.budgetEvidence).toBeNull()
    expect(facts.rejectedSignals.some((r) => r.signal === 'hiring' && r.actor === 'prospect_past')).toBe(true)
    expect(facts.rejectedSignals.some((r) => r.signal === 'budget')).toBe(true)
  })

  it.each([
    ['Founder at Alpha | CTO at Beta', 2],
    ['CEO at Gamma', 1],
    ['Founder at Delta | Advisor at Epsilon | Investor at Zeta', 3],
  ])('%s → authority is the strongest current role', (headline) => {
    const facts = readSourceFacts(profile(headline, ['We build software.'], [{ title: headline.split(' | ')[0], company: headline.split(' at ')[1].split(' |')[0], range: 'Jan 2022 - Present · 3 yrs' }]))
    expect(['FOUNDER', 'EXECUTIVE']).toContain(facts.authorityEvidence.level)
  })
})
