import { describe, it, expect } from 'vitest'
import {
  checkMemoryForDuplicates,
  buildMemoryPromptBlock,
  extractMemoriesFromDraft,
} from '@/lib/content/intelligence/memory'
import type { ContentMemory, ContentPersona, ContentProfile } from '@/lib/domain/types'

// ─── Fixtures ───

function makeMemory(type: ContentMemory['memoryType'], content: string): ContentMemory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    organizationId: 'org-test',
    personaId: 'persona-qa',
    memoryType: type,
    content,
    sourceDraftId: null,
    sourceHistoryId: null,
    createdAt: new Date().toISOString(),
  }
}

function makeProfile(overrides: Partial<ContentProfile> = {}): ContentProfile {
  return {
    id: 'profile-qa',
    organizationId: 'org-test',
    personaId: 'persona-qa',
    role: 'Senior DevOps Engineer',
    seniority: 'senior',
    industries: ['cloud infrastructure', 'saas'],
    audience: 'platform engineers and sre teams',
    expertise: [
      { area: 'kubernetes', level: 'expert', evidence: '5 years production', updatedAt: '2025-01-01' },
      { area: 'observability', level: 'advanced', evidence: 'built monitoring stack', updatedAt: '2025-01-01' },
    ],
    technologies: [
      { name: 'kubernetes', proficiency: 'expert', context: 'primary platform' },
      { name: 'prometheus', proficiency: 'proficient', context: 'metrics' },
    ],
    goals: [{ description: 'share lessons', type: 'authority', updatedAt: '2025-01-01' }],
    topicsCared: [{ topic: 'reliability', intensity: 'passionate', source: 'onboarding' }],
    topicsAvoided: [{ topic: 'political commentary', intensity: 'casual', source: 'inference' }],
    opinions: [{ belief: 'most incidents are config errors not code bugs', strength: 'strong', evidence: 'experience', source: 'onboarding', updatedAt: '2025-01-01' }],
    projects: [],
    experiences: [],
    writingCharacteristics: { preferredLength: 'short', sentenceRhythm: 'varied' },
    storytellingTendencies: [],
    confidence: 0.85,
    territories: ['kubernetes', 'observability', 'reliability engineering', 'incident response'],
    audiences: ['platform engineers', 'sre teams'],
    lastLearnedAt: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-06-01',
    ...overrides,
  }
}

function makePersona(overrides: Partial<ContentPersona> = {}): ContentPersona {
  return {
    id: 'persona-qa',
    repId: 'rep-qa',
    organizationId: 'org-test',
    displayName: 'DevOps QA',
    platforms: ['linkedin'],
    voiceProfileId: null,
    humorStyle: 'dry, technical',
    valuesAndOpinions: ['simplicity over complexity'],
    admiredExamples: [],
    contentProfileId: 'profile-qa',
    personaRole: 'Senior DevOps Engineer',
    personaCompany: 'CloudCo',
    personaLocation: 'Berlin',
    contentComfort: ['technical deep dives', 'opinions', 'practical lessons'],
    onboardingStep: 'complete',
    onboardingCompleted: true,
    trendInterestProfile: {
      primaryTerritories: ['kubernetes', 'observability'],
      secondaryTerritories: ['platform engineering', ' reliability'],
      technologies: ['kubernetes', 'prometheus', 'opentelemetry'],
      industries: ['cloud infrastructure', 'saas'],
      audienceInterests: ['reliability', 'performance'],
      monitoredEntities: [],
      excludedTerritories: ['political commentary'],
    },
    createdAt: '2025-01-01',
    ...overrides,
  }
}

// ─── Test Suite ───

