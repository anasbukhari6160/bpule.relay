import { describe, expect, it } from 'vitest'
import { runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'
import { buildOpportunityFeatures, featuresFromPacket, featureRecord, featureVector, FEATURE_NAMES, resolveFitLevel } from '@/lib/scoring-v4/opportunity-features'
import { readSourceFacts, summarizeSourceFacts } from '@/lib/intelligence-v3/source-facts-model'

const REF = new Date('2026-10-20T00:00:00Z')

const buyer = li({
  name: 'Mara Ellison', headline: 'Founder & CEO at Fieldnote | Field-service SaaS', location: 'Austin, Texas', degree: '2nd', connections: '1,400 connections',
  about: ['Fieldnote is a scheduling platform for HVAC companies. Stack: React, Node, Postgres on AWS.'],
  posts: [{ age: '2d', text: 'We are looking for an agency to rebuild our React dashboard and build a Stripe billing integration. Budget approved for Q4, start within 3 weeks. DM me.' }],
  experience: [{ title: 'Founder & CEO', company: 'Fieldnote', range: 'Mar 2023 - Present · 3 yrs 8 mos' }],
})

const seller = li({
  name: 'Tomas Reiner', headline: 'Founder at Pixelforge Agency | We build React and Node apps for startups', location: 'Berlin', degree: '3rd',
  about: ['Pixelforge is a 12-person development agency. We offer React, Node, AWS and mobile development. Book a call.'],
  posts: [{ age: '5d', text: 'Just shipped another client MVP in 6 weeks. If you need a dev shop, our calendar is open.' }],
  experience: [{ title: 'Founder', company: 'Pixelforge Agency', range: 'Jan 2019 - Present · 7 yrs 10 mos' }],
})

const candidate = li({
  name: 'Lena Ortiz', headline: 'Senior React Developer | Open to work', location: 'Madrid', degree: '2nd',
  about: ['8 years of React and TypeScript. #opentowork — looking for my next role, full-time or contract.'],
  posts: [{ age: '1d', text: 'I am open to new opportunities. If you are hiring senior frontend engineers, let\'s connect.' }],
  experience: [{ title: 'Senior Frontend Engineer', company: 'Previous Co', range: 'Jan 2020 - Jun 2026 · 6 yrs' }],
})

describe('OpportunityFeatures (Phase 6)', () => {
  it('separates verified intent from account value and reads semantic fit for a buyer', async () => {
    const packet = await runOffline(buyer, { model: { relationship: 'BUYER', buyerRequestProbability: 0.9, fit: 'STRONG', timing: 'URGENT', access: 'DIRECT' }, referenceDate: REF })
    const f = featuresFromPacket(packet, buyer)!
    expect(f).not.toBeNull()
    expect(f.intent.verifiedRequest).toBe(true)
    expect(f.intent.level).toBe('HIGH')
    expect(f.intent.verifiedBudget).toBe(true)
    expect(f.fit.needs).toContain('web_frontend')
    expect(f.fit.needs).toContain('payments_fintech')
    expect(['GOOD', 'STRONG', 'EXCEPTIONAL']).toContain(f.fit.level)
    expect(f.accountValue.currentProductActivity).toBe(true)
    expect(f.relationshipRole).toBe('BUYER')
    expect(f.buyerTiming).toBe('URGENT')
    expect(f.supply.softwareServicesSeller).toBe(false)
  })

  it('marks a software-services seller as supply-side with fit capped at WEAK', async () => {
    const packet = await runOffline(seller, { model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.1, fit: 'EXCELLENT' }, referenceDate: REF })
    const f = featuresFromPacket(packet, seller)!
    expect(f.relationshipRole).toBe('SELLER')
    expect(f.supply.softwareServicesSeller).toBe(true)
    expect(f.intent.verifiedRequest).toBe(false)
    expect(['NONE', 'WEAK']).toContain(f.fit.level)
    expect(f.accountValue.outsourcingPlausibility).toBeLessThanOrEqual(0.15)
  })

  it('marks a candidate seeking work and gives them no account value', async () => {
    const packet = await runOffline(candidate, { referenceDate: REF })
    const f = featuresFromPacket(packet, candidate)!
    expect(f.relationshipRole).toBe('CANDIDATE')
    expect(f.supply.candidateSeeking).toBe(true)
    expect(f.accountValue.outsourcingPlausibility).toBeLessThanOrEqual(0.05)
    expect(f.fit.level).toBe('WEAK')
  })

  it('gives the same features from full SourceFacts and from a stored summary plus raw text', async () => {
    const packet = await runOffline(buyer, { referenceDate: REF })
    const full = readSourceFacts(buyer)
    const a = buildOpportunityFeatures({ facts: full, intent: packet.buyerIntent!, decision: packet.decision, resolved: packet.resolved ?? null })
    const b = buildOpportunityFeatures({ facts: summarizeSourceFacts(full), intent: packet.buyerIntent!, decision: packet.decision, resolved: packet.resolved ?? null, rawText: buyer })
    expect(featureVector(a)).toEqual(featureVector(b))
    // The packet path (summary stored on the packet) agrees on every
    // feature except the two that depend on how the pipeline ran: the
    // identity-aware completeness read and the fallback flag.
    const c = featureRecord(featuresFromPacket(packet, buyer)!)
    const ar = featureRecord(a)
    for (const k of FEATURE_NAMES) if (k !== 'source_completeness' && k !== 'fallback_used') expect(c[k], k).toBe(ar[k])
  })

  it('projects to a fixed-order numeric vector in [0,1]', async () => {
    const packet = await runOffline(buyer, { referenceDate: REF })
    const v = featureVector(featuresFromPacket(packet, buyer)!)
    expect(v).toHaveLength(FEATURE_NAMES.length)
    for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1) }
  })

  it('fit resolution: explicit needs we cover dominate; nothing named is NONE; the model cannot lift NONE', () => {
    expect(resolveFitLevel({ needs: ['web_frontend', 'payments_fintech'], stack: [], orgNeedCoverage: 1, orgStackCoverage: 0, currentProductActivity: false, supplySideWithoutBuy: false, modelFit: null })).toBe('EXCEPTIONAL')
    expect(resolveFitLevel({ needs: ['web3'], stack: [], orgNeedCoverage: 0, orgStackCoverage: 0, currentProductActivity: false, supplySideWithoutBuy: false, modelFit: 'EXCELLENT' })).toBe('ADJACENT')
    expect(resolveFitLevel({ needs: [], stack: [], orgNeedCoverage: 0, orgStackCoverage: 0, currentProductActivity: false, supplySideWithoutBuy: false, modelFit: 'EXCELLENT' })).toBe('NONE')
    expect(resolveFitLevel({ needs: [], stack: ['web_frontend', 'backend_api', 'cloud_devops'], orgNeedCoverage: 0, orgStackCoverage: 1, currentProductActivity: true, supplySideWithoutBuy: true, modelFit: null })).toBe('WEAK')
  })
})
