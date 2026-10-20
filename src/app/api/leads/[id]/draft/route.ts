import type { ExtractedLead, OutreachStrategy, SafeFact, MatchedProof, Profile } from '@/lib/domain/types'
import { selectSenderProfile } from '@/lib/workspace/select-sender-profile'
import { computeScore } from '@/lib/score/rubric'
import { canonicalToLegacyScoreResult } from '@/lib/intelligence-v2/orchestrator'
import { streamDraft } from '@/lib/ai/draft-stream'
import type { DraftMessageType } from '@/lib/ai/draft'
import { selectFewShotExamples } from '@/lib/ai/few-shot'
import { embedText } from '@/lib/ai/embed'
import { mergeProofMatches } from '@/lib/ai/proof-match'
import { createScoutStore } from '@/lib/store'
import { sseStream } from '@/lib/sse/sse'
import { buildProfileIntelligence, matchProofToLead, classifyLeadFact } from '@/lib/relay/profile-intelligence'
import { createOutreachStrategy } from '@/lib/relay/outreach-strategy'
import {
  analyzeReply,
  buildReplyStrategy,
  buildConversationContext,
  buildDeterministicConversationSummary,
  getNextStage,
} from '@/lib/relay/conversation-engine'
import { determineFollowup, buildFollowupPrompt } from '@/lib/relay/followup-engine'
import { resolveConversationIntent } from '@/lib/conversation/intent'
import {
  applyRevenueStrategyToOutreach,
  buildRevenueStrategy,
  shouldWriteMessage,
  sourceFromLead,
} from '@/lib/relay/revenue-strategy'

