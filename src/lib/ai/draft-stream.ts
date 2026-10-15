import type { Profile, ProofItem } from '@/lib/domain/types'
import type { SelfCheck, DraftResult, DraftInput, DraftVariant, DraftCallLog } from '@/lib/ai/draft'
import { baseDraftSystem, buildCorrectiveFeedback, buildUserPrompt, generateDraft } from '@/lib/ai/draft'
import type { CostTierName } from '@/lib/ai/routing'
import { hasProvider } from '@/lib/ai/config'
import { sanitizeDraft } from '@/lib/facts/sanitize'
import { generate as runtimeGenerate } from '@/lib/ai/runtime'

export type DraftStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'proof'; items: ProofItem[] }
  | { type: 'profile'; profile: Profile | null }
  | { type: 'attempt'; attempt: number; model: string; tier: 'cheap' | 'strong' }
  | { type: 'draft'; chunk: string }
  | { type: 'variant'; draft: DraftVariant }
  | { type: 'selfcheck'; pass: boolean; selfCheck: SelfCheck }
  | { type: 'done'; draft: DraftResult; matchedProof: ProofItem | null }
  | { type: 'error'; message: string }
  | { type: 'needs_rescoring'; reason: string; leadId: string }

const SELFCHECK_MARKER = '---SELFCHECK---'

interface RawVariant {
  draft: string
  test_1_reply_or_delete: boolean
  test_1_note: string
  test_2_not_generic: boolean
  test_2_note: string
}

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'draft',
    'test_1_reply_or_delete',
    'test_1_note',
    'test_2_not_generic',
    'test_2_note',
  ],
  properties: {
    draft: { type: 'string' },
    test_1_reply_or_delete: { type: 'boolean' },
    test_1_note: { type: 'string' },
    test_2_not_generic: { type: 'boolean' },
    test_2_note: { type: 'string' },
  },
} as const

/**
 * Streaming draft pipeline with best-of-two support.
 *
 * Two variants are generated in parallel on the cheap model. The stronger one
 * is streamed to the client token-by-token; the weaker one is emitted as a
 * 'variant' event so the UI can show a one-click swap.
 */
// Vercel Hobby plan caps serverless functions at 10s. Track elapsed time
// and skip attempts that won't finish before the timeout.
const VERCEL_HOBBY_TIMEOUT_MS = 9_500 // leave 500ms buffer

export async function streamDraft(
  input: DraftInput,
  emit: (e: DraftStreamEvent) => void,
  matchedProof: ProofItem | null,
  profile: Profile | null,
  generationMode: 'standard' | 'premium' = 'standard',
): Promise<DraftResult> {
  const streamStart = Date.now()
  const msRemaining = () => VERCEL_HOBBY_TIMEOUT_MS - (Date.now() - streamStart)
  const hasTimeForAttempt = (minMs: number) => msRemaining() > minMs

  emit({ type: 'profile', profile })

  if (!hasProvider()) {
    // DEMO MODE: No API keys configured. Uses demo-only generateDraft().
    // See generateDraft() JSDoc — NOT the production path.
    emit({ type: 'status', message: 'Writing message...' })
    const demo = await generateDraft(input)
    emit({ type: 'draft', chunk: demo.draftText })
    emit({ type: 'selfcheck', pass: demo.passed, selfCheck: demo.selfCheck })
    emit({ type: 'done', draft: demo, matchedProof })
    return demo
  }

  const verdict = input.score.verdict
  const connectionEstablished = input.lead.connectionAcceptedAt != null
  if (verdict === 'skip' && !connectionEstablished) {
    throw new Error(
      'This lead scored skip. Drafting is only allowed for send and research_more leads.',
    )
  }

  if (!input.strategy || !input.strategy.messageJob) {
    emit({
      type: 'needs_rescoring',
      reason: !input.profile
        ? 'No sender profile selected. Assign a profile to generate outreach.'
        : 'Lead needs rescoring. Strategy could not be derived from current evidence.',
      leadId: input.leadId,
    })
    return emptyDraftResult(input)
  }

  const system = baseDraftSystem(input.styleCard, input.facts)
  const user = buildUserPrompt(input)
  const callLog: DraftCallLog[] = []

  // Contextual status messages based on message type (no model/tier details)
  const statusMessage = input.type === 'connection' ? 'Writing connection note...'
    : input.type === 'reply' ? 'Preparing reply...'
    : input.type === 'followup' ? 'Writing follow-up...'
    : 'Writing message...'
  emit({ type: 'status', message: statusMessage })

  // Single generation with FAST_STRUCTURED (native JSON from OpenAI).
  // No quality-gate rejection: if the model returns text, we use it.
  // Fallback ONLY if every provider fails or returns empty.
  const raw = await runtimeGenerate<RawVariant>({
    task: 'FAST_STRUCTURED',
    system,
    user,
    schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1024,
    temperature: 0.7,
    callSite: 'draft-stream:generate',
    feature: 'outbound_draft',
    skipCache: true,
  })
    .then((r) => {
      callLog.push({ costTier: (r.trace.costTier || 'tier1') as CostTierName, host: r.trace.provider, estimatedCostUsd: r.trace.estimatedCostUsd })
      return r.data
    })
    .catch((err) => {
      console.error('[draft-stream] Generation failed:', err instanceof Error ? err.message : String(err))
      return null
    })

  const variant = raw ? normalizeVariant(raw, input) : null

  // Use model output if non-empty after sanitization
  if (variant && variant.draftText.trim().length > 0) {
    return await streamFinalDraft(input, emit, matchedProof, variant, null, 'Generated.', callLog)
  }

  // All providers failed or returned empty — use fallback
  emit({ type: 'status', message: 'Using fallback draft' })
  const fallback = buildDeterministicFallback(input, callLog)
  emit({ type: 'draft', chunk: fallback.draftText })
  emit({ type: 'selfcheck', pass: true, selfCheck: fallback.selfCheck })
  emit({ type: 'done', draft: fallback, matchedProof })
  return fallback
}