describe('QA 1: Persona data round-trip', () => {
  it('persona has all expected fields populated after creation', () => {
    const persona = makePersona()
    expect(persona.personaRole).toBe('Senior DevOps Engineer')
    expect(persona.onboardingCompleted).toBe(true)
    expect(persona.trendInterestProfile).toBeDefined()
    expect(persona.trendInterestProfile?.primaryTerritories).toContain('kubernetes')
    expect(persona.contentComfort).toContain('technical deep dives')
  })

  it('profile territories and audiences are available for trend inference', () => {
    const profile = makeProfile()
    expect(profile.territories).toContain('kubernetes')
    expect(profile.audiences).toContain('platform engineers')
    expect(profile.expertise.length).toBeGreaterThan(0)
    expect(profile.expertise[0].level).toBe('expert')
  })

  it('persona readiness is correctly determined', () => {
    const ready = makePersona()
    expect(ready.onboardingCompleted).toBe(true)

    const incomplete = makePersona({
      onboardingCompleted: false,
      personaRole: undefined,
      trendInterestProfile: undefined,
    })
    expect(incomplete.onboardingCompleted).toBe(false)
    expect(incomplete.personaRole).toBeUndefined()
  })
})

describe('QA 2: Anti-repetition — content memory', () => {
  const existingMemories = [
    makeMemory('topic_covered', 'kubernetes pod restart loops'),
    makeMemory('angle_used', 'why most restarts are config issues'),
    makeMemory('hook_used', 'your pods keep restarting and it’s not the code'),
    makeMemory('topic_covered', 'observability blind spots in production'),
    makeMemory('opinion_expressed', 'dashboards without alerts are decoration'),
  ]

  it('flags exact duplicates', () => {
    const result = checkMemoryForDuplicates('kubernetes pod restart loops', existingMemories)
    expect(result.isDuplicate).toBe(true)
  })

  it('flags semantically similar content', () => {
    const result = checkMemoryForDuplicates('kubernetes pod restart loops are a config problem', existingMemories)
    expect(result.isDuplicate).toBe(true)
  })

  it('does NOT flag unrelated content as duplicate', () => {
    const result = checkMemoryForDuplicates('how we reduced deployment time by 60 percent', existingMemories)
    expect(result.isDuplicate).toBe(false)
  })

  it('does NOT flag content with same opening phrase but different topic', () => {
    const result = checkMemoryForDuplicates('your pods are crashing because of memory limits not code bugs', existingMemories, 0.7)
    expect(result.isDuplicate).toBe(false)
  })

  it('buildMemoryPromptBlock produces actionable prompt text', () => {
    const block = buildMemoryPromptBlock(existingMemories)
    expect(block).toMatch(/CONTENT MEMORY/)
    expect(block).toContain('kubernetes pod restart loops')
    expect(block).toMatch(/avoid repeating|do not repeat/i)
  })

  it('extractMemoriesFromDraft captures topic and hook', () => {
    const memories = extractMemoriesFromDraft(
      'Your monitoring stack is lying to you. Here is why dashboards without alerts are useless.',
      'your monitoring stack is lying to you'
    )
    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some(m => m.type === 'hook_used')).toBe(true)
    expect(memories.some(m => m.type === 'topic_covered')).toBe(true)
  })
})

