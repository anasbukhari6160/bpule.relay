import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import type { TrendRelevanceProfile } from '@/lib/trends/types'
import { rankTrendsForPersona } from '@/lib/trends/engine'
import { generateDailyBrief } from '@/lib/content/intelligence/v2/daily-brief-engine'
import type { ContentPersona, ContentProfile, DailyContentIdea } from '@/lib/domain/types'
import type { ScoutStore } from '@/lib/store/types'

export const dynamic = 'force-dynamic'
 export const runtime = 'nodejs'
 export const maxDuration = 120

function getLocalDate(timezone: string): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export async function GET(request: Request) {
   const user = await getCurrentUser()
   if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

   const url = new URL(request.url)
   const personaId = url.searchParams.get('personaId')
   if (!personaId) return NextResponse.json({ error: 'personaId required' }, { status: 400 })

   const platform = (url.searchParams.get('platform') === 'x' ? 'x' : 'linkedin') as 'linkedin' | 'x'

   const store = await createScoutStore()
   const persona = await store.getContentPersona(personaId)
   if (!persona) return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
   if (persona.repId !== user.rep.id && user.rep.role !== 'admin') {
     return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
   }

   const localDate = getLocalDate(user.rep.timezone ?? 'UTC')

    const existing = await store.getDailyContentBriefWithIdeas(personaId, localDate)
    if (existing && existing.ideas.length > 0) {
      return NextResponse.json({ brief: existing.brief, ideas: existing.ideas, fromCache: true, platform })
    }

    return NextResponse.json({ brief: null, ideas: [], platform })
 }

export async function POST(request: Request) {
   const user = await getCurrentUser()
   if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

   const body = await request.json()
   const personaId = body.personaId as string
   if (!personaId) return NextResponse.json({ error: 'personaId required' }, { status: 400 })

   const platform = (body.platform === 'x' ? 'x' : 'linkedin') as 'linkedin' | 'x'

   const store = await createScoutStore()
   const persona = await store.getContentPersona(personaId)
   if (!persona) return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
   if (persona.repId !== user.rep.id && user.rep.role !== 'admin') {
     return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
   }

   const localDate = getLocalDate(user.rep.timezone ?? 'UTC')
   return generateAndRespond(store, persona, localDate, user.rep.timezone ?? 'UTC', platform)
 }

