import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './helpers/fake-supabase'

const ORG_ID = 'org-test'
const LEAD_ID = 'lead-1'
const EMAIL_MESSAGE_ID = 'email-msg-1'
const CONTACT_ID = 'cp-1'

const { createServiceSupabaseMock } = vi.hoisted(() => ({
  createServiceSupabaseMock: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabase: createServiceSupabaseMock,
}))

function buildWebhookHarness() {
  const fake = createFakeSupabase({
    email_messages: [
      {
        id: EMAIL_MESSAGE_ID,
        organization_id: ORG_ID,
        lead_id: LEAD_ID,
        message_id: 'msg-outbound-1',
        prepared_draft_id: 'draft-1',
        revenue_identity_id: 'ri-email-1',
        mailbox_id: 'mb-1',
        contact_point_id: CONTACT_ID,
        direction: 'OUTBOUND',
        category: 'FIRST_EMAIL',
        idempotency_key: 'idem-1',
        subject: 'Quick note',
        body: 'Hello',
        provider: 'relay_noop',
        provider_message_id: 'provider-msg-1',
        provider_thread_id: 'provider-thread-1',
        delivery_status: 'SENT',
        sent_at: '2026-01-01T10:00:00.000Z',
        delivered_at: null,
        bounced_at: null,
        replied_at: null,
        last_event_at: '2026-01-01T10:00:00.000Z',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ],
    contact_points: [
      {
        id: CONTACT_ID,
        organization_id: ORG_ID,
        lead_id: LEAD_ID,
        type: 'email',
        value: 'sarah@acmehealth.com',
        source: 'USER_PROVIDED',
        source_url: null,
        source_type: null,
        verification_status: 'VERIFIED',
        verification_method: null,
        confidence: 1,
        is_primary: true,
        is_business_contact: true,
        discovered_at: '2026-01-01T10:00:00.000Z',
        verified_at: null,
        last_used_at: null,
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ],
    leads: [
      {
        id: LEAD_ID,
        organization_id: ORG_ID,
        owner_rep_id: 'rep-1',
        status: 'contacted',
      },
    ],
    conversation_states: [
      {
        id: 'conv-1',
        organization_id: ORG_ID,
        lead_id: LEAD_ID,
        stage: 'contacted',
        last_sent_at: '2026-01-01T10:00:00.000Z',
        last_sent_message_id: 'msg-outbound-1',
        last_reply_at: null,
        sender_profile_id: null,
        followup_count: 1,
        next_followup_at: '2026-01-05T10:00:00.000Z',
        commercial_state: {},
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:00:00.000Z',
      },
    ],
    email_delivery_events: [],
    email_suppressions: [],
    messages: [],
    outcomes: [],
    relay_events: [],
  })

  createServiceSupabaseMock.mockReturnValue(fake.client)
  return fake
}

async function postWebhook(payload: Record<string, unknown>) {
  const { POST } = await import('@/app/api/email/webhook/route')
  const req = new Request('http://localhost/api/email/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-relay-webhook-secret': 'test-webhook-secret' },
    body: JSON.stringify(payload),
  })
  const res = await POST(req)
  return { res, data: await res.json() }
}

