import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth/current'
import type { TrendRelevanceProfile } from '@/lib/trends/types'
import { rankTrendsForPersona } from '@/lib/trends/engine'
import { generateGrowthBriefViaStudioEngine } from '@/lib/growth/v2/relay-brand-adapter'

export const dynamic = 'force-dynamic'
 export const runtime = 'nodejs'
 export const maxDuration = 120

const RELAY_TREND_PROFILE: TrendRelevanceProfile = {
  primaryTerritories: ['sales technology', 'revenue operations', 'ai', 'b2b saas', 'outreach'],
  secondaryTerritories: ['startups', 'product', 'data', 'automation', 'founder'],
  technologies: ['ai', 'crm', 'automation', 'analytics', 'llm'],
  industries: ['saas', 'b2b', 'sales'],
  excludedTerritories: [],
}

function getLocalDate(timezone: string): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.rep.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const store = await createScoutStore()
  const localDate = getLocalDate(user.rep.timezone ?? 'UTC')

  const existing = await store.getDailyGrowthBrief(localDate)
  if (existing && existing.status === 'ready') {
    return NextResponse.json({ brief: existing, fromCache: true })
  }

  return generateAndRespond(store, user.organization.id, localDate, user.rep.timezone ?? 'UTC')
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.rep.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const rejectTitle = body.rejectTitle as string | undefined
  const rejectAngle = body.rejectAngle as string | undefined
  const markPosted = body.markPosted as boolean | undefined

  const store = await createScoutStore()
  const localDate = getLocalDate(user.rep.timezone ?? 'UTC')

  if (markPosted) {
    const existing = await store.getDailyGrowthBrief(localDate)
    if (existing) {
      await store.markDailyGrowthBriefCopied(existing.id).catch(() => {})
    }
    return NextResponse.json({ posted: true })
  }

  return generateAndRespond(
    store,
    user.organization.id,
    localDate,
    user.rep.timezone ?? 'UTC',
    rejectTitle ? [rejectTitle] : [],
    rejectAngle ? [rejectAngle] : [],
  )
}

async function generateAndRespond(
  store: Awaited<ReturnType<typeof createScoutStore>>,
  orgId: string,
  localDate: string,
  timezone: string,
  rejectTitles: string[] = [],
  rejectAngles: string[] = [],
) {
  try {
    const trendItems = await store.listTrendItems({ limit: 50 })
    const trendCandidates = rankTrendsForPersona(trendItems, RELAY_TREND_PROFILE)

    try {
      const brief = await generateGrowthBriefViaStudioEngine({
        store,
        orgId,
        trendCandidates,
        recentGrowthTopics: rejectTitles,
        recentGrowthAngles: rejectAngles,
        recentGrowthHooks: [],
        localDate,
        timezone,
        excludeTitles: rejectTitles,
        excludeAngles: rejectAngles,
      })

      if (!brief.postCaption || brief.postCaption.length < 20) {
        throw new Error('Studio engine returned empty post')
      }

      return NextResponse.json({ brief })
    } catch (aiErr) {
      try {
        const fallbackTrend = trendCandidates[0]
        const fallbackBrief = await store.createDailyGrowthBrief({
          organizationId: orgId,
          localDate,
          promptVersion: 'fallback-v1',
          postCaption: fallbackTrend
            ? `Today's signal: "${fallbackTrend.item.title}" — ${fallbackTrend.whyNow}. What does this mean for how you qualify prospects and time your outreach?`
            : "Most sales tools tell you everything that happened. The harder problem is deciding which event deserves action. What's your next move?",
          visualType: 'NO_VISUAL',
          visualReason: 'Fallback — text-only post while AI providers recover',
          alternateIdeas: [
            { title: 'Why context beats more data', angle: 'More prospect data does not create better outreach if none of it explains why now.', whyNow: 'Evergreen' },
            { title: 'The follow-up timing problem', angle: 'A sent message is not an unfinished task — waiting is the work.', whyNow: 'Evergreen' },
            { title: 'Knowing what to do next', angle: 'Signal overload is the problem. Prioritization is the solution.', whyNow: 'Evergreen' },
          ],
        })

        return NextResponse.json({ brief: fallbackBrief, fromFallback: true })
      } catch (fallbackErr) {
        return NextResponse.json(
          { error: 'Generation failed', message: aiErr instanceof Error ? aiErr.message : 'AI providers unavailable' },
          { status: 503 },
        )
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Generation failed', message: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    )
  }
}
