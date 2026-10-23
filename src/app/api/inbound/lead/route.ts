import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createScoutStore } from '@/lib/store'
import { captureClientReply, findLatestSampleForLead } from '@/lib/dataset/service'
import { isDemoMode } from '@/lib/ai/config'
import { scanForSecrets } from '@/lib/ai/secrets'
import { analyzeInboundInput, buildInboundSensitiveText } from '@/lib/inbound/analysis'
import { validateInboundLeadBody, type ValidatedInboundLeadInput } from '@/lib/inbound/validation'
import type { Lead } from '@/lib/domain/types'

function derivedIdempotencyKey(
  organizationId: string,
  repId: string,
  input: {
    company: string
    message: string
    source: string
    profileInfo?: string | null
    jobInfo?: string | null
    context?: string | null
  },
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      organizationId,
      repId,
      company: input.company,
      message: input.message,
      source: input.source,
      profileInfo: input.profileInfo ?? null,
      jobInfo: input.jobInfo ?? null,
      context: input.context ?? null,
    }))
    .digest('hex')
}

function isRecoverableRetry(
  lead: Lead | null | undefined,
  organizationId: string,
  repId: string,
  idempotencyKey: string,
  input: ValidatedInboundLeadInput,
  senderProfileId: string | null,
): lead is Lead {
  const raw = lead?.inboundRaw
  return Boolean(
    lead
      && lead.organizationId === organizationId
      && lead.ownerRepId === repId
      && lead.direction === 'inbound'
      && lead.company === input.company
      && (lead.contactName ?? null) === (input.contactName ?? null)
      && (lead.contactTitle ?? null) === (input.contactTitle ?? null)
      && (lead.url ?? null) === (input.url ?? null)
      && lead.inboundMessage === input.message
      && lead.source === input.source
      && (lead.senderProfileId ?? null) === senderProfileId
      && raw?.idempotencyKey === idempotencyKey
      && (raw?.profileInfo ?? null) === (input.profileInfo ?? null)
      && (raw?.jobInfo ?? null) === (input.jobInfo ?? null)
      && (raw?.context ?? null) === (input.context ?? null),
  )
}

export async function POST(req: NextRequest) {
  const store = await createScoutStore().catch(() => null)
  if (!store) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const validated = validateInboundLeadBody(rawBody)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }
  const body = validated.value

  const secretScan = scanForSecrets(buildInboundSensitiveText(body))
  if (secretScan.blocked) {
    return NextResponse.json(
      { error: 'Message contains sensitive credentials. Remove them before saving.' },
      { status: 400 },
    )
  }

  // Resolve sender authorization before analysis or persistence. The store's
  // assigned-profile query is rep-scoped; the explicit organization check is
  // an additional tenant-boundary guard against a malformed store response.
  let validatedProfileId: string | null = null
  if (body.assignedProfileId) {
    const allowedProfiles = await store.getAssignedProfiles().catch(() => [])
    const profile = allowedProfiles.find((candidate) =>
      candidate.id === body.assignedProfileId
      && candidate.organizationId === store.organizationId,
    )
    if (!profile) {
      return NextResponse.json(
        { error: 'The selected sender profile is not available for your workspace.' },
        { status: 403 },
      )
    }
    validatedProfileId = profile.id
  }

  let analysis
  try {
    analysis = await analyzeInboundInput(body)
  } catch (err) {
    console.error('[inbound/lead] authoritative analysis failed:', err)
    return NextResponse.json({ error: 'Failed to analyze the inbound message.' }, { status: 500 })
  }

  const repId = store.getCurrentRepId()
  const idempotencyKey = body.idempotencyKey ?? derivedIdempotencyKey(
    store.organizationId,
    repId,
    body,
  )

  try {
    const result = await store.createLead({
      company: body.company,
      contactName: body.contactName,
      contactTitle: body.contactTitle,
      url: body.url,
      direction: 'inbound',
      source: body.source,
      inboundMessage: body.message,
      inboundRaw: {
        profileInfo: body.profileInfo,
        jobInfo: body.jobInfo,
        context: body.context,
        idempotencyKey,
      },
      assignedProfileId: validatedProfileId,
      canonicalIntelligence: analysis.canonicalIntelligence,
      canonicalScore: analysis.canonicalScore,
      buyerIntent: analysis.buyerIntent,
      qualification: analysis.qualification,
      scoreVersion: analysis.scoreVersion,
      scoredAt: analysis.scoredAt,
      scoreBreakdown: analysis.scoreBreakdown,
    })

    const recovered = result.blocked && isRecoverableRetry(
      result.lead,
      store.organizationId,
      repId,
      idempotencyKey,
      body,
      validatedProfileId,
    )
    if ((result.blocked && !recovered) || !result.lead) {
      return NextResponse.json({ error: result.reason ?? 'Failed to create lead.' }, { status: 409 })
    }

    const lead = result.lead
    try {
      await store.upsertConversationState({
        leadId: lead.id,
        stage: 'new',
        senderProfileId: validatedProfileId,
      })
    } catch (err) {
      console.error('[inbound/lead] required conversation state creation failed:', err)
      return NextResponse.json({
        error: 'The lead was saved, but its conversation could not be initialized. Retry to repair it.',
        retryable: true,
        incomplete: true,
        leadId: lead.id,
        idempotencyKey,
      }, { status: 503 })
    }

    // Dataset capture is optional analytics and requires the production store.
    // Demo mode never asks the mock store for an unsupported Supabase client.
    if (!isDemoMode()) {
      try {
        const client = store.getSupabaseClient()
        const sampleId = await findLatestSampleForLead(
          client,
          lead.organizationId,
          lead.id,
        ).catch(() => null)
        if (sampleId) {
          void captureClientReply(client, sampleId, body.message).catch(() => {})
        }
      } catch (err) {
        console.warn('[inbound/lead] dataset capture skipped:', err)
      }
    }

    return NextResponse.json(
      { lead, idempotencyKey, idempotent: recovered, recovered },
      { status: recovered ? 200 : 201 },
    )
  } catch (err) {
    console.error('[inbound/lead] failed:', err)
    return NextResponse.json({ error: 'Failed to save inbound lead.' }, { status: 500 })
  }
}