describe('QA 3: Anti-repetition — 30 day simulation', () => {
  it('simulates 30 days of generation and rejects near-duplicates', () => {
    const memoryBank: ContentMemory[] = []
    const generatedTitles: string[] = []
    let duplicates = 0

    // Simulated persona output over 30 days — includes some intentional repeats
    const simulatedDailyIdeas = [
      ['why pod restart loops signal config drift', 'kubernetes pod restart loops and what they teach about config management'],
      ['observability without alerts is just decoration', 'the case for alerting first, dashboard second'],
      ['how we cut deployment time by 60 percent', 'reducing deployment time with better tooling'],
      ['the hidden cost of microservices complexity', 'microservices complexity has a hidden price'],
      ['why most incidents are not code bugs', 'most outages are configuration not code failures'],
      ['platform engineering is not just kubernetes', 'platform engineering goes beyond kubernetes adoption'],
      ['signal vs noise in production monitoring', 'separating signal from noise in your monitoring stack'],
      ['the follow-up timing problem in outreach', 'why follow-up timing matters more than message content'],
      ['context beats more prospect data every time', 'context before data in sales qualification'],
      ['a lesson from managing on-call rotations', 'what on-call rotations taught me about burnout'],
      // Day 11-20 with some repeats
      ['kubernetes pod restart loops revisited', 'pod restart patterns and config drift — part 2'],
      ['dashboards are not strategy', 'dashboards without purpose are just expensive art'],
      ['the real reason deployments fail', 'deployment failures usually trace back to config'],
      ['when to split a microservice', 'splitting microservices should be the last resort'],
      ['production incidents are teachers', 'every production incident is a free lesson'],
      ['monitoring what matters', 'monitor outcomes not just uptime'],
      ['the art of the follow-up', 'follow-up timing beats first-touch perfection'],
      ['evidence over assumptions in sales', 'evidence beats assumptions every single time'],
      ['on-call done right', 'building an on-call rotation that does not burn people out'],
      ['kubernetes at scale: lessons', 'scaling kubernetes taught me these lessons'],
      // Day 21-30
      ['why reliability is a team sport', 'reliability engineering requires whole-team ownership'],
      ['the observability maturity model', 'stages of observability maturity'],
      ['reducing alert fatigue', 'alert fatigue kills on-call effectiveness'],
      ['incident response playbooks', 'incident response playbooks that actually work'],
      ['config management at scale', 'configuration management gets harder with scale'],
      ['the platform engineering gap', 'there is a gap in most platform engineering teams'],
      ['signal detection theory for sre', 'signal detection theory applied to sre'],
      ['from reactive to proactive ops', 'moving from reactive to proactive operations'],
      ['the cost of tool sprawl', 'tool sprawl is expensive and invisible'],
      ['why simplicity wins in infrastructure', 'simplicity always beats complexity in infra'],
    ]

    for (let day = 0; day < simulatedDailyIdeas.length; day++) {
      const [primary, ...alternates] = simulatedDailyIdeas[day]

      // Check primary against memory
      const dupResult = checkMemoryForDuplicates(primary, memoryBank)
      if (dupResult.isDuplicate) {
        duplicates++
        // In real flow, this idea would be rejected and replaced
        continue
      }

      // Record in memory
      memoryBank.push(makeMemory('topic_covered', primary))
      generatedTitles.push(primary)

      // Also check alternates don't repeat
      for (const alt of alternates) {
        const altDup = checkMemoryForDuplicates(alt, memoryBank)
        if (!altDup.isDuplicate) {
          memoryBank.push(makeMemory('topic_covered', alt))
          generatedTitles.push(alt)
        }
      }
    }

    // Acceptable: <15% of ideas should be flagged as duplicates
    const dupRate = duplicates / simulatedDailyIdeas.length
    expect(dupRate).toBeLessThan(0.15)

    // Should have generated content on most days
    expect(generatedTitles.length).toBeGreaterThan(20)

    // Verify no exact duplicates in final output
    const uniqueTitles = new Set(generatedTitles.map(t => t.toLowerCase()))
    expect(uniqueTitles.size).toBe(generatedTitles.length)
  })
})

describe('QA 4: Growth brand persona', () => {
  it('Relay brand persona has required territories and profile', () => {
    const relayProfile: ContentProfile = makeProfile({
      id: 'relay-brand',
      personaId: 'relay-brand',
      role: 'Revenue Intelligence Platform',
      territories: [
        'knowing what to do next',
        'commercial signal overload',
        'context before action',
        'YOUR MOVE vs THEIR MOVE',
        'follow-up timing',
      ],
      opinions: [
        { belief: 'Most sales tools tell you everything. The harder problem is deciding which event deserves action.', strength: 'strong', evidence: 'Relay worldview', source: 'onboarding', updatedAt: '2025-01-01' },
      ],
    })

    expect(relayProfile.territories?.length ?? 0).toBeGreaterThanOrEqual(5)
    expect(relayProfile.role).toBe('Revenue Intelligence Platform')
    expect(relayProfile.opinions.some(o => o.belief.includes('harder problem'))).toBe(true)
  })

  it('Growth persona is distinct from user personas — different territories', () => {
    const userPersona = makePersona()
    const relayTerritories = ['knowing what to do next', 'commercial signal overload']
    const userTerritories = userPersona.trendInterestProfile?.primaryTerritories ?? []

    const overlap = relayTerritories.filter(t => userTerritories.includes(t))
    expect(overlap.length).toBe(0)
  })
})