async function generateAndRespond(
   store: ScoutStore,
   persona: ContentPersona,
   localDate: string,
   timezone: string,
   platform: 'linkedin' | 'x',
 ) {
  try {
    const profile: ContentProfile | null = persona.contentProfileId
      ? await store.getContentProfile(persona.contentProfileId)
      : null

    const memories = await store.listContentMemories(persona.id, { limit: 30 })
    const tasteProfile = await store.getTasteProfile(persona.id)

    const trendInterest: TrendRelevanceProfile = persona.trendInterestProfile
      ? {
          primaryTerritories: persona.trendInterestProfile.primaryTerritories,
          secondaryTerritories: persona.trendInterestProfile.secondaryTerritories,
          technologies: persona.trendInterestProfile.technologies,
          industries: persona.trendInterestProfile.industries,
          excludedTerritories: persona.trendInterestProfile.excludedTerritories,
        }
      : inferTrendInterestFromProfile(profile)

    const trendItems = await store.listTrendItems({ limit: 100 })
    const recentIdeas = await getRecentIdeas(store, persona.id)
    const trendCandidates = rankTrendsForPersona(trendItems, trendInterest, {
      recentlyCoveredTopics: extractRecentTopics(memories),
      recentlyUsedAngles: recentIdeas.map(i => i.angle),
      explorationRatio: 0.25,
    })

    try {
      const result = await generateDailyBrief(store, {
         persona,
         profile: profile ?? {
           id: '',
           organizationId: persona.organizationId,
           personaId: persona.id,
           confidence: 0,
         } as ContentProfile,
         tasteProfile,
         memories,
         trendCandidates,
         recentIdeas,
         localDate,
         timezone,
         platform,
       })

      if (!result.ideas || result.ideas.length === 0) {
        throw new Error('AI returned 0 ideas')
      }

      return NextResponse.json({ brief: result.brief, ideas: result.ideas, cost: result.cost })
    } catch (aiErr) {
      console.error('[daily-brief] AI generation failed:', aiErr instanceof Error ? aiErr.message : JSON.stringify(aiErr))
      // AI providers failed — fall back to deterministic brief from trends + profile
      try {
         const fallbackIdeas = generateFallbackIdeas(profile ?? null, trendCandidates, persona)
         // The AI path may have left a brief for this persona+date. A rep cannot
         // delete briefs (RLS allows only org admins), so delete+insert would hit
         // the unique constraint — reuse the existing brief instead.
         const existing = await store.getDailyContentBriefWithIdeas(persona.id, localDate).catch(() => null)
         if (existing && existing.ideas.length > 0) {
           return NextResponse.json({ brief: existing.brief, ideas: existing.ideas, fromFallback: true })
         }
         const brief = existing?.brief ?? await store.createDailyContentBrief({
           organizationId: persona.organizationId,
           personaId: persona.id,
           localDate,
           promptVersion: 'fallback-v1',
           trendSnapshot: { source: 'fallback', count: fallbackIdeas.length },
         })

         const ideaRecords: DailyContentIdea[] = []
         for (let i = 0; i < fallbackIdeas.length; i++) {
           const idea = fallbackIdeas[i]
           try {
             const record = await store.createDailyContentIdea({
               briefId: brief.id,
               organizationId: persona.organizationId,
               personaId: persona.id,
               ideaType: i === 0 ? 'recommended' : 'alternate',
               title: idea.title,
               angle: idea.angle,
               whyNow: idea.whyNow,
               territory: idea.territory,
               trendGrounded: idea.trendGrounded,
               formatSuggestion: idea.formatSuggestion,
               postCaption: generateEmergencyCaption(idea, persona),
             })
             ideaRecords.push(record)
           } catch (ideaErr) {
             console.error('[daily-brief] Failed to create fallback idea:', ideaErr instanceof Error ? ideaErr.message : String(ideaErr))
           }
         }

        if (ideaRecords.length === 0) {
          throw new Error('All fallback ideas failed to save')
        }

        if (ideaRecords[0]) {
          await store.updateDailyContentBriefRecommended(brief.id, ideaRecords[0].id)
        }
        await store.updateDailyContentBriefStatus(brief.id, 'ready')

        return NextResponse.json({ brief, ideas: ideaRecords, fromFallback: true })
       } catch (fallbackErr) {
         const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : (fallbackErr && typeof fallbackErr === 'object' ? JSON.stringify(fallbackErr) : String(fallbackErr))
         console.error('[daily-brief] Fallback also failed:', fallbackMsg)
         // Last resort: return ideas directly without persisting — generate real captions from angles
         const emergencyIdeas = generateFallbackIdeas(profile ?? null, trendCandidates, persona).map((idea, i) => ({
           id: `emergency-${Date.now()}-${i}`,
           briefId: 'emergency',
           organizationId: persona.organizationId,
           personaId: persona.id,
           ideaType: i === 0 ? 'recommended' : 'alternate',
           title: idea.title,
           angle: idea.angle,
           whyNow: idea.whyNow,
           territory: idea.territory,
           trendGrounded: idea.trendGrounded,
           formatSuggestion: idea.formatSuggestion,
           postCaption: generateEmergencyCaption(idea, persona),
           createdAt: new Date().toISOString(),
         }))
         return NextResponse.json({ brief: { id: 'emergency', status: 'ready', localDate }, ideas: emergencyIdeas, fromFallback: true })
       }
    }
  } catch (err) {
     const message = err instanceof Error ? err.message : (err && typeof err === 'object' ? JSON.stringify(err) : String(err))
     console.error('[daily-brief] Outer error:', message)
     return NextResponse.json(
       { error: 'Generation failed', message },
       { status: 500 },
     )
   }
}

interface FallbackIdea {
  title: string
  angle: string
  whyNow: string
  territory?: string
  trendGrounded: boolean
  formatSuggestion?: string
}

function generateEmergencyCaption(idea: FallbackIdea, persona: ContentPersona): string {
  // Generate a real post caption from the idea data without AI
  const role = persona.personaRole ?? 'professional'
  const territory = idea.territory ?? 'your field'

  switch (idea.formatSuggestion) {
    case 'opinion':
      return `${idea.angle}\n\nAfter years of working in ${territory}, I've seen this pattern repeat. The conventional advice doesn't hold up when you look at the data.\n\nWhat's your experience?`
    case 'case_study':
      return `${idea.title}.\n\n${idea.angle}\n\nHere's what happened and what I learned.\n\nWhat would you have done differently?`
    case 'practical_lesson':
      return `${idea.angle}\n\nThis is something the ${role} in me wishes I'd learned earlier.\n\n${idea.whyNow}.\n\nWhat's your approach?`
    default:
      return `${idea.title}.\n\n${idea.angle}\n\n${idea.whyNow}.\n\nWhat do you think?`
  }
}

