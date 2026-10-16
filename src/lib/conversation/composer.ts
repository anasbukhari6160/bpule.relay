import { generate as runtimeGenerate } from '@/lib/ai/runtime'
import { injectStyleCard } from '@/lib/style/inject'
import { ANTI_AI_RULES, FACTUALITY_RULES, VOICE_RULES } from '@/lib/ai/prompts'
import { accumulateEditSignals, computeEditDelta } from '@/lib/relay/edit-learning'
import type { LeadDetail, ScoutStore } from '@/lib/store/types'
import type { Profile, ProofItem } from '@/lib/domain/types'
import type { ComposeIntent, ComposeRationale, ConversationMemory, ConversationTurn } from './types'
import { awaitingOurReply, clip, renderTurns } from './thread'
import { DEAL_STAGE_LABEL, goalFor, type StageGoal } from './stage'
import { VERBATIM_WINDOW } from './memory'

/**
 * One writer for every LinkedIn message: connection note, first DM,
 * follow-up, reply, and free-form requests ("propose Tuesday", "shorter").
 *
 * Prompt layout is static-first: the system prompt is identical for every
 * lead and rep (rules + stage ladder), so OpenAI's automatic prompt caching
 * covers it; everything lead-specific sits in the user message.
 */

import { CONNECTION_NOTE_LIMIT } from './limits'

export { CONNECTION_NOTE_LIMIT }

const SYSTEM = `You write LinkedIn messages for a software development seller (the "Me" side) talking to a prospect (the "Client").
The purpose of every message is to move the deal one step forward: connection → conversation → qualified need → a short call → proposal → signed project. Write the single next message that does that job.

HOW TO WRITE
- Read the whole conversation context before writing. Never contradict or repeat what was already said. Never re-introduce yourself after the first message.
- If the client asked questions, answer them first, directly and concretely, before anything else.
- Use the client's own words and situation. No generic lines that could be sent to anyone.
- One message, one job, one question or call to action at most.
- Sound like a busy, competent person typing on LinkedIn: short sentences, plain words, no marketing language.
- Respect the word budget given. Shorter is better.
- When proposing a call: say why it helps THEM, keep it short (15-20 minutes), offer two concrete time options or ask what suits them.
- When the client is not interested or not ready, accept it gracefully. Never push, never guilt.
- Only claim experience, results, clients or numbers listed under "What I can claim". If nothing fits, do not claim anything.

${VOICE_RULES}
${FACTUALITY_RULES}
${ANTI_AI_RULES}
FORMATTING: no em dashes or en dashes, no emojis, no exclamation marks, no hashtags, no bullet lists, no subject lines, no signature. Greeting only on the first message of the thread ("Hi Name,").

Return JSON only:
{"message": "the message text", "goal": "the job of this message in a few words", "answers": ["each client question this message answers"], "nextStep": "what you want them to do next", "why": "one sentence for the seller on why this message"}`

export interface ComposeInput {
  intent: ComposeIntent
  /** Free-form instruction from the rep: "propose Tuesday 3pm", "answer pricing", "shorter". */
  instruction?: string | null
  /** Current draft to refine instead of writing from scratch. */
  previousText?: string | null
}

export interface ComposeContext {
  lead: LeadDetail
  thread: ConversationTurn[]
  memory: ConversationMemory
  profile: Profile | null
  styleCard: Parameters<typeof injectStyleCard>[0]
  proof: ProofItem[]
  edits: Array<{ originalText: string; editedText: string }>
}

export interface ComposeResult {
  text: string
  rationale: ComposeRationale
  issues: string[]
  model: string | null
  repaired: boolean
  fallback: boolean
}

interface RawCompose {
  message: string
  goal: string
  answers: string[]
  nextStep: string
  why: string
}

export async function loadComposeContext(
  store: ScoutStore,
  lead: LeadDetail,
  thread: ConversationTurn[],
  memory: ConversationMemory,
  profileId?: string | null,
): Promise<ComposeContext> {
  const profiles = await store.listProfiles().catch(() => [] as Profile[])
  const profile = profiles.find((p) => p.id === profileId)
    ?? profiles.find((p) => p.id === lead.senderProfileId)
    ?? profiles[0]
    ?? null
  const [voice, proof, edits] = await Promise.all([
    store.getVoiceProfile(profile?.id).catch(() => null),
    store.matchProofItems(lead.tags ?? [], 3, profile?.id ?? null).catch(() => [] as ProofItem[]),
    store.listRecentEdits(20).catch(() => []),
  ])
  return { lead, thread, memory, profile, styleCard: voice?.styleCard ?? null, proof, edits }
}