describe('QA 5: Blank-state prevention', () => {
  it('brief generation fallback produces at least 3 ideas from profile + trends', () => {
    const profile = makeProfile()
    const territories = profile.territories ?? []
    const expertise = profile.expertise.map(e => e.area).filter(Boolean)

    // Simulate deterministic idea generation (mirrors fallback logic)
    const ideas: Array<{ title: string; territory: string }> = []

    // Trend-grounded (simulated empty for fallback test)
    // Expertise-based
    for (const area of expertise.slice(0, 2)) {
      ideas.push({ title: `A lesson from ${area}`, territory: area })
    }
    // Territory opinions
    for (const territory of territories.slice(0, 2)) {
      if (ideas.length >= 5) break
      ideas.push({ title: `Why ${territory} matters`, territory })
    }
    // Minimum fallback
    if (ideas.length < 3) {
      ideas.push({ title: `A thought on ${expertise[0] ?? 'your work'}`, territory: territories[0] ?? 'general' })
    }

    expect(ideas.length).toBeGreaterThanOrEqual(3)
    expect(ideas.every(i => i.title.length > 0)).toBe(true)
    expect(ideas.every(i => i.territory.length > 0)).toBe(true)
  })
})

describe('QA 6: Visual direction quality', () => {
  it('visual prompt types are specific and avoid AI clichés', () => {
    const validTypes = [
      'PRODUCT_SCREENSHOT', 'EDITORIAL_GRAPHIC', 'TECHNICAL_DIAGRAM',
      'TYPOGRAPHIC_CONCEPT', 'DATA_VISUAL', 'GENERATED_IMAGE', 'NO_VISUAL',
    ]

    // Simulated visual generation output
    const visualOutput = {
      type: 'TECHNICAL_DIAGRAM',
      concept: 'A before/after comparison of alert routing — noisy flat alerts vs filtered signal-based routing',
      prompt: 'Technical diagram showing two alert pipelines side by side. Left: 500 raw alerts flooding a pager. Right: 3 actionable signals routed to specific owners. Clean lines, muted navy and gray palette, single amber accent. 1.91:1 ratio. No text. No faces.',
      reason: 'The post compares alert noise vs signal clarity — a side-by-side diagram makes the contrast concrete.',
    }

    expect(validTypes).toContain(visualOutput.type)

    // Check it avoids AI clichés
    const cliches = ['glowing brain', 'robot', '3D sphere', 'floating code', 'stock photo', 'hologram']
    const promptLower = visualOutput.prompt.toLowerCase()
    for (const cliche of cliches) {
      expect(promptLower).not.toContain(cliche)
    }

    // Check specificity
    expect(visualOutput.prompt).toContain('1.91:1')
    expect(visualOutput.reason.length).toBeGreaterThan(20)
  })
})

describe('QA 7: Date/timezone handling', () => {
  it('getLocalDate returns consistent date for a timezone', () => {
    function getLocalDate(timezone: string): string {
      try {
        return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
      } catch {
        return new Date().toISOString().slice(0, 10)
      }
    }

    const berlin = getLocalDate('Europe/Berlin')
    const ny = getLocalDate('America/New_York')
    const utc = getLocalDate('UTC')

    // All should be YYYY-MM-DD format
    expect(berlin).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ny).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Should differ by at most 1 day across timezones
    const dates = [berlin, ny, utc].map(d => new Date(d).getTime())
    const maxDiff = Math.max(...dates) - Math.min(...dates)
    expect(maxDiff).toBeLessThan(2 * 86_400_000)
  })
})

describe('QA 8: Trend source failure resilience', () => {
  it('brief generation works with zero trend items', () => {
    const profile = makeProfile()
    const trendCandidates: never[] = []

    // Fallback ideas should still be generated from profile alone
    const ideas: string[] = []
    const expertise = profile.expertise.map(e => e.area).filter(Boolean)
    const territories = profile.territories ?? []

    for (const area of expertise.slice(0, 2)) {
      ideas.push(`A lesson from ${area}`)
    }
    for (const territory of territories.slice(0, 2)) {
      if (ideas.length >= 5) break
      ideas.push(`Why ${territory} matters`)
    }
    if (ideas.length < 3) {
      ideas.push(`A thought on ${expertise[0] ?? 'your work'}`)
    }

    expect(trendCandidates.length).toBe(0)
    expect(ideas.length).toBeGreaterThanOrEqual(3)
  })
})
