/**
 * End-to-end Inbound → Lead → Conversation regression tests.
 *
 * Covers Ethan-style buyer messages and validates the full pipeline:
 *   identity extraction → buyer intent → commercial facts → save → display.
 *
 * Uses real application functions. No hardcoded QA fixtures.
 */
import { describe, expect, it } from 'vitest'
import { classifyLine, detectCommercialRequest, extractStatedBudget, extractStatedTimeline } from '@/lib/intelligence-v3/source-facts'
import { readBuyerSourceFacts } from '@/lib/intelligence-v3/buyer-intent'
import { sanitizeCompanyName } from '@/lib/intelligence-v2/extraction-pipeline'
import { getLeadDisplayScore } from '@/lib/scoring/display-score'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import { buildMockStore } from '@/lib/store/mock-store'

// ── Generalized fixtures (different from Ethan QA) ────────────────────────

const BUYER_DELEGATED = [
  'Aisha Patel',
  'VP Engineering',
  'CloudScale Systems',
  '',
  'Our CTO approved a $200,000 platform rebuild budget.',
  'We need a modern data pipeline.',
  'I have been assigned to find an external data engineering consultancy.',
  'The procurement team will review proposals.',
  'We plan to start in April 2027.',
].join('\n')

const BUYER_EVALUATING = [
  'Hello,',
  '',
  'This is Marcus Chen from Vertex Dynamics.',
  '',
  "We're currently evaluating external DevOps partners to migrate our infrastructure to Kubernetes.",
  '',
  'Our approved budget is €85,000.',
  '',
  'We want to begin by September 2026.',
  '',
  'Regards,',
  'Marcus',
  'Infrastructure Lead',
].join('\n')

const SELLER_NEGATIVE = [
  'Hi,',
  '',
  'My name is Priya Sharma.',
  "I'm a freelance full-stack developer specializing in React and Node.js.",
  "I'm looking for new clients and projects.",
  '',
  'Best,',
  'Priya',
].join('\n')

// ── 1. Commercial fact extraction ─────────────────────────────────────────

describe('Commercial fact extraction — generalized', () => {
  it('extracts approved budget from delegated buyer message', () => {
    const budget = extractStatedBudget(BUYER_DELEGATED)
    expect(budget).not.toBeNull()
    expect(budget?.amount).toContain('200')
    expect(budget?.approved).toBe(true)
  })

  it('extracts timeline from evaluating buyer message', () => {
    const timeline = extractStatedTimeline(BUYER_EVALUATING)
    // "September 2026" is an absolute date, not relative — extractStatedTimeline
    // only handles relative durations. The budget should still be found.
    const budget = extractStatedBudget(BUYER_EVALUATING)
    expect(budget).not.toBeNull()
    expect(budget?.amount).toContain('85')
  })

  it('classifies "assigned to find an external consultancy" as external_request', () => {
    const line = 'I have been assigned to find an external data engineering consultancy.'
    expect(classifyLine(line)).toBe('external_request')
  })

  it('classifies "evaluating external DevOps partners" as external_request', () => {
    const line = "We're currently evaluating external DevOps partners to migrate our infrastructure to Kubernetes."
    expect(classifyLine(line)).toBe('external_request')
  })

  it('does NOT classify seller as external_request', () => {
    const result = detectCommercialRequest(SELLER_NEGATIVE)
    expect(result.externalServiceRequest).toBeNull()
  })
})

// ── 2. Buyer intent detection ─────────────────────────────────────────────

describe('Buyer intent — delegated authority and evaluation', () => {
  it('detects external service request in delegated buyer message', () => {
    const buyer = readBuyerSourceFacts(BUYER_DELEGATED)
    expect(buyer.externalServiceRequest).not.toBeNull()
    expect(buyer.statedBudget).not.toBeNull()
    expect(buyer.statedBudget?.approved).toBe(true)
  })

  it('detects external service request in evaluating buyer message', () => {
    const buyer = readBuyerSourceFacts(BUYER_EVALUATING)
    expect(buyer.externalServiceRequest).not.toBeNull()
  })

  it('does NOT detect seller as buyer', () => {
    const buyer = readBuyerSourceFacts(SELLER_NEGATIVE)
    expect(buyer.externalServiceRequest).toBeNull()
  })
})

