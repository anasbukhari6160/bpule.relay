import type { ContentPersona, ContentProfile, ContentMemory } from '@/lib/domain/types'
import type { ScoutStore } from '@/lib/store/types'
import type { TrendRelevanceProfile, TrendCandidate } from '@/lib/trends/types'
import { rankTrendsForPersona } from '@/lib/trends/engine'
import { generate } from '@/lib/ai/runtime'
import { generateHumanizedImagePrompt } from '@/lib/writing/visual'
import type { HumanizedImageResult } from '@/lib/writing/visual'

export interface PersonaDailyPostInput {
  persona: ContentPersona
  profile: ContentProfile | null
  memories: ContentMemory[]
  trendCandidates: TrendCandidate[]
  /** Titles rejected in this session — excluded from generation */
  rejectedTitles: string[]
  /** Angles rejected in this session — excluded from generation */
  rejectedAngles: string[]
  recentIdeas: Array<{ title: string; territory: string; angle: string }>
  platform: 'linkedin' | 'x'
  localDate: string
  timezone: string
}

export interface PersonaDailyPostResult {
  title: string
  angle: string
  postCaption: string
  territory: string
  whyNow: string
  trendGrounded: boolean
  visualPrompt: HumanizedImageResult | null
  alternateIdeas: Array<{ title: string; angle: string; territory: string }>
  cost: number
}

interface RejectionMemory {
  personaId: string
  localDate: string
  rejectedTitles: string[]
  rejectedAngles: string[]
}

const rejectionStore = new Map<string, RejectionMemory>()

function getRejectionKey(personaId: string, localDate: string): string {
  return `${personaId}:${localDate}`
}

function getRejections(personaId: string, localDate: string): RejectionMemory {
  const key = getRejectionKey(personaId, localDate)
  if (!rejectionStore.has(key)) {
    rejectionStore.set(key, { personaId, localDate, rejectedTitles: [], rejectedAngles: [] })
  }
  return rejectionStore.get(key)!
}

export function recordRejection(personaId: string, localDate: string, title: string, angle: string): void {
  const rej = getRejections(personaId, localDate)
  rej.rejectedTitles.push(title)
  if (angle) rej.rejectedAngles.push(angle)
  // shortcut: in-memory only, resets on server restart. Upgrade to DB persistence if cross-instance needed.
}

export function getRejectedTitles(personaId: string, localDate: string): string[] {
  return getRejections(personaId, localDate).rejectedTitles
}

export function getRejectedAngles(personaId: string, localDate: string): string[] {
  return getRejections(personaId, localDate).rejectedAngles
}

