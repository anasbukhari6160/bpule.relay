import { describe, it, expect } from 'vitest'
import { produceV3Intelligence } from '@/lib/intelligence-v3/bridge'

const ABDULHAKIM_TEXT = [
  'Abdulhakim Ali',
  'Founder at AgentAce | Co-founder at Tayo360 | NexaCareTech',
  '',
  'About',
  'I run AgentAce, a software development agency that helps companies build MVPs.',
  '',
  'Co-founder, Tayo360 (2023 - Present)',
  '- Building a healthcare data platform',
  '- Raised pre-seed round',
  '',
  'Posts (3 months ago)',
  'Tayo360 is hiring a senior full-stack developer. Send your resume and GitHub to careers@healthbridge.io.',
  '',
  'linkedin.com/in/abdulhakim',
].join('\n')

describe('V3 Live: Abdulhakim Regression', () => {
  it('scores the founder opportunity without inventing a buyer', async () => {
    const result = await produceV3Intelligence(ABDULHAKIM_TEXT, {})
    const v3 = (result.intelligence as unknown as Record<string, unknown>).v3DecisionPacket as Record<string, unknown> | undefined
    const decision = v3?.decision as Record<string, unknown> | undefined

    console.log('Score:', v3?.score)
    console.log('Action:', v3?.action)
    console.log('Message eligible:', v3?.messageEligible)
    console.log('Relationship:', decision?.relationship)
    console.log('Buyer prob:', decision?.buyerRequestProbability)
    console.log('Episodes:', (v3?.episodes as unknown[] | undefined)?.length)
    console.log('Orgs:', new Set((v3?.episodes as Array<Record<string, unknown>>)?.map(e => e.organizationName)))

    // Provider must be OpenAI, not deterministic fallback (skipped without a key)
    if (!process.env.OPENAI_API_KEY) return
    expect(['openai_structured', 'openai_gpt-4.1']).toContain(v3?.decisionProvider)

    // Score must NOT be 0
    expect(v3?.score).toBeGreaterThan(0)

    // Buyer-intent authority (not the raw model relationship): a founder who
    // runs an agency and co-founded a funded product company is a BUILDER or
    // SELLER. Never a CANDIDATE or RECRUITER because a hiring post says
    // "send your resume". Hiring employees is NOT a request to buy services,
    // so intent must not be HIGH.
    const buyerIntent = v3?.buyerIntent as Record<string, unknown> | undefined
    expect(['BUILDER', 'SELLER', 'BUYER', 'UNKNOWN']).toContain(buyerIntent?.relationshipRole)
    expect(buyerIntent?.buyerIntentLevel).not.toBe('HIGH')
    expect(buyerIntent?.verifiedHiringNeed).toBe(true)

    // Action must not be SKIP
    expect(v3?.action).not.toBe('SKIP')

    // V3 must be canonical
    expect(result.v3Canonical).toBe(true)

    // Organization scoping: the hiring episode belongs to Tayo360, not AgentAce
    const episodes = (v3?.episodes as Array<Record<string, unknown>>) || []
    const hiringEpisodes = episodes.filter(
      e => (e.anchorEvent as Record<string, unknown>)?.eventType === 'HIRING'
    )
    for (const ep of hiringEpisodes) expect(ep.organizationName).not.toBe('AgentAce')
  }, 120000)
})
