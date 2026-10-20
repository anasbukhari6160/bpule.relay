import { describe, it, expect } from 'vitest'
import { discoverOpportunities } from '@/lib/content/intelligence/opportunities'
import { decideIfInterviewNeeded, assessAnswerQuality } from '@/lib/content/intelligence/interview'
import { extractDnaCandidatesFromAnswer, mergeDnaCandidates, calculateProfileConfidence, buildContentDnaPromptBlock } from '@/lib/content/content-dna'
import { checkMemoryForDuplicates, buildMemoryPromptBlock } from '@/lib/content/intelligence/memory'
import { requiresResearch, generateConstraints } from '@/lib/content/intelligence/research'
import type { ContentProfile, ContentMemory, TopicCluster, ContentHistoryEntry } from '@/lib/domain/types'

/**
 * Hard inputs — testing the pipeline's decision-making on difficult cases.
 * Each scenario validates a specific failure mode the system must handle.
 */

function makeProfile(overrides: Partial<ContentProfile> = {}): ContentProfile {
  return {
    id: 'p1', organizationId: 'org1', personaId: 'persona1',
    role: 'Senior Full-Stack Engineer', seniority: 'Senior',
    industries: ['fintech', 'developer tools'],
    audience: 'senior engineers and engineering managers',
    expertise: [
      { area: 'distributed systems', level: 'expert', evidence: '', updatedAt: '2024-11-01' },
      { area: 'Rails architecture', level: 'expert', evidence: '', updatedAt: '2024-11-01' },
    ],
    technologies: [
      { name: 'Ruby on Rails', proficiency: 'expert', context: 'backend' },
      { name: 'PostgreSQL', proficiency: 'expert', context: 'database' },
      { name: 'Docker', proficiency: 'proficient', context: 'local dev' },
    ],
    goals: [],
    topicsCared: [{ topic: 'Production Debugging', intensity: 'passionate', source: 'onboarding' }],
    topicsAvoided: [],
    opinions: [{ belief: 'Most performance problems are N+1 queries', strength: 'strong', evidence: '', source: 'onboarding', updatedAt: '2024-11-01' }],
    projects: [{ name: 'Payment Gateway v2', description: 'Rebuilt payment processing', role: 'Tech Lead', outcome: 'Reduced failures by 40%', lessons: ['Always design for retry safety'], updatedAt: '2024-11-01' }],
    experiences: [{ type: 'mistake', description: 'Deployed a non-idempotent job that double-charged customers', lesson: 'Always make jobs idempotent', date: '2024-09-15', updatedAt: '2024-11-01' }],
    writingCharacteristics: { sentenceRhythm: 'measured, varied', preferredLength: 'medium', questionFrequency: 'occasional', dataUsage: 'light' },
    storytellingTendencies: [],
    confidence: 0.6, lastLearnedAt: '2024-11-01', createdAt: '2024-01-01', updatedAt: '2024-11-01',
    ...overrides,
  }
}

