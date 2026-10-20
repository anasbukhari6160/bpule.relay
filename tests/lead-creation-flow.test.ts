import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lead, OrganizationRulebook } from '@/lib/domain/types'
import { SIGNALS } from '@/lib/score/signals'
import { POST as createLeadRoute } from '@/app/api/leads/route'
import { POST as prospectSaveRoute } from '@/app/api/prospect/save/route'

const { createScoutStoreMock } = vi.hoisted(() => ({
  createScoutStoreMock: vi.fn(),
}))

vi.mock('@/lib/store', () => ({
  createScoutStore: createScoutStoreMock,
}))

const RULEBOOK: OrganizationRulebook = {
  organizationId: 'org-test',
  signals: SIGNALS,
  verdictThresholds: {
    send: { min: 10, max: 12 },
    research_more: { min: 7, max: 9 },
    skip: { min: 0, max: 6 },
  },
  maxSignalWeight: 7,
  maxCompleteness: 5,
  confidenceSendThreshold: 72,
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    organizationId: 'org-test',
    ownerRepId: 'rep-1',
    company: 'Riverlane Health',
    companyKey: 'riverlanehealth',
    contactName: 'Sarah Chen',
    contactTitle: 'CTO',
    titleRaw: 'CTO at Riverlane Health',
    locationRaw: 'San Francisco, California, United States',
    url: 'https://linkedin.com/in/sarah-chen',
    rawInput:
      'Sarah Chen CTO at Riverlane Health. Hiring senior Rails engineers to rebuild patient messaging. Own API performance and reduce p95 latency by 40% in 60 days.',
    roleCategory: 'technical_leadership',
    marketRegion: 'US',
    extractionConfidence: 86,
    extractionProfile: null,
    signalType: 1,
    signalEvidence:
      'Hiring senior Rails engineers to rebuild patient messaging and reduce p95 latency by 40% in 60 days.',
    verbatimQuote: null,
    score: 10,
    verdict: 'send',
    status: 'new',
    playId: null,
    tags: ['rails', 'healthcare'],
    direction: 'outbound',
    source: null,
    inboundMessage: null,
    inboundRaw: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    company: 'Riverlane Health',
    contactName: 'Sarah Chen',
    contactTitle: 'CTO',
    titleRaw: 'CTO at Riverlane Health',
    locationRaw: 'San Francisco, California, United States',
    aboutSummary: 'Leads engineering and product delivery for digital care experiences.',
    experienceSummary: '12 years in software leadership across healthcare SaaS.',
    signalType: 1,
    signalEvidence:
      'Hiring senior Rails engineers to rebuild patient messaging and reduce p95 latency by 40% in 60 days.',
    extractionConfidence: 86,
    url: 'https://linkedin.com/in/sarah-chen',
    tags: ['rails', 'healthcare', 'saas'],
    rawInput:
      'Sarah Chen CTO at Riverlane Health. Hiring senior Rails engineers to rebuild patient messaging. Own API performance and reduce p95 latency by 40% in 60 days.',
    ...overrides,
  }
}

beforeEach(() => {
  createScoutStoreMock.mockReset()
})

