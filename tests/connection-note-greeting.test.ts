import { describe, it, expect } from 'vitest'
import { normalizeGreeting, extractFirstName, validateAndRepair, evaluateConnectionNote, stripPhrasesAnywhere, humanizeConnectionNote } from '@/lib/prospect/connection-note'

describe('humanizeConnectionNote', () => {
  it('removes dashes, slashes, and question marks', () => {
    const note = humanizeConnectionNote('Hi Aneeb, saw the go / integration work - worth a connect?')
    expect(note).not.toMatch(/[?/]| - |—/)
    expect(note).toMatch(/Hi Aneeb, saw the go integration work, worth a connect\./)
  })
})

describe('extractFirstName', () => {
  it('extracts first name from full name', () => {
    expect(extractFirstName('Sarah Chen')).toBe('Sarah')
    expect(extractFirstName('John Smith')).toBe('John')
    expect(extractFirstName('Mary')).toBe('Mary')
  })

  it('returns null for unreliable names', () => {
    expect(extractFirstName(null)).toBeNull()
    expect(extractFirstName('')).toBeNull()
    expect(extractFirstName('A')).toBeNull()
    expect(extractFirstName('   ')).toBeNull()
  })

  it('handles hyphenated names', () => {
    expect(extractFirstName('Anne-Marie Johnson')).toBe('Anne-Marie')
  })
})

describe('normalizeGreeting', () => {
  it('uses first name when full name is used in greeting', () => {
    const result = normalizeGreeting('Hi Sarah Chen, saw your work on Rails.', 'Sarah Chen')
    expect(result).toBe('Hi Sarah, saw your work on Rails.')
  })

  it('leaves natural first-name greeting unchanged', () => {
    const result = normalizeGreeting('Hey Sarah, saw your work.', 'Sarah Chen')
    expect(result).toBe('Hey Sarah, saw your work.')
  })

  it('prepends greeting when none exists and name is available', () => {
    const result = normalizeGreeting('Saw your work on Rails marketplace.', 'Sarah Chen')
    expect(result).toBe('Hi Sarah, saw your work on Rails marketplace.')
  })

  it('does not fabricate name when none available', () => {
    const result = normalizeGreeting('Saw your work on Rails.', null)
    expect(result).toBe('Saw your work on Rails.')
  })

  it('replaces "Hi there" with first name', () => {
    const result = normalizeGreeting('Hi there, saw your profile.', 'Sarah Chen')
    expect(result).toBe('Hi Sarah, saw your profile.')
  })

  it('collapses a multi-token / honorific-like display name to first name without leaving trailing tokens', () => {
    // "MD ABUL MANSUR" is a real multi-token display name (extractFirstName
    // returns "MD", its first token). The greeting-normalization regex
    // previously consumed only ONE extra word after the first name, leaving
    // "Mansur," dangling: "Hi MD Abul Mansur," incorrectly became
    // "Hi MD, Mansur," instead of "Hi MD,".
    const result = normalizeGreeting('Hi MD Abul Mansur, saw your work on XHYRE.', 'MD ABUL MANSUR')
    expect(result).toBe('Hi MD, saw your work on XHYRE.')
    expect(result).not.toMatch(/Hi MD, Mansur,/)
  })
})

