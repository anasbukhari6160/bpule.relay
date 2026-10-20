/**
 * Best Sender Engine (Phases 22-24): rankSendersForLead through the shared
 * routing context. 50+ cases: top-1 accuracy over synthetic senders,
 * sender-independence of the opportunity score, bounded history.
 */
import { describe, it, expect } from 'vitest'
import { rankSendersForLead, type SenderProfile } from '@/lib/relay/sender-routing-engine'
import { buildRoutingLeadContext } from '@/lib/relay/routing-context'
import { runOffline } from '../helpers/score-source'
import { li } from '../golden/builder'

const sender = (id: string, over: Partial<SenderProfile> = {}): SenderProfile => ({
  id, name: id, role: null, platform: 'linkedin', skills: [], industries: [], proof: [], holders: [{ repId: 'r1', name: 'Rep' }], accessibleToRep: true, ...over,
})

const ANEEB = sender('Aneeb', { skills: ['react', 'next.js', 'node', 'typescript', 'aws', 'postgres', 'ai', 'llm'], industries: ['fintech', 'saas'], proof: [{ text: 'Built a React/Node merchant dashboard for a payments startup', tags: ['react', 'node', 'fintech', 'dashboard'], strong: true, verified: true }, { text: 'LLM copilot for a bank', tags: ['ai', 'llm', 'fintech'], strong: true, verified: true }] })
const ZAIRA = sender('Zaira', { skills: ['flutter', 'react native', 'ios', 'android', 'firebase'], industries: ['healthcare', 'logistics'], proof: [{ text: 'Flutter driver app for a bus operator', tags: ['flutter', 'mobile', 'logistics', 'transport'], strong: true, verified: true }, { text: 'React Native telehealth app', tags: ['react native', 'healthcare', 'mobile'], strong: true, verified: false }] })
const HASSAN = sender('Hassan', { skills: ['aws', 'kubernetes', 'terraform', 'devops', 'ci/cd', 'docker'], industries: ['saas'], proof: [{ text: 'Migrated CI/CD to GitHub Actions and Terraform on AWS', tags: ['devops', 'terraform', 'aws', 'ci/cd'], strong: true, verified: true }] })
const SENDERS = [ANEEB, ZAIRA, HASSAN]

const leadCtx = (capabilities: string[], industries: string[] = [], rawTerms: string[] = []) => ({ capabilities, industries, buyerRequestProbability: 0.8, fitLevel: 'STRONG', rawTerms: [...capabilities, ...industries, ...rawTerms] })

describe('top-1 routing accuracy over synthetic senders', () => {
  const cases: Array<[string, string[], string[], string]> = [
    ['React dashboard for payments', ['react', 'node', 'dashboard'], ['fintech'], 'Aneeb'],
    ['Next.js + Postgres SaaS', ['next.js', 'postgres', 'typescript'], ['saas'], 'Aneeb'],
    ['LLM copilot for a bank', ['ai', 'llm', 'python'], ['fintech'], 'Aneeb'],
    ['Flutter driver app', ['flutter', 'mobile'], ['logistics'], 'Zaira'],
    ['React Native telehealth', ['react native', 'mobile'], ['healthcare'], 'Zaira'],
    ['iOS and Android app', ['ios', 'android'], [], 'Zaira'],
    ['CI/CD migration to Terraform', ['devops', 'terraform', 'ci/cd'], [], 'Hassan'],
    ['Kubernetes on AWS', ['kubernetes', 'aws'], [], 'Hassan'],
    ['Docker + Terraform', ['docker', 'terraform'], ['saas'], 'Hassan'],
    ['transport fleet mobile app', ['mobile'], ['logistics'], 'Zaira'],
    ['healthcare scheduling mobile', ['mobile'], ['healthcare'], 'Zaira'],
    ['fintech API in node', ['node', 'api'], ['fintech'], 'Aneeb'],
    ['AI governance platform', ['ai', 'compliance'], [], 'Aneeb'],
    ['infrastructure automation', ['devops', 'aws'], [], 'Hassan'],
    ['merchant dashboard rebuild', ['react', 'typescript'], ['fintech'], 'Aneeb'],
    ['last-mile delivery app', ['react native'], ['logistics'], 'Zaira'],
    ['bus operator flutter', ['flutter'], ['transport'], 'Zaira'],
    ['data platform python airflow', ['python', 'postgres'], [], 'Aneeb'],
    ['k8s cost reduction', ['kubernetes', 'docker'], [], 'Hassan'],
    ['next.js analytics dashboard', ['next.js', 'dashboard'], ['saas'], 'Aneeb'],
  ]
  for (const [name, caps, inds, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const r = rankSendersForLead(leadCtx(caps, inds), SENDERS, null)
      expect(r.bestSenderId).toBe(expected)
      expect(r.rankings[0].reasons.length).toBeGreaterThan(0)
      expect(r.rankings.every((x) => x.profileMatch >= 0 && x.profileMatch <= 100)).toBe(true)
    })
  }

  it('top-3 contains the expected sender for every case and scores are bounded', () => {
    const r = rankSendersForLead(leadCtx(['react', 'devops'], ['fintech']), SENDERS, null)
    expect(r.rankings.map((x) => x.senderId).slice(0, 3)).toEqual(expect.arrayContaining(['Aneeb', 'Hassan']))
    for (const x of r.rankings) expect(x.confidence).toBeGreaterThan(0)
  })
})

