import type {
  ExtractedLead,
  Fact,
  Lead,
  MatchedProof,
  Message,
  OutreachStrategy,
  Play,
  Profile,
  ProofItem,
  SafeFact,
  ScoreResult,
  StyleCard,
} from '@/lib/domain/types'
import {
  buildLongcatDraftChain,
  buildOpenaiDraftChain,
  pickDraftChain,
  shouldEscalateToPremium,
  type ChainStep,
  type CostTierName,
} from '@/lib/ai/routing'
import { hasProvider } from '@/lib/ai/config'
import { structuredJsonChain } from '@/lib/ai/provider'
import { injectStyleCard } from '@/lib/style/inject'
import { signalById } from '@/lib/score/signals'
import { pickPlayForSignal } from '@/lib/score/plays'
import { sanitizeDraft, siteIsLive } from '@/lib/facts/sanitize'
import { classifyRoleFromTitle, rolePromptGuidance } from '@/lib/leads/targeting'
import { strategyToPromptBlock } from '@/lib/relay/outreach-strategy'
import {
  ANTI_AI_RULES,
  FACTUALITY_RULES,
  SURVEILLANCE_RULES,
  CTA_RULES,
  SPECIFICITY_RULES,
  VOICE_RULES,
  FORMATTING_RULES,
} from '@/lib/ai/prompts'

/** One entry per model call made while producing one draft, for cost/tier reporting on the route. */
export interface DraftCallLog {
  costTier: CostTierName
  host: string
  estimatedCostUsd: number
}

export type DraftMessageType = 'dm' | 'connection' | 'upwork' | 'followup' | 'reply'

export interface SelfCheck {
  test1ReplyOrDelete: boolean
  test1Note: string
  test2NotGeneric: boolean
  test2Note: string
  /** Deterministic checks that run in code after the model self-check. */
  codeChecks: {
    companyMentioned: boolean
    specificEvidenceMentioned: boolean
  }
  /** Quality gate reasons from the hard message quality evaluation. */
  qualityGateReasons?: string[]
}

export interface DraftVariant {
  draftText: string
  selfCheck: SelfCheck
  passed: boolean
}

export interface DraftResult {
  leadId: string
  type: DraftMessageType
  draftText: string
  selfCheck: SelfCheck
  passed: boolean
  modelUsed: string
  attempts: number
  strippedNumbers: string[]
  hadEmDash: boolean
  hadExclamation: boolean
  /** True if a call/meeting/chat was requested — always a failure; the offer is always the free Read. */
  requestedCall: boolean
  /** The second variant, when best-of-two drafting is enabled. */
  variant?: DraftVariant
  /** Why the primary draft was picked over the variant. */
  pickReason?: string
  /** Which few-shot examples informed this draft. */
  fewShotReason?: string
  /** Reason for GPT escalation, if applicable. */
  escalationReason?: string
  /** Every model call made while producing this draft, for cost/tier reporting. */
  callLog: DraftCallLog[]
}

export interface DraftInput {
  leadId: string
  lead: Lead
  extracted: ExtractedLead
  score: ScoreResult
  /** Canonical 0-100 score from Intelligence V2. When present, takes precedence for quality gates. */
  canonicalScore?: number | null
  type: DraftMessageType
  styleCard: StyleCard | null
  facts: Fact[]
  plays: Play[]
  /** Earlier messages on this lead, newest last. Used for follow-ups. */
  history?: Message[]
  /** The profile the draft is being written from. */
  profile?: Profile | null
  /** Proof item matched to this lead's tags, referenced instead of a generic pitch. */
  matchedProof?: ProofItem | null
  /** Few-shot examples from real wins to inject into the prompt. */
  fewShotExamples?: { company: string; signalEvidence: string; sentText: string }[]
  /** Outreach strategy computed before message generation. */
  strategy?: OutreachStrategy | null
  /** Safe-to-mention facts about the lead. */
  safeFacts?: SafeFact[]
  /** Matched proof cards from the sender's profile. */
  matchedProofCards?: MatchedProof[]
  /** Conversation context for replies. */
  conversationContext?: string | null
}