describe('validateAndRepair - greeting normalization', () => {
  it('passes clean first-name greeting', () => {
    const result = validateAndRepair({
      text: 'Hi Sarah, saw you are hiring for Rails work.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
  })

  it('repairs surveillance opening', () => {
    const result = validateAndRepair({
      text: 'Hi Sarah, I came across your profile and would love to connect.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    // After repair, the surveillance opening is removed
    expect(result.passed).toBe(true)
    expect(result.repaired).not.toBeNull()
    expect(result.text.toLowerCase()).not.toContain('came across')
  })

  it('rejects questions in connection notes', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, curious about how you are scaling the team?',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.toLowerCase().includes('question'))).toBe(true)
  })

  it('rejects manufactured personalization', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, would love to learn more about your work at Acme.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => /manufactured|curious|would love to learn/i.test(f))).toBe(true)
  })

  it('rejects service descriptions', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, we build Rails apps and I think we can help Acme.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => /service description/i.test(f))).toBe(true)
  })

  it('passes a clean observation-based connection note', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, noticed the Rails migration at Acme. Close to work I have done. Worth connecting.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
  })

  // Regression: budget/funding inference must be contextual, not a blanket word ban.
  // Notes that mention "budget", "spend", or "funding" in the sender's own context
  // (e.g., reducing cloud spend, budget-friendly approach) must NOT be flagged.

  it('does NOT flag a note mentioning cloud spend in sender context', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Erick, I work on cloud architecture and help teams cut cloud spend. Worth connecting.',
      profile: null,
      prospectName: 'Erick Albuquerque',
      prospectCompany: 'Microsoft',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
    expect(result.failures.some((f) => f.includes('funding = budget'))).toBe(false)
  })

  it('does NOT flag a note mentioning budget-friendly approach', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, I work on platform engineering. Budget-friendly infra automation. Worth connecting.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
    expect(result.failures.some((f) => f.includes('funding = budget'))).toBe(false)
  })

  it('does NOT flag a note mentioning cost optimization', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Ben, infra cost optimization is a space I work in daily. Always keen to connect with peers building in that world.',
      profile: null,
      prospectName: 'Ben Stone',
      prospectCompany: 'FanDuel',
      matchedProof: [],
    })
    expect(result.passed).toBe(true)
    expect(result.failures.some((f) => f.includes('funding = budget'))).toBe(false)
  })

  it('STILL flags actual funding-to-budget inference', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, congrats on the Series A. That gives you some budget to spend on delivery. I can help.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.includes('funding = budget'))).toBe(true)
  })

  it('STILL flags inference from "closed a round" + budget', () => {
    const result = evaluateConnectionNote({
      text: 'Hi Sarah, you just closed a round which likely gives you budget to spend. I can help ship faster.',
      profile: null,
      prospectName: 'Sarah Chen',
      prospectCompany: 'Acme',
      matchedProof: [],
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((f) => f.includes('funding = budget'))).toBe(true)
  })

  // Regression: "let's connect" appearing mid-text must be repaired, not ignored.
  // The previous repair regex used ^ anchor (start-only), so AI-generated notes
  // with "let's connect" after the first sentence failed quality checks and
  // were withheld — producing 0/300 notes.


  // ── Generic repair: any banned phrase from any position ──────────────────

  const bannedPhraseMidTextCases = [
    {
      name: 'lets connect mid-text',
      text: "Hi Abdulhakim, I have built AI workflow systems similar to AgentAce. Let's connect to discuss further.",
      expectAbsent: "let's connect",
    },
    {
      name: 'we specialize in mid-text',
      text: 'Hi Sarah, we specialize in Rails modernization and have done similar work at scale.',
      expectAbsent: 'we specialize in',
    },
    {
      name: 'would love to connect at end',
      text: 'Hi Alex, saw the hiring post for the platform team. Would love to connect.',
      expectAbsent: 'would love to connect',
    },
    {
      name: 'explore synergies mid-text',
      text: 'Hi Sarah, the work at Nomadz looks interesting. Would be great to explore synergies between our teams.',
      expectAbsent: 'explore synergies',
    },
    {
      name: 'curious about mid-text',
      text: 'Hi Alex, noticed the migration work. Curious about how you handled the data layer.',
      expectAbsent: 'curious about',
    },
    {
      name: 'lets connect with trailing and',
      text: "Hi Sarah, I build Salesforce automation systems. Let's connect and chat about AgentAce.",
      expectAbsent: "let's connect",
    },
    {
      name: 'hope you are doing well at start',
      text: 'Hi Alex, hope you are doing well. Saw the hiring post for the platform team.',
      expectAbsent: 'hope you are doing well',
    },
  ]

  for (const testCase of bannedPhraseMidTextCases) {
    it(`repairs banned phrase: ${testCase.name}`, () => {
      const result = validateAndRepair({
        text: testCase.text,
        profile: null,
        prospectName: 'Test Person',
        prospectCompany: 'TestCo',
        matchedProof: [],
      })
      // Either it passed after repair, or the banned phrase was removed
      if (result.repaired) {
        expect(result.repaired.toLowerCase()).not.toContain(testCase.expectAbsent)
      }
    })
  }

  // Generic repair for other failure types that can appear mid-text

  const midTextRepairCases = [
    {
      name: 'AI cliche mid-text',
      text: 'Hi Sarah, this game-changing approach to infra is something I work on daily.',
      failureType: 'AI cliché',
    },
    {
      name: 'sales pitch mid-text',
      text: 'Hi Alex, saw your post. I can help you scale the platform if useful.',
      failureType: 'Sales pitch',
    },
    {
      name: 'fake familiarity mid-text',
      text: 'Hi Sarah, I have been following your work on Agentforce. Interesting direction.',
      failureType: 'fake familiarity',
    },
    {
      name: 'service description mid-text',
      text: 'Hi Alex, we build Rails apps and I think we can help TestCo.',
      failureType: 'Service description',
    },
    {
      name: 'surveillance mid-text',
      text: 'Hi Sarah, I saw your post about the migration. Similar to work I have done.',
      failureType: 'surveillance',
    },
  ]

  for (const testCase of midTextRepairCases) {
    it(`repairs or reduces: ${testCase.name}`, () => {
      const initialResult = evaluateConnectionNote({
        text: testCase.text,
        profile: null,
        prospectName: 'Test Person',
        prospectCompany: 'TestCo',
        matchedProof: [],
      })
      // The initial text should fail with the expected failure type
      expect(initialResult.passed).toBe(false)
      expect(initialResult.failures.some((f) => f.toLowerCase().includes(testCase.failureType.toLowerCase()))).toBe(true)
    })
  }

  it('stripPhrasesAnywhere removes phrases from any position', () => {
    const result = stripPhrasesAnywhere(
      "Hi Sarah, I noticed your Rails work. Let's connect to chat. We specialize in scaling teams.",
      ["let's connect", 'we specialize in'],
    )
    expect(result.toLowerCase()).not.toContain("let's connect")
    expect(result.toLowerCase()).not.toContain('we specialize in')
  })

  it('stripPhrasesAnywhere handles upper and mixed case', () => {
    const result = stripPhrasesAnywhere(
      'Hi Sarah, LETS CONNECT to chat. WE SPECIALIZE in Rails.',
      ["let's connect", 'we specialize in'],
    )
    expect(result.toLowerCase()).not.toContain("let's connect")
    expect(result.toLowerCase()).not.toContain('we specialize in')
  })
})
