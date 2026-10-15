import type { ContentPersona, ContentProfile, ContentMemory, DailyGrowthBrief } from '@/lib/domain/types'
import type { ScoutStore } from '@/lib/store/types'
import type { TrendCandidate } from '@/lib/trends/types'
import { generateDailyBrief } from '@/lib/content/intelligence/v2/daily-brief-engine'
import type { DailyBriefInput } from '@/lib/content/intelligence/v2/daily-brief-engine'

const RELAY_BRAND_TERRITORIES = [
  'knowing what to do next',
  'commercial signal overload',
  'context before action',
  'YOUR MOVE vs THEIR MOVE',
  'follow-up timing',
  'human-controlled AI',
  'better prospect qualification',
  'evidence vs assumptions',
  'good outreach',
  'conversation intelligence',
  'team visibility',
  'Studio creates demand / Relay captures it',
  'practical founder sales operations',
  'building a revenue operating system',
]

const RELAY_BRAND_PROFILE: ContentProfile = {
  id: 'relay-brand',
  organizationId: '',
  personaId: 'relay-brand',
  role: 'Revenue Intelligence Platform',
  seniority: 'industry expert',
  industries: ['sales technology', 'revenue operations', 'b2b saas'],
  audience: 'founders, sales leaders, revenue operators',
  expertise: [
    { area: 'revenue intelligence', level: 'expert', evidence: 'Relay platform', updatedAt: new Date().toISOString() },
    { area: 'sales operations', level: 'expert', evidence: 'Relay platform', updatedAt: new Date().toISOString() },
    { area: 'outreach strategy', level: 'expert', evidence: 'Relay platform', updatedAt: new Date().toISOString() },
    { area: 'conversation intelligence', level: 'expert', evidence: 'Relay platform', updatedAt: new Date().toISOString() },
    { area: 'lead qualification', level: 'expert', evidence: 'Relay platform', updatedAt: new Date().toISOString() },
  ],
  technologies: [
    { name: 'ai', proficiency: 'expert', context: 'core technology' },
    { name: 'crm', proficiency: 'expert', context: 'integration' },
    { name: 'analytics', proficiency: 'expert', context: 'core' },
    { name: 'automation', proficiency: 'proficient', context: 'workflows' },
    { name: 'llm', proficiency: 'expert', context: 'signal processing' },
  ],
  goals: [
    { description: 'Teach Relay\'s worldview on revenue intelligence', type: 'authority', updatedAt: new Date().toISOString() },
    { description: 'Show the problem of signal overload', type: 'audience', updatedAt: new Date().toISOString() },
    { description: 'Hint at the approach without being promotional', type: 'authority', updatedAt: new Date().toISOString() },
  ],
  topicsCared: RELAY_BRAND_TERRITORIES.map(t => ({ topic: t, intensity: 'passionate' as const, source: 'onboarding' as const })),
  topicsAvoided: [
    { topic: 'celebrity news', intensity: 'casual' as const, source: 'inference' as const },
    { topic: 'political commentary', intensity: 'casual' as const, source: 'inference' as const },
    { topic: 'generic motivational content', intensity: 'casual' as const, source: 'inference' as const },
  ],
  opinions: [
    { belief: 'Most sales tools tell you everything. The harder problem is deciding which event deserves action.', strength: 'strong' as const, evidence: 'Relay worldview', source: 'onboarding' as const, updatedAt: new Date().toISOString() },
    { belief: 'More prospect data does not create better outreach if none of it explains why now.', strength: 'strong' as const, evidence: 'Relay worldview', source: 'onboarding' as const, updatedAt: new Date().toISOString() },
    { belief: 'A sent message is not an unfinished task. Waiting is the work.', strength: 'strong' as const, evidence: 'Relay worldview', source: 'onboarding' as const, updatedAt: new Date().toISOString() },
  ],
  projects: [],
  experiences: [],
  writingCharacteristics: {
    preferredLength: 'short',
    sentenceRhythm: 'varied',
    questionFrequency: 'occasional',
    dataUsage: 'light',
    storyPreference: 'concrete',
  },
  storytellingTendencies: [],
  confidence: 0.9,
  lastLearnedAt: null,
  territories: RELAY_BRAND_TERRITORIES,
  audiences: ['founders', 'sales leaders', 'revenue operators', 'b2b saas'],
  contentGoals: ['Teach worldview', 'Show problem', 'Hint at approach'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const RELAY_PERSONA: ContentPersona = {
  id: 'relay-brand',
  repId: 'system',
  organizationId: '',
  displayName: 'Relay Brand',
  platforms: ['linkedin'],
  voiceProfileId: null,
  humorStyle: 'direct, confident, specific',
  valuesAndOpinions: [
    'Context before action',
    'Evidence over assumptions',
    'Human-controlled AI',
  ],
  admiredExamples: [],
  contentProfileId: 'relay-brand',
  personaRole: 'Revenue Intelligence Platform',
  onboardingCompleted: true,
  createdAt: new Date().toISOString(),
}

export interface GrowthGenerationInput {
  store: ScoutStore
  orgId: string
  trendCandidates: TrendCandidate[]
  recentGrowthTopics: string[]
  recentGrowthHooks: string[]
  recentGrowthAngles: string[]
  localDate: string
  timezone: string
  excludeTitles?: string[]
  excludeAngles?: string[]
}

export async function generateGrowthBriefViaStudioEngine(
  input: GrowthGenerationInput,
): Promise<DailyGrowthBrief> {
  const persona: ContentPersona = { ...RELAY_PERSONA, organizationId: input.orgId }
  const profile: ContentProfile = { ...RELAY_BRAND_PROFILE, organizationId: input.orgId }

  const memoryContent: ContentMemory[] = [
    ...input.recentGrowthTopics.map((t, i) => ({
      id: `growth-mem-topic-${i}`,
      organizationId: input.orgId,
      personaId: 'relay-brand',
      memoryType: 'topic_covered' as const,
      content: t,
      sourceDraftId: null,
      sourceHistoryId: null,
      createdAt: new Date().toISOString(),
    })),
    ...input.recentGrowthAngles.map((a, i) => ({
      id: `growth-mem-angle-${i}`,
      organizationId: input.orgId,
      personaId: 'relay-brand',
      memoryType: 'angle_used' as const,
      content: a,
      sourceDraftId: null,
      sourceHistoryId: null,
      createdAt: new Date().toISOString(),
    })),
  ]

  const rejectedIdeas = (input.excludeTitles ?? []).map((t, i) => ({
    title: t,
    territory: RELAY_BRAND_TERRITORIES[i % RELAY_BRAND_TERRITORIES.length],
    angle: (input.excludeAngles ?? [])[i] ?? '',
  }))
  const recentIdeas = [
    ...input.recentGrowthTopics.map((t, i) => ({
      title: t,
      territory: RELAY_BRAND_TERRITORIES[i % RELAY_BRAND_TERRITORIES.length],
      angle: input.recentGrowthAngles[i] ?? '',
    })),
    ...rejectedIdeas,
  ]

  const briefInput: DailyBriefInput = {
     persona,
     profile,
     tasteProfile: {
       preferences: {
         opinionVsEducational: 0.4,
         timelyVsEvergreen: -0.2,
         shortVsDeep: 0.3,
       },
       territoryAffinity: Object.fromEntries(RELAY_BRAND_TERRITORIES.map(t => [t, 0.8])),
     },
     memories: memoryContent,
     trendCandidates: input.trendCandidates,
     recentIdeas,
     localDate: input.localDate,
     timezone: input.timezone,
     platform: 'linkedin',
   }

  const result = await generateDailyBrief(input.store, briefInput)

  const recommended = result.ideas.find(i => i.ideaType === 'recommended')
  const alternates = result.ideas.filter(i => i.ideaType !== 'recommended')

  const brief = await input.store.createDailyGrowthBrief({
    organizationId: input.orgId,
    localDate: input.localDate,
    promptVersion: 'growth-via-studio-v2',
    postCaption: recommended?.postCaption ?? undefined,
    visualType: recommended?.visualType ?? undefined,
    visualConcept: recommended?.visualConcept ?? undefined,
    visualPrompt: recommended?.visualPrompt ?? undefined,
    visualReason: recommended?.visualReason ?? undefined,
    alternateIdeas: alternates.map(a => ({
      title: a.title,
      angle: a.angle ?? '',
      whyNow: a.whyNow ?? '',
    })),
  })

  return brief
}
