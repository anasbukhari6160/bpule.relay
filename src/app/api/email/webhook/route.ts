import { NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { safeErrorResponse } from '@/lib/errors'

type Row = Record<string, unknown>

const DELIVERY_STATUS_PRIORITY: Record<string, number> = {
  DRAFT: 0,
  QUEUED: 1,
  SENT: 2,
  DELIVERED: 3,
  FAILED: 4,
  BOUNCED: 5,
  SUPPRESSED: 6,
  REPLIED: 7,
}

function eventToDeliveryStatus(type: string): 'DELIVERED' | 'BOUNCED' | 'FAILED' | 'REPLIED' | 'SUPPRESSED' | 'SENT' {
  switch (type) {
    case 'DELIVERED':
      return 'DELIVERED'
    case 'BOUNCED':
      return 'BOUNCED'
    case 'FAILED':
      return 'FAILED'
    case 'REPLIED':
      return 'REPLIED'
    case 'UNSUBSCRIBED':
    case 'UNSUBSCRIBE':
      return 'SUPPRESSED'
    default:
      return 'SENT'
  }
}

function stableDeliveryStatus(current: string | null | undefined, incoming: ReturnType<typeof eventToDeliveryStatus>): string {
  const currentStatus = (current ?? 'SENT').toUpperCase()
  const currentRank = DELIVERY_STATUS_PRIORITY[currentStatus] ?? 0
  const incomingRank = DELIVERY_STATUS_PRIORITY[incoming] ?? 0
  return incomingRank >= currentRank ? incoming : currentStatus
}

async function updateConversationOnReply(supabase: ReturnType<typeof createServiceSupabase>, emailMessage: Row, replyBody: string | null): Promise<void> {
  const organizationId = emailMessage.organization_id as string
  const leadId = emailMessage.lead_id as string
  const revenueIdentityId = emailMessage.revenue_identity_id as string
  const nowIso = new Date().toISOString()

  const { data: leadRow } = await supabase
    .from('leads')
    .select('owner_rep_id')
    .eq('id', leadId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  const repId = (leadRow?.owner_rep_id as string) ?? null

  const { data: insertedMsg } = await supabase
    .from('messages')
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      rep_id: repId,
      type: 'reply',
      sent_text: replyBody,
      sent_at: nowIso,
      model_used: 'email_webhook',
      created_at: nowIso,
    })
    .select('id')
    .single()

  await supabase
    .from('leads')
    .update({ status: 'replied' })
    .eq('id', leadId)
    .eq('organization_id', organizationId)

  await supabase
    .from('outcomes')
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      stage: 'replied',
      occurred_at: nowIso,
    })

  const { data: existingConv } = await supabase
    .from('conversation_states')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .maybeSingle()

  if (existingConv) {
    await supabase
      .from('conversation_states')
      .update({
        stage: 'replied',
        last_reply_at: nowIso,
        next_followup_at: null,
        updated_at: nowIso,
      })
      .eq('id', existingConv.id as string)
  } else {
    await supabase
      .from('conversation_states')
      .insert({
        organization_id: organizationId,
        lead_id: leadId,
        stage: 'replied',
        last_sent_at: null,
        last_sent_message_id: (insertedMsg?.id as string) ?? null,
        last_reply_at: nowIso,
        sender_profile_id: null,
        followup_count: 0,
        commercial_state: {},
      })
  }

  await supabase.rpc('emit_relay_event', {
    p_org_id: organizationId,
    p_event_type: 'CLIENT_REPLIED',
    p_entity_type: 'lead',
    p_entity_id: leadId,
    p_actor_type: 'integration',
    p_actor_id: null,
    p_revenue_identity_id: revenueIdentityId,
    p_source: 'email_webhook',
    p_source_event_id: `client_replied:${emailMessage.id as string}`,
    p_correlation_id: null,
    p_causation_id: null,
    p_relay_run_id: null,
    p_payload: {
      channel: 'email',
      emailMessageId: emailMessage.id,
      providerMessageId: emailMessage.provider_message_id,
    },
    p_metadata: {},
    p_occurred_at: nowIso,
  })
}

