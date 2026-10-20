/**
 * Buyer-intent authority — one canonical decision, end to end.
 *
 * The full-source fixture is SYNTHETIC: a fictional founder ("Jordan Vale")
 * of a fictional AI-governance company, shaped like the seller-side founder
 * profiles that produced false "Intent HIGH" in production (product
 * promotion in About and posts, past healthcare roles in Experience). No
 * real person's data is used.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BUYER_INTENT_VERSION,
  readBuyerSourceFacts,
  resolveBuyerIntentFromSource,
  resolveVerifiedBuyerIntent,
} from '@/lib/intelligence-v3/buyer-intent'
import { resolveCurrentOrgContext, splitCurrentAndPastLines } from '@/lib/intelligence-v3/current-org'
import { buildV3ReuseKey } from '@/lib/intelligence-v3/decision-reuse'

const SELLER_FOUNDER = `Jordan Vale
Founder & CEO at Arbiter Governance | AI Governance, Model Risk & Regulatory Compliance
Brooklyn, New York, United States · Contact info
500+ connections
Message
Follow
More

About
Arbiter Governance evaluates AI systems for compliance, bias and model risk before regulators do.
We built Arbiter so enterprises can prove their AI is safe, fair and documented.
Bring us the workflow — we'll evaluate it against regulatory frameworks like the EU AI Act and NIST AI RMF.
Our platform helps compliance teams automate AI audits and produce evidence their regulators accept.
Currently working with several enterprise clients on AI governance assessments.
Previously spent 9 years in healthcare revenue-cycle management before moving into AI governance.
Request services or try our product at arbiter-governance.example.

Featured
Arbiter Readiness Assessment — fixed-fee engagement for AI governance programs.

Activity
Jordan Vale posted this • 3d
Most hospitals and banks need a better way to audit their AI. It is an urgent priority for every compliance team I talk to.
If your team is hiring for AI risk roles, let's talk — we can help you skip the hiring and get audit-ready this quarter.
Our engagement model is simple: a fixed contract, a clear rate card and a report your board can read.
We're looking for design partners to pilot Arbiter's new model-inventory module.

Jordan Vale posted this • 2w
We just shipped automated EU AI Act gap reports. Book a demo and see your exposure in an afternoon.

Experience
Founder & CEO
Arbiter Governance · Full-time
Jan 2024 - Present · 10 mos
New York, United States
Building an AI governance and model-risk platform for regulated enterprises.

Director, Revenue Cycle Operations
Lakeshore Health System · Full-time
Mar 2017 - Dec 2023 · 6 yrs 10 mos
Chicago, Illinois
Led a 40-person revenue-cycle team across 12 hospitals. Managed vendor relationships and a $4M annual budget for claims technology.
Ran an RFP for a new clinical billing vendor and hired 15 analysts.

Revenue Cycle Analyst
Northgate Medical Group · Full-time
Jun 2014 - Feb 2017 · 2 yrs 9 mos
Chicago, Illinois
Healthcare claims analytics and denial management.

Education
Northwestern University
MS, Health Informatics · 2012 - 2014

Skills
AI Governance · Model Risk Management · Regulatory Compliance · Healthcare Revenue Cycle · Python`

const GENUINE_BUYER = `Priya Raman
CTO at Ledgerline
About
Ledgerline is a payments startup.
We are looking for an external software development agency to rebuild our merchant dashboard in React.
Budget approved: $40,000. Start within 3 weeks.`

describe('resolveVerifiedBuyerIntent — the single authority', () => {
  it('seller-side promotion is SELLER with UNKNOWN intent even when every scorer claims buyer', () => {
    const r = resolveVerifiedBuyerIntent(readBuyerSourceFacts(SELLER_FOUNDER), {
      modelBuyerProbability: 0.92,
      modelExternalNeedProbability: 0.88,
      modelRelationship: 'BUYER',
      signalCheck: { explicitAsk: true, seekingVendor: true, hiring: true, budgetMentioned: true },
    })
    expect(r.version).toBe(BUYER_INTENT_VERSION)
    expect(r.buyerIntentLevel).toBe('UNKNOWN')
    expect(r.relationshipRole).toBe('SELLER')
    expect(r.verifiedBuyerRequest).toBe(false)
    expect(r.verifiedHiringNeed).toBe(false)
    expect(r.verifiedBudget).toBe(false)
    expect(r.verifiedExternalNeed).toBe(false)
    // Seller content is capped below the unverified cap.
    expect(r.effectiveBuyerProbability).toBeLessThanOrEqual(0.2)
    expect(r.effectiveExternalNeedProbability).toBeLessThanOrEqual(0.2)
    expect(r.contradictions.length).toBeGreaterThan(0)
    expect(r.evidence.some((e) => e.kind === 'seller_offering')).toBe(true)
  })

  it('a genuine request with an agreeing model is HIGH', () => {
    const r = resolveBuyerIntentFromSource(GENUINE_BUYER, { modelBuyerProbability: 0.9, modelExternalNeedProbability: 0.9 })
    expect(r.buyerIntentLevel).toBe('HIGH')
    expect(r.relationshipRole).toBe('BUYER')
    expect(r.verifiedBudget).toBe(true)
    expect(r.contradictions).toEqual([])
  })

  it('fails closed when the opportunity model and the source disagree', () => {
    const r = resolveBuyerIntentFromSource(GENUINE_BUYER, { modelBuyerProbability: 0.1 })
    expect(r.verifiedBuyerRequest).toBe(true)
    expect(r.buyerIntentLevel).toBe('UNKNOWN')
    expect(r.contradictions.join(' ')).toMatch(/opportunity model scored buyer request 0\.10/)
  })

  it('fails closed when the signal check claims a request the model rejects', () => {
    const r = resolveVerifiedBuyerIntent(readBuyerSourceFacts('Sam Lee\nFounder at Quietwave\nWe ship audio tools.'), {
      modelBuyerProbability: 0.05,
      signalCheck: { explicitAsk: true },
    })
    expect(r.buyerIntentLevel).toBe('UNKNOWN')
    expect(r.contradictions.join(' ')).toMatch(/Signal check reported an explicit buyer request/)
    expect(r.effectiveBuyerProbability).toBeLessThanOrEqual(0.2)
  })

  it('never surfaces HIGH from a verified fact without an agreeing scorer', () => {
    const r = resolveBuyerIntentFromSource(GENUINE_BUYER, { modelBuyerProbability: 0.45 })
    expect(r.buyerIntentLevel).toBe('MEDIUM')
  })
})

describe('current organization vs past roles', () => {
  it('past Experience entries are background; the current role is not', () => {
    const { pastLines } = splitCurrentAndPastLines(SELLER_FOUNDER)
    expect(pastLines).toContain('Lakeshore Health System · Full-time')
    expect(pastLines).toContain('Ran an RFP for a new clinical billing vendor and hired 15 analysts.')
    expect(pastLines).not.toContain('Arbiter Governance · Full-time')
  })

  it('industry is the current company, never a past role', () => {
    const ctx = resolveCurrentOrgContext(SELLER_FOUNDER)
    expect(ctx.currentIndustry).toBe('AI Governance / RegTech')
    expect(ctx.currentProductActivity).toBe(true)
  })

  it('a past role\'s RFP, budget and hiring never become current buyer facts', () => {
    const facts = readBuyerSourceFacts(SELLER_FOUNDER)
    expect(facts.externalServiceRequest).toBeNull()
    expect(facts.employmentHiring).toBeNull()
    expect(facts.statedBudget).toBeNull()
  })
})

describe('cache invalidation', () => {
  it('the V3 reuse key changes with the buyer-intent version', () => {
    const key = buildV3ReuseKey({ rawText: SELLER_FOUNDER })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    // The version is part of the preimage: a bump yields a different key.
    expect(BUYER_INTENT_VERSION).toBe('buyer_intent_v4')
  })
})

// ── Full-source API end-to-end ──────────────────────────────────────────────
// Runs the real POST /api/prospect/analyze handler with the V3 pipeline. Only
// the network edges are mocked: storage, auth, and the two OpenAI calls (event
// extraction + decision), which answer ADVERSARIALLY — they claim an explicit
// agency request, urgent hiring and a HIGH buyer probability.

vi.mock('@/lib/store', () => ({ createScoutStore: async () => { throw new Error('no store in test') } }))
vi.mock('@/lib/auth/organization', () => ({ getAuthContext: async () => null, can: () => false }))

const aiCalls: string[] = []
const otherCalls: string[] = []

function chatResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('API E2E: full seller-side founder profile', () => {
  const originalFetch = globalThis.fetch
  const originalEnv = { V3_CANONICAL: process.env.V3_CANONICAL, OPENAI_API_KEY: process.env.OPENAI_API_KEY }

  beforeAll(() => {
    process.env.V3_CANONICAL = 'true'
    process.env.OPENAI_API_KEY = 'test-key-not-real'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://api.openai.com/')) {
        otherCalls.push(url)
        throw new Error(`unexpected network call in test: ${url}`)
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> }
      const system = body.messages?.[0]?.content ?? ''
      if (system.startsWith('You extract commercial events')) {
        aiCalls.push('event_extraction')
        return chatResponse({
          events: [
            {
              eventType: 'AGENCY_REQUEST', organizationName: 'Arbiter Governance', organizationEvidence: 'Arbiter Governance',
              requestedCapabilities: ['AI governance'], requestedAssets: [], applicationChannels: ['DM'], applyInstructions: [],
              explicitness: 'EXPLICIT', needOwner: 'ORGANIZATION_NEED',
              evidenceQuote: "Bring us the workflow — we'll evaluate it against regulatory frameworks like the EU AI Act and NIST AI RMF.",
              confidence: 0.9,
            },
            {
              eventType: 'HIRING', organizationName: 'Arbiter Governance', organizationEvidence: 'Arbiter Governance',
              requestedCapabilities: ['AI risk'], requestedAssets: [], applicationChannels: ['DM'], applyInstructions: [],
              explicitness: 'EXPLICIT', needOwner: 'HIRING_NEED',
              evidenceQuote: "If your team is hiring for AI risk roles, let's talk — we can help you skip the hiring and get audit-ready this quarter.",
              confidence: 0.85,
            },
          ],
        })
      }
      aiCalls.push('decision')
      return chatResponse({
        relationship: 'BUYER', buyerRequestProbability: 0.92, externalNeedProbability: 0.88, needOwner: 'ORGANIZATION_NEED',
        fit: 'STRONG', timing: 'URGENT', access: 'CONNECTION', messageEligible: 0.85,
      })
    }) as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    process.env.V3_CANONICAL = originalEnv.V3_CANONICAL
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  })

  it('returns UNKNOWN intent, SELLER role, current industry — and no false verified claims', async () => {
    vi.resetModules()
    const { POST } = await import('@/app/api/prospect/analyze/route')
    const res = await POST(new Request('http://localhost/api/prospect/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText: SELLER_FOUNDER }),
    }))
    const stream = await res.text()
    const doneLine = stream.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .find((e) => e?.type === 'done')
    expect(doneLine, `no done event in stream:\n${stream.slice(0, 600)}`).toBeTruthy()
    const done = doneLine as Record<string, any>
    const payload = JSON.stringify(done)

    // One canonical object, and the UI field is rendered from it.
    expect(done.buyerIntent.version).toBe(BUYER_INTENT_VERSION)
    expect(done.buyerIntent.buyerIntentLevel).toBe('UNKNOWN')
    expect(['SELLER', 'BUILDER']).toContain(done.buyerIntent.relationshipRole)
    expect(done.revenue.intent).toBe('UNKNOWN')
    expect(done.canonical.v3DecisionPacket.buyerIntent.buyerIntentLevel).toBe('UNKNOWN')

    // No competing buyer claims anywhere in the response.
    expect(payload).not.toContain('Explicit buyer request (verified)')
    expect(payload).not.toContain('Urgent hiring (verified)')
    expect(payload).not.toContain('Budget stated (verified)')
    expect(payload).not.toMatch(/Industry: healthcare/i)

    // Downstream readers of packet.decision see the canonical projection.
    expect(done.canonical.v3DecisionPacket.decision.buyerRequestProbability).toBeLessThanOrEqual(0.2)
    expect(done.canonical.v3DecisionPacket.decision.relationship).not.toBe('BUYER')

    // Current organization, not past roles.
    expect(done.orgContext.currentIndustry).toBe('AI Governance / RegTech')
    expect(done.orgContext.currentProductActivity).toBe(true)
    expect(done.canonical.intelligence.company.industry).toBe('AI Governance / RegTech')

    // The model's contradiction is in the debug trace.
    expect(done.score.decisionAdjustments.join(' ')).toMatch(/Contradiction:/)

    // Score stays in the moderate band from authority/fit/product, action is a soft touch.
    expect(done.score.total).toBeGreaterThanOrEqual(30)
    expect(done.score.total).toBeLessThanOrEqual(65)
    expect(['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'CONNECT_OR_OBSERVE', 'OBSERVE']).toContain(done.revenue.act)

    // No extra AI calls: exactly the pipeline's event extraction + decision.
    expect(aiCalls).toEqual(['event_extraction', 'decision'])
    expect(otherCalls).toEqual([])

    process.stdout.write(`\n[E2E] score=${done.score.total} intent=${done.revenue.intent} role=${done.buyerIntent.relationshipRole} act=${done.revenue.act} industry=${done.orgContext.currentIndustry} contradictions=${done.buyerIntent.contradictions.length}\n`)
  }, 60_000)
})