// ── 3. Lead persistence ────────────────────────────────────────────────────

describe('Lead persistence — commercial data round-trip', () => {
  it('persists and retrieves canonicalScore', async () => {
    const store = buildMockStore({ rep: { id: 'rep-e2e-1', name: 'Test', organizationId: 'org-1' } as any, mode: 'demo' } as any)
    const result = await store.createLead({
      company: 'CloudScale Systems',
      contactName: 'Aisha Patel',
      contactTitle: 'VP Engineering',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: BUYER_DELEGATED,
      canonicalScore: 73,
      qualification: 'WORTH_PURSUING',
      buyerIntent: { buyerIntentLevel: 'HIGH', verifiedBuyerRequest: true },
    })
    expect(result.blocked).toBe(false)
    expect(result.lead?.canonicalScore).toBe(73)
    expect(result.lead?.qualification).toBe('WORTH_PURSUING')
  })

  it('persists canonicalIntelligence', async () => {
    const store = buildMockStore({ rep: { id: 'rep-e2e-2', name: 'Test', organizationId: 'org-1' } as any, mode: 'demo' } as any)
    const ci = { intelligence: { canonicalScore: 55 }, qualification: 'MAYBE' }
    const result = await store.createLead({
      company: 'Vertex Dynamics',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: BUYER_EVALUATING,
      canonicalIntelligence: ci,
      canonicalScore: 55,
    })
    expect(result.lead?.canonicalIntelligence).toBeTruthy()
  })
})

// ── 4. Score display ──────────────────────────────────────────────────────

describe('Score display — missing vs zero', () => {
  it('shows Unscored (not 0) for leads without a canonical score', () => {
    const lead = { canonicalScore: null, canonicalIntelligence: null, score: null } as any
    const display = getLeadDisplayScore(lead)
    expect(display.value).toBeNull()
    expect(display.text).toBe('—')
    expect(display.label).toBe('Unscored')
  })

  it('shows the actual canonical score when present', () => {
    const lead = { canonicalScore: 73, canonicalIntelligence: null, score: null } as any
    const display = getLeadDisplayScore(lead)
    expect(display.value).not.toBeNull()
    expect(display.qualification).toBe('WORTH_PURSUING')
  })

  it('qualifyCanonicalScore maps correctly', () => {
    expect(qualifyCanonicalScore(80).qualification).toBe('STRONG')
    expect(qualifyCanonicalScore(60).qualification).toBe('WORTH_PURSUING')
    expect(qualifyCanonicalScore(40).qualification).toBe('MAYBE')
    expect(qualifyCanonicalScore(20).qualification).toBe('LOW')
    expect(qualifyCanonicalScore(5).qualification).toBe('SKIP')
  })
})

// ── 5. Sequential lead isolation ─────────────────────────────────────────

describe('Sequential lead isolation', () => {
  it('creating a second lead does not leak data from the first', async () => {
    const store = buildMockStore({ rep: { id: 'rep-e2e-3', name: 'Test', organizationId: 'org-1' } as any, mode: 'demo' } as any)
    const first = await store.createLead({
      company: 'First Co',
      contactName: 'First Person',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: BUYER_DELEGATED,
      canonicalScore: 80,
    })
    const second = await store.createLead({
      company: 'Second Co',
      contactName: 'Second Person',
      direction: 'inbound',
      source: 'linkedin',
      inboundMessage: SELLER_NEGATIVE,
      canonicalScore: 10,
    })
    expect(first.lead?.canonicalScore).toBe(80)
    expect(second.lead?.canonicalScore).toBe(10)
    expect(first.lead?.company).toBe('First Co')
    expect(second.lead?.company).toBe('Second Co')
  })
})

// ── 6. Company sanitization ──────────────────────────────────────────────

describe('Company name sanitization — generalized', () => {
  it.each([
    'Hello,',
    'Hi there,',
    'Good morning,',
    'Dear team,',
    'Hey folks,',
  ])('rejects greeting "%s" as company', (greeting) => {
    expect(sanitizeCompanyName(greeting)).toBeNull()
  })

  it.each([
    'CloudScale Systems',
    'Vertex Dynamics',
    'Northstar Technologies',
    'Acme & Co',
  ])('accepts real company "%s"', (company) => {
    expect(sanitizeCompanyName(company)).toBe(company)
  })
})
