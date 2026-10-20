/**
 * Upwork golden set: every fixture's extraction and score land where the
 * business expects. Deterministic, no network.
 */
import { describe, it, expect } from 'vitest'
import { UPWORK_GOLDEN } from './fixtures'
import { readUpworkJobFacts } from '@/lib/upwork/facts'
import { scoreUpworkFacts, matchProfilesToJob } from '@/lib/upwork/score'
import type { SenderProfile } from '@/lib/relay/sender-routing-engine'

describe('upwork golden set', () => {
  it('has at least 100 fixtures across every required category', () => {
    expect(UPWORK_GOLDEN.length).toBeGreaterThanOrEqual(100)
    const cats = new Set(UPWORK_GOLDEN.map((f) => f.category))
    for (const c of ['high_budget', 'low_budget', 'hourly', 'fixed_price', 'multiline_rate', 'strong_client', 'new_client', 'high_competition', 'low_competition', 'strong_fit', 'weak_fit', 'urgent', 'long_term', 'short_term', 'screening_heavy', 'suspicious', 'incomplete', 'multilingual']) expect(cats.has(c as never), c).toBe(true)
    expect(new Set(UPWORK_GOLDEN.map((f) => f.id)).size).toBe(UPWORK_GOLDEN.length)
  })

  for (const f of UPWORK_GOLDEN) {
    it(`${f.id} (${f.category})`, () => {
      const facts = readUpworkJobFacts(f.rawText)
      const s = scoreUpworkFacts(facts)
      const e = f.expect
      const ctx = `${f.id}: score ${s.score} ${s.qualification} ${s.verdict} rate=${JSON.stringify(facts.rate)} proposals=${JSON.stringify(facts.proposals)}`
      if (e.rateType) expect(facts.rate.type, ctx).toBe(e.rateType)
      if (e.hourlyMin !== undefined) expect(facts.rate.hourlyMin, ctx).toBe(e.hourlyMin)
      if (e.hourlyMax !== undefined) expect(facts.rate.hourlyMax, ctx).toBe(e.hourlyMax)
      if (e.fixedBudget !== undefined) expect(facts.rate.fixedBudget, ctx).toBe(e.fixedBudget)
      if (e.monthlyBudget !== undefined) expect(facts.rate.monthlyBudget, ctx).toBe(e.monthlyBudget)
      if (e.multiline) expect(facts.rate.multiline, ctx).toBe(true)
      if (e.proposalsRange !== undefined) expect(facts.proposals.range, ctx).toEqual(e.proposalsRange)
      if (e.connects !== undefined) expect(facts.connects, ctx).toBe(e.connects)
      if (e.paymentVerified !== undefined) expect(facts.client.paymentVerified, ctx).toBe(e.paymentVerified)
      if (e.totalSpentMin !== undefined) expect(facts.client.totalSpent ?? 0, ctx).toBeGreaterThanOrEqual(e.totalSpentMin)
      if (e.hireRate !== undefined) expect(facts.client.hireRate, ctx).toBe(e.hireRate)
      if (e.skillsInclude) for (const sk of e.skillsInclude) expect(facts.skills, `${ctx} skills=${facts.skills.join(',')}`).toContain(sk)
      if (e.skillsExclude) for (const sk of e.skillsExclude) expect(facts.skills, ctx).not.toContain(sk)
      if (e.screeningCount !== undefined) expect(facts.screeningQuestions.length, `${ctx} q=${JSON.stringify(facts.screeningQuestions)}`).toBe(e.screeningCount)
      if (e.startUrgency) expect(facts.start.urgency, ctx).toBe(e.startUrgency)
      if (e.suspicious !== undefined) expect(facts.suspicious.length > 0, `${ctx} suspicious=${facts.suspicious.join('|')}`).toBe(e.suspicious)
      if (e.durationMonthsMin !== undefined) expect(facts.duration.months ?? 0, ctx).toBeGreaterThanOrEqual(e.durationMonthsMin)
      if (e.durationMonthsMax !== undefined) expect(facts.duration.months ?? 99, ctx).toBeLessThanOrEqual(e.durationMonthsMax)
      if (e.weeklyHours !== undefined) expect(facts.weeklyHours.hours, ctx).toBe(e.weeklyHours)
      if (e.experience !== undefined) expect(facts.experience.level, ctx).toBe(e.experience)
      if (e.language) expect(facts.language, ctx).toBe(e.language)
      if (e.scoreRange) { expect(s.score, ctx).toBeGreaterThanOrEqual(e.scoreRange[0]); expect(s.score, ctx).toBeLessThanOrEqual(e.scoreRange[1]) }
      if (e.qualification) expect(e.qualification, ctx).toContain(s.qualification)
      if (e.verdict) expect(e.verdict, ctx).toContain(s.verdict)
      // Structural invariants on every fixture.
      expect(s.dimensions).toHaveLength(9)
      for (const d of s.dimensions) { expect(d.raw).toBeGreaterThanOrEqual(0); expect(d.raw).toBeLessThanOrEqual(1) }
      const sum = s.dimensions.reduce((a, d) => a + d.contribution, 0)
      if (s.cap) expect(s.score, ctx).toBe(Math.min(Math.round(sum), s.cap.value))
      else expect(Math.abs(sum - s.score), ctx).toBeLessThanOrEqual(1)
    })
  }
})

describe('job score is independent of the profile', () => {
  const aneeb: SenderProfile = { id: 'aneeb', name: 'Aneeb', role: null, platform: 'upwork', skills: ['react', 'node', 'postgresql', 'aws', 'typescript'], industries: ['saas'], proof: [{ text: 'React/Node tenant portal for a property SaaS', tags: ['react', 'node', 'postgresql', 'saas'], strong: true, verified: true }], holders: [{ repId: 'r1', name: 'Rep' }], accessibleToRep: true }
  const zaira: SenderProfile = { id: 'zaira', name: 'Zaira', role: null, platform: 'upwork', skills: ['flutter', 'react native', 'ios', 'android', 'firebase'], industries: ['healthcare'], proof: [{ text: 'Flutter telehealth app', tags: ['flutter', 'mobile', 'healthcare'], strong: true, verified: false }], holders: [{ repId: 'r2', name: 'Rep2' }], accessibleToRep: false }
  const f = UPWORK_GOLDEN.find((x) => x.id === 'hr-standard-40-70')!
  const facts = readUpworkJobFacts(f.rawText)
  it('changing the current sender never changes the job score', () => {
    const base = scoreUpworkFacts(facts)
    const a = matchProfilesToJob(facts, [aneeb, zaira], 'aneeb')
    const z = matchProfilesToJob(facts, [aneeb, zaira], 'zaira')
    expect(scoreUpworkFacts(facts).score).toBe(base.score)
    expect(a.bestSenderId).toBe('aneeb')
    expect(z.bestSenderId).toBe('aneeb')
    expect(a.rankings.find((r) => r.senderId === 'aneeb')!.profileMatch).toBeGreaterThan(a.rankings.find((r) => r.senderId === 'zaira')!.profileMatch)
  })
  it('a mobile job ranks the mobile profile first without touching the job score', () => {
    const m = UPWORK_GOLDEN.find((x) => x.id === 'ml-rate-marker-first')!
    const mf = readUpworkJobFacts(m.rawText)
    const before = scoreUpworkFacts(mf).score
    const r = matchProfilesToJob(mf, [aneeb, zaira], 'aneeb')
    expect(r.bestSenderId).toBe('zaira')
    expect(scoreUpworkFacts(mf).score).toBe(before)
  })
})
