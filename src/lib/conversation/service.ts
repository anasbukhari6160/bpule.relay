import { displayContactName } from '@/lib/prospect/paste-normalize'
import type { LeadDetail, ScoutStore } from '@/lib/store/types'
import type { MessageType } from '@/lib/domain/types'
import { deriveNextLeadAction, type LeadActionResult } from '@/lib/relay/lead-state-machine'
import { computeEditDelta, classifySendDisposition, inferFeedbackReasons } from '@/lib/relay/edit-learning'
import type { ComposeIntent, ComposerDraft, ConversationMemory, ConversationTurn } from './types'
import { awaitingOurReply, buildThread } from './thread'
import { refreshMemory } from './memory'
import { composeMessage, loadComposeContext, type ComposeInput, type ComposeResult } from './composer'
import { DEAL_STAGE_LABEL } from './stage'

export interface ConversationView {
  leadId: string
  contactName: string | null
  contactTitle: string | null
  company: string
  url: string | null
  status: LeadDetail['status']
  thread: ConversationTurn[]
  memory: ConversationMemory
  stageLabel: string
  draft: ComposerDraft | null
  nextAction: LeadActionResult
  suggestedIntent: ComposeIntent
  awaitingReply: boolean
}

export function suggestedIntentFor(action: LeadActionResult['action']): ComposeIntent {
  switch (action) {
    case 'SEND_CONNECTION': return 'connection'
    case 'SEND_DM': return 'dm'
    case 'SEND_FOLLOWUP': return 'followup'
    case 'SEND_REPLY': return 'reply'
    default: return 'custom'
  }
}

/**
 * Process-local copy of memory, used when the database has no memory column
 * yet (migration not applied) so a page load does not re-pay for analysis.
 */
const memoryCache = new Map<string, ConversationMemory>()
const MEMORY_CACHE_MAX = 500

function cacheMemory(leadId: string, memory: ConversationMemory) {
  if (memoryCache.size >= MEMORY_CACHE_MAX) memoryCache.delete(memoryCache.keys().next().value as string)
  memoryCache.set(leadId, memory)
}

/** Load the conversation and bring its memory up to date (cheap when nothing changed). */
export async function loadConversation(store: ScoutStore, leadId: string): Promise<{ view: ConversationView; lead: LeadDetail } | null> {
  const lead = await store.getLead(leadId)
  if (!lead) return null
  const state = await store.getConversationState(leadId).catch(() => null)
  const thread = buildThread(lead)
  const stored = state?.memory ?? memoryCache.get(leadId) ?? null
  const { memory, changed } = await refreshMemory(lead, thread, stored, state?.stage ?? null)
  cacheMemory(leadId, memory)
  if (changed) {
    try {
      await store.upsertConversationState({ leadId, memory })
    } catch {
      // Memory persistence is best-effort; the view still uses the fresh copy.
    }
  }
  const nextAction = deriveNextLeadAction(lead)
  return {
    lead,
    view: {
      leadId,
      contactName: displayContactName(lead.contactName),
      contactTitle: lead.contactTitle,
      company: lead.company,
      url: lead.url,
      status: lead.status,
      thread,
      memory,
      stageLabel: DEAL_STAGE_LABEL[memory.stage],
      draft: state?.composerDraft ?? null,
      nextAction,
      suggestedIntent: suggestedIntentFor(nextAction.action),
      awaitingReply: awaitingOurReply(thread),
    },
  }
}