async function streamFinalDraft(
  input: DraftInput,
  emit: (e: DraftStreamEvent) => void,
  matchedProof: ProofItem | null,
  primary: ReturnType<typeof normalizeVariant>,
  secondary: ReturnType<typeof normalizeVariant> | null,
  pickReason: string,
  callLog: DraftCallLog[],
  escalationReason?: string,
): Promise<DraftResult> {
  // Stream the primary draft in chunks so the UI feels alive.
  const text = primary.draftText
  const chunkSize = 4
  for (let i = 0; i < text.length; i += chunkSize) {
    emit({ type: 'draft', chunk: text.slice(i, i + chunkSize) })
    // Tiny artificial delay so the client sees token-by-token appearance.
    if (i < text.length - chunkSize) {
      await new Promise((r) => setTimeout(r, 8))
    }
  }

  let qualityGatePassed = primary.passed
  let qualityGateReasons: string[] = []
  try {
    const { evaluateMessage, feelsSurveillance, isGeneric } = await import('@/lib/relay/message-forge')
    const channel = input.type === 'upwork' ? 'upwork' : input.type === 'connection' ? 'connection' : 'dm'
    const evaluation = evaluateMessage(primary.draftText, input.strategy ?? null, channel)
    const surveillance = feelsSurveillance(primary.draftText)
    const generic = isGeneric(primary.draftText, input.lead.company)
    qualityGatePassed = primary.passed && evaluation.passed && !surveillance && !generic
    qualityGateReasons = [...evaluation.reasons]
    if (surveillance) qualityGateReasons.push('Surveillance-like opening')
    if (generic) qualityGateReasons.push('Too generic')
  } catch {
    // Quality gate import failed — use self-check result only.
  }

  emit({ type: 'selfcheck', pass: qualityGatePassed, selfCheck: { ...primary.selfCheck, qualityGateReasons } })

  if (secondary) {
    emit({
      type: 'variant',
      draft: {
        draftText: secondary.draftText,
        selfCheck: secondary.selfCheck,
        passed: secondary.passed,
      },
    })
  }

  // Report the provider that actually produced the accepted output
  // The callLog entry for the winning attempt is the LAST one (most recent)
  const winningCall = callLog.length > 0 ? callLog[callLog.length - 1] : null
  const modelUsed = winningCall
    ? `${winningCall.host}${winningCall.costTier ? ` (${winningCall.costTier})` : ''}`
    : 'unknown'

  const draft: DraftResult = {
    leadId: input.leadId,
    type: input.type,
    draftText: primary.draftText,
    selfCheck: { ...primary.selfCheck, qualityGateReasons },
    passed: qualityGatePassed,
    modelUsed,
    attempts: callLog.length,
    strippedNumbers: primary.strippedNumbers,
    hadEmDash: primary.hadEmDash,
    hadExclamation: primary.hadExclamation,
    requestedCall: primary.requestedCall,
    variant: secondary
      ? {
          draftText: secondary.draftText,
          selfCheck: secondary.selfCheck,
          passed: secondary.passed,
        }
      : undefined,
    pickReason,
    fewShotReason:
      input.fewShotExamples && input.fewShotExamples.length > 0
        ? `Informed by ${input.fewShotExamples.length} real win(s): ${input.fewShotExamples.map((e) => e.company).join(', ')}.`
        : 'No few-shot examples matched this lead.',
    escalationReason,
    callLog,
  }

  emit({ type: 'done', draft, matchedProof })
  return draft
}

