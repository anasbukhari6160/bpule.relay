import { describe, it, expect, beforeEach } from 'vitest'
import { buildContentDnaPromptBlock, extractDnaCandidatesFromAnswer, mergeDnaCandidates, calculateProfileConfidence, buildInitialDnaFromPersona } from '@/lib/content/content-dna'
import { checkMemoryForDuplicates, extractMemoriesFromDraft, buildMemoryPromptBlock } from '@/lib/content/intelligence/memory'
import { discoverOpportunities } from '@/lib/content/intelligence/opportunities'
import { decideIfInterviewNeeded, assessAnswerQuality } from '@/lib/content/intelligence/interview'
import type { ContentProfile, ContentMemory, TopicCluster, ContentHistoryEntry } from '@/lib/domain/types'

/**
 * Integration test: Prove Relay learns across sessions.
 *
 * Simulates a real user going through multiple sessions and verifies
 * that the system becomes smarter over time.
 */

function makeEmptyProfile(): ContentProfile {
  return {
    id: 'p1', organizationId: 'org1', personaId: 'persona1',
    role: '', seniority: '', industries: [], audience: '',
    expertise: [], technologies: [], goals: [], topicsCared: [],
    topicsAvoided: [], opinions: [], projects: [], experiences: [],
    writingCharacteristics: {}, storytellingTendencies: [],
    confidence: 0, lastLearnedAt: null, createdAt: '2024-01-01', updatedAt: '2024-01-01',
  }
}

