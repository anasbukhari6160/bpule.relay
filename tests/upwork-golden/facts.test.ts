/**
 * Upwork extraction hardening: rate layouts, proposals, connects, client
 * history, screening questions, timing, suspicious signals. Deterministic.
 */
import { describe, it, expect } from 'vitest'
import { readUpworkJobFacts } from '@/lib/upwork/facts'

describe('hourly rate layouts', () => {
  const cases: Array<[string, string, number, number, boolean]> = [
    ['single line', 'Rate: $25.00 - $60.00 Hourly', 25, 60, false],
    ['multiline with bare dash', '$25\n-\n$60\nHourly', 25, 60, true],
    ['multiline decimals', '$25.00\n-\n$60.00\nHourly', 25, 60, true],
    ['marker before', 'Hourly: $40 - $75', 40, 75, false],
    ['per hour', '$30 to $45 per hour', 30, 45, false],
    ['slash hr', '$18-$22/hr', 18, 22, false],
    ['single amount hourly', '$50.00 Hourly', 50, 50, false],
    ['single amount per hour', 'Pay is $35 per hour', 35, 35, false],
    ['thousands separators', '$1,000 - $1,200/hr is a typo but $35-$45/hr is the rate', 35, 45, false],
  ]
  for (const [name, block, lo, hi, multiline] of cases) {
    it(name, () => {
      const f = readUpworkJobFacts(`Senior React Developer\nPosted 2 hours ago\n\nWe need a React dev for our dashboard. Must know Node and Postgres.\n\n${block}\nExpert\nMore than 6 months\n30+ hrs/week\n\nProposals: 5 to 10`)
      expect(f.rate.type).toBe('hourly')
      expect(f.rate.hourlyMin).toBe(lo)
      expect(f.rate.hourlyMax).toBe(hi)
      if (multiline) expect(f.rate.multiline).toBe(true)
    })
  }

  it('does not take a fixed budget range as an hourly rate when the hourly block is further down', () => {
    const f = readUpworkJobFacts(`Build a portal\nPosted 1 day ago\n\nBudget was $500 - $1,000 last time we posted. Now hiring hourly.\n\n$25\n-\n$60\nHourly\nIntermediate\n\nProposals: Less than 5`)
    expect(f.rate.type).toBe('hourly')
    expect(f.rate.hourlyMin).toBe(25)
    expect(f.rate.hourlyMax).toBe(60)
  })

  it('does not read "$25 - $60 mobile app" as a monthly rate', () => {
    const f = readUpworkJobFacts(`Mobile app\nPosted 1 day ago\n\nWe pay $25 - $60 mobile app developers depending on experience, hourly.\n\n$25 - $60 Hourly\n\nProposals: 5 to 10`)
    expect(f.rate.type).toBe('hourly')
    expect(f.rate.hourlyMin).toBe(25)
  })
})

describe('fixed and monthly budgets', () => {
  it('fixed-price marker after the amount', () => {
    const f = readUpworkJobFacts(`Landing page\nPosted 4 hours ago\n\nNeed a Webflow landing page with three sections and a form.\n\n$1,500.00\nFixed-price\nIntermediate\n\nProposals: 10 to 15`)
    expect(f.rate.type).toBe('fixed')
    expect(f.rate.fixedBudget).toBe(1500)
  })
  it('fixed-price without comma', () => {
    const f = readUpworkJobFacts(`Landing page\nPosted 4 hours ago\n\nNeed a Webflow landing page.\n\n$1500.00\nFixed-price\n\nProposals: 10 to 15`)
    expect(f.rate.fixedBudget).toBe(1500)
  })
  it('Est. Budget marker before the amount', () => {
    const f = readUpworkJobFacts(`Shopify theme\nPosted 4 hours ago\n\nCustomize our Shopify theme and speed it up.\n\nFixed price - Est. Budget: $800\nIntermediate\n\nProposals: 20 to 50`)
    expect(f.rate.type).toBe('fixed')
    expect(f.rate.fixedBudget).toBe(800)
  })
  it('monthly retainer', () => {
    const f = readUpworkJobFacts(`Fractional backend lead\nPosted 1 day ago\n\nOngoing Node and AWS work for our SaaS. $4,000/month retainer, 20 hrs/week.\n\nProposals: 5 to 10`)
    expect(f.rate.type).toBe('monthly')
    expect(f.rate.monthlyBudget).toBe(4000)
  })
  it('a lone dollar amount in the description is rejected, not credited', () => {
    const f = readUpworkJobFacts(`Marketing site\nPosted 1 day ago\n\nOur product sells for $49 a seat. We need a new marketing site in Next.js with a pricing page and blog.\n\nProposals: 5 to 10`)
    expect(f.rate.type).toBe('unknown')
    expect(f.rejectedSignals.some((r) => r.signal === 'budget')).toBe(true)
  })
})

