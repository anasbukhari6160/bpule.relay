/**
 * Intelligence Dataset Service — hardened, append-only.
 *
 * intelligence_samples = immutable analysis snapshot.
 * intelligence_sample_events = append-only lifecycle log (never rewritten).
 *
 * All capture functions are best-effort: failures are logged + recorded on the
 * sample but never throw to the caller. Idempotency keys prevent double-capture.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeForHash } from '@/lib/intelligence-v2/input-hash'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'
import type {
  CaptureFailure,
  CreateSampleInput,
  FunnelStage,
  HumanEdit,
  HumanFeedback,
  IntelligenceSample,
  LabelSource,
  LabelStatus,
  Platform,
  SampleEventType,
} from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SHA-256 of the whitespace-normalised source. The same function as the
 * scoring program's opportunityKey, so a sample, a lead and a captured
 * prospect of one paste share one hash. Never stores source text.
 */
export function hashRawInput(raw: string): string {
  return opportunityKey(raw) ?? createHash('sha256').update(normalizeForHash(raw ?? '')).digest('hex')
}

function tbl(client: SupabaseClient) {
  return client.from('intelligence_samples')
}

function eventsTbl(client: SupabaseClient) {
  return client.from('intelligence_sample_events')
}

/**
 * Best-effort capture wrapper. Logs structured error, records failure on sample,
 * never throws.
 */