function emptyDraftResult(input: DraftInput): DraftResult {
  return {
    leadId: input.leadId,
    type: input.type,
    draftText: '',
    selfCheck: {
      test1ReplyOrDelete: false,
      test1Note: 'No strategy — needs rescoring.',
      test2NotGeneric: false,
      test2Note: 'No strategy — needs rescoring.',
      codeChecks: { companyMentioned: false, specificEvidenceMentioned: false },
    },
    passed: false,
    modelUsed: 'none',
    attempts: 0,
    strippedNumbers: [],
    hadEmDash: false,
    hadExclamation: false,
    requestedCall: false,
    callLog: [],
  }
}

function buildDeterministicFallback(input: DraftInput, callLog: DraftCallLog[]): DraftResult {
  let draftText = fallbackText(input)
  // Safety net: fix any em-dash after name pattern
  draftText = fixEmDashNameFormat(draftText, input.extracted.name ?? input.lead.contactName ?? null)
  const codeChecks = deterministicChecks(draftText, {
    company: input.lead.company,
    evidence: input.extracted.signalEvidence,
  })
  const sanitized = sanitizeDraft(draftText, input.facts)
  const passed = Boolean(codeChecks.companyMentioned && codeChecks.specificEvidenceMentioned && sanitized.strippedNumbers.length === 0 && !sanitized.requestedCall)

  const lastCall = callLog.length > 0 ? callLog[callLog.length - 1] : null
  const modelUsed = lastCall
    ? `${lastCall.host}${lastCall.costTier ? ` (${lastCall.costTier})` : ''}`
    : 'deterministic-fallback'

  return {
    leadId: input.leadId,
    type: input.type,
    draftText: sanitized.text,
    selfCheck: {
      test1ReplyOrDelete: false,
      test1Note: 'Fallback draft used because model variants failed.',
      test2NotGeneric: codeChecks.specificEvidenceMentioned,
      test2Note: codeChecks.specificEvidenceMentioned
        ? 'Draft references lead-specific evidence.'
        : 'Draft is generic because source evidence was missing.',
      codeChecks,
    },
    passed,
    modelUsed,
    attempts: callLog.length,
    strippedNumbers: sanitized.strippedNumbers,
    hadEmDash: sanitized.hadEmDash,
    hadExclamation: sanitized.hadExclamation,
    requestedCall: sanitized.requestedCall,
    callLog,
  }
}