describe('Email webhook lifecycle integration', () => {
  const originalSecret = process.env.EMAIL_WEBHOOK_SECRET
  beforeEach(() => {
    vi.clearAllMocks()
    createServiceSupabaseMock.mockReset()
    process.env.EMAIL_WEBHOOK_SECRET = 'test-webhook-secret'
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.EMAIL_WEBHOOK_SECRET
    else process.env.EMAIL_WEBHOOK_SECRET = originalSecret
  })

  it('handles SENT -> DELIVERED -> REPLIED with duplicate/out-of-order events without duplicate activity', async () => {
    const h = buildWebhookHarness()

    const delivered = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-delivered-1',
      eventType: 'DELIVERED',
      providerMessageId: 'provider-msg-1',
      occurredAt: '2026-01-01T10:01:00.000Z',
    })
    expect(delivered.res.status).toBe(200)

    const replied = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-replied-1',
      eventType: 'REPLIED',
      providerMessageId: 'provider-msg-1',
      replyBody: 'Sounds interesting, can you send details?',
      occurredAt: '2026-01-01T10:02:00.000Z',
    })
    expect(replied.res.status).toBe(200)

    const duplicateReplyDifferentId = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-replied-2',
      eventType: 'REPLIED',
      providerMessageId: 'provider-msg-1',
      replyBody: 'duplicate reply webhook',
      occurredAt: '2026-01-01T10:03:00.000Z',
    })
    expect(duplicateReplyDifferentId.res.status).toBe(200)

    const outOfOrderDelivered = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-delivered-late',
      eventType: 'DELIVERED',
      providerMessageId: 'provider-msg-1',
      occurredAt: '2026-01-01T10:04:00.000Z',
    })
    expect(outOfOrderDelivered.res.status).toBe(200)

    const duplicateEventId = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-delivered-late',
      eventType: 'DELIVERED',
      providerMessageId: 'provider-msg-1',
      occurredAt: '2026-01-01T10:04:30.000Z',
    })
    expect(duplicateEventId.res.status).toBe(200)
    expect(duplicateEventId.data.duplicate).toBe(true)

    const emailMessage = h.tables.email_messages[0]
    expect(emailMessage.delivery_status).toBe('REPLIED')
    expect(emailMessage.delivered_at).toBe('2026-01-01T10:01:00.000Z')
    expect(emailMessage.replied_at).toBe('2026-01-01T10:02:00.000Z')

    expect(h.tables.messages).toHaveLength(1)
    expect(h.tables.messages[0]?.type).toBe('reply')
    expect(h.tables.outcomes).toHaveLength(1)
    expect(h.tables.outcomes[0]?.stage).toBe('replied')

    expect(h.tables.conversation_states).toHaveLength(1)
    expect(h.tables.conversation_states[0]?.id).toBe('conv-1')
    expect(h.tables.conversation_states[0]?.stage).toBe('replied')
    expect(h.tables.conversation_states[0]?.next_followup_at).toBeNull()

    expect(h.tables.leads[0]?.status).toBe('replied')
    expect(h.tables.relay_events).toHaveLength(1)
    expect(h.tables.relay_events[0]?.event_type).toBe('CLIENT_REPLIED')
  })

  it('handles SENT -> BOUNCED and SENT -> SUPPRESSED with out-of-order webhooks and no duplicate activity', async () => {
    const bouncedHarness = buildWebhookHarness()

    const bounced = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-bounced-1',
      eventType: 'BOUNCED',
      providerMessageId: 'provider-msg-1',
      payload: { recipientEmail: 'sarah@acmehealth.com' },
      occurredAt: '2026-01-01T10:01:00.000Z',
    })
    expect(bounced.res.status).toBe(200)

    await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-bounced-2',
      eventType: 'BOUNCED',
      providerMessageId: 'provider-msg-1',
      payload: { recipientEmail: 'sarah@acmehealth.com' },
      occurredAt: '2026-01-01T10:01:30.000Z',
    })

    await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-delivered-after-bounce',
      eventType: 'DELIVERED',
      providerMessageId: 'provider-msg-1',
      occurredAt: '2026-01-01T10:02:00.000Z',
    })

    expect(bouncedHarness.tables.email_messages[0]?.delivery_status).toBe('BOUNCED')
    expect(bouncedHarness.tables.contact_points[0]?.verification_status).toBe('BOUNCED')
    expect(bouncedHarness.tables.email_suppressions).toHaveLength(1)
    expect(bouncedHarness.tables.email_suppressions[0]?.reason).toBe('BOUNCE')
    expect(bouncedHarness.tables.messages).toHaveLength(0)
    expect(bouncedHarness.tables.outcomes).toHaveLength(0)
    expect(bouncedHarness.tables.relay_events).toHaveLength(0)

    const suppressedHarness = buildWebhookHarness()
    const unsubscribed = await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-unsub-1',
      eventType: 'UNSUBSCRIBE',
      providerMessageId: 'provider-msg-1',
      payload: { recipientEmail: 'sarah@acmehealth.com' },
      occurredAt: '2026-01-01T10:05:00.000Z',
    })
    expect(unsubscribed.res.status).toBe(200)

    await postWebhook({
      provider: 'relay_noop',
      eventId: 'event-delivered-after-unsub',
      eventType: 'DELIVERED',
      providerMessageId: 'provider-msg-1',
      occurredAt: '2026-01-01T10:06:00.000Z',
    })

    expect(suppressedHarness.tables.email_messages[0]?.delivery_status).toBe('SUPPRESSED')
    expect(suppressedHarness.tables.contact_points[0]?.verification_status).toBe('INVALID')
    expect(suppressedHarness.tables.email_suppressions).toHaveLength(1)
    expect(suppressedHarness.tables.email_suppressions[0]?.reason).toBe('UNSUBSCRIBE')
    expect(suppressedHarness.tables.messages).toHaveLength(0)
    expect(suppressedHarness.tables.outcomes).toHaveLength(0)
    expect(suppressedHarness.tables.relay_events).toHaveLength(0)
  })
})