/** What the rep's past edits say about how they want messages written. */
export function editPreferences(edits: ComposeContext['edits']): string {
  if (edits.length < 2) return ''
  const signals = accumulateEditSignals(edits.map((e) => computeEditDelta(e.originalText, e.editedText)))
  const notes = [
    signals.prefersShorter && 'The seller usually shortens AI drafts: write tighter than the budget.',
    signals.prefersLonger && 'The seller usually adds detail: be a little more specific.',
    signals.formalityTrend === 'less_formal' && 'The seller makes drafts more casual.',
    signals.formalityTrend === 'more_formal' && 'The seller makes drafts more formal.',
    signals.avoidsProofs && 'The seller removes proof/case-study mentions unless asked.',
    signals.greetingStyle && `Preferred greeting: ${signals.greetingStyle}.`,
    signals.commonRemovals.length > 0 && `Phrases the seller deletes: ${signals.commonRemovals.slice(0, 5).map((p) => `"${p}"`).join(', ')}.`,
  ].filter(Boolean)
  const example = edits.find((e) => e.editedText.length < 600 && e.originalText.length < 600)
  return [
    ...notes,
    example ? `Example of an AI draft and what the seller actually sent:\nAI: ${clip(example.originalText, 400)}\nSent: ${clip(example.editedText, 400)}` : null,
  ].filter(Boolean).join('\n')
}

function intentLabel(intent: ComposeIntent): string {
  switch (intent) {
    case 'connection': return `LinkedIn connection request note (hard limit ${CONNECTION_NOTE_LIMIT} characters)`
    case 'dm': return 'first direct message after they accepted the connection'
    case 'followup': return 'follow-up after the client has not answered my last message'
    case 'reply': return 'reply to the client\'s latest message'
    case 'custom': return 'next message in this conversation'
  }
}

/** Everything the seller may claim, as plain text, for the claim check. */
export function claimableText(ctx: Pick<ComposeContext, 'profile' | 'proof'>): string {
  const p = ctx.profile
  return [
    p?.headline, p?.bio,
    ...(p?.primarySkills ?? []), ...(p?.secondarySkills ?? []), ...(p?.technologies ?? []),
    ...(p?.serviceCapabilities ?? []), ...(p?.differentiators ?? []), ...(p?.industries ?? []),
    ...ctx.proof.flatMap((x) => [x.projectSummary, x.reviewQuote ?? '', x.clientName ?? '', ...x.tags]),
  ].filter(Boolean).join('\n')
}

