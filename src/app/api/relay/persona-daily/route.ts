import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import { rankTrendsForPersona } from '@/lib/trends/engine'
import { generatePersonaDailyPost, recordRejection, inferTrendInterestFromProfile } from '@/lib/relay/daily-persona-post-engine'
import type { TrendRelevanceProfile } from '@/lib/trends/types'
import type { TrendItem } from '@/lib/domain/types'

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
  const profile = persona.contentProfileId ? await store.getContentProfile(persona.contentProfileId) : null
  const memories = await store.listContentMemories(persona.id, { limit: 30 })

  const trendInterest: TrendRelevanceProfile = persona.trendInterestProfile
    ? {
        primaryTerritories: persona.trendInterestProfile.primaryTerritories,
        secondaryTerritories: persona.trendInterestProfile.secondaryTerritories,
        technologies: persona.trendInterestProfile.technologies,
        industries: persona.trendInterestProfile.industries,
        excludedTerritories: persona.trendInterestProfile.excludedTerritories,
      }
    : inferTrendInterestFromProfile(persona, profile)

  const trendItems = await store.listTrendItems({ limit: 150 })
  const recentIdeas: Array<{ title: string; territory: string; angle: string }> = []

  const trendCandidates = rankTrendsForPersona(trendItems as TrendItem[], trendInterest, {
    recentlyCoveredTopics: memories.filter(m => m.memoryType === 'topic_covered').slice(0, 15).map(m => m.content.toLowerCase()),
    recentlyUsedAngles: recentIdeas.map(i => i.angle),
    explorationRatio: 0.25,
  })

  try {
    const result = await generatePersonaDailyPost({
      persona,
      profile,
      memories,
      trendCandidates,
      rejectedTitles: [],
      rejectedAngles: [],
      recentIdeas,
      platform,
      localDate,
      timezone: user.rep.timezone ?? 'UTC',
    })

    return NextResponse.json({
      post: {
        title: result.title,
        angle: result.angle,
        postCaption: result.postCaption,
        territory: result.territory,
        whyNow: result.whyNow,
        trendGrounded: result.trendGrounded,
        visualPrompt: result.visualPrompt,
        alternateIdeas: result.alternateIdeas,
      },
      personaId: persona.id,
      personaName: persona.displayName,
      localDate,
      platform,
    })
  } catch (err) {
    console.error('[persona-daily] Generation failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({
      error: 'Generation failed',
      message: err instanceof Error ? err.message : 'Unknown error',
      fallback: generateFallbackPost(persona, profile, trendCandidates, platform),
    }, { status: 200 })
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const personaId = url.searchParams.get('personaId')
  if (!personaId) return NextResponse.json({ error: 'personaId required' }, { status: 400 })

  const platform = (url.searchParams.get('platform') === 'x' ? 'x' : 'linkedin') as 'linkedin' | 'x'

  const body = await request.json().catch(() => ({}))
  const rejectTitle = body.rejectTitle as string | undefined
  const rejectAngle = body.rejectAngle as string | undefined

  const store = await createScoutStore()
  const persona = await store.getContentPersona(personaId)
  if (!persona) return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
  if (persona.repId !== user.rep.id && user.rep.role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const localDate = getLocalDate(user.rep.timezone ?? 'UTC')

  // Record rejection for this persona+date session
  if (rejectTitle) {
    recordRejection(persona.id, localDate, rejectTitle, rejectAngle ?? '')
  }

  const profile = persona.contentProfileId ? await store.getContentProfile(persona.contentProfileId) : null
  const memories = await store.listContentMemories(persona.id, { limit: 30 })

  const trendInterest: TrendRelevanceProfile = persona.trendInterestProfile
    ? {
        primaryTerritories: persona.trendInterestProfile.primaryTerritories,
        secondaryTerritories: persona.trendInterestProfile.secondaryTerritories,
        technologies: persona.trendInterestProfile.technologies,
        industries: persona.trendInterestProfile.industries,
        excludedTerritories: persona.trendInterestProfile.excludedTerritories,
      }
    : inferTrendInterestFromProfile(persona, profile)

  const trendItems = await store.listTrendItems({ limit: 150 })
  const recentIdeas: Array<{ title: string; territory: string; angle: string }> = []

  const trendCandidates = rankTrendsForPersona(trendItems as TrendItem[], trendInterest, {
    recentlyCoveredTopics: memories.filter(m => m.memoryType === 'topic_covered').slice(0, 15).map(m => m.content.toLowerCase()),
    recentlyUsedAngles: recentIdeas.map(i => i.angle),
    explorationRatio: 0.30,
  })

  try {
    const result = await generatePersonaDailyPost({
      persona,
      profile,
      memories,
      trendCandidates,
      rejectedTitles: rejectTitle ? [rejectTitle] : [],
      rejectedAngles: rejectAngle ? [rejectAngle] : [],
      recentIdeas,
      platform,
      localDate,
      timezone: user.rep.timezone ?? 'UTC',
    })

    return NextResponse.json({
      post: {
        title: result.title,
        angle: result.angle,
        postCaption: result.postCaption,
        territory: result.territory,
        whyNow: result.whyNow,
        trendGrounded: result.trendGrounded,
        visualPrompt: result.visualPrompt,
        alternateIdeas: result.alternateIdeas,
      },
      personaId: persona.id,
      personaName: persona.displayName,
      localDate,
      platform,
      rejected: rejectTitle ? true : false,
    })
  } catch (err) {
    console.error('[persona-daily] Regeneration failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({
      error: 'Generation failed',
      message: err instanceof Error ? err.message : 'Unknown error',
      fallback: generateFallbackPost(persona, profile, trendCandidates, platform),
    }, { status: 200 })
  }
}

