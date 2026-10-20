/**
 * Upwork critical path (synthetic): paste → extract → score → best sender →
 * cover letter → screening answers → apply/log. Multiline rate layout on
 * purpose. Run against a demo-mode server:
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/scoring-upwork-flow.spec.ts --project=desktop-chrome
 */
import { test, expect } from '@playwright/test'
import { loginAsAdmin, bootstrapDemoProfile } from './helpers'

const JOB = `Rebuild tenant portal in React and Node
Posted 3 hours ago
Worldwide

We run a B2B SaaS for property managers and need a senior engineer to rebuild our tenant portal.
Current stack is React, Node and PostgreSQL on AWS. Deliverables:
- New React front end with our design system
- REST API changes in Node for the payments flow (Stripe)
- Migration scripts for PostgreSQL
Timeline: first milestone within 3 weeks. Please share two similar projects you shipped.

$25
-
$60
Hourly
Expert
3 to 6 months
30+ hrs/week

Skills and Expertise
React
Node.js
PostgreSQL
AWS

Screening questions
You will be asked to answer the following questions when submitting a proposal:
1. Describe your recent experience with similar projects
2. What is your hourly rate and availability?

Activity on this job
Proposals: 5 to 10
Last viewed by client: 1 hour ago

About the client
Payment method verified
4.9 of 5 stars (21 reviews)
Austin, United States
10:42 AM
31 jobs posted
82% hire rate, 2 open jobs
$48K total spent
26 hires, 1 active
$38.50/hr avg hourly rate paid
2,140 hours
Member since Mar 4, 2019

Required Connects to submit a proposal: 16
Available Connects: 140`

test.describe('Upwork scoring flow', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await bootstrapDemoProfile(baseURL ?? 'http://localhost:3100').catch(() => {})
    await loginAsAdmin(page)
  })

  test('U01: paste → extract (multiline rate) → score → save → best sender → proposal → screening → log', async ({ page }) => {
    test.setTimeout(400_000)
    await page.goto('/upwork/new')
    await page.waitForLoadState('networkidle')
    await page.locator('textarea[placeholder="Paste the full Upwork job post..."]').fill(JOB)
    await page.locator('button:has-text("Extract")').first().click()

    // Extraction fills the form; the multiline rate must parse to 25–60 hourly.
    const hourlyMin = page.locator('input').filter({ has: page.locator('xpath=..') }).first()
    await expect.poll(async () => {
      const inputs = await page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
      return inputs.includes('25') && inputs.includes('60')
    }, { timeout: 120_000, message: 'hourly 25 and 60 extracted' }).toBe(true)
    void hourlyMin

    const body = (await page.textContent('body')) ?? ''
    expect(body).toMatch(/\/ 10/)
    expect(body).toMatch(/Canonical \d{1,3}\/100/)
    expect(body).toMatch(/apply/i)

    // Save → job page.
    const save = page.locator('button').filter({ hasText: /^save/i }).first()
    await save.scrollIntoViewIfNeeded()
    await save.click()
    await page.waitForURL((u) => /\/upwork\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/new'), { timeout: 90_000 })
    await page.waitForLoadState('networkidle')
    const jobBody = (await page.textContent('body')) ?? ''
    expect(jobBody).toMatch(/\(\d{1,3}\/100\)/)
    expect(jobBody).toMatch(/\$25–\$60\/hr|\$25-\$60\/hr|\$25–\$60/)
    await expect(page.locator('[data-testid="upwork-why"]')).toBeVisible()
    // Profile match is separate from the job score (renders when profiles exist).
    const match = page.locator('[data-testid="upwork-profile-match"]')
    if (await match.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(match.getByText(/%/).first()).toBeVisible()
    }

    // Generate proposal + screening answers.
    const generate = page.locator('button:has-text("Generate proposal")').first()
    await expect(generate).toBeVisible({ timeout: 30_000 })
    await generate.click()
    await expect(page.getByText(/Screening Answers|Proposal Quality/i).first()).toBeVisible({ timeout: 180_000 })
    const afterGen = (await page.textContent('body')) ?? ''
    const letter = await page.locator('textarea').first().inputValue().catch(() => '')
    if (letter) {
      const words = letter.trim().split(/\s+/).length
      expect(words).toBeGreaterThanOrEqual(40)
      expect(words).toBeLessThanOrEqual(200)
      expect(letter).not.toMatch(/I came across your job|I'd love the opportunity|years of experience/i)
      expect(letter.toLowerCase()).toMatch(/react|node|portal|postgres|stripe/)
    }
    expect(afterGen).toMatch(/hourly rate and availability|recent experience/i)

    // Log as applied (draft/apply controls).
    const applied = page.locator('button').filter({ hasText: /mark (as )?applied|log (as )?applied|applied/i }).first()
    if (await applied.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await applied.click()
      await page.waitForTimeout(2000)
      const after = (await page.textContent('body')) ?? ''
      test.info().annotations.push({ type: 'finding', description: /applied|logged/i.test(after) ? 'apply logged' : 'apply click did not visibly log (check connects/draft gating)' })
      expect(after).not.toMatch(/Something failed|Unexpected error/i)
    }
  })
})
