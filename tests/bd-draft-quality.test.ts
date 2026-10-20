import { describe, it, expect } from 'vitest'
import { baseDraftSystem, buildUserPrompt, buildCorrectiveFeedback } from '@/lib/ai/draft'
import type { DraftInput } from '@/lib/ai/draft'
import type { StyleCard, Fact, Lead, ExtractedLead, ScoreResult } from '@/lib/domain/types'

/**
 * Test fixtures for BD draft pipeline
 */

function makeStyleCard(): StyleCard {
  return {
    contractions: 'mostly_yes',
    formality: 2,
    sentence_length: 'medium',
    punctuation: 'relaxed',
    openers: 'statement',
    emoji_use: 'none',
    greeting: 'Hey',
    sign_off: 'Best',
    never_words: ['synergy', 'leverage'],
    preferred_words: ['ship', 'build'],
    summary: 'Direct, technical, no fluff.',
  }
}

function makeFacts(): Fact[] {
  return [
    { id: 'f1', organizationId: 'org1', label: 'Price', value: '$2k/project', factType: 'price', addedBy: null, createdAt: '2024-01-01' },
    { id: 'f2', organizationId: 'org1', label: 'Site live', value: 'true', factType: 'config', addedBy: null, createdAt: '2024-01-01' },
  ]
}

function makeLead(): Lead {
  return {
    id: 'lead1',
    organizationId: 'org1',
    ownerRepId: null,
    company: 'Acme Corp',
    companyKey: 'acme-corp',
    contactName: 'Jane Smith',
    contactTitle: 'VP Engineering',
    url: 'https://acme.com/about',
    rawInput: 'Acme is hiring 3 senior Rails devs. They just raised Series A.',
    signalType: 1,
    signalEvidence: 'hiring 3 senior Rails devs',
    verbatimQuote: '',
    score: 10,
    verdict: 'send',
    status: 'new',
    playId: null,
    tags: [],
    createdAt: '2024-01-01',
  }
}

function makeExtracted(): ExtractedLead {
  return {
    name: 'Jane Smith',
    title: 'VP Engineering',
    company: 'Acme Corp',
    url: 'https://acme.com/about',
    signalType: 1 as const,
    signalEvidence: 'hiring 3 senior Rails devs',
    verbatimQuote: '',
    roleCategory: 'technical_leadership',
    tags: ['rails', 'hiring'],
  }
}

function makeScore(): ScoreResult {
  return {
    total: 10,
    verdict: 'send',
    breakdown: [
      { category: 'signal', label: 'Signal strength', points: 3, max: 3, note: 'Strong signal' },
      { category: 'completeness', label: 'Evidence', points: 4, max: 4, note: 'Specific evidence' },
      { category: 'completeness', label: 'URL', points: 1, max: 1, note: 'URL present' },
      { category: 'completeness', label: 'Name', points: 1, max: 1, note: 'Name present' },
      { category: 'completeness', label: 'Title', points: 1, max: 1, note: 'Title present' },
    ],
  }
}

function makeDraftInput(overrides?: Partial<DraftInput>): DraftInput {
  return {
    leadId: 'lead1',
    lead: makeLead(),
    extracted: makeExtracted(),
    score: makeScore(),
    type: 'dm',
    styleCard: makeStyleCard(),
    facts: makeFacts(),
    plays: [],
    history: [],
    profile: null,
    matchedProof: null,
    fewShotExamples: [],
    ...overrides,
  }
}

describe('BD Draft: System Prompt Quality', () => {
  const system = baseDraftSystem(makeStyleCard(), makeFacts())

  it('bans em dashes', () => {
    expect(system).toMatch(/em dash/i)
  })

  it('bans emojis', () => {
    expect(system).toMatch(/emojis/i)
  })

  it('bans exclamation marks', () => {
    expect(system).toMatch(/exclamation/i)
  })

  it('includes anti-AI rules for sales writing', () => {
    expect(system).toContain('I came across your')
    expect(system).toContain("I'd love the opportunity")
    expect(system).toContain('hope this finds you well')
  })

  it('requires specificity as the hook', () => {
    expect(system).toContain('Specificity rule')
  })

  it('never asks for a call', () => {
    expect(system).toContain('NEVER ask for a call')
  })

  it('includes the style card', () => {
    expect(system).toContain('SENDER VOICE')
    expect(system).toContain('Direct, technical, no fluff')
  })

  it('includes self-check tests', () => {
    expect(system).toContain('reply_or_delete')
    expect(system).toContain('not_generic')
  })
})

describe('BD Draft: User Prompt Quality', () => {
  const input = makeDraftInput()
  const userPrompt = buildUserPrompt(input)

  it('includes the company name', () => {
    expect(userPrompt).toContain('Acme Corp')
  })

  it('includes the signal evidence', () => {
    expect(userPrompt).toContain('hiring 3 senior Rails devs')
  })

  it('includes approved facts', () => {
    expect(userPrompt).toContain('$2k/project')
  })

  it('specifies the message kind', () => {
    expect(userPrompt).toContain('LinkedIn DM')
  })
})

describe('BD Draft: Follow-up Rules', () => {
  it('includes follow-up specific guidance', () => {
    const input = makeDraftInput({ type: 'followup' })
    const userPrompt = buildUserPrompt(input)
    expect(userPrompt).toContain('Follow-up message')
  })
})

describe('BD Draft: Corrective Feedback', () => {
  it('names specific failures in feedback', () => {
    const feedback = buildCorrectiveFeedback(
      {
        output: {
          draft: 'Generic message without company name.',
          test_1_reply_or_delete: false,
          test_1_note: 'Too generic to earn a reply.',
          test_2_not_generic: false,
          test_2_note: 'Would survive a company swap.',
        },
        codeChecks: { companyMentioned: false, specificEvidenceMentioned: false },
      },
      makeDraftInput(),
    )
    expect(feedback).not.toBeNull()
    expect(feedback).toContain('Acme Corp')
    expect(feedback).toContain('hiring 3 senior Rails devs')
  })

  it('returns null when no specific failures', () => {
    const feedback = buildCorrectiveFeedback(
      {
        output: {
          draft: 'Good specific message.',
          test_1_reply_or_delete: true,
          test_1_note: 'Specific enough.',
          test_2_not_generic: true,
          test_2_note: 'Tied to company.',
        },
        codeChecks: { companyMentioned: true, specificEvidenceMentioned: true },
      },
      makeDraftInput(),
    )
    expect(feedback).toBeNull()
  })
})

describe('BD Draft: Upwork-specific Rules', () => {
  it('specifies Upwork cover letter kind', () => {
    const input = makeDraftInput({ type: 'upwork' })
    const userPrompt = buildUserPrompt(input)
    expect(userPrompt).toContain('Upwork cover letter')
  })
})
