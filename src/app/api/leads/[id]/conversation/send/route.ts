import { NextResponse } from 'next/server'
import { hasUnfilledValues, UNFILLED_VALUES_MESSAGE } from '@/lib/relay/unfilled-values'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'
import { loadConversation, logSentMessage } from '@/lib/conversation/service'
import type { ComposeIntent } from '@/lib/conversation/types'
import { captureSent, findLatestSampleForLead } from '@/lib/dataset/service'

export const maxDuration = 60

const INTENTS: ComposeIntent[] = ['connection', 'dm', 'followup', 'reply', 'custom']

/** Log a message the rep sent on LinkedIn, learn from their edits, clear the draft. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { text?: string; intent?: string; idempotencyKey?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const intent = INTENTS.includes(body.intent as ComposeIntent) ? (body.intent as ComposeIntent) : 'custom'
  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, 8000) : ''
  if (text.trim() && hasUnfilledValues(text)) {
    return NextResponse.json({ error: UNFILLED_VALUES_MESSAGE }, { status: 400 })
  }
  try {
    const outcome = await logSentMessage(store, id, text, intent, body.idempotencyKey ?? null)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status ?? 400 })

    // Dataset: capture SENT event (best-effort, never breaks send).
    const sentText = typeof body.text === 'string' ? body.text : ''
    const repId = store.getCurrentRepId()
    const sampleId = await findLatestSampleForLead(store.getSupabaseClient(), store.organizationId, id)
    if (sampleId) void captureSent(store.getSupabaseClient(), sampleId, sentText, repId).catch(() => {})

    const loaded = await loadConversation(store, id)
    return NextResponse.json(loaded?.view ?? { ok: true })
  } catch (error) {
    // Lock / follow-up-not-due rules surface as readable errors.
    const message = error instanceof Error ? error.message : ''
    if (/locked|not due|follow-up|limit|owner/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return safeErrorResponse(error, 500, 'Could not log the message.', 'leads/conversation/send')
  }
}