export function buildComposeUserPrompt(ctx: ComposeContext, input: ComposeInput, goal: StageGoal): string {
  const { lead, thread, memory, profile, proof } = ctx
  const canonical = lead.canonicalIntelligence as { scoreBreakdown?: { reasons?: string[] } } | null | undefined
  const window = thread.slice(-VERBATIM_WINDOW)
  const olderCount = thread.length - window.length
  const facts = memory.facts
  const proofLines = proof.slice(0, 3).map((p) =>
    `- ${clip(p.projectSummary, 220)}${p.clientNamed && p.permissionOnFile && p.clientName ? ` (client: ${p.clientName})` : ''}${p.reviewQuote ? ` Review: "${clip(p.reviewQuote, 140)}"` : ''}`,
  )
  const claims = [
    profile?.headline && `Headline: ${profile.headline}`,
    profile?.primarySkills?.length && `Skills: ${profile.primarySkills.slice(0, 8).join(', ')}`,
    profile?.serviceCapabilities?.length && `Services: ${profile.serviceCapabilities.slice(0, 6).join(', ')}`,
    profile?.differentiators?.length && `Differentiators: ${profile.differentiators.slice(0, 4).join('; ')}`,
    ...proofLines,
  ].filter(Boolean)

  const sections = [
    `MESSAGE TO WRITE: ${intentLabel(input.intent)}.`,
    `DEAL STAGE: ${DEAL_STAGE_LABEL[memory.stage]}.`,
    `JOB OF THIS MESSAGE: ${goal.goal}`,
    `WORD BUDGET: ${goal.wordBudget.min}-${goal.wordBudget.max} words.${input.intent === 'connection' ? ` Under ${CONNECTION_NOTE_LIMIT} characters.` : ''}`,
    goal.allowCallAsk
      ? 'CALL ASK: allowed. Propose a short call if it is the natural next step.'
      : 'CALL ASK: not yet. Do not ask for a call or meeting in this message.',
    '',
    `CLIENT: ${lead.contactName ?? 'Unknown name'}${lead.contactTitle ? `, ${lead.contactTitle}` : ''} at ${lead.company}.`,
    lead.signalEvidence ? `Why this lead: ${clip(lead.signalEvidence, 400)}` : null,
    canonical?.scoreBreakdown?.reasons?.length ? `Qualification notes: ${canonical.scoreBreakdown.reasons.slice(0, 3).join('; ')}` : null,
    '',
    `ME (the seller): ${profile?.displayName ?? profile?.fullName ?? profile?.label ?? 'the seller'}.`,
    claims.length ? `What I can claim:\n${claims.join('\n')}` : 'What I can claim: nothing specific. Do not claim experience or results.',
    '',
    memory.rollingSummary && olderCount > 0 ? `EARLIER IN THE CONVERSATION (summary of ${olderCount} older messages):\n${memory.rollingSummary}` : null,
    window.length
      ? `RECENT MESSAGES (oldest first):\n${renderTurns(window)}`
      : 'RECENT MESSAGES: none yet. This is the first message.',
    '',
    'WHAT WE KNOW ABOUT THE DEAL:',
    `- Need: ${facts.need ?? 'unknown'}`,
    `- Timeline: ${facts.timeline ?? 'unknown'}`,
    `- Budget: ${facts.budget ?? 'unknown'}`,
    `- Decision maker: ${facts.decisionMaker ?? 'unknown'}`,
    facts.objections.length ? `- Objections raised: ${facts.objections.join('; ')}` : null,
    facts.nextStepNotes ? `- Client on next steps: ${facts.nextStepNotes}` : null,
    facts.alreadyShared.length ? `- Already told them (do not repeat): ${facts.alreadyShared.join('; ')}` : null,
    facts.openQuestions.length ? `\nQUESTIONS THE CLIENT ASKED THAT MUST BE ANSWERED:\n${facts.openQuestions.map((q) => `- ${q}`).join('\n')}` : null,
    memory.lastClientAnalysis && awaitingOurReply(thread) ? `Client's latest intent: ${memory.lastClientAnalysis.intent} (${memory.lastClientAnalysis.sentiment}).` : null,
    '',
    editPreferences(ctx.edits) ? `HOW THIS SELLER LIKES MESSAGES:\n${editPreferences(ctx.edits)}` : null,
    injectStyleCard(ctx.styleCard) || null,
    input.previousText?.trim() ? `\nCURRENT DRAFT TO IMPROVE:\n${clip(input.previousText, 1500)}` : null,
    input.instruction?.trim() ? `\nSELLER'S INSTRUCTION (follow it unless it breaks the rules): ${clip(input.instruction, 400)}` : null,
  ]
  return sections.filter((s): s is string => typeof s === 'string').join('\n')
}

