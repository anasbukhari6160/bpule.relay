/**
 * Scout model configuration — architecture v2.2 (September 2026).
 *
 * Every provider host and model id used anywhere in the app must be resolved
 * through this module, so a provider swap or a routing change stays a
 * one-line edit.
 *
 * Routing priority:
 *   1. Groq free tier (no card required) — extraction, classification, fallback
 *   2. LongCat-2.0 — primary writer for drafts, posts, proposals
 *   3. OpenAI (gpt-4o-mini) — escalation only when cheaper tiers fail quality gates
 *
 * DeepSeek is disabled by default (SCOUT_DEEPSEEK_ENABLED=0). The provider
 * config functions remain for future restoration but return null/empty when
 * disabled — no production workflow depends on a DeepSeek credential.
 *
 * Every id is env-overridable so spend and provider choice stay a deployment
 * decision, not a code change.
 */

export interface ProviderHost {
  /** Stable id used in logs/metrics — never the raw model string, so a host swap doesn't break historical queries. */
  id: string
  apiKey: string | undefined
  baseUrl: string
  /** The model id as this specific host names it (hosts sometimes prefix/rename the same weights). */
  model: string
}

/** DeepSeek is disabled by default. Set SCOUT_DEEPSEEK_ENABLED=1 to restore. */
export function isDeepseekEnabled(): boolean {
  return process.env.SCOUT_DEEPSEEK_ENABLED === '1'
}

// ============================================================================
// Tier 0 — Groq, free, primary. No card required; a different model family
// on different infrastructure from DeepSeek/OpenAI below it, so a Groq-side
// issue and a DeepSeek-side issue are genuinely independent failure modes.
// ============================================================================

export function groqApiKey(): string | undefined {
  return process.env.GROQ_API_KEY
}

export function groqBaseUrl(): string {
  return process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'
}

export function groqCheapModel(): string {
  return process.env.SCOUT_TIER0_CHEAP_MODEL ?? process.env.SCOUT_TIER3_CHEAP_MODEL ?? 'openai/gpt-oss-20b'
}

export function groqStrongModel(): string {
  return process.env.SCOUT_TIER0_STRONG_MODEL ?? process.env.SCOUT_TIER3_STRONG_MODEL ?? 'openai/gpt-oss-120b'
}

export function groqApiKey2(): string | undefined {
  return process.env.GROQ_API_KEY_2
}

/**
 * Tier 0 hosts — Groq free tier. Supports two keys for double quota.
 * Each key is a separate host; the retry chain walks them sequentially.
 */
export function tier0Hosts(kind: 'cheap' | 'strong'): ProviderHost[] {
  const hosts: ProviderHost[] = []
  const model = kind === 'strong' ? groqStrongModel() : groqCheapModel()
  if (groqApiKey()) {
    hosts.push({ id: 'groq', apiKey: groqApiKey(), baseUrl: groqBaseUrl(), model })
  }
  if (groqApiKey2()) {
    hosts.push({ id: 'groq-2', apiKey: groqApiKey2(), baseUrl: groqBaseUrl(), model })
  }
  return hosts
}

/** @deprecated Use tier0Hosts */
export function tier0Host(kind: 'cheap' | 'strong'): ProviderHost | null {
  return tier0Hosts(kind)[0] ?? null
}

// ============================================================================
// Tier 1 — DeepSeek V4 Flash, multi-host. Same weights served by two
// independent providers; the host retry lives in provider.ts, not here.
// First paid escalation once tier 0 (Groq) is actually exhausted or fails
// its own retry budget — structurally identical to the prior architecture
// pass, just one level down instead of primary.
// ============================================================================

export function deepseekOfficialApiKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY
}

export function deepseekOfficialBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1'
}

export function fireworksApiKey(): string | undefined {
  return process.env.FIREWORKS_API_KEY
}

export function fireworksBaseUrl(): string {
  return process.env.FIREWORKS_BASE_URL ?? 'https://api.fireworks.ai/inference/v1'
}