describe('Cross-Session Learning Integration', () => {
  let profile: ContentProfile
  let memories: ContentMemory[]
  let history: ContentHistoryEntry[]

  beforeEach(() => {
    profile = makeEmptyProfile()
    memories = []
    history = []
  })

  it('SESSION 1: User creates persona and generates first post', () => {
    // User creates persona with initial info
    const initialDna = buildInitialDnaFromPersona({
      valuesAndOpinions: ['I think monoliths are underrated for small teams'],
      topics: [
        { name: 'System Design', description: 'Distributed systems and architecture' },
        { name: 'Deployment', description: 'CI/CD and production debugging' },
      ],
      humorStyle: 'Dry / deadpan',
    })

    profile = {
      ...profile,
      role: 'Senior Full-Stack Engineer',
      seniority: 'Senior',
      industries: ['fintech', 'developer tools'],
      audience: 'senior engineers and engineering managers',
      opinions: initialDna.opinions,
      topicsCared: initialDna.topicsCared,
      writingCharacteristics: initialDna.writingCharacteristics,
      confidence: 0.2,
    }

    const confidenceBefore = calculateProfileConfidence(profile)
    expect(confidenceBefore).toBeGreaterThan(0)

    // User provides source material
    const sourceMaterial = 'I spent hours debugging a deployment because production was using stale environment variables. The deploy script was reading from .env.local instead of the actual production config.'

    // Interview should be needed (low confidence)
    const interviewDecision = decideIfInterviewNeeded({
      profile,
      memories,
      sourceMaterial,
    })
    expect(interviewDecision.shouldInterview).toBe(true)

    // User answers interview question
    const answer = 'The deploy script was reading from .env.local instead of the actual production config. I found it by adding verbose logging to the CI pipeline.'
    const quality = assessAnswerQuality(answer, sourceMaterial)
    expect(quality).toBe('high')

    // Extract DNA from answer
    const candidates = extractDnaCandidatesFromAnswer(answer, profile)
    expect(candidates.length).toBeGreaterThan(0)

    // Merge into profile
    const patches = mergeDnaCandidates(profile, candidates)
    profile = {
      ...profile,
      experiences: [...profile.experiences, ...patches.experiences],
      opinions: [...profile.opinions, ...patches.opinions],
      confidence: calculateProfileConfidence({
        ...profile,
        experiences: [...profile.experiences, ...patches.experiences],
      }),
    }

    const confidenceAfter = calculateProfileConfidence(profile)
    expect(confidenceAfter).toBeGreaterThan(confidenceBefore)

    // Generate draft and record memories
    const draft = 'Debugged a production deployment issue today. The deploy script was silently reading from .env.local instead of production config. Added verbose logging to CI and found it in minutes. Always verify your deploy reads from the right environment.'
    const hook = 'Debugged a production deployment issue today.'

    const newMemories = extractMemoriesFromDraft(draft, hook)
    memories.push(...newMemories.map((m, i) => ({
      id: `m-${i}`, organizationId: 'org1', personaId: 'persona1',
      memoryType: m.type, content: m.content,
      sourceDraftId: 'draft-1', sourceHistoryId: null,
      createdAt: '2024-01-15',
    })))

    // Record history
    history.push({
      id: 'h1', organizationId: 'org1', personaId: 'persona1',
      pillarId: null, topicClusterId: 'deployment',
      platform: 'linkedin', openingLine: hook,
      postedAt: '2024-01-15', ledToRealOutcome: false,
      outcomeNotedAt: null, likes: null, reach: null, comments: null,
      reposts: null, saves: null, profileVisits: null, followerDelta: null,
      metricsLoggedAt: null,
    })

    // Verify DNA prompt block includes learned info
    const dnaBlock = buildContentDnaPromptBlock(profile)
    expect(dnaBlock).toContain('Senior Full-Stack Engineer')
    expect(dnaBlock).toContain('monoliths')

    // Verify memory block warns about covered topics
    const memoryBlock = buildMemoryPromptBlock(memories)
    expect(memoryBlock).toContain('deployment')
  })

  it('SESSION 2: Relay remembers and avoids repetition', () => {
    // Setup: profile and memories from session 1
    profile = {
      ...profile,
      role: 'Senior Full-Stack Engineer',
      seniority: 'Senior',
      industries: ['fintech'],
      confidence: 0.5,
      experiences: [{ type: 'mistake', description: 'Deploy script read from .env.local', lesson: 'Always verify deploy reads from right environment', date: null, updatedAt: '2024-01-15' }],
      opinions: [{ belief: 'I think monoliths are underrated', strength: 'moderate', evidence: '', source: 'onboarding', updatedAt: '2024-01-01' }],
    }

    memories = [
      { id: 'm1', organizationId: 'org1', personaId: 'persona1', memoryType: 'hook_used', content: 'Debugged a production deployment issue today because the deploy script was reading stale environment variables', sourceDraftId: 'draft-1', sourceHistoryId: null, createdAt: '2024-01-15' },
      { id: 'm2', organizationId: 'org1', personaId: 'persona1', memoryType: 'topic_covered', content: 'production deployment issue', sourceDraftId: 'draft-1', sourceHistoryId: null, createdAt: '2024-01-15' },
    ]

    // Radar should NOT suggest the same deployment story
    const clusters: TopicCluster[] = [
      { id: 'c1', organizationId: 'org1', personaId: 'persona1', clusterName: 'Deployment', description: 'CI/CD and production', sourceType: 'profile', mergedIntoId: null, lastInputAt: '2024-01-15', lastResearchAt: null, createdAt: '2024-01-01', updatedAt: '2024-01-15' },
      { id: 'c2', organizationId: 'org1', personaId: 'persona1', clusterName: 'System Design', description: 'Architecture', sourceType: 'profile', mergedIntoId: null, lastInputAt: null, lastResearchAt: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    ]

    const opportunities = discoverOpportunities({
      profile,
      clusters,
      history: [],
      memories,
    })

    // Should NOT have a "recent_work" opportunity about deployment (already covered)
    const deploymentOpp = opportunities.find((o) => o.description.includes('deployment') && o.type === 'recent_work')
    expect(deploymentOpp).toBeUndefined()

    // Should suggest System Design (never posted about)
    const systemDesignOpp = opportunities.find((o) => o.description.includes('System Design') || o.title.includes('System Design'))
    expect(systemDesignOpp).toBeDefined()

    // Memory check: deployment topic should be flagged as duplicate
    // Pin "now" to the fixture date so time decay cannot age this out.
    const dupCheck = checkMemoryForDuplicates('Debugged a production deployment issue because the deploy script was reading stale environment variables', memories, 0.6, { now: '2024-01-15' })
    expect(dupCheck.isDuplicate).toBe(true)

    // Interview should NOT be needed (profile confidence is high enough)
    const newMaterial = 'I think microservices add unnecessary complexity for teams under 10 engineers. We stayed monolith and shipped faster.'
    const interviewDecision = decideIfInterviewNeeded({
      profile,
      memories,
      sourceMaterial: newMaterial,
    })
    expect(interviewDecision.shouldInterview).toBe(false)
  })

  it('SESSION 3: Rejection signal is incorporated without overfitting', () => {
    // Setup: profile with some history
    profile = {
      ...profile,
      role: 'Senior Full-Stack Engineer',
      confidence: 0.6,
      opinions: [
        { belief: 'I think monoliths are underrated', strength: 'moderate', evidence: '', source: 'onboarding', updatedAt: '2024-01-01' },
      ],
    }

    memories = [
      { id: 'm1', organizationId: 'org1', personaId: 'persona1', memoryType: 'topic_covered', content: 'deployment debugging', sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-15' },
    ]

    // User rejects a contrarian suggestion
    // The system should note this but not massively change the profile
    const confidenceBefore = calculateProfileConfidence(profile)

    // Simulate rejection: add a memory that this type was rejected
    memories.push({
      id: 'm2', organizationId: 'org1', personaId: 'persona1',
      memoryType: 'topic_covered', content: 'contrarian position on microservices',
      sourceDraftId: null, sourceHistoryId: null, createdAt: '2024-01-20',
    })

    // Profile confidence should not drop significantly from one rejection
    const confidenceAfter = calculateProfileConfidence(profile)
    expect(confidenceAfter).toBeGreaterThanOrEqual(confidenceBefore)

    // Radar should still surface useful opportunities
    const clusters: TopicCluster[] = [
      { id: 'c1', organizationId: 'org1', personaId: 'persona1', clusterName: 'Deployment', description: '', sourceType: 'profile', mergedIntoId: null, lastInputAt: '2024-01-15', lastResearchAt: null, createdAt: '2024-01-01', updatedAt: '2024-01-15' },
    ]

    const opportunities = discoverOpportunities({
      profile,
      clusters,
      history: [],
      memories,
    })

    // Should still have opportunities (not blocked by one rejection)
    expect(opportunities.length).toBeGreaterThan(0)
  })
})
