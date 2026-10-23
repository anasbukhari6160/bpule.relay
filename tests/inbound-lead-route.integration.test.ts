import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createScoutStoreMock,
  captureClientReplyMock,
  findLatestSampleForLeadMock,
  produceV3IntelligenceMock,
} = vi.hoisted(() => ({
  createScoutStoreMock: vi.fn(),
  captureClientReplyMock: vi.fn(),
  findLatestSampleForLeadMock: vi.fn(),
  produceV3IntelligenceMock: vi.fn(),
}))

vi.mock('@/lib/store', () => ({ createScoutStore: createScoutStoreMock }))
vi.mock('@/lib/dataset/service', () => ({
  captureClientReply: captureClientReplyMock,
  findLatestSampleForLead: findLatestSampleForLeadMock,
}))
vi.mock('@/lib/intelligence-v3/bridge', () => ({
  produceV3Intelligence: produceV3IntelligenceMock,
}))

import { POST } from '@/app/api/inbound/lead/route'

const MESSAGE = 'We need an engineering partner to rebuild our billing portal. Budget approved at $80,000.'

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-inbound-1',
    organizationId: 'org-1',
    ownerRepId: 'rep-1',
    company: 'Northstar Labs',
    companyKey: 'northstarlabs',
    contactName: 'Maya Chen',
    contactTitle: 'VP Engineering',
    url: null,
    direction: 'inbound',
    source: 'linkedin',
    inboundMessage: MESSAGE,
    inboundRaw: { idempotencyKey: 'request-key-0001' },
    senderProfileId: null,
    status: 'new',
    score: 0,
    verdict: 'research_more',
    tags: [],
    createdAt: '2026-10-23T00:00:00.000Z',
    ...overrides,
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/inbound/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: 'Northstar Labs',
      contactName: 'Maya Chen',
      contactTitle: 'VP Engineering',
      message: MESSAGE,
      source: 'linkedin',
      idempotencyKey: 'request-key-0001',
      ...overrides,
    }),
  })
}