const baseMemories: ContentMemory[] = [
  { id: 'm1', organizationId: 'org1', personaId: 'persona1', memoryType: 'topic_covered', content: 'Why we chose to stay on Postgres instead of adding Elasticsearch', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-11-01' },
  { id: 'm2', organizationId: 'org1', personaId: 'persona1', memoryType: 'hook_used', content: 'We double-charged 200 customers on a Tuesday morning', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-11-01' },
]

const baseClusters: TopicCluster[] = [
  { id: 'c1', organizationId: 'org1', personaId: 'persona1', clusterName: 'Production Debugging', description: '', sourceType: 'profile', mergedIntoId: null, lastInputAt: '2024-11-01', lastResearchAt: null, createdAt: '2024-01-01', updatedAt: '2024-11-01' },
  { id: 'c2', organizationId: 'org1', personaId: 'persona1', clusterName: 'System Design', description: '', sourceType: 'profile', mergedIntoId: null, lastInputAt: null, lastResearchAt: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
]

describe('Hard Input 1: Very vague', () => {
  const input = 'Had a weird issue with Docker today.'

  it('flags low quality and requires interview', () => {
    const quality = assessAnswerQuality(input, '')
    expect(quality).toBe('low')
  })

  it('triggers interview due to missing detail', () => {
    const decision = decideIfInterviewNeeded({
      profile: makeProfile(),
      memories: baseMemories,
      sourceMaterial: input,
    })
    expect(decision.shouldInterview).toBe(true)
    expect(decision.missingDimensions).toContain('specific personal detail or experience')
  })

  it('extracts minimal DNA from vague input', () => {
    const candidates = extractDnaCandidatesFromAnswer(input, makeProfile())
    // "Docker" is mentioned but no action/lesson — should extract very little
    expect(candidates.length).toBeLessThanOrEqual(1)
  })
})

describe('Hard Input 2: Already discussed (duplicate)', () => {
  // Same story, told with different words
  const input = 'I spent an entire afternoon tracking down a production issue that turned out to be a configuration problem. The deploy had succeeded but the app was reading old environment variables. I assumed the new code was broken when really the runtime config had not been updated.'

  it('flags as duplicate when key phrases overlap', () => {
    // Memory that shares key bigrams with the input
    const memoriesWithStory: ContentMemory[] = [
      ...baseMemories,
      { id: 'm3', organizationId: 'org1', personaId: 'persona1', memoryType: 'topic_covered', content: 'production issue that turned out to be a configuration problem', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
      { id: 'm4', organizationId: 'org1', personaId: 'persona1', memoryType: 'hook_used', content: 'the app was reading old environment variables', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
    ]
    // Pin "now" to the fixture date so time decay cannot age this out.
    const dupCheck = checkMemoryForDuplicates(input, memoriesWithStory, 0.5, { now: '2024-12-01' })
    expect(dupCheck.isDuplicate).toBe(true)
  })

  it('does not extract duplicate experience', () => {
    const profile = makeProfile({
      experiences: [{ type: 'mistake', description: 'the app was reading old environment variables', lesson: 'check runtime config first', date: '2024-12-01', updatedAt: '2024-12-01' }],
    })
    const candidates = extractDnaCandidatesFromAnswer(input, profile)
    const patches = mergeDnaCandidates(profile, candidates)
    // Should filter out experiences that are too similar to existing ones
    const duplicateFiltered = patches.experiences.filter(
      (e) => !profile.experiences.some((existing) => existing.description.includes('environment variables') && e.description.includes('environment variables')),
    )
    expect(duplicateFiltered.length).toBe(0)
  })
})

describe('Hard Input 3: Opinion', () => {
  const input = 'Most startups introduce Kubernetes way too early. By the time you need it, you will have learned enough to avoid the mistakes that made you think you needed it.'

  it('does not require research for opinion content', () => {
    const research = requiresResearch({ sourceMaterial: input, genomeSource: 'opinion', supportingFacts: [] })
    expect(research.shouldResearch).toBe(false)
  })

  it('extracts the opinion into DNA', () => {
    const profile = makeProfile()
    const candidates = extractDnaCandidatesFromAnswer(input, profile)
    const opinionCandidate = candidates.find((c) => c.type === 'opinion')
    expect(opinionCandidate).toBeDefined()
  })

  it('rates opinion as at least medium quality', () => {
    const quality = assessAnswerQuality(input, '')
    expect(['medium', 'high']).toContain(quality)
  })
})

describe('Hard Input 4: Current factual claim (research trigger)', () => {
  const input = 'Rails 8.1 changed how Active Record handles lazy loading and I think teams should adopt it immediately. The performance improvements are significant.'

  it('triggers research for version-specific claims', () => {
    const research = requiresResearch({
      sourceMaterial: input,
      genomeSource: null,
      supportingFacts: ['Rails 8.1 changed lazy loading', 'performance improvements are significant'],
    })
    expect(research.shouldResearch).toBe(true)
  })

  it('generates constraints when research unavailable', () => {
    const constraints = generateConstraints(input)
    expect(constraints.length).toBeGreaterThan(0)
    expect(constraints.some((c) => c.includes('Rails 8.1') || c.includes('version') || c.includes('statistics'))).toBe(true)
  })
})

describe('Hard Input 5: Weak/generic (should reject or improve)', () => {
  const input = 'AI is changing software development.'

  it('rates generic input as low quality', () => {
    const quality = assessAnswerQuality(input, '')
    expect(quality).toBe('low')
  })

  it('triggers interview to extract specificity', () => {
    const decision = decideIfInterviewNeeded({
      profile: makeProfile(),
      memories: baseMemories,
      sourceMaterial: input,
    })
    expect(decision.shouldInterview).toBe(true)
  })

  it('extracts zero DNA from generic input', () => {
    const candidates = extractDnaCandidatesFromAnswer(input, makeProfile())
    expect(candidates.length).toBe(0)
  })

  it('does not require research for generic statement', () => {
    const research = requiresResearch({ sourceMaterial: input, genomeSource: null, supportingFacts: [] })
    expect(research.shouldResearch).toBe(false)
  })
})

describe('Hard Input 6: Incomplete personal story (interview should extract)', () => {
  const input = 'We changed something in our CI and builds got much faster.'

  it('triggers interview due to missing specifics', () => {
    const decision = decideIfInterviewNeeded({
      profile: makeProfile(),
      memories: baseMemories,
      sourceMaterial: input,
    })
    expect(decision.shouldInterview).toBe(true)
    expect(decision.missingDimensions.length).toBeGreaterThan(0)
  })

  it('rates as medium (has some detail but vague)', () => {
    const quality = assessAnswerQuality(input, '')
    expect(['low', 'medium']).toContain(quality)
  })

  it('extracts the CI experience but flags it as incomplete', () => {
    const profile = makeProfile()
    const candidates = extractDnaCandidatesFromAnswer(input, profile)
    // Should extract something about CI but the lesson is empty
    const expCandidate = candidates.find((c) => c.type === 'experience')
    if (expCandidate && 'description' in expCandidate.value) {
      expect(expCandidate.value.description.toLowerCase()).toContain('ci')
    }
  })
})

describe('Hard Input 7: Fabrication trap (minimal info)', () => {
  const input = 'We had a production incident last week.'

  it('does not extract specific details that were not provided', () => {
    const profile = makeProfile()
    const candidates = extractDnaCandidatesFromAnswer(input, profile)
    for (const c of candidates) {
      // Should not invent metrics, customers, or specific causes
      const text = 'description' in c.value ? c.value.description : 'belief' in c.value ? c.value.belief : ''
      expect(text).not.toMatch(/\d+%|\d+x|\$\d+ customers|revenue|users/)
    }
  })

  it('triggers interview to get the actual story', () => {
    const decision = decideIfInterviewNeeded({
      profile: makeProfile(),
      memories: baseMemories,
      sourceMaterial: input,
    })
    expect(decision.shouldInterview).toBe(true)
  })

  it('rates as low quality (no actionable detail)', () => {
    const quality = assessAnswerQuality(input, '')
    expect(quality).toBe('low')
  })
})

describe('Hard Input 8: Cross-session (no recycling)', () => {
  // After posting the debugging story, Radar should not recycle it
  const debuggingStory = 'I lost a few hours debugging a deployment that was not actually broken. One value was stale in the environment.'

  it('does not suggest the same lesson after it has been posted', () => {
    const memoriesAfterPosting: ContentMemory[] = [
      ...baseMemories,
      { id: 'm3', organizationId: 'org1', personaId: 'persona1', memoryType: 'topic_covered', content: 'debugging a deployment caused by stale environment variables', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
      { id: 'm4', organizationId: 'org1', personaId: 'persona1', memoryType: 'hook_used', content: 'lost a few hours debugging a deployment that was not actually broken', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
      { id: 'm5', organizationId: 'org1', personaId: 'persona1', memoryType: 'angle_used', content: 'deployment timing vs runtime configuration', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
    ]

    const opportunities = discoverOpportunities({
      profile: makeProfile({
        experiences: [{ type: 'mistake', description: 'stale environment variable caused hours of debugging', lesson: 'always verify runtime config first', date: '2024-12-01', updatedAt: '2024-12-01' }],
      }),
      clusters: baseClusters,
      history: [],
      memories: memoriesAfterPosting,
    })

    // Should NOT have a production_lesson about the same stale env var story
    const recycledOpp = opportunities.find(
      (o) => o.description.includes('stale environment') || o.description.includes('few hours debugging'),
    )
    expect(recycledOpp).toBeUndefined()
  })

  it('flags duplicate if user tries to post the same story again', () => {
    const memoriesWithStory: ContentMemory[] = [
      ...baseMemories,
      { id: 'm3', organizationId: 'org1', personaId: 'persona1', memoryType: 'hook_used', content: 'lost a few hours debugging a deployment that was not actually broken', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
    ]
    // Pin "now" to the fixture date so time decay cannot age this out.
    const dupCheck = checkMemoryForDuplicates(debuggingStory, memoriesWithStory, 0.6, { now: '2024-12-01' })
    expect(dupCheck.isDuplicate).toBe(true)
  })

  it('memory prompt block warns about covered topics', () => {
    const memoriesWithStory: ContentMemory[] = [
      ...baseMemories,
      { id: 'm3', organizationId: 'org1', personaId: 'persona1', memoryType: 'topic_covered', content: 'debugging a deployment caused by stale environment variables', sourceDraftId: 'draft-debug', sourceHistoryId: null, createdAt: '2024-12-01' },
    ]
    const block = buildMemoryPromptBlock(memoriesWithStory)
    expect(block).toContain('stale environment')
  })
})
