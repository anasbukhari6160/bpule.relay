/**
 * Relative ranking (Phase 19). Exact numbers are not asserted; order is.
 *   explicit buyer + strong fit        > active founder + unknown intent
 *   active founder + strong fit        > passive founder
 *   strong external contractor need    > generic hiring post
 *   fresh explicit need                > historical launch
 *   strong-fit founder                 > unrelated-industry founder (same activity)
 *   service provider                   < buyer when otherwise comparable
 *   fresh request                      > stale request (same text)
 *   verified budget                    ≥ same request without budget
 */
import { describe, it, expect } from 'vitest'
import { runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'

const REF = new Date('2026-10-20T00:00:00Z')
const BUYER_MODEL = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const }
const FOUNDER_MODEL = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.2, externalNeedProbability: 0.3, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const }
const SELLER_MODEL = { relationship: 'SERVICE_PROVIDER' as const, buyerRequestProbability: 0.2, externalNeedProbability: 0.2, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const }

const base = (over: Partial<Parameters<typeof li>[0]>, post: string, age = '3d') => li({
  name: 'Ada Lind', headline: 'Founder & CEO at Northwind Apps | Scheduling software for clinics', location: 'Leeds, England, United Kingdom', degree: '2nd', connections: '1,500+ connections',
  about: ['Northwind builds scheduling software for clinics on Next.js, Node and Postgres on AWS. Team of 8, seed-funded.'],
  posts: [{ age, text: post }],
  experience: [{ title: 'Founder & CEO', company: 'Northwind Apps', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
  ...over,
})

const score = async (text: string, model: object | null) => (await runOffline(text, { model: model as never, referenceDate: REF })).score

describe('ranking quality', () => {
  it('explicit buyer + strong fit > active founder + unknown intent', async () => {
    const buyer = await score(base({}, 'We are looking for a development agency to rebuild our booking flow in React. Budget approved. Start in 3 weeks. DM me.'), BUYER_MODEL)
    const founder = await score(base({}, 'Shipped recurring appointments this week. 60 clinics live.'), FOUNDER_MODEL)
    expect(buyer).toBeGreaterThan(founder + 10)
  })

  it('active founder + strong fit > passive founder', async () => {
    const active = await score(base({}, 'Shipped recurring appointments this week. 60 clinics live.'), FOUNDER_MODEL)
    const passive = await score(li({ name: 'Ada Lind', headline: 'Founder at Northwind Holdings', location: 'Leeds, England, United Kingdom', degree: '3rd', connections: '200 connections', message: false, experience: [{ title: 'Founder', company: 'Northwind Holdings', range: 'Jan 2012 - Present · 13 yrs 10 mos' }] }), { ...FOUNDER_MODEL, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' })
    expect(active).toBeGreaterThan(passive + 10)
  })

  it('strong external contractor need > generic hiring post', async () => {
    const contractor = await score(base({}, 'We need a React contractor for 3 months to rebuild our booking flow. Start in two weeks. Message me with similar work.'), BUYER_MODEL)
    const hiring = await score(base({}, 'We are hiring a React developer to join our team. Apply via our careers page.'), { ...FOUNDER_MODEL, needOwner: 'HIRING_NEED' })
    expect(contractor).toBeGreaterThan(hiring + 10)
  })

  it('fresh explicit need > historical launch', async () => {
    const fresh = await score(base({}, 'We are looking for a development agency to rebuild our booking flow in React. Start in 3 weeks.'), BUYER_MODEL)
    const historical = await score(li({ name: 'Ada Lind', headline: 'Founder at Northwind Apps', location: 'Leeds, England, United Kingdom', degree: '2nd', connections: '1,500+ connections', about: ['Back in 2019 we launched Northwind v1 to 2 million downloads.'], experience: [{ title: 'Founder', company: 'Northwind Apps', range: 'Jan 2018 - Present · 7 yrs 10 mos' }] }), { ...FOUNDER_MODEL, timing: 'WEAK' })
    expect(fresh).toBeGreaterThan(historical + 20)
  })

  it('strong-fit founder > founder in an unrelated craft with the same activity', async () => {
    const fit = await score(base({}, 'We just shipped our new API gateway on Node and Postgres. 60 clinics live.'), FOUNDER_MODEL)
    const unrelated = await score(li({
      name: 'Ada Lind', headline: 'Founder & CEO at Northwind Pottery | Handmade ceramics', location: 'Leeds, England, United Kingdom', degree: '2nd', connections: '1,500+ connections',
      about: ['Northwind Pottery makes handmade ceramics in Leeds. Team of 8.'],
      posts: [{ age: '3d', text: 'We just shipped our autumn glaze collection. 60 stockists live.' }],
      experience: [{ title: 'Founder & CEO', company: 'Northwind Pottery', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
    }), { ...FOUNDER_MODEL, fit: 'WEAK' })
    expect(fit).toBeGreaterThan(unrelated)
  })

  it('service provider < buyer when otherwise comparable', async () => {
    const buyer = await score(base({}, 'We are looking for a development agency to rebuild our booking flow in React. Start in 3 weeks.'), BUYER_MODEL)
    const seller = await score(base({ headline: 'Founder & CEO at Northwind Studio | We build React apps for clinics', about: ['Northwind Studio is a development agency. We help clinics build scheduling software. Book a free consultation.'] }, 'New case study: we built a booking flow for a client in 6 weeks. Your project could be next.'), SELLER_MODEL)
    expect(buyer).toBeGreaterThan(seller + 25)
  })

  it('fresh request > the same request 8 months ago', async () => {
    const post = 'We are looking for a development agency to rebuild our booking flow in React. Message me with references.'
    const fresh = await score(base({}, post, '3d'), BUYER_MODEL)
    const stale = await score(base({}, post, '8mo'), { ...BUYER_MODEL, timing: 'STALE' })
    expect(fresh).toBeGreaterThan(stale)
    expect(stale).toBeGreaterThan(35)
  })

  it('a verified budget never lowers the score of the same request', async () => {
    const without = await score(base({}, 'We are looking for a development agency to rebuild our booking flow in React. Start in 3 weeks.'), BUYER_MODEL)
    const withBudget = await score(base({}, 'We are looking for a development agency to rebuild our booking flow in React. Budget approved: £30,000. Start in 3 weeks.'), BUYER_MODEL)
    expect(withBudget).toBeGreaterThanOrEqual(without)
  })

  it('recruiter and candidate rank below every founder archetype', async () => {
    const founder = await score(base({}, 'Shipped recurring appointments this week.'), FOUNDER_MODEL)
    const recruiter = await score(li({ name: 'Jo Hale', headline: 'Technical Recruiter at Hirewell', location: 'London', degree: '2nd', connections: '5,000+ connections', about: ['I place engineers at startups.'], posts: [{ age: '1d', text: 'My client is looking for a Senior React Developer. DM me your resume.' }], experience: [{ title: 'Technical Recruiter', company: 'Hirewell', range: 'Jan 2019 - Present · 6 yrs 10 mos' }] }), { ...BUYER_MODEL, buyerRequestProbability: 0.7 })
    const candidate = await score(li({ name: 'Jo Hale', headline: 'Senior React Developer | Open to work', location: 'London', degree: '2nd', connections: '900+ connections', about: ['I am open to new contract or full-time opportunities.'], posts: [{ age: '1d', text: 'Looking for my next role. DM me.' }], experience: [{ title: 'Senior React Developer', company: 'Freelance', range: 'Jan 2023 - Present · 2 yrs 10 mos' }] }), { ...FOUNDER_MODEL, relationship: 'CANDIDATE' })
    expect(founder).toBeGreaterThan(recruiter)
    expect(founder).toBeGreaterThan(candidate)
  })
})