export async function composeForLead(
  store: ScoutStore,
  leadId: string,
  input: ComposeInput & { profileId?: string | null },
): Promise<{ result: ComposeResult; draft: ComposerDraft } | null> {
  const loaded = await loadConversation(store, leadId)
  if (!loaded) return null
  const ctx = await loadComposeContext(store, loaded.lead, loaded.view.thread, loaded.view.memory, input.profileId)
  const result = await composeMessage(ctx, input)
  const previous = loaded.view.draft
  const draft: ComposerDraft = {
    intent: input.intent,
    text: result.text,
    // Keep the first AI text of this draft session as the learning baseline
    // when the rep is refining, so "refine" rounds aren't counted as edits.
    originalText: input.previousText && previous?.originalText ? previous.originalText : result.text,
    rationale: result.rationale,
    updatedAt: new Date().toISOString(),
  }
  try {
    await store.upsertConversationState({ leadId, composerDraft: draft })
  } catch {
    // Draft persistence is best-effort.
  }
  return { result, draft }
}

export async function saveDraft(store: ScoutStore, leadId: string, text: string, intent: ComposeIntent): Promise<ComposerDraft | null> {
  const state = await store.getConversationState(leadId).catch(() => null)
  const existing = state?.composerDraft ?? null
  if (!text.trim()) {
    await store.upsertConversationState({ leadId, composerDraft: null })
    return null
  }
  const draft: ComposerDraft = {
    intent,
    text,
    originalText: existing?.originalText ?? null,
    rationale: existing?.rationale ?? null,
    updatedAt: new Date().toISOString(),
  }
  await store.upsertConversationState({ leadId, composerDraft: draft })
  return draft
}

/** Which logged message type a composed message is, given where the thread is. */
export function messageTypeFor(intent: ComposeIntent, thread: ConversationTurn[]): MessageType {
  if (intent !== 'custom') return intent
  if (awaitingOurReply(thread) || thread.some((t) => t.role === 'client')) return 'reply'
  return 'dm'
}

export interface SendOutcome {
  ok: boolean
  error?: string
  status?: number
  messageId?: string | null
}

/**
 * Log a message the rep sent on LinkedIn. Same pipeline as the contact route
 * (limits, locks, events, accountability) plus edit learning against the
 * AI's original text, and the draft is cleared.
 */
export async function logSentMessage(
  store: ScoutStore,
  leadId: string,
  text: string,
  intent: ComposeIntent,
  idempotencyKey?: string | null,
): Promise<SendOutcome> {
  const lead = await store.getLead(leadId)
  if (!lead) return { ok: false, error: 'Lead not found.', status: 404 }
  const sentText = text.trim()
  const type = messageTypeFor(intent, buildThread(lead))
  if (!sentText && type !== 'connection') return { ok: false, error: 'Write the message you sent.', status: 400 }

  const state = await store.getConversationState(leadId).catch(() => null)
  const originalDraft = state?.composerDraft?.originalText?.trim() || sentText
  const disposition = classifySendDisposition(originalDraft, sentText, false)
  const rejectReasons = inferFeedbackReasons(originalDraft, sentText, disposition)

  const result = await store.markContacted(leadId, sentText, type, {
    originalDraft,
    sendDisposition: disposition,
    rejectReasons,
    idempotencyKey: idempotencyKey?.trim() || null,
  })
  if (!result.allowed) return { ok: false, error: result.message ?? 'Send limit reached.', status: 429 }

  if (!result.idempotent && state?.composerDraft?.originalText) {
    try {
      const delta = computeEditDelta(originalDraft, sentText)
      await store.logEditLearning({
        messageId: result.messageId ?? null,
        originalText: originalDraft,
        editedText: sentText,
        editDistance: delta.editDistance,
        lengthDelta: delta.lengthDelta,
        greetingChanged: delta.greetingChanged,
        ctaChanged: delta.ctaChanged,
        proofRemoved: delta.proofRemoved,
        madeShorter: delta.madeShorter,
        madeLonger: delta.madeLonger,
        formalityShift: delta.formalityShift,
        sendDisposition: disposition,
        rejectReasons,
      })
    } catch {
      // Learning must never block the send.
    }
  }

  try {
    await store.upsertConversationState({ leadId, composerDraft: null })
  } catch {
    // ignore
  }
  return { ok: true, messageId: result.messageId ?? null }
}
