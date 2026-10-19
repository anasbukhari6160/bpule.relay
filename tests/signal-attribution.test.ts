import { describe, it, expect } from 'vitest'
import {
  classifyTemporalProvenance,
  verifyBudgetProvenance,
  verifyHiringProvenance,
  isHistoricalYear,
  analyzeProductActivity,
  analyzeCustomerSegment,
  isOwnIndustry,
  parseAccessSignals,
  auditSignal,
} from '@/lib/scoring/signal-attribution'

describe('Temporal Provenance', () => {
  it('classifies "Back in September 2011" as HISTORICAL', () => {
    expect(classifyTemporalProvenance('Back in September 2011, I launched a studio')).toBe('HISTORICAL')
  })

  it('classifies "when I ran this company" as HISTORICAL', () => {
    expect(classifyTemporalProvenance('when I ran this company we hired 5 people')).toBe('HISTORICAL')
  })

  it('classifies "2016 to 2020" as HISTORICAL', () => {
    expect(classifyTemporalProvenance('From 2016 to 2020 I worked at Google')).toBe('HISTORICAL')
  })

  it('classifies "currently building" as CURRENT', () => {
    expect(classifyTemporalProvenance('We are currently building a new product')).toBe('CURRENT')
  })

  it('classifies "just launched" as CURRENT', () => {
    expect(classifyTemporalProvenance('We just launched Inspektor')).toBe('CURRENT')
  })

  it('classifies "5 years ago" as HISTORICAL', () => {
    expect(classifyTemporalProvenance('5 years ago I started this company')).toBe('HISTORICAL')
  })

  it('detects historical years', () => {
    expect(isHistoricalYear('In 2011 we raised funding')).toBe(true)
    expect(isHistoricalYear('Back in 2015 I was at Microsoft')).toBe(true)
    expect(isHistoricalYear('Currently hiring')).toBe(false)
  })
})

describe('Budget Provenance', () => {
  it('rejects historical budget mention', () => {
    const result = verifyBudgetProvenance('A reasonable budget was needed to build a studio back in 2011')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('historical')
  })

  it('rejects "budget needed to build" (past)', () => {
    const result = verifyBudgetProvenance('The budget was $50k to build the MVP')
    expect(result.valid).toBe(false)
  })

  it('rejects advice/example budget', () => {
    const result = verifyBudgetProvenance('For example, a reasonable budget is $10k')
    expect(result.valid).toBe(false)
  })

  it('rejects product metrics as budget', () => {
    const result = verifyBudgetProvenance('Our LTV is $500 and CPI is $50')
    expect(result.valid).toBe(false)
  })

  it('accepts current budget', () => {
    const result = verifyBudgetProvenance('We have a $15k budget approved for this project')
    expect(result.valid).toBe(true)
  })

  it('accepts current project value', () => {
    const result = verifyBudgetProvenance('Looking for a developer. Project value is $8k fixed price')
    expect(result.valid).toBe(true)
  })
})

describe('Hiring Provenance', () => {
  it('rejects historical hiring ("people hired to protect")', () => {
    const result = verifyHiringProvenance('We had people hired to protect the platform')
    expect(result.valid).toBe(false)
  })

  it('rejects candidate language', () => {
    const result = verifyHiringProvenance('I am looking for contract opportunities')
    expect(result.valid).toBe(false)
  })

  it('rejects headcount descriptions', () => {
    const result = verifyHiringProvenance('Our team size is 50 people')
    expect(result.valid).toBe(false)
  })

  it('accepts current hiring', () => {
    const result = verifyHiringProvenance('We are hiring a React developer')
    expect(result.valid).toBe(true)
  })

  it('accepts explicit open roles', () => {
    const result = verifyHiringProvenance('We have 3 open positions for senior engineers')
    expect(result.valid).toBe(true)
  })
})

describe('Customer Segment vs Company Size', () => {
  it('separates "Enterprise buyers" from company size', () => {
    const result = analyzeCustomerSegment('Enterprise buyers require custom solutions')
    expect(result.targetCustomerSegment).toBe('enterprise')
    expect(result.companySizeEvidence).toBeNull()
  })

  it('extracts actual company size from employee count', () => {
    const result = analyzeCustomerSegment('We are a team of 500 people')
    expect(result.companySizeEvidence).toBe('mid')
  })

  it('does not inflate company size from target market', () => {
    const result = analyzeCustomerSegment('Our customers are enterprise companies')
    expect(result.targetCustomerSegment).toBeTruthy()
    expect(result.companySizeEvidence).toBeNull()
  })
})

