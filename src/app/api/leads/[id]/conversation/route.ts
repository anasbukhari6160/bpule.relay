import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'
import { loadConversation } from '@/lib/conversation/service'

export const maxDuration = 60

/** The lead's conversation: ordered thread, memory, saved draft, next action. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  try {
    const loaded = await loadConversation(store, id)
    if (!loaded) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    return NextResponse.json(loaded.view)
  } catch (error) {
    return safeErrorResponse(error, 500, 'Could not load the conversation.', 'leads/conversation')
  }
}
