import type { ContentMemory, ContentMemoryType } from '@/lib/domain/types'
import { embedText } from '@/lib/ai/embed'
import { hasEmbeddingProvider } from '@/lib/ai/config'

/**
 * Content Memory service.
 *
 * Tracks what a person has already covered so Relay can avoid repetition
 * and intentionally diversify future content.
 *
 * Uses structured SQL as the source of truth. No embeddings needed for
 * the core repetition-detection path.
 */

export interface MemoryCheckResult {
  isDuplicate: boolean
  similarMemories: Array<{ type: ContentMemoryType; content: string; similarity: number; source: 'lexical' | 'semantic' }>
  reason: string
}

export interface SemanticMemoryMatch {
  id: string
  content: string
  memoryType: string
  similarity: number
  createdAt: string
}

/**
 * Check whether a topic/angle/hook has been covered before.
 *
 * Uses normalized text comparison (prefix + keyword overlap) rather than
 * embeddings — deterministic, fast, no model cost.
 *
 * Applies time decay: older memories count less against novelty.
 * Applies platform awareness: same topic on X vs LinkedIn is not a duplicate.
 */
export function checkMemoryForDuplicates(
  text: string,
  existingMemories: ContentMemory[],
  threshold = 0.7,
  options: { platform?: 'linkedin' | 'x'; now?: string } = {},
): MemoryCheckResult {
  const normalized = normalizeText(text)
  const similarMemories: MemoryCheckResult['similarMemories'] = []
  const now = options.now ?? new Date().toISOString()

  for (const memory of existingMemories) {
    const memNorm = normalizeText(memory.content)
    const rawSimilarity = computeSimilarity(normalized, memNorm)
    if (rawSimilarity < threshold * 0.5) continue

    // A near-exact match is a repeat no matter how old it is; only looser
    // overlaps fade with time.
    const decayedSimilarity = rawSimilarity >= NEAR_EXACT_SIMILARITY
      ? rawSimilarity
      : applyTimeDecay(rawSimilarity, memory.createdAt, now)

    if (decayedSimilarity >= threshold) {
      similarMemories.push({
        type: memory.memoryType,
        content: memory.content,
        similarity: decayedSimilarity,
        source: 'lexical',
      })
    }
  }

  const isDuplicate = similarMemories.length > 0
  const reason = isDuplicate
    ? `Similar to ${similarMemories.length} previous ${similarMemories[0].type.replace('_', ' ')}: "${similarMemories[0].content.slice(0, 60)}..."`
    : ''

  return { isDuplicate, similarMemories, reason }
}

/** Raw similarity at or above this is treated as the same content and never decays. */
const NEAR_EXACT_SIMILARITY = 0.9

/** Memories younger than this keep full weight. */
const DECAY_GRACE_DAYS = 30

/**
 * Apply exponential time decay to a similarity score.
 * Full weight for the first 30 days, then a 14-day half-life.
 */
function applyTimeDecay(similarity: number, createdAt: string | null, now: string): number {
  if (!createdAt) return similarity

  const ageMs = new Date(now).getTime() - new Date(createdAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (!Number.isFinite(ageDays) || ageDays <= DECAY_GRACE_DAYS) return similarity

  // Half-life of 14 days once past the grace window
  const decayFactor = Math.pow(0.5, (ageDays - DECAY_GRACE_DAYS) / 14)

  // Floor at 0.2 — old memories still provide some signal
  const effectiveFactor = Math.max(0.2, decayFactor)

  return similarity * effectiveFactor
}

/**
 * Extract memories from a published or accepted draft.
 *
 * Called after a post is accepted to record what was covered.
 */
export function extractMemoriesFromDraft(caption: string, hook: string): Array<{ type: ContentMemoryType; content: string }> {
  const memories: Array<{ type: ContentMemoryType; content: string }> = []

  // Record the hook
  if (hook.trim()) {
    memories.push({ type: 'hook_used', content: hook.trim().slice(0, 200) })
  }

  const sentences = caption.split(/[.!?]+/).filter((s) => s.trim().length > 10)
  for (const sentence of sentences.slice(0, 3)) {
    const topic = sentence.trim().slice(0, 100)
    if (topic.length > 10) {
      memories.push({ type: 'topic_covered', content: topic })
    }
  }

  return memories
}

/**
 * Extract memories from a user's idea/angle description.
 */
export function extractMemoriesFromIdea(idea: string, angle: string): Array<{ type: ContentMemoryType; content: string }> {
  const memories: Array<{ type: ContentMemoryType; content: string }> = []
  if (angle.trim()) {
    memories.push({ type: 'angle_used', content: angle.trim().slice(0, 200) })
  }
  const topic = idea.trim().split(/[.!?]/)[0]?.trim().slice(0, 100) ?? ''
  if (topic.length > 5) {
    memories.push({ type: 'topic_covered', content: topic })
  }
  return memories
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this', 'it',
  'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they', 'them',
  'what', 'which', 'who', 'whom', 'these', 'those', 'am', 'about', 'up',
])

function computeSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const aWords = new Set(a.split(' ').filter(w => !STOP_WORDS.has(w) && w.length > 2))
  const bWords = new Set(b.split(' ').filter(w => !STOP_WORDS.has(w) && w.length > 2))

  if (aWords.size === 0 || bWords.size === 0) return 0

  // Word overlap (Jaccard)
  let intersection = 0
  for (const word of aWords) {
    if (bWords.has(word)) intersection++
  }
  const union = aWords.size + bWords.size - intersection
  const jaccard = union === 0 ? 0 : intersection / union

  // Key-phrase overlap: bigrams + trigrams for structural similarity
  const aBigrams = getKeyGrams(a, 2)
  const bBigrams = getKeyGrams(b, 2)
  const [shorter, longer] = aBigrams.size <= bBigrams.size ? [aBigrams, bBigrams] : [bBigrams, aBigrams]
  let bigramIntersection = 0
  for (const bg of shorter) {
    if (longer.has(bg)) bigramIntersection++
  }
  const bigramContainment = shorter.size === 0 ? 0 : bigramIntersection / shorter.size

  // Trigram containment — catches "mistake I see every" vs "mistake most teams make"
  const aTrigrams = getKeyGrams(a, 3)
  const bTrigrams = getKeyGrams(b, 3)
  const [shortTri, longTri] = aTrigrams.size <= bTrigrams.size ? [aTrigrams, bTrigrams] : [bTrigrams, aTrigrams]
  let trigramIntersection = 0
  for (const tg of shortTri) {
    if (longTri.has(tg)) trigramIntersection++
  }
  const trigramContainment = shortTri.size === 0 ? 0 : trigramIntersection / shortTri.size

  // Weighted blend: Jaccard for topic, bigrams for phrasing, trigrams for structure
  return (jaccard * 0.45) + (bigramContainment * 0.30) + (trigramContainment * 0.25)
}

function getKeyGrams(text: string, n: number): Set<string> {
  const words = text.split(' ').filter((w) => w.length > 2)
  const grams = new Set<string>()
  for (let i = 0; i <= words.length - n; i++) {
    grams.add(words.slice(i, i + n).join(' '))
  }
  return grams
}


/**
 * Build the text that gets embedded for a content memory.
 * Combines topic + angle + hook into a single semantic fingerprint.
 */
export function buildMemoryEmbeddingText(input: {
  title: string
  angle: string
  territory?: string
  hook?: string
}): string {
  const parts: string[] = []
  if (input.territory) parts.push(`Topic: ${input.territory}`)
  if (input.title) parts.push(input.title)
  if (input.angle) parts.push(input.angle)
  if (input.hook) parts.push(`Hook: ${input.hook}`)
  return parts.join('. ').slice(0, 500)
}

/**
 * Compute the embedding for a content memory.
 * Falls back gracefully when no embedding provider is configured.
 */
