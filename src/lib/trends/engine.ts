import type { TrendItem, TrendSourceType, TrendInterestProfile } from '@/lib/domain/types'
import type { SourceAdapter, TrendStore, TrendCandidate, TrendRelevanceProfile } from './types'
import { contentFingerprint, canonicalizeUrl } from './fingerprint'
import { hackernewsTopAdapter, hackernewsBestAdapter, hackernewsNewAdapter } from './adapters/hackernews'
import { devtoPopularAdapter, devtoLatestAdapter } from './adapters/devto'
import { githubTrendingAdapter } from './adapters/github'
import { redditProgrammingAdapter, redditTechNewsAdapter } from './adapters/reddit'
import { lobstersHotAdapter, lobstersNewestAdapter } from './adapters/lobsters'
import { productHuntAdapter } from './adapters/producthunt'
import { newsapiTechAdapter, newsapiBusinessAdapter } from './adapters/newsapi'

const ADAPTER_REGISTRY: Record<string, () => SourceAdapter> = {
  'hackernews-top': hackernewsTopAdapter,
  'hackernews-best': hackernewsBestAdapter,
  'hackernews-new': hackernewsNewAdapter,
  'devto-popular': devtoPopularAdapter,
  'devto-latest': devtoLatestAdapter,
  'github-trending': githubTrendingAdapter,
  'reddit-programming': redditProgrammingAdapter,
  'reddit-technews': redditTechNewsAdapter,
  'lobsters-hot': lobstersHotAdapter,
  'lobsters-newest': lobstersNewestAdapter,
  'producthunt-today': productHuntAdapter,
  'newsapi-technology': newsapiTechAdapter,
  'newsapi-business': newsapiBusinessAdapter,
}

export function getSourceAdapters(sourceKeys?: string[]): SourceAdapter[] {
  const keys = sourceKeys ?? Object.keys(ADAPTER_REGISTRY)
  return keys
    .filter(k => k in ADAPTER_REGISTRY)
    .map(k => ADAPTER_REGISTRY[k]())
}

export async function ingestSource(
  adapter: SourceAdapter,
  store: TrendStore,
): Promise<{ saved: number; duplicates: number; errors: number }> {
  let saved = 0
  let duplicates = 0
  let errors = 0

  try {
    const signals = await adapter.fetch(store)
    const source = await store.getSource(adapter.sourceKey)
    if (!source) {
      await store.updateHealth(adapter.sourceKey, false, 'Source not found in registry')
      return { saved: 0, duplicates: 0, errors: signals.length }
    }

    for (const signal of signals) {
      try {
        const fingerprint = contentFingerprint(signal.url, signal.title)
        const exists = await store.itemExists(fingerprint)
        if (exists) {
          duplicates++
          continue
        }

        await store.saveItem({
          sourceId: source.id,
          sourceItemId: signal.sourceItemId,
          url: canonicalizeUrl(signal.url),
          title: signal.title,
          excerpt: signal.excerpt?.slice(0, 500),
          author: signal.author,
          publishedAt: signal.publishedAt,
          metrics: signal.metrics ?? {},
          topics: inferTopics(signal),
          contentFingerprint: fingerprint,
          evidenceQuality: evidenceQualityFor(adapter.sourceType),
          expiresAt: expiryFor(adapter.sourceType),
        })
        saved++
      } catch {
        errors++
      }
    }

    await store.updateHealth(adapter.sourceKey, true)
  } catch (err) {
    await store.updateHealth(adapter.sourceKey, false, err instanceof Error ? err.message : 'Unknown error')
    errors++
  }

  return { saved, duplicates, errors }
}

export async function ingestAllSources(
  store: TrendStore,
  sourceKeys?: string[],
): Promise<Record<string, { saved: number; duplicates: number; errors: number }>> {
  const adapters = getSourceAdapters(sourceKeys)
  const results: Record<string, { saved: number; duplicates: number; errors: number }> = {}

  for (const adapter of adapters) {
    results[adapter.sourceKey] = await ingestSource(adapter, store)
  }

  return results
}

