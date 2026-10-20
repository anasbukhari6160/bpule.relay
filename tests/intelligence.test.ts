import { describe, it, expect } from 'vitest'
import { checkMemoryForDuplicates, extractMemoriesFromDraft, extractMemoriesFromIdea, buildMemoryPromptBlock } from '@/lib/content/intelligence/memory'
import { discoverOpportunities } from '@/lib/content/intelligence/opportunities'
import { decideIfInterviewNeeded, shouldStopInterview, assessAnswerQuality } from '@/lib/content/intelligence/interview'
import { buildInitialDnaFromPersona } from '@/lib/content/content-dna'
import type { ContentProfile, ContentMemory, TopicCluster, ContentHistoryEntry } from '@/lib/domain/types'

function makeProfile(overrides: Partial<ContentProfile> = {}): ContentProfile {
  return {
    id: 'p1', organizationId: 'org1', personaId: 'persona1',
    role: 'Engineer', seniority: 'Senior', industries: ['fintech'],
    audience: 'engineering managers',
    expertise: [{ area: 'distributed systems', level: 'expert', evidence: '', updatedAt: '2024-01-01' }],
    technologies: [{ name: 'Rust', proficiency: 'expert', context: 'backend' }],
    goals: [], topicsCared: [], topicsAvoided: [],
    opinions: [{ belief: 'Monoliths are underrated', strength: 'strong', evidence: '', source: 'onboarding', updatedAt: '2024-01-01' }],
    projects: [{ name: 'Payment Gateway', description: 'Built new payment system', role: 'Lead', outcome: 'Live', lessons: ['Start simple'], updatedAt: '2024-01-01' }],
    experiences: [{ type: 'mistake', description: 'Deployed on Friday', lesson: 'Never deploy on Friday', date: null, updatedAt: '2024-01-01' }],
    writingCharacteristics: { sentenceRhythm: 'short, punchy' },
    storytellingTendencies: [],
    confidence: 0.6, lastLearnedAt: '2024-01-01',
    createdAt: '2024-01-01', updatedAt: '2024-01-01',
    ...overrides,
  }
}

function makeCluster(id: string, overrides: Partial<TopicCluster> = {}): TopicCluster {
  return {
    id, organizationId: 'org1', personaId: 'persona1',
    clusterName: `Cluster ${id}`, description: '', sourceType: 'answer',
    mergedIntoId: null, lastInputAt: null, lastResearchAt: null,
    createdAt: '2024-01-01', updatedAt: '2024-01-01', ...overrides,
  }
}