function generateFallbackPost(
  persona: { displayName?: string; personaRole?: string | null; repId?: string } | null,
  profile: { territories?: string[]; expertise?: Array<{ area: string }> } | null,
  trendCandidates: import('@/lib/trends/types').TrendCandidate[],
  platform: 'linkedin' | 'x',
) {
  const role = persona?.personaRole ?? 'professional'
  const territory = profile?.territories?.[0] ?? 'your field'
  const expertise = profile?.expertise?.[0]?.area ?? territory
  const trendTitle = trendCandidates[0]?.item?.title

  const alternates = [
    { title: `The ${territory} lesson most ${role}s learn too late`, angle: `A hard-won insight from real work in ${territory}. Specific, not abstract.`, territory },
    { title: `What "${trendTitle ?? 'current trends'}" means for ${role}s`, angle: `A trend-grounded take on why this matters to ${territory} professionals right now.`, territory },
    { title: `I changed my mind about ${expertise}`, angle: `A genuine perspective shift. What changed and what it means going forward.`, territory },
    { title: `The ${expertise} mistake I see every team make`, angle: `A specific, recurring pattern with a concrete fix.`, territory },
    { title: `Why most teams underestimate ${territory}`, angle: `A contrarian take that challenges common assumptions.`, territory },
    { title: `Two years of ${expertise} in one lesson`, angle: `A single actionable takeaway distilled from real experience.`, territory },
    { title: `What nobody tells you about ${territory}`, angle: `An insider perspective that contradicts surface-level advice.`, territory },
  ]

  const mainTitle = alternates[0].title
  const mainAngle = alternates[0].angle

  const postCaption = platform === 'linkedin'
    ? `${mainAngle}\n\nAfter years of working in ${territory}, I have seen this pattern repeat. The conventional advice does not hold up when you look at the actual data.\n\nHere is what actually works.\n\nWhat has your experience been?`
    : `${mainAngle.slice(0, 200)}`

  return {
    post: {
      title: mainTitle,
      angle: mainAngle,
      postCaption,
      territory,
      whyNow: 'Evergreen expertise',
      trendGrounded: !!trendTitle,
      visualPrompt: null,
      alternateIdeas: alternates.slice(1),
    },
    personaId: persona?.displayName ?? 'persona',
    personaName: persona?.displayName ?? 'Your Persona',
    fallback: true,
  }
}
