/**
 * Regression tests for Inbound → Lead persistence.
 *
 * Covers:
 *   - Commercial facts (budget, timeline) survive the save round-trip.
 *   - Canonical score is persisted so the lead is not shown as unscored.
 *   - Buyer-intent evidence is preserved.
 *   - History timeline includes the inbound opening message.
 */
import { describe, expect, it } from 'vitest'

// ── Mock store persistence ─────────────────────────────────────────────────

import { buildMockStore } from '@/lib/store/mock-store'

const REBECCA_MSG = [
  'Good afternoon,',
  '',
  'This is Rebecca Morgan from NovaBridge Analytics.',
  '',
  "We're currently evaluating external software development agencies to build a customer analytics dashboard.",
  '',
  'Our management has approved spending up to $75,000.',
  '',
  'Our preferred delivery window is Q1 2027.',
  '',
  'Kind regards,',
  'Rebecca',
  'Engineering Director',
].join('\n')

describe('MockStore — inbound lead persistence', () => {
  it('persists canonicalIntelligence, canonicalScore, qualification, and buyerIntent', async () => {
    const store = buildMockStore({ rep: { id: 'rep-1', name: 'Hassan', organizationId: 'org-1' } as any, mode: 'demo' } as any)

    // Simulate what the inbound save route now sends.
    const result = await store.createLead({
      company: 'NovaBridge Analytics',
      contactName: 'Rebecca Morgan',
      contactTitle: 'Engineering Director',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: REBECCA_MSG,
      inboundRaw: { context: null, jobInfo: null, profileInfo: null },
      canonicalIntelligence: {
        intelligence: {
          canonicalScore: 62,
          person: { fullName: 'Rebecca Morgan' },
          company: { name: 'NovaBridge Analytics' },
        },
        qualification: 'WORTH_PURSUING',
      },
      canonicalScore: 62,
      qualification: 'WORTH_PURSUING',
      buyerIntent: { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true },
      assignedProfileId: null,
    })

    expect(result.blocked).toBe(false)
    expect(result.lead).not.toBeNull()
    const lead = result.lead!
    expect(lead.canonicalScore).toBe(62)
    expect(lead.qualification).toBe('WORTH_PURSUING')
    expect(lead.buyerIntent).toEqual({ buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true })
    expect(lead.canonicalIntelligence).toBeTruthy()
  })

  it('persists the inbound message so History can show it', async () => {
    const store = buildMockStore({ rep: { id: 'rep-2', name: 'Hassan', organizationId: 'org-1' } as any, mode: 'demo' } as any)
    const result = await store.createLead({
      company: 'Acme',
      contactName: 'Jonathan Reed',
      contactTitle: 'Product Manager',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: 'Our CEO approved a $120,000 project budget. We need a SaaS platform.',
    })
    expect(result.lead?.inboundMessage).toBe('Our CEO approved a $120,000 project budget. We need a SaaS platform.')
  })

  it('does NOT fabricate a score when none is provided', async () => {
    const store = buildMockStore({ rep: { id: 'rep-3', name: 'Hassan', organizationId: 'org-1' } as any, mode: 'demo' } as any)
    const result = await store.createLead({
      company: 'NoScore Inc',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: 'Hello, we need help.',
    })
    // When no canonicalScore is provided, the lead should NOT have a fabricated score.
    expect(result.lead?.canonicalScore).toBeNull()
    expect(result.lead?.score).toBeNull()
  })
})

// ── Display score behavior ────────────────────────────────────────────────

import { getLeadDisplayScore } from '@/lib/scoring/display-score'

describe('getLeadDisplayScore — inbound leads', () => {
  it('shows "Unscored" (not 0) when no canonical score exists', () => {
    const lead = { canonicalScore: null, canonicalIntelligence: null, score: null } as any
    const display = getLeadDisplayScore(lead)
    expect(display.value).toBeNull()
    expect(display.text).toBe('—')
    expect(display.label).toBe('Unscored')
  })

  it('shows the canonical score when present', () => {
    const lead = { canonicalScore: 62, canonicalIntelligence: null, score: null } as any
    const display = getLeadDisplayScore(lead)
    expect(display.value).not.toBeNull()
    expect(display.qualification).not.toBeNull()
    expect(display.label).not.toBe('Unscored')
  })

  it('does not confuse legacy score with canonical score', () => {
    const lead = { canonicalScore: null, canonicalIntelligence: null, score: 5 } as any
    const display = getLeadDisplayScore(lead)
    expect(display.value).toBe(5)
    expect(display.max).toBe(12)
    expect(display.label).toBe('Legacy score')
  })
})

// ── History timeline ──────────────────────────────────────────────────────

describe('History timeline — inbound message visibility', () => {
  it('the buildThread function creates an inbound_first turn from lead.inboundMessage', async () => {
    const { buildThread } = await import('@/lib/conversation/thread')
    const lead = {
      id: 'lead-1',
      direction: 'inbound' as const,
      inboundMessage: 'Hello, we need a new platform.',
      messages: [],
      createdAt: new Date().toISOString(),
    } as any
    const thread = buildThread(lead)
    expect(thread.length).toBeGreaterThan(0)
    expect(thread[0].kind).toBe('inbound_first')
    expect(thread[0].text).toContain('Hello, we need a new platform.')
  })

  it('an inbound message is NOT silently dropped', async () => {
    const { buildThread } = await import('@/lib/conversation/thread')
    const lead = {
      id: 'lead-2',
      direction: 'inbound' as const,
      inboundMessage: 'Our budget is $50k and we need this by March.',
      messages: [],
      createdAt: new Date().toISOString(),
    } as any
    const thread = buildThread(lead)
    const hasMessage = thread.some((t) => t.text?.includes('$50k'))
    expect(hasMessage).toBe(true)
  })
})