describe('activity, connects and client history', () => {
  const text = `Data pipeline engineer\nPosted 6 hours ago\n\nBuild an Airflow + dbt pipeline on Postgres for our analytics.\n\n$40.00 - $70.00 Hourly\nExpert\n3 to 6 months\nLess than 30 hrs/week\n\nActivity on this job\nProposals:\nLess than 5\nInterviewing: 2\n\nAbout the client\nPayment method verified\n4.8 of 5 stars (12 reviews)\nToronto, Canada\n2:15 PM\n18 jobs posted\n72% hire rate, 1 open job\n$23K total spent\n13 hires, 2 active\n$41.20/hr avg hourly rate paid\n560 hours\nMember since Jan 12, 2021\n\nRequired Connects to submit a proposal: 16\nAvailable Connects: 140`
  const f = readUpworkJobFacts(text)
  it('proposals with the number on the next line', () => { expect(f.proposals.range).toEqual([0, 5]) })
  it('connects: required, not available', () => { expect(f.connects).toBe(16) })
  it('client facts survive (not deleted by the cleaner)', () => {
    expect(f.client.paymentVerified).toBe(true)
    expect(f.client.totalSpent).toBe(23000)
    expect(f.client.hireRate).toBe(72)
    expect(f.client.jobsPosted).toBe(18)
    expect(f.client.hires).toBe(13)
    expect(f.client.rating).toBe(4.8)
    expect(f.client.avgHourlyPaid).toBe(41.2)
    expect(f.client.memberSince).toMatch(/2021/)
    expect(f.client.isNew).toBe(false)
  })
  it('duration and hours', () => { expect(f.duration.months).toBe(4.5); expect(f.weeklyHours.hours).toBe(30) })
  it('experience and skills', () => { expect(f.experience.level).toBe('expert'); expect(f.skills).toEqual(expect.arrayContaining(['data engineering', 'postgresql'])) })
  it('proposal ranges', () => {
    expect(readUpworkJobFacts('x\n\nProposals: 20 to 50\n').proposals.range).toEqual([20, 50])
    expect(readUpworkJobFacts('x\n\nProposals: 50+\n').proposals.range?.[0]).toBe(50)
    expect(readUpworkJobFacts('x\n\n15 to 20 proposals\n').proposals.range).toEqual([15, 20])
  })
  it('payment unverified and new client', () => {
    const g = readUpworkJobFacts(`Quick fix\nPosted 1 hour ago\n\nFix a bug in our React app.\n\n$30.00 Hourly\n\nAbout the client\nPayment method unverified\nLagos, Nigeria\n9:00 AM\nMember since Oct 19, 2026`)
    expect(g.client.paymentVerified).toBe(false)
    expect(g.client.isNew).toBe(true)
  })
})

describe('screening, timing, suspicious, language', () => {
  it('numbered screening questions', () => {
    const f = readUpworkJobFacts(`React dev\nPosted 1 day ago\n\nBuild a dashboard in React.\n\n$40 Hourly\n\nScreening questions\nYou will be asked to answer the following questions when submitting a proposal:\n1. Describe your recent experience with similar projects\n2. What is your hourly rate and availability?\n3. Have you worked with Stripe Connect before?\n\nActivity on this job\nProposals: 5 to 10`)
    expect(f.screeningQuestions).toHaveLength(3)
    expect(f.screeningQuestions[1]).toMatch(/hourly rate/i)
  })
  it('start timing', () => {
    expect(readUpworkJobFacts('x\n\nWe need to start ASAP, this week ideally.\n').start.urgency).toBe('asap')
    expect(readUpworkJobFacts('x\n\nStart date: November 3. Scope is clear.\n').start.urgency).toBe('scheduled')
    expect(readUpworkJobFacts('x\n\nOngoing work, no rush.\n').start.urgency).toBe('ongoing')
  })
  it('posted ago', () => {
    expect(readUpworkJobFacts('Job\nPosted 3 days ago\n\nBuild a thing.\n').posted.hoursAgo).toBe(72)
    expect(readUpworkJobFacts('Job\nPosted yesterday\n\nBuild a thing.\n').posted.hoursAgo).toBe(24)
  })
  it('suspicious: off-platform contact and unpaid test', () => {
    const f = readUpworkJobFacts(`Easy data entry job\nPosted 1 hour ago\n\nSimple data entry, $60 per hour. Message me on WhatsApp +1 555 0100 to start. We will give you a free test task first.\n\n$60.00 Hourly\nEntry level`)
    expect(f.suspicious.length).toBeGreaterThanOrEqual(2)
  })
  it('German job', () => {
    const f = readUpworkJobFacts(`React Entwickler gesucht\nPosted 2 hours ago\n\nWir suchen einen erfahrenen React Entwickler für unser Kundenportal. Node und PostgreSQL Kenntnisse erforderlich.\n\n$35 - $55 pro Stunde\nExperte\n\nProposals: 5 to 10`)
    expect(f.language).toBe('de')
    expect(f.rate.type).toBe('hourly')
    expect(f.rate.hourlyMax).toBe(55)
    expect(f.skills).toEqual(expect.arrayContaining(['react', 'node', 'postgresql']))
  })
  it('incomplete paste scores low completeness, not an error', () => {
    const f = readUpworkJobFacts('Need a developer for my app')
    expect(f.completeness.score).toBeLessThan(40)
    expect(f.scope.vague).toBe(true)
  })
  it('same text in → same facts out', () => {
    const t = `A\nPosted 1 day ago\n\n$25\n-\n$60\nHourly\nBuild things in React.\n\nProposals: 5 to 10`
    expect(JSON.stringify(readUpworkJobFacts(t))).toBe(JSON.stringify(readUpworkJobFacts(t)))
  })
})
