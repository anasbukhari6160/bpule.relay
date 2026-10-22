/**
 * Sales Thesis Engine — the thesis must be commercially useful and never state
 * an unverified problem as fact.
 */
import { describe, expect, it } from 'vitest'
import { buildSalesThesis, type SalesThesisInput } from '@/lib/scoring-v4/sales-thesis'
import { buildOpportunityFeatures } from '@/lib/scoring-v4/opportunity-features'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveVerifiedBuyerIntent } from '@/lib/intelligence-v3/buyer-intent'
import type { V3BoundedDecision } from '@/lib/intelligence-v3/types'

const DECISION: V3BoundedDecision = {
  relationship: 'BUILDER',
  buyerRequestProbability: 0.1,
  externalNeedProbability: 0.1,
  needOwnerType: 'UNKNOWN',
  fit: 'STRONG',
  timing: 'NONE',
  access: 'DIRECT',
  messageEligible: 0.5,
  providerConfidence: 0.8,
}

function inputFor(rawText: string, overrides: Partial<SalesThesisInput> = {}): SalesThesisInput {
  const facts = readSourceFacts(rawText)
  const intent = resolveVerifiedBuyerIntent(facts.buyer)
  return {
    facts,
    features: buildOpportunityFeatures({ facts, intent, decision: DECISION }),
    ...overrides,
  }
}

describe('Sales Thesis Engine', () => {
  it('separates verified account reasons from hypotheses', () => {
    const raw = `Maya Chen\nCTO & Co-founder at Loopware\n\nAbout\nWe are building a React and Node data platform with AI workflows. Just launched v2. Currently hiring 4 engineers.`

    const thesis = buildSalesThesis(inputFor(raw))

    expect(thesis.whyThisAccount.length).toBeGreaterThan(0)
    expect(thesis.whyThisAccount.some((r) => /decision authority|Actively building/.test(r))).toBe(true)
    // Problems are labelled as hypotheses, never stated as fact.
    for (const p of thesis.likelyProblems) {
      expect(/potential|possible|unconfirmed/i.test(p)).toBe(true)
    }
    expect(thesis.likelyProblems.some((p) => /external delivery capacity/i.test(p))).toBe(true)
    expect(thesis.recommendedEntryPoint).toMatch(/technical peer conversation/i)
  })

  it('never claims buying intent the source does not state', () => {
    const raw = `Dan Okafor\nEngineering Lead at Northbeam\n\nAbout\nBuilding internal tooling on Python and Postgres.`
    const thesis = buildSalesThesis(inputFor(raw))

    expect(thesis.whyThisAccount.join(' ')).not.toMatch(/budget|buying|hiring a vendor/i)
    expect(thesis.recommendedEntryPoint).not.toMatch(/answer the stated need/i)
  })

  it('never recommends pitching a supply-side account', () => {
    const raw = `If you're hiring a React developer, DM me. I build apps for clients.`
    const thesis = buildSalesThesis(inputFor(raw, {}))

    expect(thesis.outreachRisks.join(' ')).toMatch(/supply-side|partnership/i)
    expect(thesis.recommendedEntryPoint).toMatch(/partnership|candidate|do not pitch/i)
  })

  it('recommends answering a verified buyer request directly', () => {
    const raw = `We are looking for a development agency to build our platform. React + Node.js. Budget $50k approved.`
    const facts = readSourceFacts(raw)
    const intent = resolveVerifiedBuyerIntent(facts.buyer, {
      modelBuyerProbability: 0.9, modelExternalNeedProbability: 0.85, modelRelationship: 'BUYER',
    })
    const thesis = buildSalesThesis({
      facts,
      features: buildOpportunityFeatures({ facts, intent, decision: { ...DECISION, relationship: 'BUYER' } }),
    })

    expect(thesis.recommendedEntryPoint).toMatch(/answer the stated need directly/i)
    expect(thesis.relevantCapabilities.length).toBeGreaterThan(0)
  })

  it('uses only verified proof', () => {
    const raw = `We are looking for a development agency to build our platform. React + Node.js.`
    const facts = readSourceFacts(raw)
    const intent = resolveVerifiedBuyerIntent(facts.buyer, { modelBuyerProbability: 0.9, modelExternalNeedProbability: 0.85, modelRelationship: 'BUYER' })
    const thesis = buildSalesThesis({
      facts,
      features: buildOpportunityFeatures({ facts, intent, decision: { ...DECISION, relationship: 'BUYER' } }),
      proof: [
        { capability: 'web_frontend', title: 'Verified marketplace rebuild', strength: 'verified' },
        { capability: 'ai_ml', title: 'Internal demo', strength: 'unverified' as never },
      ],
    })

    expect(thesis.relevantProof).toEqual(['Verified marketplace rebuild (web_frontend)'])
  })

  it('flags missing evidence instead of inventing it', () => {
    const raw = `Maya Chen\nCTO at Loopware`
    const thesis = buildSalesThesis(inputFor(raw))

    expect(thesis.missingEvidence.some((m) => /external engineering capacity/i.test(m))).toBe(true)
    expect(thesis.missingEvidence.some((m) => /budget authority/i.test(m))).toBe(true)
    expect(thesis.confidence).toBe('LOW')
  })
})
