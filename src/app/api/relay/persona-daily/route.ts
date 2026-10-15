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
}