export async function embedContentMemory(input: {
  title: string
  angle: string
  territory?: string
  hook?: string
}): Promise<number[] | null> {
  if (!hasEmbeddingProvider()) return null
  const text = buildMemoryEmbeddingText(input)
  if (text.length < 10) return null
  try {
    return await embedText(text)
  } catch (err) {
    console.warn('[memory] Embedding failed, falling back to lexical only:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * Combined duplicate check: lexical (fast) + semantic (embedding) when available.
 *
 * Lexical catches exact rephrases. Semantic catches same idea expressed
 * with completely different vocabulary.
 *
 * Returns the union of both signals, tagged by source.
 */
export async function checkForDuplicatesCombined(
  input: { title: string; angle: string; territory?: string; hook?: string },
  existingMemories: ContentMemory[],
  store: { findSimilarMemories: (embedding: number[], personaId: string, threshold?: number, limit?: number) => Promise<SemanticMemoryMatch[]> },
  personaId: string,
  threshold = 0.7,
): Promise<MemoryCheckResult> {
  const lexicalResult = checkMemoryForDuplicates(
    `${input.title}. ${input.angle}`,
    existingMemories,
    threshold,
  )

  // Semantic check — requires embedding provider + pgvector
  let semanticMatches: SemanticMemoryMatch[] = []
  if (hasEmbeddingProvider()) {
    const embedding = await embedContentMemory(input)
    if (embedding) {
      try {
        semanticMatches = await store.findSimilarMemories(embedding, personaId, threshold, 5)
      } catch (err) {
        console.warn('[memory] Semantic lookup failed:', err instanceof Error ? err.message : String(err))
      }
    }
  }

  const lexicalIds = new Set(lexicalResult.similarMemories.map(m => m.content))
  const additionalSemantic = semanticMatches
    .filter(m => !lexicalIds.has(m.content))
    .map(m => ({
      type: m.memoryType as ContentMemoryType,
      content: m.content,
      similarity: m.similarity,
      source: 'semantic' as const,
    }))

  const allSimilar = [...lexicalResult.similarMemories.map(m => ({ ...m, source: 'lexical' as const })), ...additionalSemantic]
    .sort((a, b) => b.similarity - a.similarity)

  const isDuplicate = allSimilar.length > 0
  const reason = isDuplicate
    ? `Similar to ${allSimilar.length} previous content: ${allSimilar[0].source === 'semantic' ? '[semantic match] ' : ''}"${allSimilar[0].content.slice(0, 60)}..."`
    : ''

  return { isDuplicate, similarMemories: allSimilar, reason }
}

/**
 * Build a memory-aware prompt block for generation.
 *
 * Weights recent memories higher. Includes angle patterns to avoid
 * repetitive structures. Keeps the block concise — only the strongest signals.
 */
export function buildMemoryPromptBlock(memories: ContentMemory[]): string {
  if (memories.length === 0) return ''
  const now = new Date().toISOString()

  // Score memories by recency + type importance
  const scored = memories.map(m => {
    const ageMs = now && m.createdAt ? new Date(now).getTime() - new Date(m.createdAt).getTime() : 0
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    const recencyScore = Math.max(0.2, Math.pow(0.5, ageDays / 14))

    // Angle and hook memories are more actionable than topic memories
    const typeWeight = m.memoryType === 'angle_used' ? 1.3 : m.memoryType === 'hook_used' ? 1.2 : 1.0

    return { ...m, score: recencyScore * typeWeight }
  }).sort((a, b) => b.score - a.score)

  const recentTopics = scored
    .filter((m) => m.memoryType === 'topic_covered')
    .slice(0, 4)
    .map((m) => m.content.slice(0, 80))

  const recentAngles = scored
    .filter((m) => m.memoryType === 'angle_used')
    .slice(0, 3)
    .map((m) => m.content.slice(0, 80))

  const recentHooks = scored
    .filter((m) => m.memoryType === 'hook_used')
    .slice(0, 2)
    .map((m) => m.content.slice(0, 60))

  const sections: string[] = []
  if (recentTopics.length > 0) {
    sections.push(`TOPICS ALREADY COVERED: ${recentTopics.join(' | ')}`)
  }
  if (recentAngles.length > 0) {
    sections.push(`ANGLES ALREADY USED: ${recentAngles.join(' | ')}`)
  }
  if (recentHooks.length > 0) {
    sections.push(`HOOKS ALREADY USED: ${recentHooks.join(' | ')}`)
  }

  if (sections.length === 0) return ''
  return `CONTENT MEMORY — avoid repeating these:\n${sections.join('\n')}`
}