function analysisFixture() {
  return {
    intelligence: {
      canonicalScore: 84,
      intelligenceVersion: 'v3.0.0',
      scoreVersion: 'canonical-v3',
      scoredAt: '2026-10-23T00:00:00.000Z',
      scoreBreakdown: { need: 20, authority: 18 },
      intelligence: {
        company: { name: 'Northstar Labs' },
        person: { fullName: 'Maya Chen', title: 'VP Engineering' },
        opportunity: { description: 'Billing portal rebuild' },
      },
    },
    v3Packet: {
      buyerIntent: { verifiedBuyerRequest: true, buyerIntentLevel: 'HIGH' },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  produceV3IntelligenceMock.mockResolvedValue(analysisFixture())
  findLatestSampleForLeadMock.mockResolvedValue(null)
})

describe('POST /api/inbound/lead integration boundary', () => {
  it('returns 401 when no authenticated store can be created', async () => {
    createScoutStoreMock.mockRejectedValue(new Error('no session'))
    const response = await POST(request() as never)
    expect(response.status).toBe(401)
    expect(produceV3IntelligenceMock).not.toHaveBeenCalled()
  })

  it('rejects forged and cross-organization sender profiles before analysis or writes', async () => {
    const createLead = vi.fn()
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([
        { id: 'profile-forged', organizationId: 'org-2', label: 'Other tenant' },
      ]),
      createLead,
    })

    const response = await POST(request({ assignedProfileId: 'profile-forged' }) as never)

    expect(response.status).toBe(403)
    expect(createLead).not.toHaveBeenCalled()
    expect(produceV3IntelligenceMock).not.toHaveBeenCalled()
  })

  it('returns a visible retryable failure when the lead exists but conversation creation fails', async () => {
    const lead = makeLead()
    const upsertConversationState = vi.fn().mockRejectedValue(new Error('conversation write failed'))
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: false, lead }),
      upsertConversationState,
      getSupabaseClient: vi.fn(),
    })

    const response = await POST(request() as never)
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload).toEqual(expect.objectContaining({
      retryable: true,
      incomplete: true,
      leadId: lead.id,
      idempotencyKey: 'request-key-0001',
    }))
    expect(upsertConversationState).toHaveBeenCalledTimes(1)
  })

  it('repairs the conversation on retry without creating a second lead', async () => {
    const lead = makeLead()
    const createLead = vi
      .fn()
      .mockResolvedValueOnce({ blocked: false, lead })
      .mockResolvedValueOnce({ blocked: true, reason: 'duplicate', lead })
    const upsertConversationState = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined)
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead,
      upsertConversationState,
      getSupabaseClient: vi.fn(),
    })

    const first = await POST(request() as never)
    const second = await POST(request() as never)
    const secondPayload = await second.json()

    expect(first.status).toBe(503)
    expect(second.status).toBe(200)
    expect(secondPayload).toEqual(expect.objectContaining({
      lead: expect.objectContaining({ id: lead.id }),
      idempotent: true,
      recovered: true,
    }))
    expect(createLead).toHaveBeenCalledTimes(2)
    expect(upsertConversationState).toHaveBeenCalledTimes(2)
  })

  it('recovers an exact retry after the original response outcome was unknown', async () => {
    const lead = makeLead()
    const upsertConversationState = vi.fn().mockResolvedValue(undefined)
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: true, reason: 'duplicate', lead }),
      upsertConversationState,
      getSupabaseClient: vi.fn(),
    })

    const response = await POST(request() as never)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual(expect.objectContaining({ idempotent: true, recovered: true }))
    expect(upsertConversationState).toHaveBeenCalledWith(expect.objectContaining({ leadId: lead.id }))
  })

  it('preserves an authorized sender profile through partial-failure recovery', async () => {
    const lead = makeLead({ senderProfileId: 'profile-1' })
    const createLead = vi
      .fn()
      .mockResolvedValueOnce({ blocked: false, lead })
      .mockResolvedValueOnce({ blocked: true, reason: 'duplicate', lead })
    const upsertConversationState = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined)
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([
        { id: 'profile-1', organizationId: 'org-1', label: 'Authorized' },
      ]),
      createLead,
      upsertConversationState,
      getSupabaseClient: vi.fn(),
    })

    const first = await POST(request({ assignedProfileId: 'profile-1' }) as never)
    const second = await POST(request({ assignedProfileId: 'profile-1' }) as never)

    expect(first.status).toBe(503)
    expect(second.status).toBe(200)
    expect(createLead).toHaveBeenNthCalledWith(1, expect.objectContaining({ assignedProfileId: 'profile-1' }))
    expect(upsertConversationState).toHaveBeenNthCalledWith(1, expect.objectContaining({ senderProfileId: 'profile-1' }))
    expect(upsertConversationState).toHaveBeenNthCalledWith(2, expect.objectContaining({ senderProfileId: 'profile-1' }))
  })

  it('turns concurrent submissions into one create plus an idempotent completion', async () => {
    const lead = makeLead()
    let inserted = false
    const createLead = vi.fn().mockImplementation(async () => {
      if (!inserted) {
        inserted = true
        return { blocked: false, lead }
      }
      return { blocked: true, reason: 'duplicate', lead }
    })
    const upsertConversationState = vi.fn().mockResolvedValue(undefined)
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead,
      upsertConversationState,
      getSupabaseClient: vi.fn(),
    })

    const responses = await Promise.all([
      POST(request() as never),
      POST(request() as never),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
    expect(upsertConversationState).toHaveBeenCalledTimes(2)
  })

  it('does not recover an idempotency collision owned by another user', async () => {
    const otherUsersLead = makeLead({ ownerRepId: 'rep-2' })
    const upsertConversationState = vi.fn()
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: true, reason: 'duplicate', lead: otherUsersLead }),
      upsertConversationState,
      getSupabaseClient: vi.fn(),
    })

    const response = await POST(request() as never)
    expect(response.status).toBe(409)
    expect(upsertConversationState).not.toHaveBeenCalled()
  })

  it('does not recover a duplicate contact with a reused key when persisted inputs differ', async () => {
    const existing = makeLead({
      inboundRaw: { idempotencyKey: 'request-key-0001', context: 'Original context' },
    })
    const upsertConversationState = vi.fn()
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: true, reason: 'duplicate', lead: existing }),
      upsertConversationState,
    })

    const response = await POST(request({ context: 'Changed context' }) as never)

    expect(response.status).toBe(409)
    expect(upsertConversationState).not.toHaveBeenCalled()
  })

  it('does not recover a matching operation key from another organization', async () => {
    const otherOrganizationsLead = makeLead({ organizationId: 'org-2' })
    const upsertConversationState = vi.fn()
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: true, reason: 'duplicate', lead: otherOrganizationsLead }),
      upsertConversationState,
    })

    const response = await POST(request() as never)

    expect(response.status).toBe(409)
    expect(upsertConversationState).not.toHaveBeenCalled()
  })

  it('does not invoke an unsupported Supabase client in demo storage mode', async () => {
    const getSupabaseClient = vi.fn(() => { throw new Error('unsupported in demo') })
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: false, lead: makeLead() }),
      upsertConversationState: vi.fn().mockResolvedValue(undefined),
      getSupabaseClient,
    })

    const previous = process.env.SCOUT_DB
    process.env.SCOUT_DB = 'demo'
    try {
      const response = await POST(request() as never)
      expect(response.status).toBe(201)
      expect(getSupabaseClient).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.SCOUT_DB
      else process.env.SCOUT_DB = previous
    }
  })

  it('keeps optional dataset failures non-fatal after the core workflow succeeds', async () => {
    const getSupabaseClient = vi.fn(() => ({ fake: true }))
    findLatestSampleForLeadMock.mockRejectedValueOnce(new Error('analytics unavailable'))
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockResolvedValue({ blocked: false, lead: makeLead() }),
      upsertConversationState: vi.fn().mockResolvedValue(undefined),
      getSupabaseClient,
    })

    const previous = process.env.SCOUT_DB
    process.env.SCOUT_DB = 'supabase'
    try {
      const response = await POST(request() as never)
      expect(response.status).toBe(201)
      expect(getSupabaseClient).toHaveBeenCalledTimes(1)
      expect(findLatestSampleForLeadMock).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === undefined) delete process.env.SCOUT_DB
      else process.env.SCOUT_DB = previous
    }
  })

  it('reports a Supabase lead-write failure without claiming success', async () => {
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead: vi.fn().mockRejectedValue(new Error('database unavailable')),
    })

    const response = await POST(request() as never)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to save inbound lead.' })
  })

  it('blocks secrets directly on the save route before analysis or writes', async () => {
    const createLead = vi.fn()
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead,
    })

    const response = await POST(request({
      message: 'We need a vendor.',
      context: 'AWS_SECRET_ACCESS_KEY=not-a-real-secret-but-shaped-like-one',
    }) as never)

    expect(response.status).toBe(400)
    expect(createLead).not.toHaveBeenCalled()
    expect(produceV3IntelligenceMock).not.toHaveBeenCalled()
  })

  it('scans identity fields before saving, not only the scoring text', async () => {
    const createLead = vi.fn()
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead,
    })

    const response = await POST(request({
      company: 'AWS_SECRET_ACCESS_KEY=not-a-real-secret-but-shaped-like-one',
    }) as never)

    expect(response.status).toBe(400)
    expect(createLead).not.toHaveBeenCalled()
    expect(produceV3IntelligenceMock).not.toHaveBeenCalled()
  })

  it('rejects malformed runtime fields instead of throwing or coercing them', async () => {
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
    })

    const response = await POST(request({ company: { name: 'Northstar Labs' }, source: 'carrier-pigeon' }) as never)
    expect(response.status).toBe(400)
  })

  it('persists all server-derived canonical metadata and ignores forged client decisions', async () => {
    const createLead = vi.fn().mockResolvedValue({ blocked: false, lead: makeLead() })
    createScoutStoreMock.mockResolvedValue({
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead,
      upsertConversationState: vi.fn().mockResolvedValue(undefined),
      getSupabaseClient: vi.fn(),
    })

    const response = await POST(request({
      canonicalScore: 1,
      qualification: 'SKIP',
      buyerIntent: { verifiedBuyerRequest: false },
      canonicalIntelligence: { canonicalScore: 1, forged: true },
    }) as never)

    expect(response.status).toBe(201)
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({
      canonicalScore: 84,
      qualification: 'STRONG',
      buyerIntent: expect.objectContaining({ verifiedBuyerRequest: true }),
      scoreVersion: 'canonical-v3',
      scoredAt: '2026-10-23T00:00:00.000Z',
      scoreBreakdown: { need: 20, authority: 18 },
    }))
    expect(createLead.mock.calls[0]?.[0].canonicalIntelligence).not.toHaveProperty('forged')
  })
})