describe('Industry Scoping', () => {
  it('rejects use-case example as own industry', () => {
    expect(isOwnIndustry('For example, this can be used for healthcare data')).toBe(false)
  })

  it('accepts own industry with ownership markers', () => {
    expect(isOwnIndustry('We are a LegalTech company building compliance tools')).toBe(true)
  })

  it('accepts industry from role line', () => {
    expect(isOwnIndustry('Co-Founder at TrustTroiAI — AI Governance')).toBe(true)
  })

  it('rejects "helps with" as own industry', () => {
    expect(isOwnIndustry('This helps with healthcare compliance')).toBe(false)
  })
})

describe('Product Activity vs Buyer Intent', () => {
  it('detects current product activity without buyer intent', () => {
    const result = analyzeProductActivity('Inspektor is live. Building feedback loop with first users.')
    expect(result.hasCurrentProductActivity).toBe(true)
    expect(result.hasBuyerIntent).toBe(false)
  })

  it('detects buyer intent separately', () => {
    const result = analyzeProductActivity('Looking for a developer to help scale our product')
    expect(result.hasBuyerIntent).toBe(true)
  })

  it('does not confuse launch with buyer budget', () => {
    const result = analyzeProductActivity('We just launched our new SaaS platform. Currently in beta.')
    expect(result.hasCurrentProductActivity).toBe(true)
    expect(result.hasBuyerIntent).toBe(false)
    expect(result.productName).toBeTruthy()
  })
})

describe('Access/Mutual Consistency', () => {
  it('parses named mutual connections', () => {
    const result = parseAccessSignals('John Smith, Jane Doe and 5 other mutual connections')
    expect(result.mutualConnections).toBe(7)
    expect(result.canMessage).toBe(true)
  })

  it('parses direct mutual count', () => {
    const result = parseAccessSignals('42 mutual connections')
    expect(result.mutualConnections).toBe(42)
  })

  it('marks 1st degree correctly', () => {
    const result = parseAccessSignals('· 1st')
    expect(result.connectionDegree).toBe('1st')
    expect(result.canMessage).toBe(true)
  })
})

describe('Attribution Audit', () => {
  it('audits historical launch as unverified', () => {
    const audit = auditSignal({
      signal: 'launch',
      value: true,
      sourceQuote: 'Back in 2011, we launched a new product',
    })
    expect(audit.verified).toBe(false)
    expect(audit.temporalClass).toBe('HISTORICAL')
  })

  it('audits current budget as verified', () => {
    const audit = auditSignal({
      signal: 'budget',
      value: '$15k',
      sourceQuote: 'We have a $15k budget approved for this project',
    })
    expect(audit.verified).toBe(true)
  })

  it('rejects historical budget in audit', () => {
    const audit = auditSignal({
      signal: 'budget',
      value: '$50k',
      sourceQuote: 'A reasonable budget was needed to build the studio back in 2011',
    })
    expect(audit.verified).toBe(false)
    expect(audit.rejectionReason).toBeTruthy()
  })
})

describe('Golden Regressions', () => {
  it('Thorsten: historical launch should not count as current', () => {
    const text = 'Back in September 2011, I designed and launched a new studio'
    expect(classifyTemporalProvenance(text)).toBe('HISTORICAL')
    const audit = auditSignal({ signal: 'launch', value: true, sourceQuote: text })
    expect(audit.verified).toBe(false)
  })

  it('Thorsten: historical budget should not count as current budget', () => {
    const text = 'A reasonable budget was needed to build a studio'
    expect(verifyBudgetProvenance(text).valid).toBe(false)
  })

  it('Thorsten: people hired to protect should not be hiring signal', () => {
    const text = 'We had people hired to protect the platform'
    expect(verifyHiringProvenance(text).valid).toBe(false)
  })

  it('Harold: enterprise buyers should not inflate company size', () => {
    const result = analyzeCustomerSegment('Enterprise buyers require custom solutions and dedicated support')
    expect(result.targetCustomerSegment).toBe('enterprise')
    expect(result.companySizeEvidence).toBeNull()
  })

  it('Harold: current product activity without buyer intent', () => {
    const text = 'Inspektor is live. Building feedback loop with first users before we scale.'
    const result = analyzeProductActivity(text)
    expect(result.hasCurrentProductActivity).toBe(true)
    expect(result.hasBuyerIntent).toBe(false)
  })

  it('Harold: LegalTech company should not become healthcare', () => {
    const line = 'For example, this can be used for healthcare data'
    expect(isOwnIndustry(line)).toBe(false)
  })
})