function fallbackText(input: DraftInput): string {
  const name = input.extracted.name ?? input.lead.contactName ?? 'there'
  const firstName = name.split(' ')[0]
  const company = input.lead.company
  const title = (input.extracted.title ?? input.lead.contactTitle ?? '').split(/\s*[·|\-–]\s+/)[0].trim()
  const observation = buildSpecificObservation(input, title, company)

  if (input.type === 'connection') {
    const openers = [
      `Hi ${firstName}, ${observation} Would be great to connect.`,
      `Hi ${firstName}, ${observation} Thought it worth reaching out — connect?`,
      `Hi ${firstName}, ${observation} Always interesting to meet others in this space. Connect?`,
    ]
    return openers[Math.abs(hashCode(company)) % openers.length]
  }

  if (input.type === 'followup') {
    return `Hi ${firstName}, following up on my last note. If the timing is not right for ${company}, a quick "not now" is perfect.`
  }

  if (input.type === 'upwork') {
    return `Hi ${firstName}, ${observation} I can help ${company} ship this. Happy to share a short approach in one reply.`
  }

  if (input.type === 'reply') {
    // For replies, acknowledge their message — never pitch
    return `Hi ${firstName}, thanks for getting back. No pressure — just wanted to leave the door open if anything comes up.`
  }

  // DM: varied, specific openers
  const dmOpeners = [
    `Hi ${firstName}, ${observation} One thing that caught my attention — would be curious how you are approaching it at ${company}.`,
    `Hi ${firstName}, ${observation} Quick question — what is the one thing ${company} is prioritizing right now?`,
    `Hi ${firstName}, ${observation} I have one specific idea that might be relevant for ${company}. Worth a share?`,
  ]
  return dmOpeners[Math.abs(hashCode(company + title)) % dmOpeners.length]
}

/** Simple deterministic hash for picking a varied opener. */
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h
}

/**
 * Build a specific, unique observation from lead evidence.
 * Extracts real details — initiatives, tech, posts — so every message feels
 * personal instead of copy-pasted. Falls back to title+company only when the
 * lead has zero signal evidence.
 */
function buildSpecificObservation(input: DraftInput, title: string, company: string): string {
  const evidence = (input.extracted.signalEvidence ?? '').toLowerCase()
  const tags = input.lead.tags ?? []
  const role = input.extracted.roleCategory

  // Extract a concrete initiative/tech mention from evidence
  const techMatches = evidence.match(/\b(ai|machine learning|llm|genai|react|python|rust|kubernetes|aws|cloud|automation|cybersecurity|zero trust|iam|data|analytics|scaling|hiring|building|launching)\b/g)
  if (techMatches && techMatches.length > 0) {
    const unique = [...new Set(techMatches)].slice(0, 3)
    if (unique.length >= 2) {
      return `saw you are working on ${unique.join(', ')} at ${company}.`
    }
    return `noticed your focus on ${unique[0]} at ${company}.`
  }

  // Use tags (lead-specific)
  if (tags.length > 0) {
    return `noticed your work on ${tags.slice(0, 2).join(' and ')} at ${company}.`
  }

  // Role-based specificity
  if (role && role !== 'other' && role !== 'hiring_manager_recruiter') {
    return `came across your work leading ${role.replace(/_/g, ' ')} at ${company}.`
  }

  // Fallback to title+company
  if (title) {
    return `came across your work as ${title.toLowerCase()} at ${company}.`
  }

  return `came across ${company}.`
}

function variantScore(v: {
  passed: boolean
  selfCheck: { test1ReplyOrDelete: boolean; test2NotGeneric: boolean; codeChecks: SelfCheck['codeChecks'] }
}): number {
  let s = v.passed ? 4 : 0
  s += v.selfCheck.test1ReplyOrDelete ? 2 : 0
  s += v.selfCheck.test2NotGeneric ? 2 : 0
  s += v.selfCheck.codeChecks.companyMentioned ? 1 : 0
  s += v.selfCheck.codeChecks.specificEvidenceMentioned ? 1 : 0
  return s
}

function normalizeVariant(
  raw: RawVariant,
  input: DraftInput,
): {
  draftText: string
  selfCheck: SelfCheck
  passed: boolean
  strippedNumbers: string[]
  hadEmDash: boolean
  hadExclamation: boolean
  requestedCall: boolean
} {
  const cleaned = (raw.draft ?? '').trim() || fallbackText(input)
  const codeChecks = deterministicChecks(cleaned, {
    company: input.lead.company,
    evidence: input.extracted.signalEvidence,
  })
  const sanitized = sanitizeDraft(cleaned, input.facts)
  // Lenient gate: only reject if the model output is truly broken (empty,
  // contains a hard-sell call request, or is shorter than a valid message).
  // We trust the model — it was given rich lead context and a detailed prompt.
  // Over-strict gates caused every draft to fall back to the generic template.
  const tooShort = sanitized.text.trim().split(/\s+/).length < 8
  const passed = !tooShort && !sanitized.requestedCall && sanitized.strippedNumbers.length === 0
  let draftText = sanitized.text

  // Fix AI-looking em-dash after name: "Hi John - ..." → "Hi John, ..."
  draftText = fixEmDashNameFormat(draftText, input.extracted.name)

  return {
    draftText,
    selfCheck: {
      test1ReplyOrDelete: Boolean(raw.test_1_reply_or_delete),
      test1Note: raw.test_1_note || '',
      test2NotGeneric: Boolean(raw.test_2_not_generic),
      test2Note: raw.test_2_note || '',
      codeChecks,
    },
    passed,
    strippedNumbers: sanitized.strippedNumbers,
    hadEmDash: sanitized.hadEmDash,
    hadExclamation: sanitized.hadExclamation,
    requestedCall: sanitized.requestedCall,
  }
}