describe('Lead creation hardening flow', () => {
  it('rejects garbage raw input on /api/leads before touching the store', async () => {
    const req = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody({ rawInput: 'XYZ' })),
    })

    const res = await createLeadRoute(req)
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(createScoutStoreMock).not.toHaveBeenCalled()
    expect(data.qualification?.inputHardFail).toBe(true)
  })

  it('rejects URL-only raw input on /api/prospect/save before touching the store', async () => {
    const req = new Request('http://localhost/api/prospect/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody({ rawInput: 'https://linkedin.com/in/only-url' })),
    })

    const res = await prospectSaveRoute(req)
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(createScoutStoreMock).not.toHaveBeenCalled()
    expect(data.qualification?.inputHardFail).toBe(true)
  })

  it('returns explicit hard duplicate semantics from /api/leads', async () => {
    createScoutStoreMock.mockResolvedValue({
      getRulebook: vi.fn().mockResolvedValue(RULEBOOK),
      createLead: vi.fn().mockResolvedValue({
        blocked: true,
        duplicateKind: 'hard',
        reason: 'This profile URL already exists as a lead.',
        existingOwnerName: 'Hassan',
        lead: makeLead({ id: 'lead-existing', company: 'Acme Nail Polish Co' }),
      }),
    })

    const req = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody()),
    })

    const res = await createLeadRoute(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.duplicate).toBe(true)
    expect(data.duplicateKind).toBe('hard')
    expect(data.canCreateSeparate).toBe(false)
    expect(data.existingLeadId).toBe('lead-existing')
  })

  it('returns explicit potential duplicate semantics from /api/prospect/save', async () => {
    createScoutStoreMock.mockResolvedValue({
      getRulebook: vi.fn().mockResolvedValue(RULEBOOK),
      createLead: vi.fn().mockResolvedValue({
        blocked: true,
        duplicateKind: 'potential',
        reason: 'Potential duplicate: this company name is very similar to an existing lead.',
        existingOwnerName: 'Hassan',
        lead: makeLead({ id: 'lead-existing', company: 'Acme Nail Polish Co' }),
      }),
    })

    const req = new Request('http://localhost/api/prospect/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody()),
    })

    const res = await prospectSaveRoute(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.duplicate).toBe(true)
    expect(data.duplicateKind).toBe('potential')
    expect(data.canCreateSeparate).toBe(true)
  })

  it('passes score and verdict inside createLead payload (single write)', async () => {
    const createLeadMock = vi.fn().mockResolvedValue({
      blocked: false,
      lead: makeLead({ id: 'lead-new', score: 11, verdict: 'send' }),
    })
    const updateLeadScoreMock = vi.fn()

    createScoutStoreMock.mockResolvedValue({
      getRulebook: vi.fn().mockResolvedValue(RULEBOOK),
      createLead: createLeadMock,
      updateLeadScore: updateLeadScoreMock,
    })

    const req = new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody()),
    })

    const res = await createLeadRoute(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(createLeadMock).toHaveBeenCalledTimes(1)
    expect(createLeadMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        score: expect.any(Number),
        verdict: expect.stringMatching(/send|research_more|skip/),
      }),
    )
    expect(updateLeadScoreMock).not.toHaveBeenCalled()
    expect(data.lead.id).toBe('lead-new')
  })

  // Regression: Relay team bug bash, TEAM-002 (same lead shows different
  // scores internal vs external — duplicate source of truth). Found while
  // auditing every computeScore()/canonicalScore consumer: /api/prospect/save
  // persisted the legacy rubric's score UNCONDITIONALLY, even when canonical
  // intelligence (and its own, different-scale 0-100 score) was provided in
  // the same request. /api/leads already did this correctly ("Score: Use
  // canonical if available, else fall back to rubric"). A lead saved through
  // /prospect could end up with canonical_score=79 AND a numerically
  // unrelated legacy score column (whatever computeScore() happened to
  // compute from the extracted fields) — a real, persisted duplicate source
  // of truth, not just a display bug.
  //
  // Follow-up regression: the initial fix for TEAM-002 made /api/prospect/save
  // derive `score` from canonicalScore, but divided it onto a legacy 0-12
  // scale (round(canonicalScore / 10)) while /api/leads stored the raw 0-100
  // value in that same `leads.score` column. Two lead-creation endpoints
  // writing the same column on two different scales reintroduced the exact
  // inconsistency this test exists to prevent, just one level down. Both
  // endpoints now store the raw canonicalScore, matching /api/leads.
  it('/api/prospect/save derives the persisted legacy score column FROM canonicalScore when canonical intelligence is present, never independently', async () => {
    const createLeadMock = vi.fn().mockResolvedValue({
      blocked: false,
      lead: makeLead({ id: 'lead-canonical', score: 79, verdict: 'send', canonicalScore: 79 }),
    })

    createScoutStoreMock.mockResolvedValue({
      getRulebook: vi.fn().mockResolvedValue(RULEBOOK),
      createLead: createLeadMock,
    })

    const req = new Request('http://localhost/api/prospect/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody({
        canonicalScore: 79,
        canonical: { qualification: 'worth_pursuing' },
      })),
    })

    const res = await prospectSaveRoute(req)
    expect(res.status).toBe(201)
    expect(createLeadMock).toHaveBeenCalledTimes(1)
    const payload = createLeadMock.mock.calls[0]?.[0]
    const data = await res.json()
    // Same convention as /api/leads: `canonicalScore` is the authority and the
    // verdict follows its band. The legacy `score` column keeps the 0-12
    // rubric for pre-canonical surfaces; it is the route's own computation
    // (returned in the response), never a rescaled copy of the canonical.
    expect(payload.canonicalScore).toBe(79)
    expect(payload.score).toBe(data.score.total)
    expect(payload.score).toBeLessThanOrEqual(12)
    expect(payload.verdict).toBe('send') // 79 → STRONG band → 'send'
  })

  it('/api/prospect/save derives canonicalScore from the canonical object itself, not a separately-sent field that could disagree with it', async () => {
    const createLeadMock = vi.fn().mockResolvedValue({
      blocked: false,
      lead: makeLead({ id: 'lead-mismatch', canonicalScore: 79 }),
    })
    createScoutStoreMock.mockResolvedValue({
      getRulebook: vi.fn().mockResolvedValue(RULEBOOK),
      createLead: createLeadMock,
    })

    const req = new Request('http://localhost/api/prospect/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody({
        // Deliberately mismatched — the embedded canonical.canonicalScore
        // (the actual ground truth being persisted as canonicalIntelligence)
        // must win over this stale/wrong separately-sent field.
        canonicalScore: 12,
        canonical: { canonicalScore: 79, qualification: 'worth_pursuing' },
      })),
    })

    const res = await prospectSaveRoute(req)
    expect(res.status).toBe(201)
    const payload = createLeadMock.mock.calls[0]?.[0]
    expect(payload.canonicalScore).toBe(79) // from canonical.canonicalScore, NOT the mismatched top-level 12
    expect(payload.canonicalIntelligence.qualification).toBe('strong') // stored qualification follows the stored score
  })

  it('/api/prospect/save falls back to the legacy rubric score when NO canonical intelligence is provided (pre-canonical / manual-entry compatibility path)', async () => {
    const createLeadMock = vi.fn().mockResolvedValue({
      blocked: false,
      lead: makeLead({ id: 'lead-legacy-only' }),
    })

    createScoutStoreMock.mockResolvedValue({
      getRulebook: vi.fn().mockResolvedValue(RULEBOOK),
      createLead: createLeadMock,
    })

    const req = new Request('http://localhost/api/prospect/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody()), // no canonicalScore, no canonical
    })

    const res = await prospectSaveRoute(req)
    expect(res.status).toBe(201)
    const payload = createLeadMock.mock.calls[0]?.[0]
    expect(payload.canonicalScore).toBeNull()
    expect(typeof payload.score).toBe('number') // legacy computeScore() result, the only option available
  })
})