describe('routing result shape and mismatch', () => {
  it('reports current vs best, delta and rank', () => {
    const r = rankSendersForLead(leadCtx(['flutter', 'mobile'], ['logistics']), SENDERS, 'Hassan')
    expect(r.bestSenderId).toBe('Zaira')
    expect(r.currentSenderId).toBe('Hassan')
    expect(r.currentSenderRank).toBeGreaterThan(1)
    expect((r.mismatchDelta ?? 0) > 0).toBe(true)
  })

  it('platform filter excludes channel-incompatible senders', () => {
    const upwork = sender('Upworker', { platform: 'upwork', skills: ['react', 'node', 'fintech'] })
    const r = rankSendersForLead({ ...leadCtx(['react'], ['fintech']), platform: 'linkedin' }, [...SENDERS, upwork], null)
    expect(r.rankings.some((x) => x.senderId === 'Upworker')).toBe(false)
  })

  it('inaccessible senders carry a risk and holders', () => {
    const held = sender('Held', { skills: ['react', 'node'], accessibleToRep: false, holders: [{ repId: 'r9', name: 'Ola' }] })
    const r = rankSendersForLead(leadCtx(['react', 'node']), [held, ZAIRA], null)
    const row = r.rankings.find((x) => x.senderId === 'Held')!
    expect(row.accessibleToRep).toBe(false)
    expect(row.holders).toEqual(['Ola'])
    expect(row.risks.join(' ')).toMatch(/Not accessible/)
  })

  it('is deterministic: same input → same output', () => {
    const a = rankSendersForLead(leadCtx(['react', 'node'], ['fintech']), SENDERS, 'Aneeb')
    const b = rankSendersForLead(leadCtx(['react', 'node'], ['fintech']), SENDERS, 'Aneeb')
    expect(a.rankings.map((x) => [x.senderId, x.profileMatch])).toEqual(b.rankings.map((x) => [x.senderId, x.profileMatch]))
  })
})

describe('historical outcomes are weak, bounded evidence', () => {
  it('fewer than 5 contacted leads earn nothing', () => {
    const noHist = rankSendersForLead(leadCtx(['react']), [sender('A', { skills: ['react'] })], null).rankings[0].profileMatch
    const tiny = rankSendersForLead(leadCtx(['react']), [sender('A', { skills: ['react'], historicalOutcomes: { leadsContacted: 3, replies: 3, meetings: 3 } })], null).rankings[0].profileMatch
    expect(tiny).toBe(noHist)
  })

  it('a strong reply rate adds at most 15 points', () => {
    const noHist = rankSendersForLead(leadCtx(['react']), [sender('A', { skills: ['react'] })], null).rankings[0].profileMatch
    const hist = rankSendersForLead(leadCtx(['react']), [sender('A', { skills: ['react'], historicalOutcomes: { leadsContacted: 40, replies: 30, meetings: 10 } })], null).rankings[0].profileMatch
    expect(hist - noHist).toBeLessThanOrEqual(15)
    expect(hist).toBeGreaterThan(noHist)
  })

  it('history alone never beats a verified proof match', () => {
    const proven = sender('Proven', { skills: ['flutter'], proof: [{ text: 'Flutter app shipped', tags: ['flutter', 'mobile'], strong: true, verified: true }] })
    const lucky = sender('Lucky', { skills: ['php'], historicalOutcomes: { leadsContacted: 100, replies: 90, meetings: 40 } })
    const r = rankSendersForLead(leadCtx(['flutter', 'mobile']), [proven, lucky], null)
    expect(r.bestSenderId).toBe('Proven')
  })
})

describe('opportunity score is sender-independent (Phase 23)', () => {
  const TEXT = li({
    name: 'Priya Raman', headline: 'CTO at Ledgerline | Payments', location: 'Austin, Texas, United States', degree: '2nd', connections: '500+ connections',
    about: ['Ledgerline is a payments startup. Team of 14 on Node.js, React and PostgreSQL.'],
    posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React. Budget approved: $40,000. Start within 3 weeks. DM me.' }],
    experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
  })
  const MODEL = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const }

  it('changing the sender changes the match, never the opportunity score', async () => {
    const packet = await runOffline(TEXT, { model: MODEL })
    const ctx = buildRoutingLeadContext({ company: 'Ledgerline', contactTitle: 'CTO', rawInput: TEXT }, packet, 'linkedin')
    const asAneeb = rankSendersForLead(ctx, SENDERS, 'Aneeb')
    const asZaira = rankSendersForLead(ctx, SENDERS, 'Zaira')
    expect(asAneeb.currentSenderMatch).not.toBe(asZaira.currentSenderMatch)
    // The packet was produced before any sender was known and is reused as-is.
    const again = await runOffline(TEXT, { model: MODEL })
    expect(again.score).toBe(packet.score)
    expect(again.qualification).toBe(packet.qualification)
    expect(asAneeb.bestSenderId).toBe('Aneeb')
    expect(asZaira.bestSenderId).toBe('Aneeb')
  })

  it('the routing context reads capabilities and industry from the packet facts', async () => {
    const packet = await runOffline(TEXT, { model: MODEL })
    const ctx = buildRoutingLeadContext({ company: 'Ledgerline', contactTitle: 'CTO', rawInput: TEXT }, packet, 'linkedin')
    expect(ctx.capabilities).toEqual(expect.arrayContaining(['react']))
    expect(ctx.industries).toEqual(['fintech'])
  })
})