async function safeCapture(
  client: SupabaseClient,
  sampleId: string | null,
  stage: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[dataset:capture] ${stage} failed for ${sampleId ?? 'unknown'}: ${message}`)

    if (sampleId) {
      try {
        // Append failure to sample's capture_failures array (best-effort)
        const failure: CaptureFailure = {
          stage,
          message: message.slice(0, 500),
          timestamp: new Date().toISOString(),
          sampleId,
        }
        // Read current failures, append, update
        const { data: current } = await tbl(client).select('capture_failures').eq('id', sampleId).maybeSingle()
        const failures: CaptureFailure[] = (current?.capture_failures as CaptureFailure[] | null) ?? []
        failures.push(failure)
        await tbl(client).update({
          capture_failures: failures,
          last_capture_error: message.slice(0, 500),
        }).eq('id', sampleId)
      } catch { /* swallow — don't cascade */ }
    }
  }
}

// ── Sample creation ──────────────────────────────────────────────────────────

export async function createSample(
  client: SupabaseClient,
  input: CreateSampleInput,
): Promise<string | null> {
  const hash = input.rawInput ? hashRawInput(input.rawInput) : null

  // Compute version safely: unique constraint on (lead_id, version) prevents races
  let version = 1
  if (input.leadId) {
    const { data: maxRow } = await tbl(client)
      .select('version')
      .eq('lead_id', input.leadId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    version = (maxRow?.version as number ?? 0) + 1
  }

  const { data, error } = await tbl(client).insert({
    organization_id: input.organizationId,
    lead_id: input.leadId ?? null,
    upwork_job_id: input.upworkJobId ?? null,
    platform: input.platform,
    source_type: input.sourceType ?? null,
    version,
    funnel_stage: 'EXTRACTION',
    raw_input: input.rawInput ?? null,
    raw_input_hash: hash,
    label_status: 'AI_ONLY',
    label_source: 'ai',
    training_eligible: false,
    training_approved: false,
    needs_review: false,
  }).select('id').single()

  if (error) {
    console.error('[dataset] createSample failed:', error.message)
    return null
  }

  // Link to lead (best-effort)
  if (input.leadId && data?.id) {
    try {
      await client.from('leads').update({ latest_sample_id: data.id }).eq('id', input.leadId)
    } catch { /* best-effort */ }
  }

  return data.id
}

// ── Event appending (append-only, idempotent) ───────────────────────────────

async function appendEvent(
  client: SupabaseClient,
  sampleId: string,
  eventType: SampleEventType,
  payload: Record<string, unknown>,
  actor: string | null = null,
  idempotencyKey?: string,
): Promise<void> {
  await eventsTbl(client).insert({
    sample_id: sampleId,
    event_type: eventType,
    payload,
    actor,
    idempotency_key: idempotencyKey ?? null,
  })
}

// ── Funnel stage capture ─────────────────────────────────────────────────────

interface ScoreCapture {
  canonicalScore: number
  displayScore: number
  qualification: string
  scoreDimensions: unknown[]
  confidence: number
  recommendedAction: string
  resolvedDecision?: Record<string, unknown>
  modelRawOutput?: Record<string, unknown>
  sourceFacts?: Record<string, unknown>
  rejectedSignals?: unknown[]
  evidenceLedger?: unknown[]
  extractedIdentity?: Record<string, unknown>
  decisionRunId?: string
  scoringVersion?: string
  sourceFactsVersion?: string
  buyerIntentVersion?: string
  attributionVersion?: string
  promptVersion?: string
  modelVersion?: string
}

export async function captureScore(
  client: SupabaseClient,
  sampleId: string,
  score: ScoreCapture,
): Promise<void> {
  await safeCapture(client, sampleId, 'SCORE', async () => {
    // 1. Update immutable snapshot fields (set once, never change again)
    await tbl(client).update({
      funnel_stage: 'SCORE',
      canonical_score: score.canonicalScore,
      display_score: score.displayScore,
      qualification: score.qualification,
      score_dimensions: score.scoreDimensions ?? [],
      confidence: score.confidence,
      recommended_action: score.recommendedAction,
      resolved_decision: score.resolvedDecision ?? null,
      model_raw_output: score.modelRawOutput ?? null,
      source_facts: score.sourceFacts ?? null,
      rejected_signals: score.rejectedSignals ?? [],
      evidence_ledger: score.evidenceLedger ?? [],
      extracted_identity: score.extractedIdentity ?? null,
      decision_run_id: score.decisionRunId ?? null,
      scoring_version: score.scoringVersion ?? null,
      source_facts_version: score.sourceFactsVersion ?? null,
      buyer_intent_version: score.buyerIntentVersion ?? null,
      attribution_version: score.attributionVersion ?? null,
      prompt_version: score.promptVersion ?? null,
      model_version: score.modelVersion ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    // 2. Append event (idempotent)
    const idemKey = `score:${sampleId}:${score.scoringVersion ?? 'v1'}`
    await appendEvent(client, sampleId, 'SCORE_CAPTURED', {
      canonical_score: score.canonicalScore,
      qualification: score.qualification,
      confidence: score.confidence,
    }, null, idemKey)

    // 3. Auto-flag low-confidence for review
    if (score.confidence < 0.45) {
      await flagForReview(client, sampleId)
    }
  })
}

interface RoutingCapture {
  senderRankings: Array<{ senderId: string; name: string | null; profileMatch: number; reasons: string[] }>
  bestSenderId: string | null
  currentSenderId: string | null
  routingVersion?: string
}

export async function captureRouting(
  client: SupabaseClient,
  sampleId: string,
  routing: RoutingCapture,
): Promise<void> {
  await safeCapture(client, sampleId, 'ROUTING', async () => {
    await tbl(client).update({
      funnel_stage: 'ROUTING',
      sender_rankings: routing.senderRankings,
      best_sender_id: routing.bestSenderId,
      current_sender_id: routing.currentSenderId,
      routing_version: routing.routingVersion ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'ROUTING_CAPTURED', {
      best_sender_id: routing.bestSenderId,
      rankings_count: routing.senderRankings.length,
    }, null, `routing:${sampleId}:${routing.routingVersion ?? 'v1'}`)
  })
}

interface MessageCapture {
  connectionNote?: string
  firstDm?: string
  followupDrafts?: string[]
  replyDrafts?: string[]
  upworkCoverLetter?: string
  screeningAnswers?: Array<{ question: string; answer: string }>
  generatedText?: string
  messageStage?: string
  senderProfileId?: string
}

export async function captureMessageGeneration(
  client: SupabaseClient,
  sampleId: string,
  msg: MessageCapture,
): Promise<void> {
  await safeCapture(client, sampleId, 'MESSAGE_GENERATION', async () => {
    await tbl(client).update({
      funnel_stage: 'MESSAGE_GENERATION',
      connection_note: msg.connectionNote ?? null,
      first_dm: msg.firstDm ?? null,
      followup_drafts: msg.followupDrafts ?? [],
      reply_drafts: msg.replyDrafts ?? [],
      upwork_cover_letter: msg.upworkCoverLetter ?? null,
      screening_answers: msg.screeningAnswers ?? [],
      generated_text: msg.generatedText ?? null,
      message_stage: msg.messageStage ?? null,
      sender_profile_id: msg.senderProfileId ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'MESSAGE_GENERATED', {
      stage: msg.messageStage,
      has_connection_note: !!msg.connectionNote,
      has_dm: !!msg.firstDm,
      followup_count: (msg.followupDrafts ?? []).length,
    }, null, `msg:${sampleId}:${msg.messageStage ?? 'gen'}`)
  })
}

export async function captureHumanEdit(
  client: SupabaseClient,
  sampleId: string,
  edit: HumanEdit,
): Promise<void> {
  await safeCapture(client, sampleId, 'HUMAN_EDIT', async () => {
    // Append to edit history on the snapshot
    const { data: existing } = await tbl(client)
      .select('human_edited_text')
      .eq('id', sampleId)
      .maybeSingle()
    const history: HumanEdit[] = (existing?.human_edited_text as HumanEdit[] | null) ?? []
    history.push(edit)

    await tbl(client).update({
      funnel_stage: 'HUMAN_EDIT',
      human_edited_text: history,
      final_sent_text: edit.finalSentText ?? null,
      label_status: 'HUMAN_REVIEWED',
      label_source: 'human',
      labeler_id: edit.editorId ?? null,
      training_eligible: true,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'MESSAGE_EDITED', {
      edit_distance: edit.editedText && edit.generatedText
        ? levenshtein(edit.editedText.slice(0, 500), edit.generatedText.slice(0, 500))
        : null,
      editor_id: edit.editorId,
    }, edit.editorId ?? null, `edit:${sampleId}:${edit.timestamp}`)
  })
}

export async function captureSent(
  client: SupabaseClient,
  sampleId: string,
  finalText: string,
  actorId?: string,
): Promise<void> {
  await safeCapture(client, sampleId, 'SENT', async () => {
    await tbl(client).update({
      funnel_stage: 'SENT',
      final_sent_text: finalText,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'MESSAGE_SENT', {
      text_length: finalText.length,
    }, actorId ?? null, `sent:${sampleId}`)
  })
}

export async function captureClientReply(
  client: SupabaseClient,
  sampleId: string,
  replyText: string,
): Promise<void> {
  await safeCapture(client, sampleId, 'CLIENT_REPLY', async () => {
    const { data: existing } = await tbl(client)
      .select('client_replies')
      .eq('id', sampleId)
      .maybeSingle()
    const replies: string[] = (existing?.client_replies as string[] | null) ?? []
    replies.push(replyText)

    await tbl(client).update({
      funnel_stage: 'CLIENT_REPLY',
      client_replies: replies,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'CLIENT_REPLY', {
      reply_length: replyText.length,
      reply_index: replies.length,
    }, null, `reply:${sampleId}:${replies.length}`)
  })
}

export async function captureOutcome(
  client: SupabaseClient,
  sampleId: string,
  outcome: string,
): Promise<void> {
  await safeCapture(client, sampleId, 'OUTCOME', async () => {
    // Outcome is evidence, NOT automatically a correct label.
    const labelStatus: LabelStatus = 'OUTCOME_VERIFIED'
    const labelSource: LabelSource = 'outcome'

    await tbl(client).update({
      funnel_stage: 'OUTCOME',
      final_outcome: outcome,
      label_status: labelStatus,
      label_source: labelSource,
      // Outcome alone does NOT make training eligible — needs human review
      needs_review: true,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'OUTCOME_CHANGED', { outcome }, null, `outcome:${sampleId}:${outcome}`)
  })
}

export async function captureFeedback(
  client: SupabaseClient,
  sampleId: string,
  feedback: HumanFeedback,
  actorId: string,
): Promise<void> {
  await safeCapture(client, sampleId, 'FEEDBACK', async () => {
    const { data: existing } = await tbl(client)
      .select('human_feedback')
      .eq('id', sampleId)
      .maybeSingle()
    const history: HumanFeedback[] = (existing?.human_feedback as HumanFeedback[] | null) ?? []
    history.push(feedback)

    const isCorrection = !feedback.feedbackType.includes('CORRECT')
    const labelStatus: LabelStatus = isCorrection ? 'HUMAN_CORRECTED' : 'HUMAN_REVIEWED'

    await tbl(client).update({
      funnel_stage: 'HUMAN_FEEDBACK',
      human_feedback: history,
      label_status: labelStatus,
      label_source: 'human',
      labeler_id: actorId,
      training_eligible: true,
      needs_review: isCorrection,
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)

    await appendEvent(client, sampleId, 'FEEDBACK_SUBMITTED', {
      feedback_type: feedback.feedbackType,
      is_correction: isCorrection,
    }, actorId, `feedback:${sampleId}:${feedback.timestamp}`)
  })
}

export async function flagForReview(
  client: SupabaseClient,
  sampleId: string,
): Promise<void> {
  try {
    await tbl(client).update({
      needs_review: true,
      review_status: 'pending',
      updated_at: new Date().toISOString(),
    }).eq('id', sampleId)
  } catch { /* best-effort */ }
}

/** Explicitly approve a sample for training (admin/reviewer action). The only path to TRAINING_APPROVED. */
export async function approveForTraining(
  client: SupabaseClient,
  sampleId: string,
  approverId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await tbl(client).update({
    training_approved: true,
    approved_by: approverId,
    approved_at: now,
    review_status: 'approved',
    reviewed_by: approverId,
    reviewed_at: now,
    needs_review: false,
    label_status: 'TRAINING_APPROVED',
    label_source: 'review',
    updated_at: now,
  }).eq('id', sampleId)
  try {
    await appendEvent(client, sampleId, 'LABEL_APPROVED', { approver_id: approverId }, approverId, `label_approved:${sampleId}:${approverId}`)
  } catch { /* best-effort */ }
}

// ── Query ────────────────────────────────────────────────────────────────────

export interface DatasetFilter {
  platform?: Platform
  qualification?: string
  outcome?: string
  labelStatus?: LabelStatus
  needsReview?: boolean
  trainingEligible?: boolean
  trainingApproved?: boolean
  lowConfidence?: boolean
  limit?: number
  offset?: number
}

export async function querySamples(
  client: SupabaseClient,
  orgId: string,
  filter: DatasetFilter = {},
): Promise<IntelligenceSample[]> {
  const limit = Math.min(filter.limit ?? 50, 1000)
  const from = Math.max(0, filter.offset ?? 0)
  let query = tbl(client)
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1)

  // Always organisation-scoped: the service role bypasses RLS, so this is
  // the only tenant boundary on reads.
  query = query.eq('organization_id', orgId)

  if (filter.platform) query = query.eq('platform', filter.platform)
  if (filter.qualification) query = query.eq('qualification', filter.qualification)
  if (filter.outcome) query = query.eq('final_outcome', filter.outcome)
  if (filter.labelStatus) query = query.eq('label_status', filter.labelStatus)
  if (filter.needsReview) query = query.eq('needs_review', true)
  if (filter.trainingEligible) query = query.eq('training_eligible', true)
  if (filter.trainingApproved) query = query.eq('training_approved', true)
  if (filter.lowConfidence) query = query.lt('confidence', 0.45)

  const { data, error } = await query
  if (error) {
    console.error('[dataset] querySamples failed:', error.message)
    return []
  }
  return (data ?? []).map(rowToSample)
}

export async function countSamples(
  client: SupabaseClient,
  orgId: string,
  filter: DatasetFilter = {},
): Promise<number> {
  let query = tbl(client).select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
  if (filter.platform) query = query.eq('platform', filter.platform)
  if (filter.qualification) query = query.eq('qualification', filter.qualification)
  if (filter.outcome) query = query.eq('final_outcome', filter.outcome)
  if (filter.labelStatus) query = query.eq('label_status', filter.labelStatus)
  if (filter.needsReview) query = query.eq('needs_review', true)
  if (filter.trainingEligible) query = query.eq('training_eligible', true)
  if (filter.trainingApproved) query = query.eq('training_approved', true)

  const { count, error } = await query
  if (error) return 0
  return count ?? 0
}

/** Find the most recent sample for a lead, inside one organisation. */
export async function findLatestSampleForLead(
  client: SupabaseClient,
  orgId: string,
  leadId: string,
): Promise<string | null> {
  const query = tbl(client).select('id').eq('lead_id', leadId).eq('organization_id', orgId)
  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data?.id as string | null) ?? null
}

/** Get all events for a sample (reconstruction). */
export async function getSampleEvents(
  client: SupabaseClient,
  sampleId: string,
): Promise<Array<{ event_type: string; payload: Record<string, unknown>; actor: string | null; idempotency_key: string | null; created_at: string }>> {
  const { data, error } = await eventsTbl(client)
    .select('event_type, payload, actor, idempotency_key, created_at')
    .eq('sample_id', sampleId)
    .order('created_at', { ascending: true })

  if (error) return []
  return (data ?? []).map(r => ({
    event_type: r.event_type,
    payload: r.payload as Record<string, unknown>,
    actor: r.actor as string | null,
    idempotency_key: r.idempotency_key as string | null,
    created_at: r.created_at,
  }))
}

// ── Serialization ────────────────────────────────────────────────────────────

function rowToSample(row: Record<string, unknown>): IntelligenceSample {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    leadId: row.lead_id as string | null,
    upworkJobId: row.upwork_job_id as string | null,
    decisionRunId: row.decision_run_id as string | null,
    platform: row.platform as Platform,
    sourceType: row.source_type as string | undefined,
    version: row.version as number,
    funnelStage: row.funnel_stage as IntelligenceSample['funnelStage'],
    rawInput: row.raw_input as string | null,
    rawInputHash: row.raw_input_hash as string | null,
    extractedIdentity: row.extracted_identity as Record<string, unknown> | null,
    sourceFacts: row.source_facts as Record<string, unknown> | null,
    rejectedSignals: (row.rejected_signals as unknown[]) ?? [],
    evidenceLedger: (row.evidence_ledger as unknown[]) ?? [],
    modelRawOutput: row.model_raw_output as Record<string, unknown> | null,
    resolvedDecision: row.resolved_decision as Record<string, unknown> | null,
    canonicalScore: row.canonical_score as number | null,
    displayScore: row.display_score as number | null,
    qualification: row.qualification as string | null,
    scoreDimensions: (row.score_dimensions as unknown[]) ?? [],
    confidence: row.confidence as number | null,
    recommendedAction: row.recommended_action as string | null,
    senderRankings: (row.sender_rankings as IntelligenceSample['senderRankings']) ?? [],
    bestSenderId: row.best_sender_id as string | null,
    currentSenderId: row.current_sender_id as string | null,
    connectionNote: row.connection_note as string | null,
    firstDm: row.first_dm as string | null,
    followupDrafts: (row.followup_drafts as string[]) ?? [],
    replyDrafts: (row.reply_drafts as string[]) ?? [],
    upworkCoverLetter: row.upwork_cover_letter as string | null,
    screeningAnswers: (row.screening_answers as IntelligenceSample['screeningAnswers']) ?? [],
    humanEditedText: (row.human_edited_text as HumanEdit[]) ?? [],
    finalSentText: row.final_sent_text as string | null,
    generatedText: row.generated_text as string | null,
    messageStage: row.message_stage as string | null,
    senderProfileId: row.sender_profile_id as string | null,
    clientReplies: (row.client_replies as string[]) ?? [],
    finalOutcome: row.final_outcome as string | null,
    humanFeedback: (row.human_feedback as HumanFeedback[]) ?? [],
    scoringVersion: row.scoring_version as string | null,
    sourceFactsVersion: row.source_facts_version as string | null,
    buyerIntentVersion: row.buyer_intent_version as string | null,
    attributionVersion: row.attribution_version as string | null,
    routingVersion: row.routing_version as string | null,
    promptVersion: row.prompt_version as string | null,
    modelVersion: row.model_version as string | null,
    labelStatus: row.label_status as LabelStatus,
    labelSource: row.label_source as LabelSource | null,
    labelerId: row.labeler_id as string | null,
    reviewStatus: row.review_status as IntelligenceSample['reviewStatus'],
    reviewNotes: row.review_notes as string | null,
    reviewedAt: row.reviewed_at as string | null,
    reviewedBy: row.reviewed_by as string | null,
    trainingEligible: row.training_eligible as boolean,
    trainingApproved: row.training_approved as boolean,
    approvedBy: row.approved_by as string | null,
    approvedAt: row.approved_at as string | null,
    needsReview: row.needs_review as boolean,
    captureFailures: (row.capture_failures as CaptureFailure[]) ?? [],
    lastCaptureError: row.last_capture_error as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
