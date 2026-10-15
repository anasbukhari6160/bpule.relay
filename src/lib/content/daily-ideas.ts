import type {
  ContentProfile,
  ContentIdeaCard,
  TopicCluster,
  ContentHistoryEntry,
  ContentMemory,
  ContentJourneyEntry,
} from '@/lib/domain/types'

/**
 * Daily Ideas Engine — deterministic-first idea generation.
 *
 * Produces personalized content ideas from stored Persona intelligence.
 * No model calls required. Cheap, fast, always available.
 *
 * Sources: expertise, journey, opinions, projects, experiences,
 * topic clusters, content gaps, audience needs, goals.
 */

const TERRITORY_COLORS: Record<string, string> = {
  authority: '#2563eb',
  proof: '#059669',
  perspective: '#7c3aed',
  education: '#d97706',
  journey: '#dc2626',
  conversation: '#0891b2',
  timely: '#ea580c',
  human: '#be185d',
}

export function generateDailyIdeas(input: {
  profile: ContentProfile | null
  clusters: TopicCluster[]
  history: ContentHistoryEntry[]
  memories: ContentMemory[]
  journey: ContentJourneyEntry[]
  contentGoals: string[]
  audiences: string[]
  territories: string[]
}): ContentIdeaCard[] {
  const ideas: ContentIdeaCard[] = []
  const coveredTopics = new Set<string>(
    input.memories
      .filter((m) => m.memoryType === 'topic_covered')
      .map((m) => m.content.toLowerCase()),
  )
  const usedHooks = new Set<string>(
    input.memories
      .filter((m) => m.memoryType === 'hook_used')
      .map((m) => m.content.toLowerCase().slice(0, 40)),
  )

  if (input.profile) {
    for (const exp of input.profile.expertise ?? []) {
      if (exp.level === 'expert' || exp.level === 'advanced') {
        const alreadyCovered = [...coveredTopics].some((t) => t.includes(exp.area.toLowerCase()))
        if (!alreadyCovered) {
          ideas.push({
            id: `exp-${exp.area}`,
            title: `Something most people get wrong about ${exp.area}`,
            angle: `Teach a counterintuitive lesson or common misconception in ${exp.area} that only someone with your experience would know.`,
            whyYou: `You have ${exp.level} expertise in ${exp.area}${exp.evidence ? ` — ${exp.evidence}` : ''}.`,
            whyAudience: `Your audience faces this daily but likely hasn't heard your perspective.`,
            sourceKind: 'expertise',
            territory: 'authority',
            confidence: exp.level === 'expert' ? 0.85 : 0.7,
            territoryColor: TERRITORY_COLORS.authority,
          })
        }
      }
    }

    for (const opinion of input.profile.opinions ?? []) {
      const confidence = opinion.strength === 'strong' ? 0.8 : opinion.strength === 'moderate' ? 0.65 : 0.5
      ideas.push({
        id: `op-${opinion.belief.slice(0, 30)}`,
        title: `Why you believe: "${opinion.belief.slice(0, 50)}${opinion.belief.length > 50 ? '...' : ''}"`,
        angle: `Share the reasoning behind this belief. Explain what experiences led you here and why others should consider it.`,
        whyYou: `You hold this ${opinion.strength} opinion${opinion.evidence ? ` — backed by: ${opinion.evidence}` : ''}.`,
        whyAudience: `Opinions spark discussion. Your audience wants to know how you think.`,
        sourceKind: 'opinion',
        territory: 'perspective',
        confidence,
        territoryColor: TERRITORY_COLORS.perspective,
      })
    }

    for (const project of input.profile.projects ?? []) {
      if ((project.lessons ?? []).length > 0) {
        ideas.push({
          id: `proj-${project.name}`,
          title: `What building ${project.name} taught you`,
          angle: `Share the key lesson from this project. What would you tell someone attempting something similar?`,
          whyYou: `You delivered ${project.name}${project.role ? ` as ${project.role}` : ''}.`,
          whyAudience: `Real project lessons are more credible than abstract advice.`,
          sourceKind: 'project',
          territory: 'proof',
          confidence: 0.75,
          territoryColor: TERRITORY_COLORS.proof,
        })
      }
      if (project.outcome && !(project.lessons ?? []).length) {
        ideas.push({
          id: `proj-out-${project.name}`,
          title: `The outcome of ${project.name} and what it means`,
          angle: `Share the result and what it taught you about the space.`,
          whyYou: `You shipped ${project.name} and achieved: ${project.outcome}.`,
          whyAudience: `Outcomes demonstrate credibility and provide useful case studies.`,
          sourceKind: 'project',
          territory: 'proof',
          confidence: 0.65,
          territoryColor: TERRITORY_COLORS.proof,
        })
      }
    }

    for (const exp of input.profile.experiences ?? []) {
      if (exp.lesson.trim()) {
        const typeLabel = exp.type === 'mistake' ? 'mistake' : exp.type === 'success' ? 'win' : exp.type === 'decision' ? 'decision' : 'experience'
        ideas.push({
          id: `exp-${exp.description.slice(0, 30)}`,
          title: `The ${typeLabel} that changed how you think${exp.description ? ` about ${exp.description.split(' ').slice(0, 4).join(' ')}` : ''}`,
          angle: `Tell the story of this ${typeLabel} and the lesson it taught you.`,
          whyYou: `You lived this: ${exp.description}`,
          whyAudience: `Stories from real experience are the most shareable content.`,
          sourceKind: 'journey',
          territory: 'journey',
          confidence: 0.7,
          territoryColor: TERRITORY_COLORS.journey,
        })
      }
    }

    for (const tech of input.profile.technologies ?? []) {
      if (tech.proficiency === 'expert' || tech.proficiency === 'proficient') {
        const alreadyCovered = [...coveredTopics].some((t) => t.includes(tech.name.toLowerCase()))
        if (!alreadyCovered) {
          ideas.push({
            id: `tech-${tech.name}`,
            title: `What ${tech.name} gets right (and wrong)${tech.context ? ` in ${tech.context}` : ''}`,
            angle: `Share your nuanced take on this technology — not hype, not hate, just real experience.`,
            whyYou: `You use ${tech.name} at ${tech.proficiency} level${tech.context ? ` in ${tech.context}` : ''}.`,
            whyAudience: `Engineers want real takes, not marketing copy.`,
            sourceKind: 'expertise',
            territory: 'education',
            confidence: 0.65,
            territoryColor: TERRITORY_COLORS.education,
          })
        }
      }
    }
  }

  for (const event of input.journey) {
    if (event.eventType === 'shipped' || event.eventType === 'milestone') {
      ideas.push({
        id: `journey-${event.id}`,
        title: `What "${event.title}" taught you`,
        angle: `Reflect on this milestone. What did it change about how you work or think?`,
        whyYou: `You experienced this: ${event.title}.`,
        whyAudience: `Growth stories resonate with people on similar paths.`,
        sourceKind: 'journey',
        territory: 'journey',
        confidence: 0.7,
        territoryColor: TERRITORY_COLORS.journey,
      })
    }
  }

  for (const cluster of input.clusters) {
    const alreadyCovered = [...coveredTopics].some((t) => t.includes(cluster.clusterName.toLowerCase()))
    if (!alreadyCovered) {
      ideas.push({
        id: `cluster-${cluster.id}`,
        title: `Your take on ${cluster.clusterName}`,
        angle: cluster.description
          ? `Share your perspective on this topic: ${cluster.description}`
          : `What do you know about ${cluster.clusterName} that others might not?`,
        whyYou: `This is one of your focus areas.`,
        whyAudience: `Your audience followed you for expertise like this.`,
        sourceKind: 'expertise',
        territory: 'education',
        confidence: 0.55,
        territoryColor: TERRITORY_COLORS.education,
      })
    }
  }

  for (const goal of input.contentGoals) {
    const goalIdeas: ContentIdeaCard[] = []

    if (goal === 'get_clients' || goal === 'grow_my_company') {
      goalIdeas.push({
        id: `goal-${goal}-authority`,
        title: `Show the work behind the work`,
        angle: `Share a specific insight from your practice that demonstrates expertise. Let the work speak.`,
        whyYou: `You want clients to find you through demonstrated authority.`,
        whyAudience: `People hire those who clearly know their craft.`,
        sourceKind: 'expertise',
        territory: 'authority',
        confidence: 0.6,
        territoryColor: TERRITORY_COLORS.authority,
      })
    }
    if (goal === 'build_authority' || goal === 'build_a_personal_brand') {
      goalIdeas.push({
        id: `goal-${goal}-perspective`,
        title: `Your unpopular (but honest) take`,
        angle: `Share a perspective that goes against common wisdom. Explain your reasoning.`,
        whyYou: `Authority comes from having original thoughts, not echoing others.`,
        whyAudience: `People follow those with genuine perspectives.`,
        sourceKind: 'opinion',
        territory: 'perspective',
        confidence: 0.6,
        territoryColor: TERRITORY_COLORS.perspective,
      })
    }
    if (goal === 'grow_my_network' || goal === 'meet_people_in_my_industry') {
      goalIdeas.push({
        id: `goal-${goal}-conversation`,
        title: `A question only your industry would understand`,
        angle: `Ask a thought-provoking question that invites discussion among peers.`,
        whyYou: `Questions are the fastest way to start conversations.`,
        whyAudience: `People engage when they have something to add.`,
        sourceKind: 'audience_gap',
        territory: 'conversation',
        confidence: 0.55,
        territoryColor: TERRITORY_COLORS.conversation,
      })
    }

    ideas.push(...goalIdeas)
  }

  if (ideas.length === 0) {
    ideas.push(...getEvergreenIdeas(input.profile, input.audiences))
  }

  return diversifyIdeas(ideas, usedHooks)
}