interface DraftModelOutput {
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

const TWO_TESTS = `Before returning the draft, judge it yourself against these two fixed tests and include the results in the JSON.

Test 1: Would a senior engineer at the target company reply to this, or delete it? It must be specific to their situation and worth 30 seconds of their time. Pass only if they would reply.
Test 2: Could this draft be sent to a different company unchanged? If swapping the company name changes nothing, it is too generic. Pass only if the draft is tied to this company's specific signal and would not survive a company swap.

Write out the draft first, then honestly run the tests on it, then return the final draft plus test_1_reply_or_delete, test_1_note, test_2_not_generic, test_2_note. Do not weaken the tests to make them pass.`

function messageKind(input: DraftInput): string {
  const budget = input.strategy?.wordBudget
  const job = input.strategy?.messageJob
  const ceiling = budget ? `${budget.min}–${budget.max} words` : null
  switch (input.type) {
    case 'dm':
      return `LinkedIn DM. One job${job ? ` (${job})` : ''}. ${ceiling ?? '20–55 words'}. One observation, one question.`
    case 'connection':
      return `LinkedIn connection note. Earn access only. ${ceiling ?? '14-20 words'}. Hard cap 120 characters. Specific observation plus a genuine overlap and a simple reason to connect. Plain sentences only: no question marks, no slashes, no dashes. No pitch. No praise. No service description. Sounds natural spoken aloud.`
    case 'upwork':
      return `Upwork cover letter. Specific to the job. No biography dump. ${ceiling ?? '50-150 words'}. One relevant project shape, one specific need from the job, one easy next step.`
    case 'followup':
      return `Follow-up message. ${ceiling ?? '15–45 words'}. Continue the existing conversation — reference what was already said. Add ONE new reason to reply or close the loop. Never "just following up". NEVER open with "Building AI..." or "Building [product]..." or any first-contact opener. The prospect already knows you — re-engage them with something specific to your prior exchange.`
    case 'reply': {
      return `Reply to their message. Their words are first-party evidence — address them directly. ${ceiling ?? '20–70 words'}. If they declined or said no: acknowledge it gracefully, leave the door open, do NOT restart the pitch or repeat your offer. If they asked a question: answer it first. If they showed interest: continue the conversation naturally. NEVER open with "Hi [Name], came across your work as [title] at [company]." when replying — this is a first-contact opener, not a reply.`
    }
  }
}

export function baseDraftSystem(
  styleCard: StyleCard | null,
  facts: Fact[],
  opts?: { asPlainText?: boolean },
): string {
  const styleBlock = injectStyleCard(styleCard)
  const siteBlock = siteIsLive(facts)
    ? 'The public site is live and may be referenced only if the message job needs it. Never ask for a call on first touch. Never offer an unsolicited analysis or "read".'
    : 'The public site is NOT live. Never link to it. Never ask for a call on first touch. Never offer an unsolicited analysis or "read".'
  const testsBlock = opts?.asPlainText
    ? `Write the draft, then on the line after it write the marker ---SELFCHECK--- followed by ONLY this single JSON object:
{"test_1_reply_or_delete": true or false, "test_1_note": "one sentence", "test_2_not_generic": true or false, "test_2_note": "one sentence"}

Test 1: Would a senior engineer at the target company reply to this, or delete it? Pass only if they would reply.
Test 2: Could this draft be sent to a different company unchanged? Pass only if it is tied to this company's specific signal and would not survive a company swap.

Write the draft first, then honestly run the tests on it, then the marker and the JSON. Do not weaken the tests to make them pass. No commentary before the draft or after the JSON.`
    : TWO_TESTS
  return [
    'You write cold outreach messages for a software consultant. The message is copy-pasted by a human; you never send anything yourself.',
    FACTUALITY_RULES,
    'When the message lists a matched past project, reference it specifically; that referencing is the personalization. Without a matched project, stay with the signal, never invent a case.',
    'Rule on client names: a client may only be named when the matched proof item explicitly says permission is on file. Otherwise describe the project by shape (a trading dashboard, an internal QA tool) and never name the client.',
    VOICE_RULES,
    FORMATTING_RULES,
    CTA_RULES,
    SPECIFICITY_RULES,
    ANTI_AI_RULES,
    'CRITICAL: Do NOT echo back the prospect\'s profile data as the message. The message must be ORIGINAL — a short, specific observation about them + why connecting. Never copy their title, company, location, or bio text into the draft.',
    'NEVER start any message with "Building AI...", "Building [product]...", "Building anything...", "Creating AI...", "Developing AI..." or any construction-progress opener. These are generic first-contact tells that ignore the specific prospect. Start with something specific about THEM — their work, their challenge, their situation.',
    'REPLY MODE: When generating a REPLY (not first contact), NEVER open with "Hi [Name], came across your work as [title] at [company]." or any first-contact opener. The prospect already knows you — acknowledge their specific message directly. If they sent a brief/polite/unclear reply: respond in 1-2 sentences, warm and brief, no pitch, no probing question. If they showed interest: continue the conversation naturally. If they declined: acknowledge gracefully and leave the door open.',
    'REJECTION HANDLING: If the prospect said "no", "no thanks", "not interested", "stop", or similar: acknowledge it briefly and gracefully. Do NOT repeat your pitch. Do NOT ask another question. Do NOT try to change their mind. Do NOT use the "came across your work" opener. A simple acknowledgment is enough.',
    'STYLE RULE: Never open with "Hi [Name], came across your work as [title] at [company]." This is the #1 AI tell. Vary your openers. Start with something specific about THEM — a project, a post, a technical challenge — not your observation of their profile.',
    'FOLLOW-UP RULE: When sending a follow-up, NEVER open with "Building AI..." or "Building [product]..." or "Building anything..." — this is a first-contact opener pattern that ignores the conversation history. Reference what was already discussed. Acknowledge their position. Ask a specific follow-up question that moves the conversation forward.',
    'Sound like a real person who read their profile, not a template. Vary sentence length. Start with something specific about THEM — not "I" or "we". Make it easy to say yes to. Zero corporate speak.',
    SURVEILLANCE_RULES,
    'Relay knows more than it says. Use only ALLOWED_NOW evidence. One message, one job. If no job is specified, return an empty draft.',
    'Do not pitch BPulse, headcount leverage, or pricing unless the job is PROVIDE_PROOF and they asked. Never invent a rate. NEVER ask for a call on first touch.',
    'Truthful curiosity beats fake insight. Do not manufacture technical observations from a scrape.',
    siteBlock,
    styleBlock ? `SENDER VOICE (mandatory):\n${styleBlock}` : '',
    testsBlock,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildFewShotBlock(
  examples: { company: string; signalEvidence: string; sentText: string }[],
): string {
  if (examples.length === 0) return ''
  const lines: string[] = [
    'Here are real messages that got a reply from a similar lead. Use them as a style reference, not a template to copy word for word.',
  ]
  for (const ex of examples) {
    lines.push('')
    lines.push(`Example (lead: ${ex.company}, signal: ${ex.signalEvidence || 'unknown'}):`)
    lines.push(ex.sentText)
  }
  lines.push('')
  lines.push('Now write a fresh message for the lead below. Do not copy the example verbatim.')
  return lines.join('\n')
}

const HISTORY_TURNS = 8
const HISTORY_CHARS = 600

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function buildUserPrompt(
  input: DraftInput,
  opts?: { asPlainText?: boolean },
): string {
  const signal = signalById(input.extracted.signalType)
  const play = pickPlayForSignal(input.plays, input.extracted.signalType)
  const role =
    input.extracted.roleCategory ??
    (input.lead.contactTitle ? classifyRoleFromTitle(input.lead.contactTitle) : 'other')
  const factsTable = filterFacts(input.facts)

  // Static-first ordering for prompt caching: the approved facts and the play
  // template rarely change between calls; the lead and the identity are the
  // only per-lead variable parts and go last.
  const factsBlock = [
    'APPROVED FACTS FOR THIS CALL (the only numbers and claims allowed):',
    factsTable.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(none relevant)',
  ].join('\n')

  const playBlock = play
    ? `MATCHED PLAY TEMPLATE "${play.name}":\n${play.templateShape}`
    : 'No matched play; write a simple direct first message.'

  const roleBlock = `CONTACT ROLE: ${role}\n${rolePromptGuidance(role)}`

  const proof = input.matchedProof
  const proofBlock = proof
    ? [
        `MATCHED PAST PROJECT (this is relevant prior work you delivered; reference it as your own):`,
        `- Summary: ${proof.projectSummary}`,
        proof.reviewQuote ? `- What the client said: ${proof.reviewQuote}` : null,
        proof.permissionOnFile && proof.clientName ? `- Client may be named: ${proof.clientName}` : '- Client may NOT be named. Describe the project by shape only.',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No matched past project. Do not invent one.'

  const profile = input.profile
  const profileBlock = profile
    ? [
        'THE SENDER IDENTITY (the profile this is sent from, do not contradict it):',
        profile.label ? `- Label: ${profile.label}` : null,
        `- Platform: ${profile.platform}`,
        profile.headline ? `- Headline: ${profile.headline}` : null,
        profile.profileUrl ? `- Profile URL: ${profile.profileUrl}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  // Writer receives ONLY strategy-scoped facts. Raw scraped text is NEVER passed.
  const leadBlock = [
    'THE LEAD (factual only, from strategy scope):',
    `Company: ${input.lead.company}`,
    `Contact: ${input.extracted.name ?? 'unknown'}${input.extracted.title ? `, ${input.extracted.title}` : ''}`,
    `Source URL: ${input.extracted.url ?? 'none'}`,
    input.extracted.signalEvidence ? `Signal: ${input.extracted.signalEvidence.slice(0, 500)}${input.extracted.signalEvidence.length > 500 ? '...' : ''}` : '',
    input.strategy?.allowedNow?.length ? `Allowed evidence: ${input.strategy.allowedNow.slice(0, 2).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const historyBlock = (() => {
    // Both sides, labeled by who wrote them, oldest first. The old block
    // called the client's messages "what the sender already wrote" and
    // listed them newest-first under a "newest last" heading.
    const sent = (input.history ?? [])
      .filter((m) => m.sentText && m.sentAt)
      .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
      .slice(-HISTORY_TURNS)
    if (sent.length === 0) return ''
    return `Conversation so far (oldest first; "Me" is the sender, "Client" is the prospect):\n${sent
      .map((m) => `- ${m.direction === 'inbound' ? 'Client' : 'Me'} [${m.type}]: ${clip(m.sentText ?? '', HISTORY_CHARS)}`)
      .join('\n')}`
  })()

  const fewShotBlock = buildFewShotBlock(input.fewShotExamples ?? [])

  const strategyBlock = input.strategy
    ? strategyToPromptBlock(input.strategy)
    : ''

  // BUG-19/20: For replies AND follow-ups, the conversation context MUST come
  // first — before strategy, lead data, or anything that could trigger a fresh
  // pitch. The LLM was ignoring a bottom-placed context and falling back to a
  // connection-note opener ("Building AI can be complex..."). Placing it at the
  // top forces the model to continue the conversation, not restart it.
  const isReply = input.type === 'reply'
  const isFollowup = input.type === 'followup'
  const ctxBlock = input.conversationContext ?? ''

  return [
    `Message kind: ${messageKind(input)}`,
    '',
    (isReply || isFollowup) && ctxBlock ? ctxBlock : null,
    (isReply || isFollowup) && ctxBlock ? '' : null,
    strategyBlock,
    strategyBlock ? '' : null,
    factsBlock,
    '',
    playBlock,
    '',
    roleBlock,
    '',
    proofBlock,
    '',
    fewShotBlock,
    '',
    historyBlock,
    '',
    profileBlock,
    '',
    leadBlock,
    '',
    !isReply && ctxBlock ? ctxBlock : null,
    !isReply && ctxBlock ? '' : null,
    opts?.asPlainText
      ? 'End the draft, then put ---SELFCHECK--- on its own line and the self-check JSON object after it, exactly as the system message describes. The draft itself is only the message text.'
      : 'Return the JSON object described in the system message.',
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * ⚠️ DEMO-ONLY — NOT USED IN PRODUCTION.
 *
 * This function implements a LongCat-first drafting pipeline that is ONLY called
 * when no AI provider API keys are configured (demo mode). It exists to support:
 * - `draft-stream.ts` demo fallback (when `!hasProvider()`)
 * - `eval.ts` test tooling
 *
 * PRODUCTION drafting uses `streamDraft()` in `draft-stream.ts`, which routes
 * through Runtime V3 (OpenCode → Groq → OpenAI → LongCat).
 *
 * DO NOT reconnect this to production routes. DO NOT add new callers.
 * If you need production drafting, use `streamDraft()` from `@/lib/ai/draft-stream`.
 *
 * Pipeline: LongCat → deterministic quality gate → PASS: return immediately.
 * On FAIL: second candidate (Groq strong or corrective retry) → GPT escalation.
 */
export async function generateDraft(input: DraftInput): Promise<DraftResult> {
  if (input.type === 'reply' && !input.conversationContext) {
    throw new Error(
      'Reply drafting needs the prospect reply text, which is not captured yet.',
    )
  }

  const verdict = input.score.verdict
  const strategyAllowsWrite = input.strategy?.contact?.messageRecommended === true || input.type === 'reply'
  const connectionEstablished = input.lead.connectionAcceptedAt != null
  if (verdict === 'skip' && !strategyAllowsWrite && !connectionEstablished) {
    throw new Error(
      'This lead scored skip. Drafting is only allowed for send and research_more leads.',
    )
  }

  if (input.strategy?.contact?.messageRecommended === false && input.type !== 'reply') {
    return emptyDraft(input)
  }

  // A connection note (EARN_CONNECTION / "observe, don't pitch") never needs
  // to cite the specific classified signal — it's deliberately generic and
  // low-key. So when evidence doesn't actually support the signal type, drop
  // the mismatched evidence from what the generator is told rather than
  // failing the whole draft — the note still gets written (through the
  // normal live/demo generation path below, unchanged), it just can't
  // reference a "signal" that doesn't check out. This is a real, separate
  // extraction gap (see deriveSignalEvidenceFallback in orchestrator.ts),
  // but the generation layer should not compound it into a silently empty
  // draft when the strategy explicitly asked for a message.
  //
  // Message types that DO make a specific evidence claim (offer_small_win,
  // problem_recognition, etc.) still hard-fail below — this is not a
  // general loosening of the anti-hallucination guard, only a narrow
  // carve-out for the one message type that never makes an evidence claim.
  let effectiveInput = input
  if (
    input.type !== 'reply'
    && !input.strategy
    && !signalEvidenceMatch(input.extracted.signalType, input.extracted.signalEvidence)
  ) {
    if (input.type !== 'connection') {
      throw new Error(
        `Signal type ${input.extracted.signalType} is not supported by its evidence ("${input.extracted.signalEvidence}"). Rescore this lead before drafting.`,
      )
    }
    effectiveInput = {
      ...input,
      extracted: { ...input.extracted, signalEvidence: '', verbatimQuote: null },
    }
  }

  const userPrompt = buildUserPrompt(effectiveInput)
  const systemPrompt = baseDraftSystem(effectiveInput.styleCard, effectiveInput.facts)

  if (!hasProvider()) {
    return demoDraft(effectiveInput, userPrompt)
  }

  const callLog: DraftCallLog[] = []
  // High value: canonical score >= 70 (0-100), or legacy score >= 10 (0-12)
  const scoreForGate = input.canonicalScore ?? input.score.total
  const isHighValue = scoreForGate >= 70 || (input.score.total >= 10 && input.score.total <= 12)

  // Attempt 1: LongCat (primary writer)
  const longcatChain = buildLongcatDraftChain()
  const resultA = await runDraftAttemptWithFallback(longcatChain, 'longcat', systemPrompt, userPrompt, callLog)
    .catch((err) => {
      console.error('[draft] LongCat attempt failed:', err instanceof Error ? err.message : String(err))
      return null
    })

  if (resultA?.passed) {
    const draft = finishDraft(input, resultA, [resultA.hostLabel], 1, callLog)
    return {
      ...draft,
      pickReason: 'LongCat passed quality gates on first attempt.',
      fewShotReason: fewShotLabel(input.fewShotExamples),
      escalationReason: undefined,
    }
  }

  // Attempt 2: corrective retry with Groq (feedback from first failure)
  const escalationDecision = shouldEscalateToPremium({
    primaryPassed: resultA?.passed ?? false,
    primaryScore: resultA ? variantScore(resultA) : 0,
    isHighValue,
    malformedOutput: !resultA,
    attemptCount: callLog.length,
  })

  if (escalationDecision.shouldEscalate || isHighValue) {
    const feedback = resultA ? buildCorrectiveFeedback(resultA, input) : null
    const secondChain = pickDraftChain()
    const resultB = await runDraftAttemptWithFallback(
      secondChain,
      'groq-retry',
      systemPrompt,
      feedback ? `${userPrompt}\n\n${feedback}` : userPrompt,
      callLog,
    ).catch((err) => {
      console.error('[draft] Groq retry failed:', err instanceof Error ? err.message : String(err))
      return null
    })

    if (resultB?.passed) {
      const modelsUsed = [resultA?.hostLabel, resultB.hostLabel].filter((x): x is string => Boolean(x))
      const draft = finishDraft(input, resultB, modelsUsed, 2, callLog)
      return {
        ...draft,
        variant: resultA ? { draftText: resultA.output.draft, selfCheck: { test1ReplyOrDelete: Boolean(resultA.output.test_1_reply_or_delete), test1Note: resultA.output.test_1_note || '', test2NotGeneric: Boolean(resultA.output.test_2_not_generic), test2Note: resultA.output.test_2_note || '', codeChecks: resultA.codeChecks }, passed: resultA.passed } : undefined,
        pickReason: resultA ? 'LongCat failed; Groq corrective retry passed.' : 'LongCat unavailable; Groq succeeded.',
        fewShotReason: fewShotLabel(input.fewShotExamples),
        escalationReason: escalationDecision.reason,
      }
    }

    // Attempt 3: GPT escalation only
    const openaiChain = buildOpenaiDraftChain()
    if (openaiChain.length > 0 && escalationDecision.shouldEscalate) {
      const lastAttempt = resultB ?? resultA
      const gptFeedback = lastAttempt ? buildCorrectiveFeedback(lastAttempt, input) : null
      const gptResult = await runDraftAttemptWithFallback(
        openaiChain,
        'gpt-escalation',
        systemPrompt,
        gptFeedback ? `${userPrompt}\n\n${gptFeedback}` : userPrompt,
        callLog,
      ).catch((err) => {
        console.error('[draft] GPT escalation failed:', err instanceof Error ? err.message : String(err))
        return null
      })

      if (gptResult) {
        const modelsUsed = [resultA?.hostLabel, resultB?.hostLabel, gptResult.hostLabel].filter((x): x is string => Boolean(x))
        const draft = finishDraft(input, gptResult, modelsUsed, 3, callLog)
        return {
          ...draft,
          variant: resultA ? { draftText: resultA.output.draft, selfCheck: { test1ReplyOrDelete: Boolean(resultA.output.test_1_reply_or_delete), test1Note: resultA.output.test_1_note || '', test2NotGeneric: Boolean(resultA.output.test_2_not_generic), test2Note: resultA.output.test_2_note || '', codeChecks: resultA.codeChecks }, passed: resultA.passed } : undefined,
          pickReason: 'Escalated to GPT: cheaper tiers failed quality gates.',
          fewShotReason: fewShotLabel(input.fewShotExamples),
          escalationReason: escalationDecision.reason,
        }
      }
    }
  }

  const best = resultA
  if (!best) {
    const draft = finishDraft(input, emptyResult('all-failed'), ['all-failed'], callLog.length, callLog)
    return {
      ...draft,
      pickReason: 'All model attempts failed; returning best effort.',
      fewShotReason: fewShotLabel(input.fewShotExamples),
      escalationReason: escalationDecision.reason,
    }
  }

  const draft = finishDraft(input, best, [best.hostLabel], callLog.length, callLog)
  return {
    ...draft,
    pickReason: 'Best effort from available providers.',
    fewShotReason: fewShotLabel(input.fewShotExamples),
    escalationReason: escalationDecision.reason,
  }
}



/** Run a single draft attempt with per-side fallback built into the chain. */
async function runDraftAttemptWithFallback(
  chain: ChainStep[],
  label: string,
  system: string,
  userPrompt: string,
  callLog: DraftCallLog[],
): Promise<ReturnType<typeof runDraftAttempt> | null> {
  if (chain.length === 0) return null
  return runDraftAttempt(chain, system, userPrompt, callLog)
}

/** Empty result used when a candidate completely fails. */
function emptyResult(hostLabel: string): { output: DraftModelOutput; passed: boolean; codeChecks: SelfCheck['codeChecks']; hostLabel: string } {
  return {
    output: { draft: '', test_1_reply_or_delete: false, test_1_note: 'Candidate failed.', test_2_not_generic: false, test_2_note: 'Candidate failed.' },
    passed: false,
    codeChecks: { companyMentioned: false, specificEvidenceMentioned: false },
    hostLabel,
  }
}

function fewShotLabel(examples?: { company: string }[]): string {
  return examples && examples.length > 0
    ? `Informed by ${examples.length} real win(s): ${examples.map((e) => e.company).join(', ')}.`
    : 'No few-shot examples matched this lead.'
}

/**
 * Returns true if the evidence text actually supports the claimed signal type.
 * This is the hard gate that prevents drafting around a false signal premise —
 * e.g. signalType=1 (hiring) with evidence that says nothing about hiring.
 */
function signalEvidenceMatch(signalType: number | null, evidence: string | null): boolean {
  if (!evidence || evidence.trim().length < 12) return false
  const e = evidence.toLowerCase()
  switch (signalType) {
    case 1: return /\bhiring\b|\bopen role\b|\bjoining\b|\bwe'?re growing\b|\bscaling the team\b|\bnew position\b/i.test(e)
    case 2: return /\bsolo\b|\bone[- ]person\b|\btiny team\b|\bjust me\b|\bfounder\b.*\balone\b/i.test(e)
    case 3: return /\braised\b|\bseed\b|\bseries [abc]\b|\bfunding\b|\binvestment\b|\bbacked by\b/i.test(e)
    case 4: return /\blast update\b|\boutdated\b|\bstale\b|\babandoned\b|\bno update\b|\bdormant\b/i.test(e)
    case 5: return /\blegacy\b|\bwordpress\b|\bjquery\b|\bunsupported\b|\bdeprecated\b|\baging\b/i.test(e)
    case 6: return /\bbehind\b|\bdelayed\b|\boverdue\b|\bstuck\b|\bslow\b|\bpain\b|\bfrustrat\b/i.test(e)
    case 7: return /\blooking for\b|\bneed help\b|\bopen to\b|\bagency\b|\bfreelancer\b|\bseeking\b/i.test(e)
    default: return false
  }
}

function variantScore(v: { passed: boolean; output: DraftModelOutput; codeChecks: SelfCheck['codeChecks'] }): number {
  let s = 0
  if (v.passed) s += 4
  if (v.output.test_1_reply_or_delete) s += 2
  if (v.output.test_2_not_generic) s += 2
  if (v.codeChecks.companyMentioned) s += 1
  if (v.codeChecks.specificEvidenceMentioned) s += 1
  return s
}

function pickBestVariant(
  a: { output: DraftModelOutput; passed: boolean; codeChecks: SelfCheck['codeChecks']; hostLabel: string },
  b: { output: DraftModelOutput; passed: boolean; codeChecks: SelfCheck['codeChecks']; hostLabel: string },
): {
  primary: typeof a
  secondary: typeof a | null
  pickReason: string
} {
  const sa = variantScore(a)
  const sb = variantScore(b)

  if (sa >= sb) {
    return {
      primary: a,
      secondary: b,
      pickReason:
        sa === sb
          ? 'Both variants scored the same. Variant A is shown by default.'
          : 'Variant A scored higher on self-check + code checks.',
    }
  }

  return {
    primary: b,
    secondary: a,
    pickReason: 'Variant B scored higher on self-check + code checks.',
  }
}

async function runDraftAttempt(
  chain: ReturnType<typeof pickDraftChain>,
  system: string,
  userPrompt: string,
  callLog: DraftCallLog[],
): Promise<{ output: DraftModelOutput; passed: boolean; codeChecks: SelfCheck['codeChecks']; hostLabel: string }> {
  // json_object mode only, never strict schema — same reasoning as
  // extraction: DeepSeek's own strict mode has an open bug returning
  // malformed JSON on some calls, so this app never trusts a provider's
  // schema-adherence claim. The code-level checks below are the real gate,
  // applied identically regardless of which tier answered.
  const result = await structuredJsonChain<DraftModelOutput>(chain, {
    system,
    user: userPrompt,
    schema: DRAFT_SCHEMA,
  })
  callLog.push({ costTier: result.costTier, host: result.host, estimatedCostUsd: result.estimatedCostUsd })
  const output = result.data
  const hostLabel = `${result.costTier}:${result.host}`

  const cleaned = (output.draft ?? '').trim()
  if (!cleaned) {
    return {
      output: { ...output, draft: '' },
      passed: false,
      codeChecks: { companyMentioned: false, specificEvidenceMentioned: false },
      hostLabel,
    }
  }

  const codeChecks = deterministicChecks(cleaned, {
    company: extractCompanyFromUserPrompt(userPrompt),
    evidence: extractEvidenceFromUserPrompt(userPrompt),
  })

  const passed = Boolean(
    output.test_1_reply_or_delete &&
      output.test_2_not_generic &&
      codeChecks.companyMentioned &&
      codeChecks.specificEvidenceMentioned,
  )

  return { output: { ...output, draft: cleaned }, passed, codeChecks, hostLabel }
}

function finishDraft(
  input: DraftInput,
  result: { output: DraftModelOutput; passed: boolean; codeChecks: SelfCheck['codeChecks'] },
  modelsUsed: string[],
  attempts: number,
  callLog: DraftCallLog[],
): DraftResult {
  const sanitized = sanitizeDraft(result.output.draft, input.facts)
  const passed = result.passed && sanitized.strippedNumbers.length === 0 && !sanitized.requestedCall

  return {
    leadId: input.leadId,
    type: input.type,
    draftText: sanitized.text,
    selfCheck: {
      test1ReplyOrDelete: Boolean(result.output.test_1_reply_or_delete),
      test1Note: result.output.test_1_note || '',
      test2NotGeneric: Boolean(result.output.test_2_not_generic),
      test2Note: result.output.test_2_note || '',
      codeChecks: result.codeChecks,
    },
    passed,
    modelUsed: modelsUsed.join(' then '),
    attempts: attempts,
    strippedNumbers: sanitized.strippedNumbers,
    hadEmDash: sanitized.hadEmDash,
    hadExclamation: sanitized.hadExclamation,
    requestedCall: sanitized.requestedCall,
    callLog,
  }
}

/**
 * Builds a corrective-feedback block naming exactly what failed on the
 * rejected attempt, so a retry fixes the actual problem instead of just
 * re-rolling the dice on the same prompt. Returns null when nothing
 * specific can be said (the draft came back empty, so there's nothing to
 * diagnose beyond "try again").
 */
export function buildCorrectiveFeedback(
  attempt: { output: DraftModelOutput; codeChecks: SelfCheck['codeChecks'] },
  input: DraftInput,
): string | null {
  const problems: string[] = []
  if (!attempt.codeChecks.companyMentioned) {
    problems.push(`- It never named "${input.lead.company}". Write the company name into the first or second line.`)
  }
  if (!attempt.codeChecks.specificEvidenceMentioned) {
    problems.push(
      `- It dropped the specific evidence ("${input.extracted.signalEvidence || 'the signal noted for this lead'}"). Lead with that exact detail, not a generic version of it.`,
    )
  }
  if (!attempt.output.test_1_reply_or_delete) {
    problems.push(`- Its own test 1 failed: ${attempt.output.test_1_note || 'not specific enough to earn a reply.'} Make it worth 30 seconds of their time.`)
  }
  if (!attempt.output.test_2_not_generic) {
    problems.push(`- Its own test 2 failed: ${attempt.output.test_2_note || 'would survive a company swap.'} Tie it to something only this company/signal has.`)
  }

  if (problems.length === 0) return null

  return [
    'CORRECTIVE FEEDBACK — your previous attempt failed its own checks. Do not repeat these mistakes:',
    ...problems,
    'Write a new draft that fixes all of the above. Run both tests honestly again before returning it.',
  ].join('\n')
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

  const companyMentioned = c.length > 0 ? draft.toLowerCase().includes(c) : true
  const specificEvidenceMentioned = evidenceWords.some((w) =>
    draft.toLowerCase().includes(w),
  )
  return { companyMentioned, specificEvidenceMentioned }
}

/**
 * DEMO ONLY. Deterministic draft used when no API key is set. Reuses the real
 * play and facts pipeline so the loop runs end to end locally.
 */
function emptyDraft(input: DraftInput): DraftResult {
  return {
    leadId: input.leadId,
    type: input.type,
    draftText: '',
    selfCheck: {
      test1ReplyOrDelete: true,
      test1Note: 'No message recommended.',
      test2NotGeneric: true,
      test2Note: 'Silence is the correct result.',
      codeChecks: {
        companyMentioned: false,
        specificEvidenceMentioned: false,
      },
    },
    passed: true,
    modelUsed: 'demo-local-deterministic',
    attempts: 1,
    strippedNumbers: [],
    hadEmDash: false,
    hadExclamation: false,
    requestedCall: false,
    callLog: [],
  }
}

function demoDraft(input: DraftInput, userPrompt: string): DraftResult {
  void userPrompt
  const signal = signalById(input.extracted.signalType)
  const play = pickPlayForSignal(input.plays, input.extracted.signalType)
  const factsTable = filterFacts(input.facts)
  const priceFact = factsTable.find((f) => f.factType === 'price')
  const lastSent = (input.history ?? [])
    .filter((m) => m.sentText && m.sentAt)
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
    .at(-1)

  const first = firstName(input.extracted.name)
  const greeting = input.styleCard?.greeting ?? 'Hey'
  const allowed = input.strategy?.allowedNow?.[0] ?? null
  const job = input.strategy?.messageJob ?? null
  const hireRole = inferRoleFromEvidence(input.extracted.signalEvidence, input.extracted.title)
  const noMessage = input.strategy?.contact?.messageRecommended === false

  let draft: string
  if (noMessage) {
    draft = ''
  } else if (input.type === 'reply') {
    draft = demoReplyDraft(input, first, greeting)
  } else if (input.type === 'followup') {
    const topic = /\bhiring\b/i.test(allowed ?? '') ? `that ${hireRole}` : (asTopic(allowed) ?? 'the earlier note')
    draft = `${greeting} ${first} - if ${topic} is still open, I can share one relevant example. If not, all good.`
  } else if (input.type === 'connection') {
    if (/\bhiring\b/i.test(`${input.extracted.signalEvidence ?? ''} ${allowed ?? ''}`)) {
      draft = `${greeting} ${first} — noticed the ${hireRole} search at ${input.lead.company}. I've done similar builds and it's a space I work in. Worth connecting.`
    } else if (allowed) {
      draft = `${greeting} ${first} — ${clipWords(asTopic(allowed) ?? stripProspectVoice(allowed), 10)} at ${input.lead.company} is close to work I've done. Seemed worth a connection.`
    } else {
      draft = `${greeting} ${first} — the ${input.lead.company} work is in a space I spend time in. Genuinely seemed worth connecting.`
    }
  } else if (job === 'TEST_DELIVERY_MODEL' || (input.extracted.signalType === 1 && /\bhiring\b/i.test(input.extracted.signalEvidence ?? ''))) {
    draft = `${greeting} ${first} - are you set on hiring for that ${hireRole} at ${input.lead.company}, or open to someone taking ownership of the build instead?`
  } else if (allowed) {
    draft = `${greeting} ${first} - is ${clipWords(asTopic(allowed) ?? stripProspectVoice(allowed), 12)} still the constraint at ${input.lead.company}?`
  } else if (signal && input.extracted.signalEvidence) {
    draft = `${greeting} ${first} — ${clipWords(input.extracted.signalEvidence, 16)}. Still the plan at ${input.lead.company}?`
  } else {
    draft = `${greeting} ${first} — is the ${input.lead.company} work still something you want outside help on?`
  }

  void lastSent
  void play
  void priceFact
  void userPrompt

  const sanitized = sanitizeDraft(draft, input.facts)

  return {
    leadId: input.leadId,
    type: input.type,
    draftText: sanitized.text,
    selfCheck: {
      test1ReplyOrDelete: true,
      test1Note: 'DEMO self-check: draft references a specific detail from the lead.',
      test2NotGeneric: true,
      test2Note: 'DEMO self-check: company and signal detail are embedded.',
      codeChecks: {
        companyMentioned: draft.toLowerCase().includes(input.lead.company.toLowerCase()),
        specificEvidenceMentioned: true,
      },
    },
    passed: sanitized.strippedNumbers.length === 0 && !sanitized.requestedCall,
    modelUsed: 'demo-local-deterministic',
    attempts: 1,
    strippedNumbers: sanitized.strippedNumbers,
    hadEmDash: sanitized.hadEmDash,
    hadExclamation: sanitized.hadExclamation,
    requestedCall: sanitized.requestedCall,
    callLog: [],
  }
}

/**
 * Only the facts relevant to this call go into the prompt, never the whole
 * table. Credentials, prices, and case facts are the drafting set; anything
 * tagged for a specific industry or play is included only when it matches
 * this lead's situation.
 */
const FACT_TYPE_RANK: Record<string, number> = {
  price: 0,
  credential: 1,
  case: 2,
}
function filterFacts(facts: Fact[]): Fact[] {
  const ranked = [...facts].sort((a, b) => {
    const ra = a.factType ? (FACT_TYPE_RANK[a.factType] ?? 10) : 10
    const rb = b.factType ? (FACT_TYPE_RANK[b.factType] ?? 10) : 10
    if (ra !== rb) return ra - rb
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  const selected: Fact[] = []
  let industryCount = 0
  let playCount = 0
  for (const f of ranked) {
    if (selected.length >= 14) break
    if (f.factType?.startsWith('industry:') && industryCount >= 2) continue
    if (f.factType?.startsWith('play:') && playCount >= 2) continue
    if (f.factType?.startsWith('industry:')) industryCount++
    if (f.factType?.startsWith('play:')) playCount++
    selected.push(f)
  }
  return selected
}

function extractCompanyFromUserPrompt(prompt: string): string | null {
  const m = prompt.match(/Company: (.+)/)
  return m?.[1]?.trim() ?? null
}

function extractEvidenceFromUserPrompt(prompt: string): string | null {
  const m = prompt.match(/Evidence: (.+)/)
  return m?.[1]?.trim() ?? null
}

function firstName(name: string | null | undefined): string {
  const part = (name ?? '').trim().split(/\s+/)[0]
  return part || 'there'
}

function clipWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length <= max) return words.join(' ')
  return words.slice(0, max).join(' ')
}

function stripProspectVoice(text: string): string {
  return text
    .replace(/^(we(?:'re| are)|i(?:'m| am))\s+hiring\b/i, 'hiring')
    .replace(/^(we(?:'re| are)|i(?:'m| am))\s+/i, '')
    .replace(/[.]+$/g, '')
    .trim()
}

function asTopic(text: string | null): string | null {
  if (!text) return null
  const cleaned = stripProspectVoice(text)
  const beforeIs = cleaned.split(/\b(?:is|are|was|were)\b/i)[0]?.trim()
  if (beforeIs && beforeIs.split(/\s+/).length >= 2 && beforeIs.length >= 8) return beforeIs
  return cleaned
}

function inferRoleFromEvidence(evidence: string | null | undefined, title: string | null | undefined): string {
  const text = `${evidence ?? ''} ${title ?? ''}`
  if (/\bfull[- ]stack\b/i.test(text)) return 'full-stack role'
  if (/\bfrontend|front-end|react\b/i.test(text)) return 'frontend role'
  if (/\bbackend|back-end|rails|node\b/i.test(text)) return 'backend role'
  if (/\bmobile|ios|android\b/i.test(text)) return 'mobile role'
  if (/\bdevops|sre|infra\b/i.test(text)) return 'infra role'
  if (/\bsenior\b/i.test(text)) return 'senior role'
  return 'role'
}

function demoReplyDraft(input: DraftInput, first: string, greeting: string): string {
  const context = input.conversationContext ?? ''
  const company = input.lead.company
  if (/already hired|role is filled|not interested/i.test(context)) {
    return `${greeting} ${first} — understood. Good luck with it.`
  }
  if (/\b(example|examples|portfolio|proof)\b/i.test(context) && /\b(rate|pricing|cost|how much)\b/i.test(context)) {
    const proof = input.matchedProof?.projectSummary ?? 'one close delivery example'
    return `${greeting} ${first} - I can share ${clipWords(proof, 12)}. Rate follows scope; if you say what you want owned, I can be specific.`
  }
  if (/\b(rate|pricing|cost|how much)\b/i.test(context)) {
    const price = input.facts.find((f) => f.factType === 'price')
    if (price) {
      return `${greeting} ${first} — ${price.label} is ${price.value}, scoped to a defined outcome. What do you want owned?`
    }
    return `${greeting} ${first} — I do not quote a rate before scope. What do you want owned at ${company}?`
  }
  if (/\b(example|examples|portfolio|proof)\b/i.test(context)) {
    const proof = input.matchedProof?.projectSummary ?? input.strategy?.allowedNow?.[0] ?? 'one close example'
    return `${greeting} ${first} — ${clipWords(proof, 18)}. Want me to send that?`
  }
  if (/\bnext quarter|later this year|maybe later\b/i.test(context)) {
    return `${greeting} ${first} — next quarter is fine. Want me to check back then, or is there a trigger I should watch?`
  }
  return `${greeting} ${first} — understood. What would be most useful to clarify first?`
}
