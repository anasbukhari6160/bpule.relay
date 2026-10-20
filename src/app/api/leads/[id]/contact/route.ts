import { NextResponse } from 'next/server'
import { hasUnfilledValues, UNFILLED_VALUES_MESSAGE } from '@/lib/relay/unfilled-values'
import { createScoutStore } from '@/lib/store'
import type { MessageType } from '@/lib/domain/types'
import { computeEditDelta, classifySendDisposition, inferFeedbackReasons } from '@/lib/relay/edit-learning'
import { safeErrorResponse } from '@/lib/errors'

const TYPES: MessageType[] = ['dm', 'connection', 'followup', 'reply']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { sentText?: string; type?: string; originalDraft?: string; rejected?: boolean; rejectReasons?: string[]; idempotencyKey?: string; sendWithoutNote?: boolean; direction?: string }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const sentText = body.sentText?.trim() ?? ''
  const sendWithoutNote = body.sendWithoutNote === true
  if (!sentText && body.rejected !== true && !sendWithoutNote) {
    return NextResponse.json(
      { error: 'Paste the message text you actually sent.' },
      { status: 400 },
    )
  }
  // A note with an empty value ("a -month trial with / support") is never a
  // sent message; refuse to log it even if the client skipped its own check.
  if (sentText && body.rejected !== true && hasUnfilledValues(sentText)) {
    return NextResponse.json({ error: UNFILLED_VALUES_MESSAGE }, { status: 400 })
  }

  const rawType = body.type?.trim() ?? ''
  if (!TYPES.includes(rawType as MessageType)) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${TYPES.join(', ')}` },
      { status: 400 },
    )
  }
  const type: MessageType = rawType as MessageType

  let store
  try {
    store = await createScoutStore()
  } catch (err) {
    return NextResponse.json(
      { error: 'Not signed in.' },
      { status: 401 },
    )
  }

  const lead = await store.getLead(id)
  if (!lead) {
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  }
  // BUG-15 fix: Do NOT block sends on locked status here. markContacted()
  // handles locked leads gracefully — message insert succeeds, status update
  // is skipped. This allows reps to log outreach even on no/dead leads.

  try {
    const originalDraft = body.originalDraft?.trim() || sentText
    const disposition = classifySendDisposition(originalDraft, sentText, body.rejected === true)
    const inferredReasons = inferFeedbackReasons(originalDraft, sentText, disposition)
    const rejectReasons = [
      ...inferredReasons,
      ...((body.rejectReasons ?? []).filter((r): r is typeof inferredReasons[number] =>
        [
          'TOO_LONG', 'GENERIC', 'FAKE_PERSONALIZATION', 'UNSUPPORTED', 'TOO_SALESY',
          'WRONG_OBJECTIVE', 'BAD_CTA', 'UNNATURAL', 'WRONG_PROOF', 'WRONG_TIMING',
        ].includes(r),
      )),
    ]

    if (body.rejected === true) {
      try {
        const delta = computeEditDelta(originalDraft, sentText)
        await store.logEditLearning({
          messageId: null,
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
        // Rejection telemetry must not break the UI.
      }
      return NextResponse.json({ ok: true, disposition, rejectReasons })
    }

    const result = await store.markContacted(id, sentText, type, {
      originalDraft,
      sendDisposition: disposition,
      rejectReasons,
      idempotencyKey: body.idempotencyKey?.trim() || null,
    })
    if (result.idempotent) {
      // Duplicate call for the same logical send (double-click, retry) —
      // learning/memory/event side effects below, which already ran on the
      // original call. Re-running them would be harmless for most (they're
      // themselves best-effort/non-fatal) but pointless and would blur
      // "how many times was this send attempted" telemetry.
      return NextResponse.json({
        ok: true,
        todaySends: result.todaySends,
        type,
        disposition,
        idempotent: true,
      })
    }
    if (!result.allowed) {
      return NextResponse.json(
        { error: result.message ?? 'Send ceiling reached.' },
        { status: 429 },
      )
    }

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
        formalityShift: delta.formalityShift === 'more_formal' ? 'more_formal' : delta.formalityShift === 'less_formal' ? 'less_formal' : delta.formalityShift === 'same' ? 'same' : null,
        sendDisposition: disposition,
        rejectReasons,
      })
    } catch {
      // Non-fatal: learning must not break the send
    }

    if (type === 'followup') {
      try {
        await store.emitRelayEvent({
          eventType: 'FOLLOWUP_RECORDED',
          entityType: 'lead',
          entityId: id,
          actorType: 'rep',
          payload: { type, disposition },
          source: 'app',
          // Stable key across retries (mirrors OUTREACH_RECORDED pattern).
          // Date.now() would make every call unique and defeat dedup.
          sourceEventId: `followup_recorded:${id}:${body.idempotencyKey ?? 'none'}`,
        })
      } catch {
        // Non-fatal
      }
    }

    // Record sales memory for this send
    try {
      await store.addSalesMemory({
        memoryType: 'angle_used',
        content: `Sent ${type} to ${lead.company}: ${sentText.slice(0, 120)}`,
        leadId: id,
        channel: type,
        stage: lead.status,
        outcome: null,
      })
    } catch {
      // Non-fatal: memory must not break the send
    }

    return NextResponse.json({
      ok: true,
      todaySends: result.todaySends,
      type,
      disposition,
    })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('NOT_ELIGIBLE:')) {
      return NextResponse.json({ error: err.message.replace(/^NOT_ELIGIBLE:\s*/, '') }, { status: 409 })
    }
    if (err instanceof Error && /locked|owner|unavailable|not yours/i.test(err.message)) {
      if (/connection-locked/i.test(err.message)) {
        return NextResponse.json({ error: err.message }, { status: 429 })
      }
      if (/no or dead/i.test(err.message)) {
        return NextResponse.json({ error: 'This lead is locked (status: no/dead).' }, { status: 409 })
      }
      return NextResponse.json({ error: lead ? 'This lead is not assigned to you.' : 'Lead not found.' }, { status: 409 })
    }
    return safeErrorResponse(err, 500, 'Failed to log send.', 'leads/[id]/contact')
  }
}