function getEvergreenIdeas(profile: ContentProfile | null, audiences: string[]): ContentIdeaCard[] {
  const role = profile?.role?.toLowerCase() || 'professional'
  return [
    {
      id: 'evergreen-1',
      title: `One thing I wish I knew earlier in my ${role} journey`,
      angle: `Share a lesson that would have saved you time or frustration.`,
      whyYou: `Your experience is the credibility.`,
      whyAudience: `Everyone benefits from hindsight.`,
      sourceKind: 'evergreen',
      territory: 'journey',
      confidence: 0.5,
      territoryColor: TERRITORY_COLORS.journey,
    },
    {
      id: 'evergreen-2',
      title: `A common mistake in ${profile?.expertise[0]?.area || 'your field'} and how to avoid it`,
      angle: `Teach something practical that people can apply immediately.`,
      whyYou: `You have the expertise to spot this mistake.`,
      whyAudience: `Actionable content gets saved and shared.`,
      sourceKind: 'evergreen',
      territory: 'education',
      confidence: 0.5,
      territoryColor: TERRITORY_COLORS.education,
    },
    {
      id: 'evergreen-3',
      title: `What I'd tell someone starting in ${profile?.industries?.[0] || 'this industry'} today`,
      angle: `Give honest, practical advice for newcomers.`,
      whyYou: `You have the experience to guide them.`,
      whyAudience: `People starting out need honest guidance.`,
      sourceKind: 'evergreen',
      territory: 'education',
      confidence: 0.45,
      territoryColor: TERRITORY_COLORS.education,
    },
  ]
}

function diversifyIdeas(ideas: ContentIdeaCard[], usedHooks: Set<string>): ContentIdeaCard[] {
  // Deduplicate by similar title
  const seen = new Set<string>()
  const deduped: ContentIdeaCard[] = []
  for (const idea of ideas) {
    const key = idea.title.toLowerCase().slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(idea)
  }

  deduped.sort((a, b) => b.confidence - a.confidence)

  const territoryCount = new Map<string, number>()
  const diversified: ContentIdeaCard[] = []
  for (const idea of deduped) {
    const count = territoryCount.get(idea.territory) || 0
    if (count < 2) {
      diversified.push(idea)
      territoryCount.set(idea.territory, count + 1)
    }
  }

  return diversified.slice(0, 8)
}
