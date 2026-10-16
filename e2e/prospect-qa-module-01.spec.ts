/**
 * Live regression for the Prospect Analysis QA report (Module 01, PRO-001…PRO-020).
 * Runs the report's control scenarios against a real server: raw SSE `done`
 * payloads for decision/scoring checks, the UI for presentation checks.
 * Evidence (payload JSON + screenshots) goes to test-results/prospect-qa/.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { loginAsAdmin } from './helpers'

const OUT = process.env.QA_EVIDENCE_DIR ?? path.join('test-results', 'prospect-qa')
fs.mkdirSync(OUT, { recursive: true })

const HIRING_ONLY = `Alex Morgan
Technical Recruiter at Northstar Technologies
Company: Northstar Technologies
Role: Technical Recruiter
LinkedIn Post:
We are hiring a Full-Time React Developer to join our internal engineering team.
Requirements:
- 3+ years of React experience
- REST API integration
Interested candidates should submit their CV.`

const EXTERNAL_AGENCY = `Alex Morgan
Technical Recruiter at Northstar Technologies
Company: Northstar Technologies
Role: Technical Recruiter
LinkedIn Post:
We are looking for an external software development agency to help us build a customer portal in React.
We want an outsourced development team, not full-time employees.
Scope:
- React frontend
- REST API integration
- Dashboard development
Approved project budget: $20,000
Expected start: Within 2 weeks.
Interested development agencies should contact us with their portfolio and project proposal.`

const JOHN_BODY = `John Gummadi

Senior Director of Software Engineering at Acme Labs

About
I lead the engineering team at Acme Labs.
We develop internal software products.`

const GENERIC = `Hello everyone!

I am exploring some new ideas.

Technology is changing rapidly, and there
are many interesting things happening.

Looking forward to connecting with people.`

type Done = Record<string, any>

async function analyzeApi(request: APIRequestContext, rawText: string, name: string): Promise<Done> {
  const res = await request.post('/api/prospect/analyze', {
    data: { rawText, forceReanalyze: true },
    timeout: 180_000,
  })
  expect(res.status(), `${name}: HTTP status`).toBe(200)
  const body = await res.text()
  const events = body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)))
  const errors = events.filter((e) => e.type === 'error')
  expect(errors, `${name}: SSE errors`).toEqual([])
  const done = events.reverse().find((e) => e.type === 'done')
  expect(done, `${name}: done event`).toBeTruthy()
  fs.writeFileSync(path.join(OUT, `${name}.done.json`), JSON.stringify(done, null, 2))
  return done
}

async function analyzeUi(page: Page, rawText: string) {
  await page.goto('/prospect')
  const box = page.getByPlaceholder('Paste the LinkedIn profile here...')
  await box.fill(rawText)
  await page.getByRole('button', { name: /^(Analyze|Re-analyze)$/ }).click()
  await expect(page.getByRole('button', { name: /^(Analyze|Re-analyze)$/ })).toBeEnabled({ timeout: 180_000 })
}

const dim = (done: Done, key: string) => (done.score?.dimensions ?? []).find((d: Done) => d.key === key)
const quoteOf = (d: Done | undefined) => (d?.evidence ?? []).find((e: Done) => e.kind === 'quote')?.text as string | undefined

test.describe('Prospect QA Module 01 — live', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(300_000)

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('API — PRO-001/019 identity and eligibility unaffected by LinkedIn chrome', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    const withView = await analyzeApi(page.request, `View John Gummadi's profile\n${JOHN_BODY}`, 'john-view-straight')
    const withCurly = await analyzeApi(page.request, `View John Gummadi’s profile\n${JOHN_BODY}`, 'john-view-curly')
    const without = await analyzeApi(page.request, JOHN_BODY, 'john-clean')
    for (const d of [withView, withCurly, without]) {
      expect(d.extracted.name).toBe('John Gummadi')
      expect(d.extracted.company).toBe('Acme Labs')
    }
    expect(withView.qualification.qualificationEligibility).toBe(without.qualification.qualificationEligibility)
    expect(withCurly.qualification.qualificationEligibility).toBe(without.qualification.qualificationEligibility)
    expect(withView.qualification.missingCritical).toEqual(without.qualification.missingCritical)
  })

  test('API — PRO-002/003/020 hiring-only is not a buyer request', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    const d = await analyzeApi(page.request, HIRING_ONLY, 'alex-hiring-only')
    expect(d.extracted.name).toBe('Alex Morgan')
    expect(d.extracted.title).toBe('Technical Recruiter')
    expect(d.extracted.company).toBe('Northstar Technologies')
    const packet = d.canonical.v3DecisionPacket
    expect(packet.decision.buyerRequestProbability).toBeLessThanOrEqual(0.2)
    expect(packet.decision.externalNeedProbability).toBeLessThanOrEqual(0.2)
    expect(packet.decision.relationship).not.toBe('BUYER')
    expect(packet.decision.needOwnerType).toBe('HIRING_NEED')
    expect(d.score.reasons).not.toContain('Explicit buyer request detected')
    expect(d.score.reasons.join(' ')).toMatch(/Recruitment activity detected; external-service buying need not verified/)
    expect(d.revenue.intent).not.toBe('HIGH')
    expect(d.qualification.inputClassification.classification).toBe('HIRING_POST')
    // PRO-020: extraction completeness is real; provider confidence is decisiveness, not inverted.
    expect(d.extracted.extractionConfidence).toBeGreaterThan(0)
    expect(d.canonical.confidence).not.toBe(50)
  })

  test('API — PRO-004/005/006/007/008/020 external agency request', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    const d = await analyzeApi(page.request, EXTERNAL_AGENCY, 'alex-external-agency')
    const packet = d.canonical.v3DecisionPacket

    // PRO-004: the selected episode is the external-service request.
    const selected = packet.episodes.find((e: Done) => e.id === packet.selectedEpisodeId)
    expect(selected, 'selected episode exists').toBeTruthy()
    expect(selected.needOwnerType).toBe('ORGANIZATION_NEED')
    expect(selected.anchorEvent.id.startsWith('evt_synthetic_')).toBe(false)
    expect(packet.decision.needOwnerType).toBe('ORGANIZATION_NEED')
    expect(packet.episodes.filter((e: Done) => e.anchorEvent.id.startsWith('evt_synthetic_') && e.needOwnerType === 'HIRING_NEED')).toEqual([])
    expect(d.score.reasons).not.toContain('Hiring')

    // PRO-005
    expect(d.qualification.inputClassification.classification).toBe('SERVICE_REQUEST')

    // PRO-006: the trace reconciles rows → canonical total.
    const calc = d.score.calculation
    expect(calc, 'calculation trace').toBeTruthy()
    const modelRows = d.score.dimensions.filter((r: Done) => r.group === 'model')
    expect(modelRows).toHaveLength(8)
    const subtotal = modelRows.reduce((s: number, r: Done) => s + r.points, 0)
    expect(calc.modelSubtotal).toBeCloseTo(subtotal, 1)
    expect(calc.modelScore).toBe(Math.round(Math.min(100, subtotal * calc.statusMultiplier * calc.relationshipMultiplier)))
    if (calc.signalCheckTotal != null && calc.floorApplied == null) {
      expect(Math.round(calc.modelScore * calc.modelWeight + calc.signalCheckTotal * (1 - calc.modelWeight))).toBe(calc.finalScore)
    }
    expect(calc.finalScore).toBe(d.score.total)

    // PRO-007: source quotes, verbatim.
    expect(quoteOf(dim(d, 'buyerRequest'))).toMatch(/external software development agency|outsourced development team/)
    expect(quoteOf(dim(d, 'commercialPotential'))).toBe('Approved project budget: $20,000')
    expect(quoteOf(dim(d, 'timing'))).toBe('Expected start: Within 2 weeks.')
    // A cited contact instruction must not sit on a 0/10 Access row.
    expect(dim(d, 'access').points).toBeGreaterThan(0)
    for (const row of d.score.dimensions) {
      for (const e of row.evidence ?? []) if (e.kind === 'quote') expect(EXTERNAL_AGENCY).toContain(e.text)
    }
    expect(d.evidenceLedger.length).toBeGreaterThan(0)

    // PRO-008: budget and start are recognized by their dimensions.
    expect(dim(d, 'commercialPotential').note).toMatch(/Budget stated: \$20,000 \(approved\)/)
    expect(dim(d, 'timing').note).toMatch(/Within 2 weeks/i)
    expect(d.score.watchOut.join(' ')).not.toMatch(/Episode status: UNKNOWN/)

    // PRO-020
    expect(d.extracted.extractionConfidence).toBe(100)
    expect(packet.decision.providerConfidence).toBeGreaterThan(0.3)
  })

  test('API — PRO-010/011/013 non-prospect input is not scored', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    const d = await analyzeApi(page.request, GENERIC, 'generic-non-prospect')
    expect(d.score).toBeNull()
    expect(d.inputStatus).toBe('not_prospect')
    expect(d.inputHeadline).toBe('Not a prospect')
    expect(d.revenue.noMessageReason).not.toMatch(/login|product ui/i)
    expect(d.revenue.noMessageReason).toMatch(/person, employer, or commercial opportunity/)
    expect(d.qualification.qualificationEligibility).toBe(false)
  })

  test('API — PRO-014 empty and whitespace input rejected', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    for (const raw of ['', '   \n\n  ']) {
      const res = await page.request.post('/api/prospect/analyze', { data: { rawText: raw } })
      expect(res.status()).toBe(400)
    }
  })

  test('UI — PRO-014/015 validation is one inline message, no request', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    await page.goto('/prospect')
    let analyzeCalls = 0
    page.on('request', (r) => { if (r.url().includes('/api/prospect/analyze')) analyzeCalls++ })
    for (const raw of ['', '   \n\n   ']) {
      await page.getByPlaceholder('Paste the LinkedIn profile here...').fill(raw)
      await page.getByRole('button', { name: /^Analyze$/ }).click()
      const alert = page.locator('#prospect-paste-error')
      await expect(alert).toHaveText(/Paste some profile text first/)
      await expect(page.getByText('Paste some profile text first.')).toHaveCount(1)
      await expect(page.getByText('Something failed')).toHaveCount(0)
      await expect(page.getByText('Check the paste')).toHaveCount(0)
      await expect(page.getByPlaceholder('Paste the LinkedIn profile here...')).toBeFocused()
      await expect(page.getByPlaceholder('Paste the LinkedIn profile here...')).toHaveAttribute('aria-invalid', 'true')
    }
    expect(analyzeCalls).toBe(0)
    await page.screenshot({ path: path.join(OUT, 'pro-014-015-validation.png'), fullPage: true })
  })

  test('UI — PRO-010/011/012/013 non-prospect state', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    await analyzeUi(page, GENERIC)
    await expect(page.getByText('Not a prospect', { exact: true })).toBeVisible()
    await expect(page.getByText(/Maybe — needs more signal/)).toHaveCount(0)
    await expect(page.getByRole('img', { name: /Opportunity score/ })).toHaveCount(0)
    await expect(page.getByText(/Not scored — there is no valid prospect to score/)).toBeVisible()
    await expect(page.getByText(/Create a lead to start outreach/)).toHaveCount(0)
    await expect(page.getByText(/Add identifying and opportunity details to continue/)).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Lead not eligible/ })).toBeDisabled()
    await expect(page.getByText(/Login or product UI/i)).toHaveCount(0)
    await page.screenshot({ path: path.join(OUT, 'pro-010-013-non-prospect.png'), fullPage: true })
  })

  test('UI — PRO-001 clean name in result header', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    await analyzeUi(page, `View John Gummadi's profile\n${JOHN_BODY}`)
    await expect(page.getByRole('heading', { name: 'John Gummadi', exact: true })).toBeVisible()
    // The paste itself stays in the textarea; nothing outside it may show the label.
    await expect(page.locator('main :not(textarea)', { hasText: /View John Gummadi/ }).filter({ hasNot: page.locator('textarea') })).toHaveCount(0)
    await page.screenshot({ path: path.join(OUT, 'pro-001-john.png'), fullPage: true })
  })

  test('UI — PRO-002/006/007/009/018/020 agency result, lead creation and persistence', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    await analyzeUi(page, EXTERNAL_AGENCY)
    await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible()
    await expect(page.getByText('Technical Recruiter · Northstar Technologies', { exact: true })).toBeVisible()
    await expect(page.getByText('Decision confidence')).toBeVisible()

    await page.getByRole('button', { name: /Show scoring details/ }).click()
    await expect(page.getByText(/^Why \d+\/100\?$/)).toBeVisible()
    await expect(page.getByText('No source quote for this row')).toHaveCount(0)
    await expect(page.getByText('“Approved project budget: $20,000”')).toBeVisible()
    await expect(page.getByText('“Expected start: Within 2 weeks.”')).toBeVisible()

    // PRO-009: high-value rows have a visibly coloured fill.
    const meter = page.getByRole('meter', { name: /^Capability Fit/ }).first()
    const fill = meter.locator('div').first()
    const bg = await fill.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    const pct = Number(await meter.getAttribute('aria-valuenow'))
    const [mw, fw] = await Promise.all([meter.evaluate((el) => el.getBoundingClientRect().width), fill.evaluate((el) => el.getBoundingClientRect().width)])
    expect(fw / mw * 100).toBeCloseTo(pct, -1)
    await page.screenshot({ path: path.join(OUT, 'pro-006-009-agency-breakdown.png'), fullPage: true })

    // QA's own Alex Morgan lead (saved before the fix) is a hard duplicate:
    // open it and confirm the original paste is now reachable (PRO-018).
    await page.getByRole('button', { name: /Create lead/ }).click()
    await page.getByRole('button', { name: 'View existing' }).click()
    await page.waitForURL(/\/leads\/[^/?]+/, { timeout: 60_000 })
    await expect(page.getByText('Technical Recruiter · Northstar Technologies', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await page.getByText('Context', { exact: true }).click()
    await page.getByText('View original pasted evidence').click()
    await expect(page.locator('pre', { hasText: 'Approved project budget: $20,000' })).toBeVisible()
    await page.screenshot({ path: path.join(OUT, 'pro-018-existing-qa-lead.png'), fullPage: true })
  })

  test('UI — PRO-002/018 fresh save keeps role, employer, budget and timing', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    const brief = EXTERNAL_AGENCY
      .replace('Alex Morgan', 'Riley Carter')
      .replaceAll('Northstar Technologies', 'Westbrook Analytics')
    await analyzeUi(page, brief)
    await expect(page.getByText('Technical Recruiter · Westbrook Analytics', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Create lead/ }).click()
    const existing = page.getByRole('button', { name: 'View existing' })
    await Promise.race([
      page.waitForURL(/\/leads\/[^/]+/, { timeout: 60_000 }),
      existing.waitFor({ timeout: 60_000 }).then(() => existing.click()),
    ])
    await page.waitForURL(/\/leads\/[^/?]+/, { timeout: 60_000 })
    fs.writeFileSync(path.join(OUT, 'created-lead-url.txt'), page.url())

    const checkLead = async () => {
      await expect(page.getByRole('heading', { name: 'Riley Carter' })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Technical Recruiter · Westbrook Analytics', { exact: true }).first()).toBeVisible()
      await page.getByText('Context', { exact: true }).click()
      await expect(page.getByText('Technical Recruiter', { exact: true })).toBeVisible()
      const signal = page.getByText('Signal evidence').locator('xpath=following-sibling::p[1]')
      await expect(signal).toContainText('Approved project budget: $20,000')
      await expect(signal).toContainText('Expected start: Within 2 weeks.')
      await page.getByText('View original pasted evidence').click()
      await expect(page.locator('pre', { hasText: 'Expected start: Within 2 weeks.' })).toBeVisible()
      await page.getByText('Score Breakdown').click()
      await expect(page.getByText(/^Why \d+\/100\?$/)).toBeVisible()
    }
    await checkLead()
    await page.screenshot({ path: path.join(OUT, 'pro-002-018-fresh-lead.png'), fullPage: true })
    await page.reload()
    await checkLead()
  })

  test('UI mobile — PRO-016/017 feedback clear of nav; no shortcut hint', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-iphone')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/prospect')
    await expect(page.getByText('Cmd / Ctrl + Enter')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Analyze$/ })).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'Primary' }).last()
    await expect(nav).toBeVisible()
    const feedback = page.locator('.gv-button')
    await feedback.waitFor({ state: 'visible', timeout: 20_000 })
    const [n, f] = [await nav.boundingBox(), await feedback.boundingBox()]
    expect(n && f).toBeTruthy()
    expect(f!.y + f!.height, 'feedback bottom edge above nav top edge').toBeLessThanOrEqual(n!.y)
    await page.screenshot({ path: path.join(OUT, 'pro-016-017-mobile.png') })
  })
})