/** Tier 1 model id, per host — DeepSeek and Fireworks name the same weights slightly differently. */
export function deepseekFlashModel(): string {
  return process.env.SCOUT_TIER1_MODEL ?? 'deepseek-chat'
}

export function fireworksFlashModel(): string {
  return process.env.SCOUT_TIER1_FIREWORKS_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash'
}

/**
 * Tier 1 hosts (DeepSeek V4 Flash). Returns empty when DeepSeek is disabled
 * via SCOUT_DEEPSEEK_ENABLED=0 (the default). Config functions remain for
 * future restoration.
 */
export function tier1Hosts(): ProviderHost[] {
  if (!isDeepseekEnabled()) return []
  const hosts: ProviderHost[] = []
  if (deepseekOfficialApiKey()) {
    hosts.push({
      id: 'deepseek-official',
      apiKey: deepseekOfficialApiKey(),
      baseUrl: deepseekOfficialBaseUrl(),
      model: deepseekFlashModel(),
    })
  }
  if (fireworksApiKey()) {
    hosts.push({
      id: 'fireworks',
      apiKey: fireworksApiKey(),
      baseUrl: fireworksBaseUrl(),
      model: fireworksFlashModel(),
    })
  }
  return hosts
}

// ============================================================================
// Tier 2 — DeepSeek V4 Pro, escalation only. Same official host as tier 1;
// Fireworks also serves it, kept as a second host for the same reason.
// ============================================================================

export function deepseekProModel(): string {
  return process.env.SCOUT_TIER2_MODEL ?? 'deepseek-reasoner'
}

export function fireworksProModel(): string {
  return process.env.SCOUT_TIER2_FIREWORKS_MODEL ?? 'accounts/fireworks/models/deepseek-v4-pro'
}

/**
 * Tier 2 hosts (DeepSeek V4 Pro). Returns empty when DeepSeek is disabled
 * via SCOUT_DEEPSEEK_ENABLED=0 (the default).
 */
export function tier2Hosts(): ProviderHost[] {
  if (!isDeepseekEnabled()) return []
  const hosts: ProviderHost[] = []
  if (deepseekOfficialApiKey()) {
    hosts.push({
      id: 'deepseek-official',
      apiKey: deepseekOfficialApiKey(),
      baseUrl: deepseekOfficialBaseUrl(),
      model: deepseekProModel(),
    })
  }
  if (fireworksApiKey()) {
    hosts.push({
      id: 'fireworks',
      apiKey: fireworksApiKey(),
      baseUrl: fireworksBaseUrl(),
      model: fireworksProModel(),
    })
  }
  return hosts
}

// ============================================================================
// Tier 4 — OpenAI, final safety net and one of the two drafting sources.
// Fires as a last-resort extraction fallback if tier 0 (Groq) and every
// tier 1/2 (DeepSeek) host have failed. In drafting, it's one of the two
// parallel candidate sources alongside LongCat-2.0.
// ============================================================================

export function openaiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY
}

export function openaiBaseUrl(): string {
  return process.env.OPENAI_CHAT_BASE_URL ?? 'https://api.openai.com/v1'
}

export function openaiModel(): string {
  return process.env.SCOUT_TIER4_MODEL ?? 'gpt-4o-mini'
}

export function tier4Host(): ProviderHost | null {
  if (!openaiApiKey()) return null
  return {
    id: 'openai',
    apiKey: openaiApiKey(),
    baseUrl: openaiBaseUrl(),
    model: openaiModel(),
  }
}

// ============================================================================
// Drafting-specific: LongCat-2.0 (Meituan, MoE, 1.6T total / ~48B active,
// MIT licensed, native 1M context). One of the two parallel drafting sources.
// ============================================================================

export function longcatApiKey(): string | undefined {
  return process.env.LONGCAT_API_KEY
}

export function longcatBaseUrl(): string {
  return process.env.LONGCAT_BASE_URL ?? 'https://api.longcat.chat/openai/v1'
}

export function longcatModel(): string {
  return process.env.LONGCAT_MODEL ?? 'LongCat-2.0'
}

