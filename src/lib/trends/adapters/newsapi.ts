import type { SourceAdapter, RawTrendSignal, TrendStore } from '../types'

const NEWSAPI_BASE = 'https://newsapi.org/v2'
const FETCH_TIMEOUT = 10000

interface NewsApiResponse {
  status: string
  totalResults: number
  articles: Array<{
    source: { id: string | null; name: string }
    author: string | null
    title: string
    description: string | null
    url: string
    urlToImage: string | null
    publishedAt: string
    content: string | null
  }>
}

function getApiKey(): string | undefined {
  return process.env.NEWSAPI_API_KEY
}

async function fetchNews(category: string, pageSize: number): Promise<NewsApiResponse> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('NEWSAPI_API_KEY not configured')

  const url = `${NEWSAPI_BASE}/top-headlines?country=us&category=${category}&pageSize=${pageSize}&apiKey=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`NewsAPI ${category} failed: ${res.status}`)
  return (await res.json()) as NewsApiResponse
}

function inferTopics(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase()
  const topics: string[] = []
  const patterns: [string, string[]][] = [
    ['ai', ['ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'chatbot', 'neural']],
    ['startups', ['startup', 'founder', 'venture', 'funding', 'seed', 'series', 'ipo', 'unicorn']],
    ['security', ['cybersecurity', 'breach', 'hack', 'vulnerability', 'ransmalware', 'zero-day']],
    ['cloud', ['aws', 'azure', 'gcp', 'cloud', 'kubernetes', 'serverless']],
    ['product', ['launch', 'product', 'release', 'update', 'feature']],
    ['business', ['revenue', 'profit', 'earnings', 'acquisition', 'merger', 'market']],
    ['developer-tools', ['developer', 'programming', 'coding', 'api', 'sdk', 'framework']],
    ['data', ['data', 'analytics', 'database', 'sql', 'big data']],
    ['mobile', ['ios', 'android', 'mobile', 'app store', 'swift']],
    ['web', ['browser', 'chrome', 'firefox', 'web', 'javascript', 'css']],
  ]
  for (const [topic, keywords] of patterns) {
    if (keywords.some(kw => text.includes(kw))) topics.push(topic)
  }
  return topics.length > 0 ? topics.slice(0, 4) : ['general']
}

const CATEGORIES = ['technology', 'business'] as const

export function newsapiTechAdapter(): SourceAdapter {
  return {
    sourceType: 'newsapi',
    sourceKey: 'newsapi-technology',
    async fetch(_store: TrendStore): Promise<RawTrendSignal[]> {
      const data = await fetchNews('technology', 20)
      if (data.status !== 'ok') return []
      return data.articles
        .filter(a => a.title && a.title !== '[Removed]')
        .map(article => ({
          source: 'newsapi',
          sourceType: 'newsapi' as const,
          sourceItemId: article.url,
          url: article.url,
          title: article.title,
          excerpt: article.description ?? undefined,
          author: article.author ?? article.source.name,
          publishedAt: article.publishedAt,
          tags: inferTopics(article.title, article.description ?? ''),
          metrics: {},
        }))
    },
  }
}

export function newsapiBusinessAdapter(): SourceAdapter {
  return {
    sourceType: 'newsapi',
    sourceKey: 'newsapi-business',
    async fetch(_store: TrendStore): Promise<RawTrendSignal[]> {
      const data = await fetchNews('business', 15)
      if (data.status !== 'ok') return []
      return data.articles
        .filter(a => a.title && a.title !== '[Removed]')
        .map(article => ({
          source: 'newsapi',
          sourceType: 'newsapi' as const,
          sourceItemId: article.url,
          url: article.url,
          title: article.title,
          excerpt: article.description ?? undefined,
          author: article.author ?? article.source.name,
          publishedAt: article.publishedAt,
          tags: inferTopics(article.title, article.description ?? ''),
          metrics: {},
        }))
    },
  }
}
