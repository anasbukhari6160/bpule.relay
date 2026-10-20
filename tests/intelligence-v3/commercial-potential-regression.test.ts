/**
 * Commercial Potential Regression — V3.2
 *
 * Commercial potential is separate from buyer intent and is assessed from
 * SourceFacts with no floors. A founder building a product with no explicit
 * request has meaningful commercial potential; a recruiter or candidate does
 * not. Authority is NOT inside commercial potential (it is its own dimension).
 */

import { describe, it, expect } from 'vitest'
import { assessCommercialPotential } from '@/lib/intelligence-v3/latent-opportunity'
import { assessCommercialPotentialFromFacts } from '@/lib/intelligence-v3/dimensions'
import { readSourceFacts } from '@/lib/intelligence-v3/source-facts-model'
import { resolveBuyerIntentFromSource } from '@/lib/intelligence-v3/buyer-intent'
import { scoreSourceForTest } from '../helpers/score-source'
import { li } from '../golden/builder'
import type { CanonicalProspectIntelligence } from '@/lib/intelligence-v2/types'

function cpFor(text: string) {
  return assessCommercialPotentialFromFacts(readSourceFacts(text), resolveBuyerIntentFromSource(text))
}

const ACTIVE_FOUNDER = li({
  name: 'Jane Founder', headline: 'Founder & CEO at ProductCo', location: 'San Francisco Bay Area', degree: '2nd', connections: '2,000+ connections',
  about: ['Building an AI-powered workflow platform. Just launched our MVP. React, TypeScript, Node.js, PostgreSQL on AWS.', 'Small team, raised a seed round in June.'],
  posts: [{ age: '2d', text: 'We just launched our MVP to 30 design partners. Shipping weekly.' }],
  experience: [{ title: 'Founder & CEO', company: 'ProductCo', range: 'Jan 2024 - Present · 1 yr 10 mos' }],
})

const TITLE_ONLY_FOUNDER = li({
  name: 'Gerard Lafitte', headline: 'Founder at Lafitte Holdings', location: 'Lyon, France', degree: '3rd', connections: '200 connections', message: false,
  experience: [{ title: 'Founder', company: 'Lafitte Holdings', range: 'Jan 2012 - Present · 13 yrs 10 mos' }],
})

const RECRUITER = li({
  name: 'Bob Recruiter', headline: 'Technical Recruiter at TalentAgency', location: 'New York, New York, United States', degree: '2nd', connections: '5,000+ connections',
  about: ['Helping companies find top talent. We are hiring for our clients.', 'Contact us if you have candidates to place.'],
  posts: [{ age: '1d', text: 'My client is looking for a Senior React Developer. $150k. DM me.' }],
  experience: [{ title: 'Technical Recruiter', company: 'TalentAgency', range: 'Jan 2019 - Present · 6 yrs 10 mos' }],
})

const AGENCY_WITH_PRODUCT = li({
  name: 'Alex Builder', headline: 'Founder at DevAgency', location: 'Remote', degree: '2nd', connections: '1,000+ connections',
  about: ['I run a dev agency helping companies build products.', 'Also building a new SaaS product — just launched beta. React, TypeScript, Node.js.'],
  posts: [{ age: '3d', text: 'Beta launch day for our scheduling product. 200 signups in 24 hours.' }],
  experience: [{ title: 'Founder', company: 'DevAgency', range: 'Jan 2018 - Present · 7 yrs 10 mos' }],
})

