import { NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { safeErrorResponse } from '@/lib/errors'
import { emitAction } from '@/lib/action-ledger'
import { captureOutcome, findLatestSampleForLead } from '@/lib/dataset/service'

const STATUS_TYPES = [
  'meeting_booked',
  'proposal_sent',
  'interested',
  'not_interested',
  'no_response',
  'closed',
  'reviewed',
] as const

type StatusType = typeof STATUS_TYPES[number]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { status_type?: string; metadata?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const statusType = body.status_type?.trim() ?? ''
  if (!statusType || !STATUS_TYPES.includes(statusType as StatusType)) {
    return NextResponse.json(
      { error: `Invalid status_type. Must be one of: ${STATUS_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  let store
  try {
    store = await createScoutStore()
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const lead = await store.getLead(id)
  if (!lead) {
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  }
  if (lead.status === 'no' || lead.status === 'dead') {
    return NextResponse.json({ error: 'This lead is locked.' }, { status: 409 })
  }

  try {
    let newStatus: 'won' | 'lost' | null = null
    let conversationStage: 'interested' | 'meeting' | 'proposal' | 'contacted' | 'replied' | null = null

    switch (statusType) {
      case 'meeting_booked':
        newStatus = 'won'
        conversationStage = 'meeting'
        break
      case 'interested':
        conversationStage = 'interested'
        break
      case 'not_interested':
      case 'closed':
        newStatus = 'lost'
        break
      case 'no_response':
        conversationStage = 'contacted'
        break
      case 'proposal_sent':
        conversationStage = 'proposal'
        break
    }

    if (newStatus) {
      await store.updateLeadStatus(id, newStatus)
    }
    if (conversationStage) {
      await store.upsertConversationState({
        leadId: id,
        stage: conversationStage,
      })
    }

    const actionType = statusType === 'meeting_booked' ? 'CLIENT_WON' as const
      : statusType === 'interested' ? 'OPPORTUNITY_CREATED' as const
      : null

    if (actionType) {
      try {
        await emitAction({
          orgId: lead.organizationId,
          actionType,
          actorType: 'rep',
          actorId: lead.ownerRepId,
          leadId: id,
          senderProfileId: lead.senderProfileId,
          metadata: { source: 'status_update', status_type: statusType },
          idempotencyKey: `${actionType.toLowerCase()}:${id}:${statusType}`,
        })
      } catch { }
    }

    // Dataset: capture OUTCOME (won/lost/deferred).
    if (newStatus) {
      const sampleId = await findLatestSampleForLead(store.getSupabaseClient(), lead.organizationId, id)
      if (sampleId) {
        // A booked meeting is a meeting, not a won deal: the dataset keeps
        // the stages apart even where the lead status collapses them.
        const datasetOutcome = statusType === 'meeting_booked' ? 'meeting' : statusType === 'interested' ? 'positive_reply' : 'lost'
        void captureOutcome(store.getSupabaseClient(), sampleId, datasetOutcome).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true, status_type: statusType, lead_status: newStatus ?? lead.status })
  } catch (err) {
    return safeErrorResponse(err, 500, 'Failed to update status.', 'leads/[id]/status')
  }
}