export function rankTrendsForPersona(
  items: TrendItem[],
  profile: TrendRelevanceProfile,
  options?: {
    recentlyCoveredTopics?: string[]
    recentlyUsedAngles?: string[]
    explorationRatio?: number
  },
): TrendCandidate[] {
  const now = Date.now()
  const recentlyCovered = new Set(options?.recentlyCoveredTopics ?? [])
  const candidates: TrendCandidate[] = []

  for (const item of items) {
    const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : now
    const hoursOld = (now - publishedMs) / 3600000

    const relevanceScore = computeRelevance(item, profile)
    if (relevanceScore < 0.1) continue

    const freshnessScore = computeFreshness(hoursOld)
    const momentumScore = computeMomentum(item)
    const authorityScore = computeAuthority(item)
    const insightScore = computeInsightPotential(item, profile)
    const credibilityScore = relevanceScore * 0.7 + authorityScore * 0.3

    // Novelty: penalize recently covered topics
    const topicOverlap = item.topics.filter(t => recentlyCovered.has(t)).length
    const noveltyScore = topicOverlap === 0 ? 1.0 : Math.max(0.1, 1 - topicOverlap * 0.4)

    // Exploration bonus: reward territory diversity
    const isNewTerritory = !recentlyCovered.has(item.topics[0])
    const explorationBonus = isNewTerritory ? 0.1 : 0

    const overallScore =
      relevanceScore * 0.25 +
      freshnessScore * 0.15 +
      momentumScore * 0.08 +
      authorityScore * 0.07 +
      insightScore * 0.15 +
      credibilityScore * 0.10 +
      noveltyScore * 0.20 +
      explorationBonus

    candidates.push({
      item,
      relevanceScore,
      personaMatch: getMatchingTerms(item, profile),
      freshnessScore,
      momentumScore,
      authorityScore,
      noveltyScore,
      insightScore,
      credibilityScore,
      overallScore,
      whyNow: buildWhyNow(item, hoursOld),
    })
  }

  // Sort, but inject exploration: with some probability, pick a wildcard
  const sorted = candidates.sort((a, b) => b.overallScore - a.overallScore)
  const explorationRatio = options?.explorationRatio ?? 0.2

  if (sorted.length > 3 && Math.random() < explorationRatio) {
    // Move a mid-tier candidate (positions 3-8) to the top for diversity
    const midIdx = 3 + Math.floor(Math.random() * Math.min(5, sorted.length - 3))
    const wildcard = sorted.splice(midIdx, 1)[0]
    sorted.unshift({ ...wildcard, overallScore: sorted[0].overallScore + 0.01 })
  }

  return sorted
}

function computeRelevance(item: TrendItem, profile: TrendRelevanceProfile): number {
  const itemText = `${item.title} ${item.excerpt ?? ''}`.toLowerCase()
  const itemTopics = item.topics.map(t => t.toLowerCase())

  let score = 0
  let matches = 0

  for (const territory of profile.primaryTerritories) {
    const t = territory.toLowerCase()
    if (itemText.includes(t) || itemTopics.some(it => it.includes(t) || t.includes(it))) {
      score += 0.35
      matches++
    }
  }

  for (const territory of profile.secondaryTerritories) {
    const t = territory.toLowerCase()
    if (itemText.includes(t) || itemTopics.some(it => it.includes(t) || t.includes(it))) {
      score += 0.15
      matches++
    }
  }

  for (const tech of profile.technologies) {
    const t = tech.toLowerCase()
    if (itemText.includes(t)) {
      score += 0.1
      matches++
    }
  }

  for (const excluded of profile.excludedTerritories) {
    const e = excluded.toLowerCase()
    if (itemText.includes(e)) {
      score -= 0.3
    }
  }

  return Math.max(0, Math.min(1, score))
}