const CALL_ASK = /\b(call|zoom|meet(?:ing)?|hop on|jump on|catch up|15[- ]?min|20[- ]?min|calendar|calendly|book a time|schedule)\b/i
const BANNED = /\b(i came across your|i hope (this|you)|hope this finds you|i wanted to reach out|just following up|just checking in|circling back|touching base|bumping this|i'd love the opportunity|we specialize in|synergy|leverage our)\b/i

const CLAIM_LEAD = /\b(?:experience (?:with|in|building)|worked (?:with|on)|built|shipped|delivered|integrated|done (?:a )?(?:lot of )?(?:work )?with|familiar with|expert in|speciali[sz]e in)\s+((?:[A-Z][\w.+#-]*)(?:\s+[A-Z][\w.+#-]*)*)/g

/**
 * Named things the message claims experience with (capitalized after
 * "experience with", "built", "worked with"...) that appear nowhere in what
 * the seller may claim or in the client's own words.
 */
export function unsupportedClaims(text: string, allowedText: string): string[] {
  const allowed = allowedText.toLowerCase()
  const out: string[] = []
  for (const m of text.matchAll(CLAIM_LEAD)) {
    const subject = m[1].trim()
    const words = subject.split(/\s+/).filter((w) => w.length > 2 && !/^(The|This|That|Your|Their|A|An)$/.test(w))
    if (words.length === 0) continue
    if (!words.some((w) => allowed.includes(w.toLowerCase()))) out.push(subject)
  }
  return [...new Set(out)]
}

export function checkMessage(
  text: string,
  intent: ComposeIntent,
  goal: StageGoal,
  memory: ConversationMemory,
  thread: ConversationTurn[],
  answers: string[],
  claimable = '',
): string[] {
  const issues: string[] = []
  const t = text.trim()
  if (!t) return ['The message is empty.']
  const words = t.split(/\s+/).length
  if (intent === 'connection' && t.length > CONNECTION_NOTE_LIMIT) issues.push(`Connection notes must be under ${CONNECTION_NOTE_LIMIT} characters (this is ${t.length}).`)
  if (words > goal.wordBudget.max * 1.35) issues.push(`Too long: ${words} words, budget is ${goal.wordBudget.max}.`)
  if (/[—–]/.test(t)) issues.push('Uses an em/en dash.')
  if (/!/.test(t)) issues.push('Uses an exclamation mark.')
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) issues.push('Uses an emoji.')
  const banned = t.match(BANNED)
  if (banned) issues.push(`Uses a cliché: "${banned[0]}".`)
  if (!goal.allowCallAsk && CALL_ASK.test(t)) issues.push('Asks for a call before the client has shown interest.')
  if ((t.match(/\?/g) ?? []).length > 2) issues.push('Asks too many questions; keep one.')
  if (memory.facts.openQuestions.length > 0 && awaitingOurReply(thread) && answers.length === 0) {
    issues.push(`Does not answer the client's question(s): ${memory.facts.openQuestions.join(' | ')}`)
  }
  // The client mentioning a technology does not make claiming experience
  // with it true; only the seller's profile and proof do.
  const unsupported = unsupportedClaims(t, claimable)
  if (unsupported.length > 0) {
    issues.push(`Claims experience that is not in what I can claim: ${unsupported.join(', ')}. Remove the claim or ask instead.`)
  }
  const lastMine = [...thread].reverse().find((x) => x.role === 'me' && x.kind !== 'connection')
  if (lastMine && similarity(lastMine.text, t) > 0.6) issues.push('Repeats my previous message.')
  if (thread.some((x) => x.role === 'me' && x.kind !== 'connection') && /^(hi|hey|hello)\b[^,\n]*,/i.test(t) && intent !== 'dm') {
    // A greeting mid-thread is allowed but re-introducing yourself is not.
    if (/\b(my name is|i am a|i'm a)\b/i.test(t)) issues.push('Re-introduces the sender mid-conversation.')
  }
  return issues
}

function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z']{3,}/g) ?? [])
  const A = words(a)
  const B = words(b)
  if (A.size === 0 || B.size === 0) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / Math.min(A.size, B.size)
}

/** Mechanical cleanup the model sometimes misses. */
export function cleanMessage(text: string, intent: ComposeIntent, midThread = false): string {
  let t = text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/!+/g, '.')
    .replace(/\.\./g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim()
  // Mid-conversation, a "Hey Jordan," on every message reads like a bot.
  if (midThread) {
    const stripped = t.replace(/^(?:hi|hey|hello|dear)\s+[^,\n]{1,40},\s*/i, '')
    if (stripped !== t && stripped.length > 0) t = stripped.charAt(0).toUpperCase() + stripped.slice(1)
  }
  if (intent === 'connection' && t.length > CONNECTION_NOTE_LIMIT) {
    const cut = t.slice(0, CONNECTION_NOTE_LIMIT)
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '))
    t = (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut.slice(0, cut.lastIndexOf(' '))).trim()
  }
  return t
}

function fallbackMessage(ctx: ComposeContext, intent: ComposeIntent): string {
  const first = ctx.lead.contactName?.split(/\s+/)[0] ?? 'there'
  const q = ctx.memory.facts.openQuestions[0]
  switch (intent) {
    case 'connection':
      return `Hi ${first}, I work on software projects in the same space as ${ctx.lead.company} and would like to connect.`
    case 'dm':
      return `Thanks for connecting, ${first}. What is the main thing your team is trying to ship at ${ctx.lead.company} this quarter?`
    case 'followup':
      return `${first}, is this still something you are looking at, or has the priority shifted?`
    default:
      return q
        ? `Good question. Let me answer that properly: could you share a bit more about what you have in mind so I give you a useful answer?`
        : `Thanks ${first}. What would be the most useful next step on your side?`
  }
}

/**
 * Write the next message. Gate failures get one corrective rewrite; the
 * remaining issues (if any) are returned so the rep sees them, never hidden.
 */
export async function composeMessage(ctx: ComposeContext, input: ComposeInput): Promise<ComposeResult> {
  const goal = goalFor(ctx.memory.stage, input.intent, ctx.memory)
  const user = buildComposeUserPrompt(ctx, input, goal)
  // Live conversations get the stronger model; openers stay on the cheap tier.
  const live = ctx.thread.some((t) => t.role === 'client')
  const tier = live && (input.intent === 'reply' || input.intent === 'custom' || input.intent === 'followup') ? 'terra' : 'luna'

  const call = async (prompt: string): Promise<{ raw: RawCompose | null; model: string | null }> => {
    try {
      const res = await runtimeGenerate<RawCompose>({
        task: 'FAST_STRUCTURED',
        tier,
        system: SYSTEM,
        user: prompt,
        schema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            goal: { type: 'string' },
            answers: { type: 'array', items: { type: 'string' } },
            nextStep: { type: 'string' },
            why: { type: 'string' },
          },
          required: ['message', 'goal', 'answers', 'nextStep', 'why'],
          additionalProperties: false,
        },
        schemaName: 'composed_message',
        maxTokens: 900,
        timeoutMs: 25_000,
        temperature: input.previousText ? 0.5 : 0.7,
        promptVersion: 'conversation-compose-v1',
        skipCache: true,
        callSite: 'conversation/composer:composeMessage',
        feature: `conversation_${input.intent}`,
      })
      return { raw: res.data ?? null, model: res.trace?.model ?? null }
    } catch {
      return { raw: null, model: null }
    }
  }

  let { raw, model } = await call(user)
  let repaired = false
  const midThread = ctx.thread.some((t) => t.role === 'me' && t.kind !== 'connection')
  let text = raw?.message ? cleanMessage(String(raw.message), input.intent, midThread) : ''
  let answers = Array.isArray(raw?.answers) ? raw!.answers.map(String) : []
  const claimable = `${claimableText(ctx)}\n${ctx.lead.company}\n${ctx.lead.contactName ?? ''}`
  let issues = text ? checkMessage(text, input.intent, goal, ctx.memory, ctx.thread, answers, claimable) : ['No draft returned.']

  if (raw && issues.length > 0) {
    const retry = await call(`${user}\n\nYOUR PREVIOUS DRAFT:\n${text}\n\nIt broke these rules. Rewrite it so none apply:\n${issues.map((i) => `- ${i}`).join('\n')}`)
    if (retry.raw?.message) {
      const retryText = cleanMessage(String(retry.raw.message), input.intent, midThread)
      const retryAnswers = Array.isArray(retry.raw.answers) ? retry.raw.answers.map(String) : []
      const retryIssues = checkMessage(retryText, input.intent, goal, ctx.memory, ctx.thread, retryAnswers, claimable)
      if (retryIssues.length <= issues.length) {
        raw = retry.raw
        model = retry.model ?? model
        text = retryText
        answers = retryAnswers
        issues = retryIssues
        repaired = true
      }
    }
  }

  const fallback = !text
  if (fallback) {
    text = fallbackMessage(ctx, input.intent)
    issues = ['AI was unavailable; this is a plain template. Edit before sending.']
  }

  return {
    text,
    rationale: {
      goal: raw?.goal?.trim() || goal.goal,
      stage: ctx.memory.stage,
      answers,
      nextStep: raw?.nextStep?.trim() || '',
      why: raw?.why?.trim() || '',
    },
    issues,
    model,
    repaired,
    fallback,
  }
}