export const maxDuration = 120

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { type?: string; profileId?: string; proofId?: string; replyToMessageId?: string; replyText?: string; generationMode?: 'standard' | 'premium' }
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const type = body.type ?? 'dm'
  const profileId = body.profileId ?? null
  const proofId = body.proofId ?? null
  const generationMode = body.generationMode === 'premium' ? 'premium' : 'standard'

  if (!['dm', 'connection', 'upwork', 'followup', 'reply'].includes(type)) {
    return new Response(JSON.stringify({ error: 'Unknown message type.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (type === 'reply' && !body.replyToMessageId && !body.replyText?.trim()) {
    return new Response(
      JSON.stringify({ error: 'Reply drafting requires replyToMessageId or replyText.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let store
  try {
    store = await createScoutStore()
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'Not signed in.',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const detail = await store.getLead(id)
  if (!detail) {
    return new Response(JSON.stringify({ error: 'Lead not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  // BUG-15: Allow draft generation on locked leads. Drafts don't modify data;
  // the actual send action goes through /contact which handles locking.

  const rulebook = await store.getRulebook()

  return sseStream(async (emit) => {
    const [facts, plays, profiles, fewShotPool] = await Promise.all([
      store.listFacts(),
      store.listPlays(),
      store.listProfiles(),
      store.listFewShotWins(50),
    ])

    const leadRevenueIdentityId = detail.revenueIdentityId ?? null
    // Priority: explicit param → lead's stored sender_profile_id → revenue
    // identity match → first profile. The workspace identity is a fallback
    // only; it never replaces the sender stored on the lead (REL-QA-015).
    const selection = selectSenderProfile(
      profiles as Array<Profile & { revenueIdentityId?: string | null }>,
      { senderProfileId: detail.senderProfileId, revenueIdentityId: leadRevenueIdentityId },
      profileId,
    )
    const selectedProfile = selection.profile
    if (selection.crossWorkspace) {
      emit({ type: 'status', message: 'Warning: selected profile belongs to a different Revenue Identity than this lead.' })
    }

    const profile = selectedProfile
    const voiceProfile = await store.getVoiceProfile(profile?.id)

    const extracted: ExtractedLead = {
      name: detail.contactName,
      title: detail.contactTitle,
      titleRaw: detail.titleRaw ?? detail.contactTitle,
      company: detail.company,
      url: detail.url,
      locationRaw: detail.locationRaw ?? null,
      roleCategory: detail.roleCategory ?? undefined,
      marketRegion: detail.marketRegion ?? undefined,
      extractionConfidence: detail.extractionConfidence ?? undefined,
      confidenceNotes:
        ((detail.extractionProfile as { confidenceNotes?: string[] } | null)
          ?.confidenceNotes as string[] | undefined) ?? [],
      signalType: detail.signalType ?? 7,
      signalEvidence: detail.signalEvidence ?? '',
      verbatimQuote: detail.verbatimQuote,
      tags: detail.tags ?? [],
    }

    // Canonical Intelligence V2 is the source of truth once a lead has been
    // scored through it — see canonicalToLegacyScoreResult() for why we never
    // recompute a second, independent score here.
    const score = canonicalToLegacyScoreResult(detail)
      ?? computeScore(extracted, rulebook!, detail.rawInput ? { sourceText: detail.rawInput } : {})

    const tagMatches = await store.matchProofItems(detail.tags ?? [], 8, profile?.id ?? null)
    let matched = tagMatches

    if (proofId) {
      const explicit = matched.find((p) => p.id === proofId) ?? null
      if (explicit) matched = [explicit, ...matched.filter((p) => p.id !== proofId)]
    }
    if (matched.length > 0) emit({ type: 'proof', items: matched })

    const embedTextPromise = embedText(
      `${detail.company} ${detail.signalEvidence ?? ''} ${Array.isArray(detail.tags) ? detail.tags.join(' ') : ''}`,
    ).then(async (leadEmbedding) => {
      const semanticMatches = await store.matchProofItemsByEmbedding(leadEmbedding, 8, profile?.id ?? null)
      const merged = mergeProofMatches(semanticMatches, tagMatches, 8)
      emit({ type: 'proof', items: merged })
    }).catch(() => {})

    const fewShotSelection = selectFewShotExamples(fewShotPool, { leadId: detail.id, lead: detail, extracted, score, type: type as DraftMessageType, styleCard: voiceProfile?.styleCard ?? null, facts, plays, history: detail.messages, profile, matchedProof: matched[0] ?? null }, plays)

    let strategy: OutreachStrategy | null = null
    let safeFacts: SafeFact[] = []
    let matchedProofCards: MatchedProof[] = []
    let conversationContext: string | null = null
    let replyStrategy: ReturnType<typeof buildReplyStrategy> | null = null

    if (profile) {
      const profileIntelligence = buildProfileIntelligence(profile, [])
      matchedProofCards = matchProofToLead(profileIntelligence, detail.tags ?? [], 3)
      safeFacts = [classifyLeadFact(detail.signalEvidence ?? '', detail.signalEvidence ?? '', detail.signalType ?? null)]
      void profileIntelligence

      if (type === 'followup') {
        const followup = determineFollowup({
          lead: detail,
          priorMessages: detail.messages,
          conversationStage: detail.status,
          senderProfileId: profile.id,
          followupCount: detail.followupCount ?? 0,
          lastSentAt: detail.messages.filter((m) => m.sentAt).sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? '')).at(-1)?.sentAt ?? null,
          lastReplyAt: null,
        })
        if (!followup.shouldFollowUp) {
          emit({ type: 'error', message: followup.waitReason ?? followup.reason })
          return
        }
        conversationContext = buildFollowupPrompt({
          lead: detail,
          priorMessages: detail.messages,
          conversationStage: detail.status,
          senderProfileId: profile.id,
          followupCount: detail.followupCount ?? 0,
          lastSentAt: detail.messages.filter((m) => m.sentAt).at(-1)?.sentAt ?? null,
          lastReplyAt: null,
        }, followup)
      }

      const alreadyShared = detail.messages
        .filter((m) => m.sentText)
        .map((m) => m.sentText as string)

      let replyKnowledge: ReturnType<typeof analyzeReply>['knowledge'] | null = null
      if (type === 'reply') {
        let prospectReplyMsg = body.replyToMessageId && body.replyToMessageId !== 'manual'
          ? detail.messages.find((m) => m.id === body.replyToMessageId) ?? null
          : null
        let prospectReply = body.replyText?.trim() || prospectReplyMsg?.sentText || prospectReplyMsg?.draftText || ''
        // Fallback: if no explicit reply text, use the latest inbound message
        if (!prospectReply) {
          const latestInbound = detail.messages
            .filter((m) => m.direction === 'inbound' && m.sentText)
            .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0]
          if (latestInbound) {
            prospectReply = latestInbound.sentText || ''
            prospectReplyMsg = latestInbound  // ensure priorMessages filter works
          }
        }

        if (prospectReply) {
          // A pasted reply (no stored message) is the newest turn, so every
          // stored message is prior context — '' as the bound hid them all.
          const priorMessages = detail.messages.filter((m) => m.sentAt && m.sentAt < (prospectReplyMsg?.sentAt ?? new Date().toISOString()))
          const convStage = detail.status === 'followed_up' ? 'contacted' : detail.status === 'new' ? 'new' : detail.status === 'contacted' ? 'contacted' : detail.status === 'replied' ? 'replied' : detail.status === 'no' ? 'lost' : detail.status === 'dead' ? 'lost' : 'contacted'
          const replyAnalysis = analyzeReply(prospectReply, {
            leadId: detail.id,
            leadCompany: detail.company,
            contactName: detail.contactName,
            replyText: prospectReply,
            priorMessages,
            conversationStage: convStage,
            senderProfileId: profile.id,
          })
          // The conversation's latest explicit meaning, not just this message:
          // "ok bye" after "not interested" is still a rejection → graceful close.
          const conversationIntent = resolveConversationIntent([
            ...detail.messages
              .filter((m) => m.direction === 'inbound' && m.sentText && m.sentAt && m.sentAt < (prospectReplyMsg?.sentAt ?? '9999'))
              .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
              .map((m) => m.sentText ?? ''),
            prospectReply,
          ])
          if (conversationIntent.declined) {
            replyAnalysis.intent = 'not_interested'
            replyAnalysis.sentiment = 'negative'
            replyAnalysis.buyingSignal = false
            replyAnalysis.nextBestAction = 'graceful_close'
          }
          replyKnowledge = replyAnalysis.knowledge
          replyStrategy = buildReplyStrategy(replyAnalysis, {
            leadId: detail.id,
            leadCompany: detail.company,
            contactName: detail.contactName,
            replyText: prospectReply,
            priorMessages,
            conversationStage: convStage,
            senderProfileId: profile.id,
          }, null)
          const replyContext = buildConversationContext({
            leadId: detail.id,
            leadCompany: detail.company,
            contactName: detail.contactName,
            replyText: prospectReply,
            priorMessages,
            conversationStage: convStage,
            senderProfileId: profile.id,
          }, replyAnalysis)
          conversationContext = [
            `## Reply Strategy`,
            ``,
            `**Job:** ${replyStrategy.messageJob}`,
            `**Move:** ${replyStrategy.nextMove}`,
            `**Goal:** ${replyStrategy.goal}`,
            `**Approach:** ${replyStrategy.approach}`,
            `**Tone:** ${replyStrategy.tone}`,
            `**CTA:** ${replyStrategy.ctaStrategy}`,
            ``,
            replyContext,
          ].join('\n')
          try {
            await store.upsertConversationState({
              leadId: detail.id,
              stage: getNextStage(convStage, replyAnalysis),
              lastStrategy: replyStrategy.messageJob,
              lastAngle: replyAnalysis.intent,
              lastCta: replyStrategy.ctaStrategy,
              commercialState: replyAnalysis.knowledge as unknown as Record<string, unknown>,
            })
            await store.emitRelayEvent({
              eventType: 'REPLY_PREPARED',
              entityType: 'lead',
              entityId: detail.id,
              actorType: 'system',
              payload: {
                intent: replyAnalysis.intent,
                messageJob: replyStrategy.messageJob,
                nextMove: replyStrategy.nextMove,
                newFacts: replyAnalysis.knowledge.newFacts,
              },
              source: 'app',
              sourceEventId: `reply_prepared:${detail.id}:${Date.now()}`,
            })
          } catch {
            // Non-fatal
          }
        } else {
          const priorMessages = detail.messages.filter((m) => m.sentText)
          const convStage = detail.status === 'followed_up' ? 'contacted' : detail.status === 'new' ? 'new' : detail.status === 'contacted' ? 'contacted' : detail.status === 'replied' ? 'replied' : detail.status === 'no' ? 'lost' : detail.status === 'dead' ? 'lost' : 'contacted'
          const summary = buildDeterministicConversationSummary({
            leadId: detail.id,
            leadCompany: detail.company,
            contactName: detail.contactName,
            replyText: '',
            priorMessages,
            conversationStage: convStage,
            senderProfileId: profile.id,
          })
          conversationContext = [
            '## Deterministic conversation summary (pre-generation)',
            summary,
            '',
            'Write a helpful, direct reply to the prospect. Answer any open question first. Do not repeat bio/proof facts already sent unless they asked again.',
          ].join('\n')
        }
      }

      const revenue = buildRevenueStrategy(sourceFromLead(detail, extracted, {
        channel: type === 'followup' ? 'followup' : type === 'connection' ? 'connection' : type === 'reply' ? 'reply' : type === 'upwork' ? 'upwork' : 'dm',
        relationshipStage: type === 'followup' ? 'followup' : type === 'reply' ? 'reply' : 'first_touch',
        alreadyShared,
        conversation: replyKnowledge,
        priorFollowupCount: detail.status === 'followed_up' ? 1 : 0,
        connectionAccepted: Boolean(detail.connectionAcceptedAt),
      }))

      if (type !== 'reply' && !shouldWriteMessage(revenue)) {
        if (type === 'connection') {
          // Connection notes are always allowed — they earn access
          revenue.contact.messageRecommended = true
          revenue.messageJob = 'EARN_CONNECTION'
        } else {
          emit({
            type: 'status',
            message: `${revenue.contact.noMessageReason ?? 'No message recommended.'} Generating anyway — edit before sending.`,
          })
          revenue.contact.messageRecommended = true
          revenue.messageJob = 'DISCOVER_NEED'
        }
      }

      strategy = applyRevenueStrategyToOutreach(
        createOutreachStrategy({
          leadCompany: detail.company,
          contactName: detail.contactName,
          contactTitle: detail.contactTitle,
          signalType: detail.signalType ?? null,
          signalEvidence: detail.signalEvidence ?? '',
          verbatimQuote: detail.verbatimQuote,
          tags: detail.tags ?? [],
          safeFacts,
          senderProfile: profile,
          matchedProof: matchedProofCards,
          channel: type === 'upwork' ? 'upwork' : type === 'connection' ? 'connection' : 'dm',
          relationshipStage: type === 'followup' ? 'followup' : type === 'reply' ? 'reply' : 'first_touch',
        }),
        revenue,
      )
      if (type !== 'reply') {
        try {
          await store.emitRelayEvent({
            eventType: type === 'followup' ? 'FOLLOWUP_PREPARED' : 'OUTREACH_PREPARED',
            entityType: 'lead',
            entityId: detail.id,
            actorType: 'system',
            payload: {
              type,
              messageJob: revenue.messageJob,
              contactAction: revenue.contact.action,
              fit: revenue.assessment.fit,
              intent: revenue.assessment.intent,
            },
            source: 'app',
            sourceEventId: `${type}_prepared:${detail.id}:${Date.now()}`,
          })
        } catch {
          // Non-fatal
        }
      }
    }

    const draftStrategy: OutreachStrategy | null = type === 'reply' && replyStrategy && strategy
      ? {
          ...strategy,
          messageJob: replyStrategy.messageJob,
          contact: { ...strategy.contact, messageRecommended: true, action: 'CONTACT_NOW' as const, reason: 'RELATIONSHIP_CONTEXT' as const },
        } as OutreachStrategy
      : strategy

    const draftStarted = Date.now()
    let draftResult: Awaited<ReturnType<typeof streamDraft>>
    try {
      draftResult = await streamDraft(
        {
          leadId: detail.id,
          lead: detail,
          extracted,
          score,
          type: type as DraftMessageType,
          styleCard: voiceProfile?.styleCard ?? null,
          facts,
          plays,
          history: detail.messages,
          profile,
          matchedProof: matched[0] ?? null,
          fewShotExamples: fewShotSelection.examples.map((e) => ({
            company: e.company,
            signalEvidence: e.signalEvidence ?? '',
            sentText: e.sentText,
          })),
          strategy: draftStrategy,
          safeFacts,
          matchedProofCards,
          conversationContext: conversationContext ?? undefined,
        },
        emit,
        matched[0] ?? null,
        profile ?? null,
        generationMode,
      )
    } catch (draftErr) {
      const message = draftErr instanceof Error ? draftErr.message : 'Drafting failed.'
      if (/STRATEGY_REQUIRED/i.test(message)) {
        emit({
          type: 'error',
          message: 'No message recommended for this prospect. Silence is the correct result.',
        })
        return
      }
      throw draftErr
    }

    // Do NOT persist a draft row — the generated text lives only in the
    // component state until the user explicitly logs it as sent via /contact.
    // Saving drafts pollutes the timeline (shows "Draft" entries) and breaks
    // the state machine (latestMessage filters by sentText, ignoring drafts).
    if (profile) {
      try {
        await store.updateLeadSenderProfile(detail.id, profile.id)
      } catch {
        // Non-fatal
      }
      if (leadRevenueIdentityId) {
        try {
          await store.updateLeadRevenueIdentity(detail.id, leadRevenueIdentityId)
        } catch {
          // Non-fatal
        }
      }
    }

    const draftLatencyMs = Date.now() - draftStarted
    for (const call of draftResult.callLog) {
      try {
        await store.logExtractionRun({
          task: 'draft',
          success: true,
          latencyMs: draftLatencyMs,
          model: call.host,
          costTier: call.costTier,
          host: call.host,
          costUsd: call.estimatedCostUsd,
        })
      } catch {
        // Metrics logging must never break drafting.
      }
    }
  })
}
