import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'
import { composeForLead } from '@/lib/conversation/service'
import type { ComposeIntent } from '@/lib/conversation/types'
import { captureMessageGeneration, findLatestSampleForLead } from '@/lib/dataset/service'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'

export const maxDuration = 120

const INTENTS: ComposeIntent[] = ['connection', 'dm', 'followup', 'reply', 'custom']

/** Write (or refine) the next message for this lead. The result is saved as the lead's draft. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { intent?: string; instruction?: string; previousText?: string; profileId?: string }
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const intent = INTENTS.includes(body.intent as ComposeIntent) ? (body.intent as ComposeIntent) : 'custom'

  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  try {
    const composed = await composeForLead(store, id, {
      intent,
      instruction: typeof body.instruction === 'string' ? body.instruction.slice(0, 600) : null,
      previousText: typeof body.previousText === 'string' ? body.previousText.slice(0, 3000) : null,
      profileId: typeof body.profileId === 'string' ? body.profileId : null,
    })
    if (!composed) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

    // Dataset: capture MESSAGE_GENERATION (uses service role for system capture).
    const datasetClient = createServiceSupabase()
    const auth = await getAuthContext()
    const sampleId = auth ? await findLatestSampleForLead(datasetClient, auth.orgId, id) : null
    if (sampleId && composed.draft) {
      void captureMessageGeneration(datasetClient, sampleId, {
        generatedText: composed.draft.text,
        messageStage: intent,
        senderProfileId: typeof body.profileId === 'string' ? body.profileId : undefined,
      }).catch(() => {})
    }

    return NextResponse.json({
      draft: composed.draft,
      issues: composed.result.issues,
      repaired: composed.result.repaired,
      fallback: composed.result.fallback,
      model: composed.result.model,
    })
  } catch (error) {
    return safeErrorResponse(error, 500, 'Could not write the message.', 'leads/conversation/compose')
  }
}
