/**
 * Upwork application gate: cover letters and screening answers are judged
 * deterministically against the job and the profile. No model calls.
 */
import { describe, it, expect } from 'vitest'
import { evaluateCoverLetter, evaluateScreeningAnswers, classifyQuestion } from '@/lib/upwork/application-gate'

const job = {
  title: 'Rebuild tenant portal in React and Node',
  description: 'We run a B2B SaaS for property managers and need a senior engineer to rebuild our tenant portal. React, Node, PostgreSQL on AWS. Stripe payments flow. First milestone within 3 weeks.',
  skills: ['react', 'node', 'postgresql', 'aws', 'stripe'],
  screeningQuestions: ['Describe your recent experience with similar projects', 'What is your hourly rate and availability?', 'Have you worked with Stripe Connect before?'],
}
const profile = {
  claimableText: ['React', 'Node', 'PostgreSQL', 'AWS', 'Stripe', 'TypeScript', 'Rentwise tenant portal', 'Built a React/Node tenant portal for Rentwise with Stripe billing'],
  proof: ['Built a React/Node tenant portal for Rentwise: Stripe billing, PostgreSQL migrations, AWS deploy; cut support tickets 40%'],
  allowedNumbers: ['40%', '3'],
}

const GOOD = `Your tenant portal rebuild on React and Node is close to what we shipped for Rentwise: a React front end on their design system, Stripe billing in the Node API and PostgreSQL migrations run without downtime, deployed on AWS. Support tickets dropped 40% after launch. For your first milestone I would start with the payments flow and the migration scripts in week one, then the portal screens, so the 3-week milestone is a working slice rather than a mockup. Which part of the current portal causes the most support load today?`

describe('cover letter gate', () => {
  it('passes a specific, grounded, proof-backed letter of the right length', () => {
    const r = evaluateCoverLetter(GOOD, job, profile)
    expect(r.issues.filter((i) => i.severity === 'block')).toEqual([])
    expect(r.passed).toBe(true)
    expect(r.wordCount).toBeGreaterThanOrEqual(50)
    expect(r.wordCount).toBeLessThanOrEqual(150)
    expect(r.jobReferences.length).toBeGreaterThanOrEqual(2)
    expect(r.proofUsed).toBe(true)
  })
  it('blocks the generic opener and biography dump', () => {
    const r = evaluateCoverLetter(`Hi, I came across your job posting and I would love the opportunity. I am a full-stack developer with 8+ years of experience. My skills include: React, Node, Angular, Vue, PHP, Laravel, Python, Django, AWS, Azure, GCP. I am confident that I am the perfect fit for this project. Looking forward to hearing from you. Best regards.`, job, profile)
    expect(r.passed).toBe(false)
    const codes = r.issues.map((i) => i.code)
    expect(codes).toContain('GENERIC_OPENER')
    expect(codes).toContain('BANNED_PHRASE')
    expect(codes).toContain('BIO_DUMP')
  })
  it('blocks invented numbers and flags unknown product names', () => {
    const r = evaluateCoverLetter(`${GOOD} We also delivered 120 integrations for Zentrava last year.`, job, profile)
    expect(r.issues.some((i) => i.code === 'INVENTED_NUMBER')).toBe(true)
    expect(r.issues.some((i) => i.code === 'UNKNOWN_NAME' && /Zentrava/.test(i.message))).toBe(true)
  })
  it('blocks letters that never reference the job', () => {
    const r = evaluateCoverLetter(`I build software for clients around the world and deliver on time. My process is simple: understand, plan, ship, iterate. I communicate daily and keep everything documented so nothing is lost. Let me know when you want to talk about the next steps and I will send over a plan the same day.`, job, profile)
    expect(r.issues.some((i) => i.code === 'NOT_SPECIFIC')).toBe(true)
  })
  it('blocks too short and too long', () => {
    expect(evaluateCoverLetter('React and Node portal. Did Rentwise. Stripe too.', job, profile).issues.some((i) => i.code === 'TOO_SHORT')).toBe(true)
    expect(evaluateCoverLetter(`${GOOD} ${GOOD}`, job, profile).issues.some((i) => i.code === 'TOO_LONG')).toBe(true)
  })
  it('normalises dashes, exclamation marks and emoji', () => {
    const r = evaluateCoverLetter(GOOD.replace('For your first milestone', 'For your first milestone — and yes! 🚀'), job, profile)
    expect(r.text).not.toMatch(/[—!🚀]/)
  })
})

describe('screening answers gate', () => {
  it('classifies question types', () => {
    expect(classifyQuestion('What is your hourly rate and availability?')).toBe('availability_rate')
    expect(classifyQuestion('Have you worked with Stripe Connect before?')).toBe('yes_no')
    expect(classifyQuestion('Describe your recent experience with similar projects')).toBe('technical')
    expect(classifyQuestion('Walk us through how you would structure billing')).toBe('technical')
  })
  it('passes answers that actually answer, are grounded and are not the letter again', () => {
    const r = evaluateScreeningAnswers([
      { question: job.screeningQuestions[0], answer: 'Most recently I built the Rentwise tenant portal: React front end, Node API with Stripe billing and PostgreSQL migrations on AWS. Similar shape to your portal, including the payments flow.' },
      { question: job.screeningQuestions[1], answer: 'My rate is within your posted range and I can commit 30 hours per week starting Monday, overlapping US Central mornings.' },
      { question: job.screeningQuestions[2], answer: 'Yes. Rentwise used Stripe Connect for landlord payouts, including onboarding and webhook reconciliation.' },
    ], job, profile, GOOD)
    expect(r.issues.filter((i) => i.severity === 'block')).toEqual([])
    expect(r.passed).toBe(true)
  })
  it('blocks a yes/no question answered sideways, a missing answer and an ungrounded claim', () => {
    const r = evaluateScreeningAnswers([
      { question: job.screeningQuestions[0], answer: 'I built and shipped a large hospital scheduling system with Kubernetes and Rust that handled millions of users.' },
      { question: job.screeningQuestions[2], answer: 'Payments are important for every tenant portal and I take them seriously.' },
    ], job, profile, GOOD)
    const codes = r.issues.map((i) => i.code)
    expect(codes).toContain('UNGROUNDED_CLAIM')
    expect(codes).toContain('NOT_ANSWERED')
    expect(codes).toContain('MISSING_ANSWER')
    expect(r.passed).toBe(false)
  })
  it('blocks an answer that copies the cover letter and truncates an over-long one', () => {
    const copy = GOOD.split('.').slice(0, 3).join('.') + '.'
    const r = evaluateScreeningAnswers([
      { question: job.screeningQuestions[0], answer: copy },
      { question: job.screeningQuestions[1], answer: `I can start Monday at 30 hours per week. ${'I keep my calendar open and communicate daily. '.repeat(12)}` },
      { question: job.screeningQuestions[2], answer: 'Yes, on Rentwise with Stripe Connect payouts.' },
    ], job, profile, GOOD)
    expect(r.issues.some((i) => i.code === 'COPIES_COVER_LETTER')).toBe(true)
    expect(r.answers[1].wordCount).toBeLessThanOrEqual(40)
  })
})