const CANDIDATE = li({
  name: 'Pavel Novak', headline: 'Senior Full-Stack Developer | Open to work', location: 'Prague, Czechia', degree: '2nd', connections: '900+ connections',
  about: ['I am open to new contract or full-time opportunities.'],
  posts: [{ age: '2d', text: 'Looking for my next role — remote, EU time zone.' }],
  experience: [{ title: 'Senior Full-Stack Developer', company: 'Freelance', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
})

describe('Commercial Potential (facts-based, no floors)', () => {
  it('active founder with product, funding and stack → HIGH', () => {
    const cp = cpFor(ACTIVE_FOUNDER)
    expect(['HIGH', 'VERY_HIGH']).toContain(cp.overallPotential)
    expect(cp.buildIntensity).not.toBe('NONE')
    expect(cp.raw).toBeGreaterThanOrEqual(0.5)
  })

  it('founder title with no activity → LOW or at most MEDIUM', () => {
    const cp = cpFor(TITLE_ONLY_FOUNDER)
    expect(['VERY_LOW', 'LOW', 'MEDIUM']).toContain(cp.overallPotential)
    expect(cp.raw).toBeLessThan(0.45)
  })

  it('recruiter → LOW, capped', () => {
    const cp = cpFor(RECRUITER)
    expect(['VERY_LOW', 'LOW', 'MEDIUM']).toContain(cp.overallPotential)
    expect(cp.raw).toBeLessThanOrEqual(0.35)
  })

  it('candidate → capped at 0.25', () => {
    expect(cpFor(CANDIDATE).raw).toBeLessThanOrEqual(0.25)
  })

  it('agency that is also building a product keeps MEDIUM/HIGH potential (but a dev agency has delivery capacity)', () => {
    const cp = cpFor(AGENCY_WITH_PRODUCT)
    expect(['MEDIUM', 'HIGH']).toContain(cp.overallPotential)
    expect(cp.capacityNeedLikelihood).toBeLessThanOrEqual(0.3)
  })

  it('authority is not double counted: commercial potential ignores the title', () => {
    const ceo = cpFor(ACTIVE_FOUNDER)
    const engineer = cpFor(ACTIVE_FOUNDER.replace('Founder & CEO at ProductCo', 'Software Engineer at ProductCo').replace('Founder & CEO\n', 'Software Engineer\n'))
    expect(Math.abs(ceo.raw - engineer.raw)).toBeLessThan(0.05)
  })

  it('no floors: a verified budget does not lift commercial potential by itself', () => {
    const withBudget = cpFor('Sam Lee\nCTO at Quietwave\n\nAbout\nWe are looking for an agency to build our app. Budget approved: $40,000.')
    const without = cpFor('Sam Lee\nCTO at Quietwave\n\nAbout\nWe are looking for an agency to build our app.')
    expect(Math.abs(withBudget.raw - without.raw)).toBeLessThan(0.05)
  })
})

describe('Commercial Potential inside the canonical score', () => {
  it('active founder with no request lands in MAYBE/WORTH_PURSUING, never near zero', () => {
    const out = scoreSourceForTest(ACTIVE_FOUNDER, { relationship: 'UNKNOWN', buyerRequestProbability: 0.2, externalNeedProbability: 0.3, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' })
    expect(out.score).toBeGreaterThanOrEqual(45)
    expect(out.score).toBeLessThan(75)
    expect(out.dimensions.find((d) => d.key === 'commercialPotential')!.contribution).toBeGreaterThan(8)
    expect(out.reasons.join(' ')).toMatch(/commercial potential/i)
  })

  it('title-only founder stays low', () => {
    const out = scoreSourceForTest(TITLE_ONLY_FOUNDER, { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' })
    expect(out.score).toBeLessThan(40)
  })

  it('recruiter stays low even with a generous model', () => {
    const out = scoreSourceForTest(RECRUITER, { relationship: 'BUYER', buyerRequestProbability: 0.7, externalNeedProbability: 0.6, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' })
    expect(out.score).toBeLessThan(35)
  })

  it('commercial potential makes a meaningful difference between an active and an idle founder', () => {
    const active = scoreSourceForTest(ACTIVE_FOUNDER, { relationship: 'UNKNOWN', buyerRequestProbability: 0.15, externalNeedProbability: 0.2, fit: 'MEDIUM', timing: 'CURRENT', access: 'CONNECTION' })
    const idle = scoreSourceForTest(TITLE_ONLY_FOUNDER, { relationship: 'UNKNOWN', buyerRequestProbability: 0.15, externalNeedProbability: 0.2, fit: 'MEDIUM', timing: 'CURRENT', access: 'CONNECTION' })
    expect(active.score).toBeGreaterThan(idle.score + 10)
  })
})

describe('compatibility: assessCommercialPotential(v2, rawText)', () => {
  const v2 = {
    intelligence: {
      person: { fullName: 'Jane Founder', firstName: 'Jane', title: 'Founder & CEO', seniority: 'executive', location: null, linkedinUrl: null, otherUrls: [], affiliations: [] },
      company: { name: 'ProductCo', domain: null, linkedinUrl: null, industry: null, size: null, sizeEvidence: null, product: null, stage: null, stageEvidence: null },
      content: { recentPosts: [], topics: [], explicitProblems: [], initiatives: [], launches: [], technicalSignals: [], hiringSignals: [] },
    },
  } as unknown as CanonicalProspectIntelligence

  it('reads from the raw text through SourceFacts', async () => {
    const cp = await assessCommercialPotential(v2, ACTIVE_FOUNDER)
    expect(['HIGH', 'VERY_HIGH']).toContain(cp.overallPotential)
    expect(cp.decisionAuthority).toBeGreaterThan(0.7)
  })
})
