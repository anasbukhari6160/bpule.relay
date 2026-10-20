/**
 * POST /api/dataset/capture
 *
 * Capture a funnel stage snapshot onto an intelligence_sample.
 * Called by existing flows (extract, score, message, feedback, outcome).
 *
 * Body:
 *   sample_id — existing sample to update (or omit to create new)
 *   stage — FunnelStage
 *   platform — linkedin | upwork
 *   lead_id? — link to existing lead
 *   upwork_job_id? — link to existing upwork job
 *   raw_input? — the original paste
 *   payload — stage-specific data (score, message, feedback, etc.)
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import {
  captureClientReply,
  captureFeedback,
  captureHumanEdit,
  captureMessageGeneration,
  captureOutcome,
  captureRouting,
  captureScore,
  captureSent,
  createSample,
  flagForReview,
  approveForTraining,
} from '@/lib/dataset/service'
import type { FunnelStage } from '@/lib/dataset/types'

const VALID_STAGES: FunnelStage[] = [
  'RAW_INPUT', 'EXTRACTION', 'VERIFIED_FACTS', 'SCORE', 'ROUTING',
  'MESSAGE_GENERATION', 'HUMAN_EDIT', 'SENT', 'CLIENT_REPLY',
  'LIFECYCLE_CHANGE', 'OUTCOME', 'HUMAN_FEEDBACK',
]

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const stage = typeof body.stage === 'string' ? body.stage as FunnelStage : null
  if (!stage || !VALID_STAGES.includes(stage)) {
    return NextResponse.json({ error: `stage must be one of ${VALID_STAGES.join(', ')}` }, { status: 400 })
  }

  const sampleId = typeof body.sample_id === 'string' ? body.sample_id : null
  const payload = (body.payload ?? {}) as Record<string, unknown>
  const client = createServiceSupabase()

  // Service role bypasses RLS: a caller may only capture onto a sample in
  // their own organisation.
  if (sampleId) {
    const { data: owner } = await client.from('intelligence_samples').select('organization_id').eq('id', sampleId).maybeSingle()
    if (!owner || owner.organization_id !== auth.orgId) {
      return NextResponse.json({ error: 'Sample not found.' }, { status: 404 })
    }
  }

  // Create new sample if no sample_id
  let sid = sampleId
  if (!sid) {
    const platform = typeof body.platform === 'string' ? body.platform : 'linkedin'
    sid = await createSample(client, {
      platform: platform as 'linkedin' | 'upwork',
      sourceType: typeof body.source_type === 'string' ? body.source_type : undefined,
      leadId: typeof body.lead_id === 'string' ? body.lead_id : undefined,
      upworkJobId: typeof body.upwork_job_id === 'string' ? body.upwork_job_id : undefined,
      rawInput: typeof body.raw_input === 'string' ? body.raw_input : undefined,
      organizationId: auth.orgId,
    })
    if (!sid) return NextResponse.json({ error: 'Failed to create sample.' }, { status: 500 })
  }

  try {
    switch (stage) {
      case 'SCORE':
        await captureScore(client, sid, {
          canonicalScore: Number(payload.canonical_score ?? 0),
          displayScore: Number(payload.display_score ?? 0),
          qualification: String(payload.qualification ?? ''),
          scoreDimensions: (payload.score_dimensions as unknown[]) ?? [],
          confidence: Number(payload.confidence ?? 0.5),
          recommendedAction: String(payload.recommended_action ?? ''),
          resolvedDecision: payload.resolved_decision as Record<string, unknown> ?? undefined,
          modelRawOutput: payload.model_raw_output as Record<string, unknown> ?? undefined,
          sourceFacts: payload.source_facts as Record<string, unknown> ?? undefined,
          rejectedSignals: (payload.rejected_signals as unknown[]) ?? undefined,
          evidenceLedger: (payload.evidence_ledger as unknown[]) ?? undefined,
          extractedIdentity: payload.extracted_identity as Record<string, unknown> ?? undefined,
          scoringVersion: typeof payload.scoring_version === 'string' ? payload.scoring_version : undefined,
          sourceFactsVersion: typeof payload.source_facts_version === 'string' ? payload.source_facts_version : undefined,
          buyerIntentVersion: typeof payload.buyer_intent_version === 'string' ? payload.buyer_intent_version : undefined,
          attributionVersion: typeof payload.attribution_version === 'string' ? payload.attribution_version : undefined,
          promptVersion: typeof payload.prompt_version === 'string' ? payload.prompt_version : undefined,
          modelVersion: typeof payload.model_version === 'string' ? payload.model_version : undefined,
        })
        break

      case 'ROUTING':
        await captureRouting(client, sid, {
          senderRankings: (payload.sender_rankings as Array<{ senderId: string; name: string | null; profileMatch: number; reasons: string[] }>) ?? [],
          bestSenderId: typeof payload.best_sender_id === 'string' ? payload.best_sender_id : null,
          currentSenderId: typeof payload.current_sender_id === 'string' ? payload.current_sender_id : null,
          routingVersion: typeof payload.routing_version === 'string' ? payload.routing_version : undefined,
        })
        break

      case 'MESSAGE_GENERATION':
        await captureMessageGeneration(client, sid, {
          connectionNote: typeof payload.connection_note === 'string' ? payload.connection_note : undefined,
          firstDm: typeof payload.first_dm === 'string' ? payload.first_dm : undefined,
          followupDrafts: (payload.followup_drafts as string[]) ?? [],
          replyDrafts: (payload.reply_drafts as string[]) ?? [],
          upworkCoverLetter: typeof payload.upwork_cover_letter === 'string' ? payload.upwork_cover_letter : undefined,
          screeningAnswers: (payload.screening_answers as Array<{ question: string; answer: string }>) ?? [],
          generatedText: typeof payload.generated_text === 'string' ? payload.generated_text : undefined,
        })
        break

      case 'HUMAN_EDIT':
        await captureHumanEdit(client, sid, {
          generatedText: String(payload.generated_text ?? ''),
          editedText: String(payload.edited_text ?? ''),
          finalSentText: typeof payload.final_sent_text === 'string' ? payload.final_sent_text : null,
          editorId: auth.repId,
          timestamp: new Date().toISOString(),
        })
        break

      case 'SENT':
        await captureSent(client, sid, String(payload.final_text ?? ''))
        break

      case 'CLIENT_REPLY':
        await captureClientReply(client, sid, String(payload.reply_text ?? ''))
        break

      case 'OUTCOME':
        await captureOutcome(client, sid, String(payload.outcome ?? ''))
        break

      case 'HUMAN_FEEDBACK':
        await captureFeedback(client, sid, {
          feedbackType: String(payload.feedback_type ?? ''),
          note: typeof payload.note === 'string' ? payload.note : undefined,
          observed: payload.observed as Record<string, unknown> ?? undefined,
          expected: payload.expected as Record<string, unknown> ?? undefined,
          timestamp: new Date().toISOString(),
        }, auth.repId)
        break

      default:
        // For stages without a dedicated payload, just advance the funnel
        await client.from('intelligence_samples').update({
          funnel_stage: stage,
          updated_at: new Date().toISOString(),
        }).eq('id', sid)
    }

    // Active learning: flag low-confidence or corrected samples for review
    if (stage === 'SCORE' && typeof payload.confidence === 'number' && payload.confidence < 0.45) {
      await flagForReview(client, sid)
    }

    return NextResponse.json({ ok: true, sample_id: sid, stage }, { status: 200 })
  } catch (err) {
    console.error('[dataset/capture] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Capture failed.' }, { status: 500 })
  }
}
