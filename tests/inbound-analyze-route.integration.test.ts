import { beforeEach, describe, expect, it, vi } from 'vitest'

const { analyzeInboundInputMock, createScoutStoreMock } = vi.hoisted(() => ({
  analyzeInboundInputMock: vi.fn(),
  createScoutStoreMock: vi.fn(),
}))

vi.mock('@/lib/store', () => ({ createScoutStore: createScoutStoreMock }))
vi.mock('@/lib/ai/config', () => ({ isDemoMode: () => true }))
vi.mock('@/lib/inbound/analysis', () => ({
  buildInboundAnalysisText: (input: { message: string; profileInfo?: string | null; jobInfo?: string | null; context?: string | null }) =>
    [input.message, input.profileInfo, input.jobInfo, input.context].filter(Boolean).join('\n\n'),
  buildInboundSensitiveText: (input: { message: string; company?: string | null; contactName?: string | null; contactTitle?: string | null; url?: string | null; profileInfo?: string | null; jobInfo?: string | null; context?: string | null }) =>
    [input.message, input.company, input.contactName, input.contactTitle, input.url, input.profileInfo, input.jobInfo, input.context].filter(Boolean).join('\n\n'),
  analyzeInboundInput: analyzeInboundInputMock,
}))
vi.mock('@/lib/dataset/service', () => ({
  captureClientReply: vi.fn(),
  findLatestSampleForLead: vi.fn().mockResolvedValue(null),
}))

import { POST as analyzePost } from '@/app/api/inbound/analyze/route'
import { POST as leadPost } from '@/app/api/inbound/lead/route'

function canonicalFixture() {
  const canonical = {
    canonicalScore: 84,
    scoreVersion: 'canonical-v3',
    scoredAt: '2026-10-23T00:00:00.000Z',
    scoreBreakdown: { total: 84, missingInfo: [], dimensions: [] },
    intelligenceVersion: 'v3.0.0',
    intelligence: {
      company: { name: 'Aurora Commerce' },
      person: { fullName: 'Zoë Müller', title: 'VP Engineering', linkedinUrl: null },
      opportunity: { description: 'Checkout rebuild' },
      content: { technicalSignals: ['React', 'payments'] },
    },
    rawSource: { sourceUrl: null },
  }
  const buyerIntent = { verifiedBuyerRequest: true, buyerIntentLevel: 'HIGH' }
  return {
    rawText: 'This is Zoë Müller from Aurora Commerce. We need an external partner.',
    canonical,
    canonicalScore: 84,
    qualification: 'STRONG',
    buyerIntent,
    canonicalIntelligence: { ...canonical, qualification: 'STRONG', buyerIntent },
    scoreVersion: 'canonical-v3',
    scoredAt: '2026-10-23T00:00:00.000Z',
    scoreBreakdown: canonical.scoreBreakdown,
  }
}

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  analyzeInboundInputMock.mockResolvedValue(canonicalFixture())
})

describe('inbound route integration', () => {
  it('requires authentication before analyzing', async () => {
    createScoutStoreMock.mockRejectedValue(new Error('no session'))
    const response = await analyzePost(request('/api/inbound/analyze', { message: 'hello', source: 'email' }) as never)
    expect(response.status).toBe(401)
    expect(analyzeInboundInputMock).not.toHaveBeenCalled()
  })

  it('validates and scans all analysis context before invoking scoring', async () => {
    createScoutStoreMock.mockResolvedValue({ getAssignedProfiles: vi.fn().mockResolvedValue([]) })
    const malformed = await analyzePost(request('/api/inbound/analyze', { message: ['not a string'] }) as never)
    expect(malformed.status).toBe(400)

    const sensitive = await analyzePost(request('/api/inbound/analyze', {
      message: 'We need a vendor.',
      source: 'email',
      context: 'AWS_SECRET_ACCESS_KEY=not-a-real-secret-but-shaped-like-one',
    }) as never)
    expect(sensitive.status).toBe(400)
    const sensitiveIdentity = await analyzePost(request('/api/inbound/analyze', {
      message: 'We need a vendor.',
      source: 'email',
      company: 'AWS_SECRET_ACCESS_KEY=not-a-real-secret-but-shaped-like-one',
    }) as never)
    expect(sensitiveIdentity.status).toBe(400)
    expect(analyzeInboundInputMock).not.toHaveBeenCalled()
  })

  it('returns the same authoritative score metadata that the save route persists', async () => {
    const createLead = vi.fn().mockImplementation(async (input) => ({
      blocked: false,
      lead: {
        id: 'lead-1',
        organizationId: 'org-1',
        ownerRepId: 'rep-1',
        company: input.company,
        companyKey: 'auroracommerce',
        direction: 'inbound',
        source: input.source,
        inboundMessage: input.inboundMessage,
        inboundRaw: input.inboundRaw,
        status: 'new',
      },
    }))
    const store = {
      organizationId: 'org-1',
      getCurrentRepId: () => 'rep-1',
      getAssignedProfiles: vi.fn().mockResolvedValue([]),
      createLead,
      upsertConversationState: vi.fn().mockResolvedValue(undefined),
    }
    createScoutStoreMock.mockResolvedValue(store)
    const input = {
      company: 'Aurora Commerce',
      message: 'This is Zoë Müller. We need an external partner.',
      source: 'email',
      idempotencyKey: 'route-parity-0001',
    }

    const preview = await analyzePost(request('/api/inbound/analyze', input) as never)
    const previewPayload = await preview.json()
    const save = await leadPost(request('/api/inbound/lead', {
      ...input,
      canonicalScore: 1,
      qualification: 'SKIP',
      buyerIntent: { verifiedBuyerRequest: false },
    }) as never)

    expect(preview.status).toBe(200)
    expect(save.status).toBe(201)
    const persisted = createLead.mock.calls[0]?.[0]
    expect(persisted.canonicalScore).toBe(previewPayload.canonical.canonicalScore)
    expect(persisted.scoreVersion).toBe(previewPayload.scoreVersion)
    expect(persisted.scoredAt).toBe(previewPayload.scoredAt)
    expect(persisted.scoreBreakdown).toEqual(previewPayload.scoreBreakdown)
    expect(persisted.qualification).toBe(previewPayload.qualification)
    expect(persisted.buyerIntent).toEqual(previewPayload.buyerIntent)
    expect(previewPayload.extracted).toEqual(expect.objectContaining({
      company: 'Aurora Commerce',
      contactName: 'Zoë Müller',
      contactTitle: 'VP Engineering',
    }))
  })
})