function generateFallbackIdeas(
  profile: ContentProfile | null,
  trendCandidates: import('@/lib/trends/types').TrendCandidate[],
  persona: ContentPersona,
): FallbackIdea[] {
  const ideas: FallbackIdea[] = []
  const territories = profile?.territories ?? []
  const expertise = (profile?.expertise ?? []).map(e => e.area).filter(Boolean)
  const role = persona.personaRole ?? profile?.role ?? 'your role'
  const topicsCared = (profile?.topicsCared ?? []).map(t => t.topic)

  // 1. Trend ideas — only include trends RELEVANT to this persona
  for (const candidate of trendCandidates.slice(0, 8)) {
    if (ideas.length >= 2) break
    const trendTopics = candidate.item.topics
    const isRelevant = territories.some(t => trendTopics.includes(t)) ||
      expertise.some(e => trendTopics.includes(e)) ||
      topicsCared.some(t => trendTopics.includes(t))
    if (!isRelevant) continue
    ideas.push({
      title: `What "${candidate.item.title}" means for ${role}`,
      angle: `A current development relevant to ${role}. Connect this trend to your audience's daily challenges.`,
      whyNow: candidate.whyNow,
      territory: territories[0] ?? candidate.item.topics[0],
      trendGrounded: true,
      formatSuggestion: 'observation',
    })
  }

  // 2. Expertise-based ideas (persona-specific hooks)
  const expertiseHooks = [
    (area: string) => ({ title: `The ${area} mistake I see every team make`, angle: `A specific recurring pattern you have observed. Name the mistake, why it happens, and what to do instead.`, format: 'practical_lesson' }),
    (area: string) => ({ title: `What nobody tells you about ${area}`, angle: `An insider perspective that contradicts common advice.`, format: 'opinion' }),
    (area: string) => ({ title: `I changed my mind about ${area}`, angle: `A genuine shift in perspective. What changed your mind and what you think now.`, format: 'opinion' }),
  ]
  for (let i = 0; i < Math.min(expertise.length, 3); i++) {
    const area = expertise[i]
    const hook = expertiseHooks[i % expertiseHooks.length](area)
    ideas.push({ ...hook, whyNow: 'Evergreen expertise', territory: area, trendGrounded: false, formatSuggestion: hook.format })
  }

  // 3. Territory opinions
  for (const territory of territories.slice(0, 2)) {
    if (ideas.length >= 5) break
    ideas.push({
      title: `Why most teams underestimate ${territory}`,
      angle: `A contrarian take that challenges common assumptions about ${territory}.`,
      whyNow: 'Evergreen territory',
      territory,
      trendGrounded: false,
      formatSuggestion: 'opinion',
    })
  }

  if (ideas.length < 3) {
    ideas.push(
      { title: `A lesson from ${expertise[0] ?? territories[0] ?? 'your work'}`, angle: `Share a specific insight from your experience. What would you tell someone starting out?`, whyNow: 'Evergreen', trendGrounded: false, formatSuggestion: 'practical_lesson' },
      { title: `What's changing in ${territories[0] ?? 'your field'}`, angle: `An observation about a trend or shift you are seeing.`, whyNow: 'Evergreen', trendGrounded: false, formatSuggestion: 'observation' },
      { title: `The ${role} timing problem`, angle: `A specific challenge you face and how you approach it.`, whyNow: 'Evergreen', trendGrounded: false, formatSuggestion: 'observation' },
    )
  }

  return ideas.slice(0, 5)
}

function inferTrendInterestFromProfile(profile: ContentProfile | null): TrendRelevanceProfile {
  return {
    primaryTerritories: profile?.territories?.slice(0, 5) ?? [],
    secondaryTerritories: profile?.audiences ?? [],
    technologies: (profile?.technologies ?? []).map(t => (typeof t === 'object' && 'name' in t ? t.name : String(t))).slice(0, 10),
    industries: profile?.industries ?? [],
    excludedTerritories: (profile?.topicsAvoided ?? []).map(t => (typeof t === 'object' && 'topic' in t ? t.topic : String(t))).slice(0, 5),
  }
}

function extractRecentTopics(memories: { memoryType: string; content: string }[]): string[] {
  return memories
    .filter(m => m.memoryType === 'topic_covered')
    .slice(0, 15)
    .map(m => m.content.toLowerCase())
}

async function getRecentIdeas(
  store: ScoutStore,
  personaId: string,
): Promise<Array<{ title: string; territory: string; angle: string }>> {
  const latestBrief = await store.getLatestDailyContentBrief(personaId)
  if (!latestBrief) return []
  const ideas = await store.listDailyContentIdeas(latestBrief.id)
  return ideas.map(i => ({ title: i.title, territory: i.territory ?? '', angle: i.angle ?? '' }))
}