describe('Content Memory: duplicate detection', () => {
  it('detects exact duplicate hooks', () => {
    const memories: ContentMemory[] = [
      { id: 'm1', organizationId: 'org1', personaId: 'p1', memoryType: 'hook_used', content: 'Shipped the caching fix today', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-01' },
    ]
    const result = checkMemoryForDuplicates('Shipped the caching fix today', memories, 0.7, { now: '2024-01-01' })
    expect(result.isDuplicate).toBe(true)
  })

  it('keeps flagging an exact duplicate regardless of age (no time decay for near-exact matches)', () => {
    const memories: ContentMemory[] = [
      { id: 'm1', organizationId: 'org1', personaId: 'p1', memoryType: 'hook_used', content: 'Shipped the caching fix today', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-01T00:00:00.000Z' },
    ]
    for (const now of ['2024-01-01T00:00:00.000Z', '2024-01-31T00:00:00.000Z', '2024-03-31T00:00:00.000Z']) {
      const result = checkMemoryForDuplicates('Shipped the caching fix today', memories, 0.7, { now })
      expect(result.isDuplicate, `exact duplicate should flag at now=${now}`).toBe(true)
    }
  })

  it('allows sufficiently different content', () => {
    const memories: ContentMemory[] = [
      { id: 'm1', organizationId: 'org1', personaId: 'p1', memoryType: 'hook_used', content: 'Shipped the caching fix today', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-01' },
    ]
    const result = checkMemoryForDuplicates('The database migration completed ahead of schedule', memories)
    expect(result.isDuplicate).toBe(false)
  })

  it('returns empty prompt block for no memories', () => {
    expect(buildMemoryPromptBlock([])).toBe('')
  })

  it('builds prompt block with recent topics', () => {
    const memories: ContentMemory[] = [
      { id: 'm1', organizationId: 'org1', personaId: 'p1', memoryType: 'topic_covered', content: 'Database sharding strategies', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-01' },
      { id: 'm2', organizationId: 'org1', personaId: 'p1', memoryType: 'hook_used', content: 'Turns out the bottleneck was the index', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-01' },
    ]
    const block = buildMemoryPromptBlock(memories)
    expect(block).toContain('Database sharding strategies')
    expect(block).toContain('Turns out the bottleneck')
  })
})

describe('Content Memory: extraction', () => {
  it('extracts hook and topics from a draft', () => {
    const memories = extractMemoriesFromDraft(
      'Shipped the caching fix today. Latency dropped by half. Turns out the fix was three lines.',
      'Shipped the caching fix today'
    )
    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some((m) => m.type === 'hook_used')).toBe(true)
    expect(memories.some((m) => m.type === 'topic_covered')).toBe(true)
  })

  it('extracts angle and topic from an idea', () => {
    const memories = extractMemoriesFromIdea('Microservices are overrated', 'most teams dont need them')
    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some((m) => m.type === 'angle_used')).toBe(true)
  })
})

describe('Post Radar: opportunity discovery', () => {
  it('surfaces opportunities from Content DNA', () => {
    const profile = makeProfile()
    const opportunities = discoverOpportunities({
      profile,
      clusters: [],
      history: [],
      memories: [],
    })
    expect(opportunities.length).toBeGreaterThan(0)
    // Should include project-based opportunity
    expect(opportunities.some((o) => o.type === 'behind_the_build')).toBe(true)
    // Should include experience-based opportunity
    expect(opportunities.some((o) => o.type === 'mistake_or_failure')).toBe(true)
  })

  it('surfaces stale cluster opportunities', () => {
    const cluster = makeCluster('c1', { lastInputAt: new Date(Date.now() - 20 * 86_400_000).toISOString() })
    const opportunities = discoverOpportunities({
      profile: null,
      clusters: [cluster],
      history: [],
      memories: [],
    })
    expect(opportunities.some((o) => o.type === 'industry_development')).toBe(true)
  })

  it('surfaces opportunities from user input', () => {
    const opportunities = discoverOpportunities({
      profile: null,
      clusters: [],
      history: [],
      memories: [],
      recentUserInput: 'I spent all morning debugging a race condition in our CI pipeline',
    })
    expect(opportunities.some((o) => o.type === 'recent_work')).toBe(true)
  })

  it('returns evergreen fallback for empty context', () => {
    const opportunities = discoverOpportunities({
      profile: null,
      clusters: [],
      history: [],
      memories: [],
    })
    expect(opportunities.length).toBeGreaterThan(0)
  })

  it('ranks opportunities by confidence', () => {
    const profile = makeProfile()
    const opportunities = discoverOpportunities({
      profile,
      clusters: [],
      history: [],
      memories: [],
      recentUserInput: 'I spent all morning debugging a race condition',
    })
    // Highest confidence first
    if (opportunities.length >= 2) {
      expect(opportunities[0].confidence).toBeGreaterThanOrEqual(opportunities[1].confidence)
    }
  })
})

describe('Interview Agent: decision logic', () => {
  it('does not interview when enough context exists', () => {
    const profile = makeProfile({ confidence: 0.6 })
    const decision = decideIfInterviewNeeded({
      profile,
      memories: [],
      sourceMaterial: 'I spent today debugging a race condition in our CI pipeline. Turns out the test was flaky.',
    })
    expect(decision.shouldInterview).toBe(false)
  })

  it('interviews when personal detail is missing', () => {
    const profile = makeProfile({ confidence: 0.2 })
    const decision = decideIfInterviewNeeded({
      profile,
      memories: [],
      sourceMaterial: 'Microservices are overrated.',
    })
    expect(decision.shouldInterview).toBe(true)
    expect(decision.missingDimensions.length).toBeGreaterThan(0)
  })

  it('stops after max questions', () => {
    const decision = shouldStopInterview({
      questionsAsked: 3,
      lastAnswerQuality: 'low',
      informationGain: 0.1,
      missingDimensionsRemaining: 2,
    })
    expect(decision.shouldStop).toBe(true)
  })

  it('stops when information gain is high enough', () => {
    const decision = shouldStopInterview({
      questionsAsked: 2,
      lastAnswerQuality: 'medium',
      informationGain: 0.8,
      missingDimensionsRemaining: 1,
    })
    expect(decision.shouldStop).toBe(true)
  })

  it('continues when more info is needed', () => {
    const decision = shouldStopInterview({
      questionsAsked: 1,
      lastAnswerQuality: 'low',
      informationGain: 0.1,
      missingDimensionsRemaining: 2,
    })
    expect(decision.shouldStop).toBe(false)
  })
})

describe('Interview Agent: answer quality', () => {
  it('rates specific, detailed answers as high quality', () => {
    const quality = assessAnswerQuality(
      'I spent three hours yesterday debugging a race condition in our CI pipeline. Turns out two tests were sharing mutable state.',
      ''
    )
    expect(quality).toBe('high')
  })

  it('rates vague answers as low quality', () => {
    const quality = assessAnswerQuality('It was interesting', '')
    expect(quality).toBe('low')
  })

  it('rates very short answers as low quality', () => {
    const quality = assessAnswerQuality('Yes', '')
    expect(quality).toBe('low')
  })
})
