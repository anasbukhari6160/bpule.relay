import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from './helpers/fake-supabase'
import { mapLead, SupabaseStore } from '@/lib/store/supabase-store'
import type { Organization, Rep } from '@/lib/domain/types'

const rep: Rep = {
  id: 'rep-1', name: 'Rep One', role: 'rep', organizationId: 'org-1',
  createdAt: '2026-10-23T00:00:00.000Z', timezone: 'UTC',
}
const organization: Organization = {
  id: 'org-1', name: 'Org One', plan: 'active', billingCustomerId: null,
  timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], holidays: [],
  createdAt: '2026-10-23T00:00:00.000Z',
}

const canonical = {
  canonicalScore: 88,
  scoreVersion: 'canonical-v3',
  scoredAt: '2026-10-23T00:00:00.000Z',
  scoreBreakdown: { total: 88, dimensions: [] },
}
const buyerIntent = { verifiedBuyerRequest: true, buyerIntentLevel: 'HIGH' }

describe('inbound Supabase metadata parity', () => {
  it('maps canonical metadata, buyer intent and qualification from a Supabase row', () => {
    const lead = mapLead({
      id: 'lead-1', organization_id: 'org-1', owner_rep_id: 'rep-1',
      company: 'Aurora Commerce', company_key: 'auroracommerce', status: 'new',
      canonical_score: 88, score_version: 'canonical-v3',
      scored_at: '2026-10-23T00:00:00.000Z', score_breakdown: canonical.scoreBreakdown,
      canonical_intelligence: { ...canonical, buyerIntent, qualification: 'STRONG' },
      created_at: '2026-10-23T00:00:00.000Z',
    })

    expect(lead.canonicalScore).toBe(88)
    expect(lead.scoreVersion).toBe('canonical-v3')
    expect(lead.scoredAt).toBe('2026-10-23T00:00:00.000Z')
    expect(lead.scoreBreakdown).toEqual(canonical.scoreBreakdown)
    expect(lead.buyerIntent).toEqual(buyerIntent)
    expect(lead.qualification).toBe('STRONG')
    expect(lead.canonicalIntelligence).toEqual({ ...canonical, buyerIntent, qualification: 'STRONG' })
  })

  it('writes and reads every inbound canonical field through the Supabase store contract', async () => {
    const fake = createFakeSupabase()
    const store = new SupabaseStore(rep, fake.client as never, organization)
    const result = await store.createLead({
      company: 'Aurora Commerce',
      contactName: 'Zoë Müller',
      direction: 'inbound',
      source: 'email',
      inboundMessage: 'We need an external engineering partner.',
      canonicalScore: 88,
      scoreVersion: 'canonical-v3',
      scoredAt: '2026-10-23T00:00:00.000Z',
      scoreBreakdown: canonical.scoreBreakdown,
      canonicalIntelligence: canonical,
      buyerIntent,
      qualification: 'STRONG',
    })

    expect(result.blocked).toBe(false)
    expect(result.lead).toEqual(expect.objectContaining({
      canonicalScore: 88,
      scoreVersion: 'canonical-v3',
      scoredAt: '2026-10-23T00:00:00.000Z',
      scoreBreakdown: canonical.scoreBreakdown,
      buyerIntent,
      qualification: 'STRONG',
    }))
    expect(result.lead?.canonicalIntelligence).toEqual({ ...canonical, buyerIntent, qualification: 'STRONG' })
  })

  it('concurrently initializes one conversation row per lead', async () => {
    const fake = createFakeSupabase()
    const store = new SupabaseStore(rep, fake.client as never, organization)

    await Promise.all([
      store.upsertConversationState({ leadId: 'lead-1', stage: 'new', senderProfileId: 'profile-1' }),
      store.upsertConversationState({ leadId: 'lead-1', stage: 'new', senderProfileId: 'profile-1' }),
    ])

    expect(fake.tables.conversation_states).toHaveLength(1)
    expect(fake.tables.conversation_states[0]).toEqual(expect.objectContaining({
      organization_id: 'org-1',
      lead_id: 'lead-1',
      sender_profile_id: 'profile-1',
    }))
  })
})