export async function generatePersonaDailyPost(
  input: PersonaDailyPostInput,
): Promise<PersonaDailyPostResult> {
  const costTracking = { total: 0 }
  const rejectedTitles = Array.from(new Set([...input.rejectedTitles, ...getRejectedTitles(input.persona.id, input.localDate)]))
  const rejectedAngles = Array.from(new Set([...input.rejectedAngles, ...getRejectedAngles(input.persona.id, input.localDate)]))

  const trendSignals = input.trendCandidates.slice(0, 6).map(tc =>
    `- [${tc.item.evidenceQuality}] ${tc.item.title} (${tc.whyNow})`
  ).join('\n')

  const personaContext = buildPersonaContext(input.persona, input.profile)
  const recentContent = buildRecentContentSummary(input.recentIdeas, rejectedTitles)

  const rejectedBlock = rejectedTitles.length > 0
    ? `\n\nREJECTED TITLES (do NOT generate anything similar):\n${rejectedTitles.map(t => `- "${t}"`).join('\n')}`
    : ''

  const rejectedAngleBlock = rejectedAngles.length > 0
    ? `\n\nREJECTED ANGLES (do NOT use these perspectives):\n${rejectedAngles.map(a => `- "${a.slice(0, 100)}"`).join('\n')}`
    : ''

  const systemPrompt = `You are a senior editorial strategist. Generate ONE perfect social media post for this person. Then generate 3 alternate ideas.

CRITICAL: This post must be something this SPECIFIC person would write — not generic content advice. It must pass the "would a real human post this?" test.

HOOK-FIRST REQUIREMENT:
The first line of the post is everything. It must:
- Stop the scroll immediately
- Contain a surprising number, a contrarian claim, a specific story detail, or a bold statement
- NEVER start with a question, "I think", "Just finished", or any filler

STRUCTURE (LinkedIn):
[HOOK — one line, the most interesting thing you could say]
[CONTEXT — 1-2 short sentences, the situation]
[INSIGHT — 1-2 sentences, the counterintuitive take]
[IMPLICATION — 1-2 sentences, what this means for the reader]
[CLOSE — one genuine question that invites specific answers]

STRUCTURE (X):
- Single punchy statement or short thread
- Lead with the take, the number, or the tension
- Every word earns its place
- No setup, no conclusion, no "Here's why:"

RULES:
- NO em dashes. Use commas or periods.
- NO filler: "Here's the thing", "Let that sink in", "Game changer", "In today's fast-paced world", "leverage", "synergy".
- NO listicles, no numbered lists, no "here are X tips".
- NO hashtags, NO emojis, NO exclamation marks, NO sign-off.
- ${input.platform === 'linkedin' ? '100-200 words.' : 'Max 280 chars for single post.'}
- Sounds like a smart professional sharing something real — not a brand, not a journalist, not a motivational speaker.

${rejectedBlock}${rejectedAngleBlock}

CRITICAL: Generate at least 5 alternate ideas. Each must be a DISTINCT angle — not variations of the same idea.

Output ONLY JSON:
{
  "title": "specific, non-generic title",
  "angle": "1-2 sentences of insight — the counterintuitive take",
  "whyNow": "why this matters today",
  "territory": "topic area",
  "trendGrounded": true/false,
  "postCaption": "the full post text, perfectly formatted with paragraph breaks",
  "alternates": [
    {"title": "...", "angle": "...", "territory": "..."},
    {"title": "...", "angle": "...", "territory": "..."},
    {"title": "...", "angle": "...", "territory": "..."},
    {"title": "...", "angle": "...", "territory": "..."},
    {"title": "...", "angle": "...", "territory": "..."}
  ]
}`

  const userObj = {
    persona: personaContext,
    trends: trendSignals,
    avoid: recentContent,
    platform: input.platform,
    date: input.localDate,
  }

  const result = await generate<Record<string, unknown>>({
    task: 'FAST_STRUCTURED',
    system: systemPrompt,
    user: JSON.stringify(userObj),
    promptVersion: 'relay-persona-daily-v1',
    callSite: 'relay:personaDailyPost',
    feature: 'relay_persona_daily',
  })

  costTracking.total += Number(result.trace?.estimatedCostUsd ?? 0)

  const data = result.data as Record<string, unknown>
  if (!data || typeof data !== 'object') {
    throw new Error('AI returned invalid data structure')
  }
  const title = (data.title as string) ?? ''
  const angle = (data.angle as string) ?? ''
  const whyNow = (data.whyNow as string) ?? ''
  const territory = (data.territory as string) ?? ''
  const trendGrounded = (data.trendGrounded as boolean) ?? false
  let postCaption = (data.postCaption as string) ?? ''

  if (input.platform === 'x') {
    postCaption = cleanXPostCaption(postCaption)
  } else {
    postCaption = cleanLinkedInCaption(postCaption)
  }

  const alternatesRaw = (data.alternates as Array<Record<string, string>>) ?? []
  const alternateIdeas = alternatesRaw.slice(0, 5).map(a => ({
    title: a.title ?? '',
    angle: a.angle ?? '',
    territory: a.territory ?? '',
  })).filter(a => a.title.length > 0)

  let visualPrompt: HumanizedImageResult | null = null
  try {
    visualPrompt = generateHumanizedImagePrompt({
      postText: postCaption,
      topic: territory || input.profile?.territories?.[0] || 'technology',
      angle,
      tone: input.persona.humorStyle ?? 'direct',
      coreDetail: angle,
      platform: input.platform,
    })
  } catch (visErr) {
    console.warn('[relay-persona-daily] Visual prompt generation failed:', visErr instanceof Error ? visErr.message : String(visErr))
  }

  return {
    title,
    angle,
    postCaption,
    territory,
    whyNow,
    trendGrounded,
    visualPrompt,
    alternateIdeas,
    cost: costTracking.total,
  }
}

