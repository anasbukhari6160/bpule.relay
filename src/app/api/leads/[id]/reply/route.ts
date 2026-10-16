import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'

/**
 * Persist a prospect's inbound reply as a message row, flip the lead to
 * 'replied', record the outcome, and emit a CLIENT_REPLIED event. This is
 * how a rep captures the prospect's actual words — previously the inbound
 * text was never stored for the LinkedIn flow (only the rep's reply was).
 * Owner-scoped; returns the refreshed lead detail so the UI can update.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let replyText: string
  let receivedAt: string | null = null
  try {
    const body = await request.json()
    replyText = typeof body?.text === 'string' ? body.text.trim() : ''
    receivedAt = typeof body?.receivedAt === 'string' && !Number.isNaN(new Date(body.receivedAt).getTime()) ? body.receivedAt : null
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!replyText) {
    return NextResponse.json({ error: 'Reply text is required.' }, { status: 400 })
  }

  try {
    await store.recordProspectReply(id, replyText, { receivedAt })
    const detail = await store.getLead(id)
    return NextResponse.json({ ok: true, lead: detail })
  } catch (error) {
    return safeErrorResponse(error, 500, 'Could not record the reply.', 'leads/reply')
  }
}