export async function POST(request: Request) {
  const requiredSecret = process.env.EMAIL_WEBHOOK_SECRET
  if (!requiredSecret) {
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 500 })
  }
  const provided = request.headers.get('x-relay-webhook-secret')
  if (!provided || provided !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized webhook.' }, { status: 401 })
  }

  let body: {
    provider?: string
    eventId?: string
    eventType?: string
    providerMessageId?: string | null
    providerThreadId?: string | null
    replyBody?: string | null
    occurredAt?: string | null
    payload?: Record<string, unknown>
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const provider = body.provider?.trim() || 'relay_noop'
  const eventType = body.eventType?.trim().toUpperCase() || ''
  if (!eventType) return NextResponse.json({ error: 'eventType is required.' }, { status: 400 })

  if (!body.providerMessageId && !body.providerThreadId) {
    return NextResponse.json({ error: 'providerMessageId or providerThreadId is required.' }, { status: 400 })
  }

  try {
    const supabase = createServiceSupabase()

    const messageLookup = body.providerMessageId
      ? await supabase
          .from('email_messages')
          .select('*')
          .eq('provider', provider)
          .eq('provider_message_id', body.providerMessageId)
          .maybeSingle()
      : await supabase
          .from('email_messages')
          .select('*')
          .eq('provider', provider)
          .eq('provider_thread_id', body.providerThreadId ?? '')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

    if (messageLookup.error) throw messageLookup.error
    const emailMessage = (messageLookup.data ?? null) as Row | null
    if (!emailMessage) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'message_not_found' })
    }

    const organizationId = emailMessage.organization_id as string
    const eventId = body.eventId?.trim() || `${provider}:${eventType}:${body.providerMessageId ?? body.providerThreadId}`

    const { data: existingEvent } = await supabase
      .from('email_delivery_events')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('provider_event_id', eventId)
      .maybeSingle()

    if (existingEvent) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const status = eventToDeliveryStatus(eventType)
    const nowIso = body.occurredAt ?? new Date().toISOString()
    const currentStatus = (emailMessage.delivery_status as string) ?? 'SENT'
    const nextStatus = stableDeliveryStatus(currentStatus, status)
    const alreadyReplied = currentStatus === 'REPLIED' || Boolean(emailMessage.replied_at)

    await supabase
      .from('email_delivery_events')
      .insert({
        organization_id: organizationId,
        email_message_id: emailMessage.id as string,
        provider_event_id: eventId,
        event_type: eventType,
        payload: body.payload ?? {},
        occurred_at: nowIso,
      })

    const patch: Record<string, unknown> = {
      delivery_status: nextStatus,
      last_event_at: nowIso,
      updated_at: new Date().toISOString(),
    }
    if (status === 'DELIVERED' && !emailMessage.delivered_at) patch.delivered_at = nowIso
    if (status === 'BOUNCED' && !emailMessage.bounced_at) patch.bounced_at = nowIso
    if (status === 'REPLIED' && !emailMessage.replied_at) patch.replied_at = nowIso

    await supabase
      .from('email_messages')
      .update(patch)
      .eq('id', emailMessage.id as string)
      .eq('organization_id', organizationId)

    if (status === 'BOUNCED' || eventType === 'UNSUBSCRIBE') {
      const reason = eventType === 'UNSUBSCRIBE' ? 'UNSUBSCRIBE' : 'BOUNCE'
      const contactPointId = (emailMessage.contact_point_id as string) ?? null

      let suppressedEmail: string | null = null
      if (contactPointId) {
        const { data: cp } = await supabase
          .from('contact_points')
          .select('value')
          .eq('id', contactPointId)
          .eq('organization_id', organizationId)
          .maybeSingle()
        suppressedEmail = (cp?.value as string) ?? null

        await supabase
          .from('contact_points')
          .update({
            verification_status: status === 'BOUNCED' ? 'BOUNCED' : 'INVALID',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contactPointId)
          .eq('organization_id', organizationId)
      }

      const payloadEmail = typeof body.payload?.recipientEmail === 'string' ? body.payload.recipientEmail : null
      const email = suppressedEmail ?? payloadEmail
      if (email) {
        await supabase
          .from('email_suppressions')
          .upsert({
            organization_id: organizationId,
            lead_id: emailMessage.lead_id as string,
            contact_point_id: contactPointId,
            email,
            reason,
            active: true,
            source: 'provider_webhook',
            notes: `${provider}:${eventType}`,
          }, { onConflict: 'organization_id,email_key,reason,active' })
      }
    }

    if (status === 'REPLIED' && !alreadyReplied) {
      await updateConversationOnReply(supabase, emailMessage, body.replyBody ?? null)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return safeErrorResponse(error, 500, 'Failed to process email webhook.', 'email/webhook')
  }
}