function buildPersonaContext(persona: ContentPersona, profile: ContentProfile | null): string {
  const parts: string[] = []

  if (persona.personaRole) parts.push(`Role: ${persona.personaRole}`)
  if (profile?.seniority) parts.push(`Seniority: ${profile.seniority}`)
  if (profile?.industries?.length) parts.push(`Industries: ${profile.industries.join(', ')}`)
  if (profile?.audience) parts.push(`Audience: ${profile.audience}`)

  if (profile?.expertise?.length) {
    const top = profile.expertise
      .sort((a, b) => (b.level === 'expert' ? 1 : 0) - (a.level === 'expert' ? 1 : 0))
      .slice(0, 5)
      .map(e => e.area)
    parts.push(`Expertise: ${top.join(', ')}`)
  }

  if (profile?.opinions?.length) {
    const strong = profile.opinions
      .filter(o => o.strength === 'strong')
      .slice(0, 3)
      .map(o => o.belief)
    if (strong.length > 0) parts.push(`Strong opinions: ${strong.join('; ')}`)
  }

  if (persona.humorStyle) parts.push(`Tone: ${persona.humorStyle}`)
  if (profile?.territories?.length) parts.push(`Content territories: ${profile.territories.join(', ')}`)

  if (persona.valuesAndOpinions?.length) {
    parts.push(`Values: ${persona.valuesAndOpinions.join(', ')}`)
  }

  return parts.join('\n')
}

function buildRecentContentSummary(
  recentIdeas: Array<{ title: string; territory: string; angle: string }>,
  rejectedTitles: string[],
): string {
  const parts: string[] = []
  if (recentIdeas.length > 0) {
    parts.push('Recent ideas:\n' + recentIdeas.map(i => `- ${i.title} (${i.territory})`).join('\n'))
  }
  if (rejectedTitles.length > 0) {
    parts.push('Recently rejected (do not repeat):\n' + rejectedTitles.map(t => `- "${t}"`).join('\n'))
  }
  return parts.length > 0 ? parts.join('\n\n') : 'No previous content.'
}

function cleanLinkedInCaption(raw: string): string {
  let text = raw.trim()
  text = text.replace(/[\u2014\u2013\u2015\uFE58\uFF0D\u2500\u2212\u2E3A\u2E3B]/g, ' ')
  text = text.replace(/\s{2,}/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replace(/(\d)([a-zA-Z]{2,})/g, '$1 $2')
  text = text.replace(/(\d)\s+(%|x\b|min|hr|mo|yr)/gi, '$1$2')
  text = text.replace(/\.\s+([a-z])/g, (_, c) => `. ${c.toUpperCase()}`)
  text = text.replace(/\s*(Thoughts\?|Agree\?|Let that sink in\.?)\s*$/i, '')

  const words = text.split(/\s+/)
  if (words.length > 200) {
    let trimmed = words.slice(0, 200).join(' ')
    const lastPeriod = trimmed.lastIndexOf('.')
    if (lastPeriod > trimmed.length * 0.7) trimmed = trimmed.slice(0, lastPeriod + 1)
    return trimmed
  }
  return text
}

function cleanXPostCaption(raw: string): string {
  let text = raw.trim()
  text = text.replace(/[\u2014\u2013\u2015\uFE58\uFF0D\u2500\u2212\u2E3A\u2E3B]/g, ' ')
  text = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
  text = text.replace(/[\u{1F600}-\u{1F64F}]/gu, '')
  text = text.replace(/#[a-zA-Z][a-zA-Z0-9]*/g, '')
  text = text.replace(/\s*(Thoughts\?|Agree\?|Let that sink in\.?)\s*$/i, '')
  text = text.replace(/\s{2,}/g, ' ').trim()

  if (text.length > 280) {
    const lastPeriod = text.lastIndexOf('.', 277)
    if (lastPeriod > 200) {
      text = text.slice(0, lastPeriod + 1)
    } else {
      text = text.slice(0, 277) + '...'
    }
  }
  return text.trim()
}

export function inferTrendInterestFromProfile(
  persona: ContentPersona,
  profile: ContentProfile | null,
): TrendRelevanceProfile {
  return {
    primaryTerritories: profile?.territories?.slice(0, 5) ?? [],
    secondaryTerritories: profile?.audiences ?? [],
    technologies: (profile?.technologies ?? []).map(t => (typeof t === 'object' && 'name' in t ? t.name : String(t))).slice(0, 10),
    industries: profile?.industries ?? [],
    excludedTerritories: (profile?.topicsAvoided ?? []).map(t => (typeof t === 'object' && 'topic' in t ? t.topic : String(t))).slice(0, 5),
  }
}
