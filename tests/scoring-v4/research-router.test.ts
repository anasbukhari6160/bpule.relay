/**
 * Research Router — research only the leads worth researching, and never
 * overwrite a source fact with an enrichment finding.
 */
import { describe, expect, it } from 'vitest'
import { runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'
import { featuresFromPacket } from '@/lib/scoring-v4/opportunity-features'
import { buildSalesThesis } from '@/lib/scoring-v4/sales-thesis'
import { emptyEnrichment, mergeEnrichment, researchPlan, shouldResearch, type ResearchFinding } from '@/lib/scoring-v4/research-router'

const REF = new Date('2026-10-20T00:00:00Z')

const highValue = li({
  name: 'Priya Natarajan', headline: 'Co-founder & CTO at Lumen Health | AI triage for clinics', location: 'Toronto', degree: '2nd',
  about: ['Lumen Health is an AI SaaS for clinics. Stack: React, Node, Postgres, AWS, LLM pipelines.'],
  posts: [{ age: '3d', text: 'We are looking for an agency to build our React patient portal and a RAG pipeline on AWS. Budget approved. DM me.' }],
  experience: [{ title: 'Co-founder & CTO', company: 'Lumen Health', range: 'Feb 2024 - Present · 2 yrs 9 mos' }],
  extra: ['Company size: 60 employees', 'We are hiring 8 engineers across React, Node and AI.'],
})

const thin = li({
  name: 'Sam Lee', headline: 'Analyst at Northgate', location: 'Leeds', degree: '3rd',
  about: ['Reporting and dashboards.'],
})

async function load(fixture: string) {
  const raw = typeof fixture === 'string' ? fixture : ''
  void raw
  return null
}
void load

describe('Research Router', () => {
  it('does not research a thin, low-value profile', async () => {
    const packet = await runOffline(thin, { referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const thesis = buildSalesThesis({ features: f, facts: packet.sourceFacts! })

    const decision = shouldResearch({ features: f, thesis, v3Score: packet.score })

    expect(decision.should).toBe(false)
    expect(decision.reasons).toEqual([])
  })

  it('researches a high-value account with strong fit and high outsourcing propensity', async () => {
    const packet = await runOffline(highValue, { model: { relationship: 'BUYER', buyerRequestProbability: 0.9, fit: 'STRONG', access: 'DIRECT' }, referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const thesis = buildSalesThesis({ features: f, facts: packet.sourceFacts! })

    const decision = shouldResearch({ features: f, thesis, v3Score: packet.score })
    const plan = researchPlan({ features: f, decision, company: 'Lumen Health' })

    expect(decision.should).toBe(true)
    expect(decision.priority).toBe('HIGH')
    expect(plan.some((t) => t.kind === 'careers')).toBe(true)
    expect(plan.every((t) => t.query.length > 0)).toBe(true)
  })

  it('researches when the engines disagree materially', async () => {
    const packet = await runOffline(thin, { referenceDate: REF })
    const f = featuresFromPacket(packet)!
    const thesis = buildSalesThesis({ features: f, facts: packet.sourceFacts! })

    const decision = shouldResearch({ features: f, thesis, v3Score: 60, shadowScores: [10, 90] })
    expect(decision.reasons.join(' ')).toMatch(/disagree by 80 points/i)
  })

  it('merges enrichment append-only and never touches the source facts', async () => {
    const packet = await runOffline(thin, { referenceDate: REF })
    const before = JSON.stringify(packet.sourceFacts)
    const enrichment = emptyEnrichment()

    const finding: ResearchFinding = {
      kind: 'careers',
      fact: 'Hiring 3 backend engineers',
      provenance: { source: 'company careers page', url: 'https://example.com/careers', retrievedAt: '2026-10-22T00:00:00.000Z' },
      confidence: 0.7,
    }
    const merged = mergeEnrichment(enrichment, [finding])
    const again = mergeEnrichment(merged, [finding])

    expect(merged.findings).toHaveLength(1)
    expect(again.findings).toHaveLength(1)
    expect(JSON.stringify(packet.sourceFacts)).toBe(before)
    expect(merged.findings[0].provenance.url).toBe('https://example.com/careers')
  })
})
