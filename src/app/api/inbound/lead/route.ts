import { NextRequest, NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import type { LeadSource } from '@/lib/domain/types'
import { captureClientReply, findLatestSampleForLead } from '@/lib/dataset/service'

export async function POST(req: NextRequest) {
  const store = await createScoutStore().catch(() => null)
  if (!store) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: {
    company?: string
    contactName?: string | null
    contactTitle?: string | null
    url?: string | null
    message: string
    source: LeadSource
    profileInfo?: string | null
    jobInfo?: string | null
    context?: string | null
    assignedProfileId?: string | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }
  if (!body.company || !body.company.trim()) {
    return NextResponse.json({ error: 'Company name is required.' }, { status: 400 })
  }

  try {
    const result = await store.createLead({
      company: body.company,
      contactName: body.contactName || null,
      contactTitle: body.contactTitle || null,
      url: body.url || null,
      direction: 'inbound',
      source: body.source,
      inboundMessage: body.message.trim(),
      inboundRaw: {
        profileInfo: body.profileInfo || null,
        jobInfo: body.jobInfo || null,
        context: body.context || null,
      },
      assignedProfileId: body.assignedProfileId || null,
    })

    if (result.blocked || !result.lead) {
      return NextResponse.json({ error: result.reason ?? 'Failed to create lead.' }, { status: 409 })
    }

    await store.upsertConversationState({
      leadId: result.lead.id,
      stage: 'new',
      senderProfileId: body.assignedProfileId || null,
    })

    // Dataset: inbound lead's opening message is a client reply event.
    const sampleId = await findLatestSampleForLead(store.getSupabaseClient(), result.lead.organizationId, result.lead.id)
    if (sampleId && body.message) {
      void captureClientReply(store.getSupabaseClient(), sampleId, body.message.trim()).catch(() => {})
    }

    return NextResponse.json({ lead: result.lead }, { status: 201 })
  } catch (err) {
    console.error('[inbound/lead] failed:', err)
    return NextResponse.json({ error: 'Failed to save inbound lead.' }, { status: 500 })
  }
}
