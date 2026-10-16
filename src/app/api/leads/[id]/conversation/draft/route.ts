import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'
import { saveDraft } from '@/lib/conversation/service'
import type { ComposeIntent } from '@/lib/conversation/types'

const INTENTS: ComposeIntent[] = ['connection', 'dm', 'followup', 'reply', 'custom']

/** Autosave the composer text so a draft survives reloads. Empty text clears it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { text?: string; intent?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, 5000) : ''
  const intent = INTENTS.includes(body.intent as ComposeIntent) ? (body.intent as ComposeIntent) : 'custom'
  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  try {
    const lead = await store.getLead(id)
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    const draft = await saveDraft(store, id, text, intent)
    return NextResponse.json({ draft })
  } catch (error) {
    return safeErrorResponse(error, 500, 'Could not save the draft.', 'leads/conversation/draft')
  }
}