/**
 * Fix AI-looking em-dash patterns after names.
 * "Hi John - came across..." → "Hi John, came across..."
 * "John - I noticed..." → "John, I noticed..."
 */
function fixEmDashNameFormat(text: string, prospectName: string | null): string {
  if (!text || !prospectName) return text

  const firstName = prospectName.split(/\s+/)[0]
  if (!firstName || firstName.length < 2) return text

  const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // "Hi/Hey/Hello Name -" → "Hi/Hey/Hello Name,"
  text = text.replace(
    new RegExp(`^(hi|hey|hello)\\s+${escaped}\\s*[\\u2014\\u2013-]\\s*`, 'i'),
    `$1 ${firstName}, `,
  )

  // "Name -" at start of line → "Name,"
  text = text.replace(
    new RegExp(`(^|\\n)\\s*${escaped}\\s*[\\u2014\\u2013-]\\s*`, 'i'),
    `$1${firstName}, `,
  )

  return text
}

function pickBestVariant(
  a: ReturnType<typeof normalizeVariant> | null,
  b: ReturnType<typeof normalizeVariant> | null,
): {
  primary: ReturnType<typeof normalizeVariant>
  secondary: ReturnType<typeof normalizeVariant> | null
  pickReason: string
} {
  if (a && !b) return { primary: a, secondary: null, pickReason: 'Only variant A succeeded.' }
  if (b && !a) return { primary: b, secondary: null, pickReason: 'Only variant B succeeded.' }
  if (!a && !b) {
    // Unreachable in practice because we guard upstream, but satisfies types.
    throw new Error('Both variants failed.')
  }

  const sa = variantScore(a!)
  const sb = variantScore(b!)

  if (sa >= sb) {
    return {
      primary: a!,
      secondary: b,
      pickReason:
        sa === sb
          ? 'Both variants scored the same. Showing variant A by default.'
          : 'Variant A scored higher on self-check + code checks.',
    }
  }

  return {
    primary: b!,
    secondary: a,
    pickReason: 'Variant B scored higher on self-check + code checks.',
  }
}

function deterministicChecks(
  draft: string,
  leadTokens: { company: string | null; evidence: string | null },
): SelfCheck['codeChecks'] {
  const c = leadTokens.company?.toLowerCase() ?? ''
  const evidenceWords =
    leadTokens.evidence
      ?.toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 5) ?? []

  // Company mention: check full name OR first token (e.g. "Search" from "Search HI")
  const companyTokens = c.split(/\s+/).filter(Boolean)
  const companyMentioned = c.length > 0
    ? draft.toLowerCase().includes(c) || companyTokens.some((t) => t.length > 2 && draft.toLowerCase().includes(t))
    : true
  // Evidence: check if ANY evidence word appears (lenient — model may paraphrase)
  const specificEvidenceMentioned = evidenceWords.length === 0 || evidenceWords.some((w) =>
    draft.toLowerCase().includes(w),
  )
  return { companyMentioned, specificEvidenceMentioned }
}

function parseSelfCheckBlock(raw: string): {
  test_1_reply_or_delete?: boolean
  test_1_note?: string
  test_2_not_generic?: boolean
  test_2_note?: string
} | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
  const lastObj = cleaned.lastIndexOf('{')
  const lastClose = cleaned.lastIndexOf('}')
  if (lastObj >= 0 && lastClose > lastObj) {
    try {
      return JSON.parse(cleaned.slice(lastObj, lastClose + 1)) as Record<string, unknown>
    } catch {
      // Fall through.
    }
  }
  return null
}

export { baseDraftSystem, buildUserPrompt, generateDraft }
