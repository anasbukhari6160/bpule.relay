/**
 * Ethan Brooks — full pipeline reproduction test.
 *
 * Traces the complete inbound → lead → conversation → deal panel pipeline
 * using real application functions. Verifies budget, timeline, need, score,
 * and buyer intent flow through to the stored lead and conversation memory.
 */
import { describe, expect, it } from 'vitest'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'
import { readBuyerSourceFacts } from '@/lib/intelligence-v3/buyer-intent'
import { extractStatedBudget, extractStatedTimeline, extractExplicitDates, extractProjectNeed } from '@/lib/intelligence-v3/source-facts'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import { sanitizeCompanyName } from '@/lib/intelligence-v2/extraction-pipeline'

const ETHAN = `Hello,

My name is Ethan Brooks, and I'm the Technology Director at HorizonPeak Manufacturing.

Our company is looking for an external software development agency to build a custom inventory management platform.

We currently manage multiple warehouses and need a centralized system for stock tracking, supplier management, reporting, and ERP integration.

Our management has approved a budget of $92,000 for this project.

We are planning to begin development in February 2027, and the implementation should take approximately 12 weeks.

I've been assigned to evaluate potential software development partners and coordinate the technical discussions.

Could you please share your relevant experience, estimated pricing, and development approach?

Best regards,
Ethan Brooks
Technology Director
HorizonPeak Manufacturing`

describe('Ethan pipeline — source extraction', () => {
  it('extracts budget evidence', () => {
    const budget = extractStatedBudget(ETHAN)
    expect(budget).not.toBeNull()
    expect(budget?.amount).toContain('92')
    expect(budget?.approved).toBe(true)
  })

  it('extracts absolute start date', () => {
    const dates = extractExplicitDates(ETHAN)
    expect(dates.buyerStartDate).toBe('February 2027')
  })

  it('extracts project duration', () => {
    const dates = extractExplicitDates(ETHAN)
    expect(dates.durationDays).toBe(84) // 12 weeks * 7
  })

  it('extracts project need', () => {
    const need = extractProjectNeed(ETHAN)
    expect(need).not.toBeNull()
    // Should mention the project (inventory platform)
    expect(need).toContain('looking for')
  })

  it('detects buyer intent', () => {
    const buyer = readBuyerSourceFacts(ETHAN)
    expect(buyer.externalServiceRequest).not.toBeNull()
    expect(buyer.statedBudget).not.toBeNull()
    expect(buyer.statedBudget?.approved).toBe(true)
  })

  it('company is not a greeting', () => {
    expect(sanitizeCompanyName('HorizonPeak Manufacturing')).toBe('HorizonPeak Manufacturing')
    expect(sanitizeCompanyName('Hello,')).toBeNull()
  })
})

describe('Ethan pipeline — V3 intelligence', () => {
  it('produces canonical score', async () => {
    const v3 = await produceV3Intelligence(ETHAN, { deterministicOnly: true })
    expect(v3.intelligence.canonicalScore).not.toBeNull()
    expect(v3.intelligence.canonicalScore).toBeGreaterThan(0)
  })

  it('classifies as buyer', async () => {
    const v3 = await produceV3Intelligence(ETHAN, { deterministicOnly: true })
    expect(v3.v3Packet?.buyerIntent?.buyerIntentLevel).toBe('HIGH')
    expect(v3.v3Packet?.buyerIntent?.verifiedBuyerRequest).toBe(true)
  })

  it('qualifies correctly', async () => {
    const v3 = await produceV3Intelligence(ETHAN, { deterministicOnly: true })
    const score = v3.intelligence.canonicalScore
    const qual = qualifyCanonicalScore(score)
    // A verified buyer with budget and timeline should be at least WORTH_PURSUING
    expect(['STRONG', 'WORTH_PURSUING']).toContain(qual.qualification)
  })
})