export function longcatHost(): ProviderHost | null {
  if (!longcatApiKey()) return null
  return {
    id: 'longcat',
    apiKey: longcatApiKey(),
    baseUrl: longcatBaseUrl(),
    model: longcatModel(),
  }
}

/** True once at least one tier has a usable key; false only in demo mode. */
export function hasProvider(): boolean {
  return (
    Boolean(process.env.OPENCODE_API_KEY) ||
    tier0Hosts('cheap').length > 0 ||
    tier1Hosts().length > 0 ||
    tier2Hosts().length > 0 ||
    Boolean(openaiApiKey()) ||
    Boolean(longcatApiKey())
  )
}

// ============================================================================
// Off-peak scheduling. DeepSeek prices roughly double during peak hours;
// batch-eligible jobs (eval harness run, few-shot pool refresh) should run
// outside this window to capture the discount automatically. Per the
// September 2026 research pass, peak is 01:00-04:00 and 06:00-10:00 UTC.
// ============================================================================

export function deepseekPeakWindowsUtc(): Array<{ startHour: number; endHour: number }> {
  return [
    { startHour: 1, endHour: 4 },
    { startHour: 6, endHour: 10 },
  ]
}

export function isDeepseekPeakHour(date: Date = new Date()): boolean {
  const hour = date.getUTCHours()
  return deepseekPeakWindowsUtc().some((w) => hour >= w.startHour && hour < w.endHour)
}

export function dbMode(): 'supabase' | 'demo' {
  const override = process.env.SCOUT_DB
  if (override === 'supabase' || override === 'demo') return override
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return 'supabase'
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required in production. The app will not start in demo mode.',
    )
  }
  return 'demo'
}

export function isDemoMode(): boolean {
  return dbMode() === 'demo'
}

/** Embedding model for semantic proof matching. Unrelated to the chat-completion tiers above. */
export function embeddingModel(): string {
  return process.env.SCOUT_EMBEDDING_MODEL ?? 'text-embedding-3-small'
}

export function embeddingApiKey(): string | undefined {
  return process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GROQ_API_KEY
}

export function embeddingBaseUrl(): string {
  return process.env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1'
}

export function hasEmbeddingProvider(): boolean {
  return Boolean(embeddingApiKey())
}

/**
 * Per-rep daily send ceiling (Part 7 rule).
 *
 * Override per-org via organizations.settings JSONB:
 *   { "dailyConnectionLimit": 50, "dailySendLimit": 30 }
 *
 * Falls back to env var, then default.
 */
export function dailySendLimit(orgSettings?: Record<string, unknown>): number {
  const orgLimit = orgSettings?.dailySendLimit
  if (typeof orgLimit === 'number' && orgLimit > 0) return Math.min(orgLimit, 200)
  const raw = Number(process.env.SCOUT_DAILY_SEND_LIMIT ?? '15')
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 15
}

/**
 * Per-type daily ceilings, enforced server-side, not just in the UI.
 *
 *   dm / followup  -> dailySendLimit()      (15 by default)
 *   connection / upwork -> dailyConnectionSendLimit()   (20 by default)
 *
 * Override per-org via organizations.settings JSONB:
 *   { "dailyConnectionLimit": 50, "dailySendLimit": 30 }
 *
 * Inbound reply drafting has no ceiling.
 */
export function dailyConnectionSendLimit(orgSettings?: Record<string, unknown>): number {
  // Per-org override takes priority
  const orgLimit = orgSettings?.dailyConnectionLimit
  if (typeof orgLimit === 'number' && orgLimit > 0) return Math.min(orgLimit, 200)
  // Fall back to env var, then default
  const raw = Number(process.env.SCOUT_DAILY_CONNECTION_LIMIT ?? '20')
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 20
}

export function messageTypeLimit(type: string, orgSettings?: Record<string, unknown>): number {
  return type === 'connection' || type === 'upwork'
    ? dailyConnectionSendLimit(orgSettings)
    : dailySendLimit(orgSettings)
}

/** Published team targets. */
export const REPLY_RATE_TARGET = 0.15
export const READ_TO_CHECK_TARGET = 0.25


