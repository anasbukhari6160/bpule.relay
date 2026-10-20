import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'
import { loadConversation } from '@/lib/conversation/service'
import { captureClientReply, findLatestSampleForLead } from '@/lib/dataset/service'
import { createServiceSupabase } from '@/lib/supabase/service'

export const maxDuration = 60

/**
 * Add the client's message to the thread (pasted from LinkedIn), optionally
 * with when they actually sent it, then return the refreshed conversation —
 * memory analyzes the new message as part of the reload.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { text?: string; receivedAt?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : ''
  if (!text) return NextResponse.json({ error: 'Paste the client\'s message.' }, { status: 400 })
  const receivedAt = typeof body.receivedAt === 'string' && body.receivedAt ? body.receivedAt : null
  if (receivedAt && Number.isNaN(new Date(receivedAt).getTime())) {
    return NextResponse.json({ error: 'Invalid time for the client\'s message.' }, { status: 400 })
  }

  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  try {
    await store.recordProspectReply(id, text, { receivedAt })

    // Dataset: capture CLIENT_REPLY event (uses service role for system capture).
    const datasetClient = createServiceSupabase()
    const sampleId = await findLatestSampleForLead(datasetClient, 'all-orgs', id)
    if (sampleId) void captureClientReply(datasetClient, sampleId, text).catch(() => {})

    const loaded = await loadConversation(store, id)
    if (!loaded) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    return NextResponse.json(loaded.view)
  } catch (error) {
    return safeErrorResponse(error, 500, 'Could not add the client\'s message.', 'leads/conversation/inbound')
  }
}