function computeFreshness(hoursOld: number): number {
  if (hoursOld < 2) return 1.0
  if (hoursOld < 6) return 0.9
  if (hoursOld < 24) return 0.75
  if (hoursOld < 72) return 0.5
  if (hoursOld < 168) return 0.3
  return 0.1
}

function computeMomentum(item: TrendItem): number {
  const metrics = item.metrics
  const score = typeof metrics.score === 'number' ? metrics.score : 0
  const stars = typeof metrics.stars === 'number' ? metrics.stars : 0
  const comments = typeof metrics.comments === 'number' ? metrics.comments : 0

  let momentum = 0.3
  if (score > 100 || stars > 500) momentum += 0.3
  else if (score > 50 || stars > 100) momentum += 0.15
  if (comments > 20) momentum += 0.2
  else if (comments > 5) momentum += 0.1

  return Math.min(1, momentum)
}

function computeAuthority(item: TrendItem): number {
  switch (item.evidenceQuality) {
    case 'high': return 0.9
    case 'medium': return 0.6
    case 'low': return 0.3
  }
}

function computeInsightPotential(item: TrendItem, profile: TrendRelevanceProfile): number {
  const titleLower = item.title.toLowerCase()
  const hasAnnouncement = /(launch|release|announce|ship|introduc|open.source|beta|v\d)/.test(titleLower)
  const hasDiscussion = /(why|how|lesson|problem|mistake|opinion|should|tradeoff)/.test(titleLower)
  const relevance = computeRelevance(item, profile)

  let score = 0.3
  if (hasAnnouncement) score += 0.25
  if (hasDiscussion) score += 0.2
  score += relevance * 0.25

  return Math.min(1, score)
}

function getMatchingTerms(item: TrendItem, profile: TrendRelevanceProfile): string[] {
  const itemText = `${item.title} ${item.excerpt ?? ''}`.toLowerCase()
  const matches: string[] = []
  const allTerms = [...profile.primaryTerritories, ...profile.secondaryTerritories, ...profile.technologies]
  for (const term of allTerms) {
    if (itemText.includes(term.toLowerCase())) matches.push(term)
  }
  return [...new Set(matches)].slice(0, 5)
}

function buildWhyNow(item: TrendItem, hoursOld: number): string {
  if (hoursOld < 2) return 'New today'
  if (hoursOld < 6) return 'Recent release'
  if (hoursOld < 24) return 'Fresh official announcement'
  if (hoursOld < 72) return 'Active discussion'
  if (hoursOld < 168) return 'Growing developer attention'
  return 'Relevant current event'
}

function inferTopics(signal: { tags?: string[]; title: string }): string[] {
  const topics = new Set(signal.tags ?? [])
  if (topics.size === 0) {
    const lower = signal.title.toLowerCase()
    const patterns: [string, string][] = [
      ['ai', 'ai'], ['kubernetes', 'infrastructure'], ['rust', 'software-engineering'],
      ['startup', 'startups'], ['security', 'security'], ['database', 'infrastructure'],
      ['react', 'web'], ['devops', 'devops'], ['cloud', 'infrastructure'],
    ]
    for (const [kw, topic] of patterns) {
      if (lower.includes(kw)) topics.add(topic)
      if (topics.size >= 3) break
    }
  }
  return [...topics].slice(0, 6)
}

function evidenceQualityFor(sourceType: TrendSourceType): 'high' | 'medium' | 'low' {
  switch (sourceType) {
    case 'hackernews': return 'medium'
    case 'devto': return 'medium'
    case 'github': return 'high'
    case 'reddit': return 'medium'
    case 'lobsters': return 'medium'
    case 'producthunt': return 'high'
    case 'stackoverflow': return 'medium'
    case 'rss': return 'high'
    case 'arxiv': return 'high'
    case 'newsapi': return 'high'
    default: return 'low'
  }
}

function expiryFor(sourceType: TrendSourceType): string {
  const days = sourceType === 'hackernews' ? 3 : sourceType === 'devto' ? 7 : sourceType === 'newsapi' ? 5 : 14
  return new Date(Date.now() + days * 86400000).toISOString()
}
