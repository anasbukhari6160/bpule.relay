import { describe, expect, it } from 'vitest'
import { extractIntroduction } from '@/lib/intelligence-v2/extraction-pipeline'
import { readBuyerSourceFacts } from '@/lib/intelligence-v3/buyer-intent'
import { classifyLine, detectCommercialRequest } from '@/lib/intelligence-v3/source-facts'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { refreshMemory } from '@/lib/conversation/memory'
import type { LeadDetail } from '@/lib/store/types'

describe('inbound identity and buyer provenance regressions', () => {
  it('does not treat arbitrary text after a standalone I as an introduction', () => {
    expect(extractIntroduction('I Need Help With Billing')).toBeNull()
    expect(extractIntroduction('I saw Aurora Commerce at the conference.')).toBeNull()
  })

  it('recognizes Unicode introductions and attributes the full identity', () => {
    expect(extractIntroduction('I am Zoë Müller, VP Engineering at Aurora Commerce.')).toEqual({
      name: 'Zoë Müller',
      role: 'VP Engineering',
      company: 'Aurora Commerce',
    })
  })

  it('recognizes delegated procurement without accepting bare find/finding prose', () => {
    expect(classifyLine('I have been assigned to find an external data engineering consultancy.')).toBe('external_request')
    expect(classifyLine('Jonathan was assigned to find an external development agency.')).toBe('external_request')
    expect(classifyLine('I find agency case studies useful for our newsletter.')).toBe('neutral')
    expect(classifyLine('Finding developers at conferences is difficult.')).toBe('neutral')
  })

  it('does not promote seller pricing, urgency or project copy into buyer facts', () => {
    const seller = [
      'I am a freelance product engineer available for new clients.',
      'My project budget starts at $20,000.',
      'I can start immediately and build your checkout platform.',
    ].join('\n')
    const buyer = readBuyerSourceFacts(seller)
    const facts = readSourceFacts(seller)

    expect(detectCommercialRequest(seller).externalServiceRequest).toBeNull()
    expect(buyer.statedBudget).toBeNull()
    expect(facts.budgetEvidence).toBeNull()
    expect(facts.timelineEvidence).toBeNull()
  })

  it('keeps commercial facts only when a current buyer-owned request establishes provenance', () => {
    const source = [
      'We need an external engineering partner to rebuild our checkout.',
      'The approved budget is $120,000.',
      'We need to start within 6 weeks.',
    ].join('\n')
    const buyer = readBuyerSourceFacts(source)
    const facts = readSourceFacts(source)

    expect(buyer.externalServiceRequest?.line).toContain('external engineering partner')
    expect(buyer.statedBudget?.amount).toBe('$120,000')
    expect(facts.timelineEvidence?.days).toBe(42)
  })

  it('does not persist seller-owned project copy into conversation deal memory', async () => {
    const sellerMessage = [
      'I am a freelance product engineer available for projects.',
      'My project budgets start at $20,000.',
      'I can begin immediately and build your checkout platform.',
    ].join('\n')
    const lead = {
      id: 'seller-lead', company: 'Independent Studio', contactName: 'Seller',
      contactTitle: 'Consultant', status: 'new', signalEvidence: null,
      rawInput: null, inboundMessage: sellerMessage, messages: [],
    } as unknown as LeadDetail

    const result = await refreshMemory(lead, [], null)
    expect(result.memory.facts.budget).toBeNull()
    expect(result.memory.facts.timeline).toBeNull()
    expect(result.memory.facts.need).toBeNull()
  })

  it('persists buyer-owned need, budget and timeline into conversation deal memory', async () => {
    const buyerMessage = [
      'We need an external engineering partner to rebuild our checkout.',
      'The approved budget is $120,000.',
      'We need to start within 6 weeks.',
    ].join('\n')
    const lead = {
      id: 'buyer-lead', company: 'Aurora Commerce', contactName: 'Buyer',
      contactTitle: 'VP Engineering', status: 'new', signalEvidence: null,
      rawInput: null, inboundMessage: buyerMessage, messages: [],
    } as unknown as LeadDetail

    const result = await refreshMemory(lead, [], null)
    expect(result.memory.facts.need).toContain('external engineering partner')
    expect(result.memory.facts.budget).toContain('$120,000')
    expect(result.memory.facts.timeline).toContain('6 weeks')
  })
})
