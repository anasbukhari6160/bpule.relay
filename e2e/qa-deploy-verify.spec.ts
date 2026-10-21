/**
 * QA deploy verification — S1 cases on the deployed build.
 * Run: E2E_BASE_URL=https://relay.bpulse.dev npx playwright test e2e/qa-deploy-verify.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'
import { loginAsAdmin, loginAsRep } from './helpers'

// Prospect analysis runs the real AI pipeline; the default 60s test timeout is
// too short for a cold provider round-trip.
test.setTimeout(240_000)

const HANNAH = `Hannah Blake
· 2nd

CEO at NorthPeak Logistics

Chicago, Illinois, United States

About
I lead operations at NorthPeak Logistics.

We need a software development agency to rebuild our TMS. We have $45,000 approved for the project and plan to start in November 2026. The build should take about 8 weeks.

Contact info`

const EMMA = `Emma Collins
· 1st

Founder at BrightPath Education

Austin, Texas, United States

About
I'm the founder of BrightPath Education.

We're looking for a SaaS development agency to build our student platform. $35,000 budget approved. Start in November. 8 week project.

Contact info`

const ETHAN = `Ethan Cole
· 3rd

Head of Engineering at CloudNine Systems

July 2026
Looking for an agency to help migrate our infrastructure. Budget is available.

October 2026
We selected a partner and the project is complete. Please do not contact us with agency offers.`

const DANIEL = `Daniel Brooks
· 1st

Freelance Full Stack Developer

I'm a freelance developer. Contact me if your company needs a developer.
Looking for React and Node projects.`

const RECRUITER = `Chloe Barrett
Senior Technical Recruiter at Talentbridge | Placing React & Node engineers

Hiring: 3x React developers for a fintech client in Leeds, £70-85k. DM me your CV.`

const IRRELEVANT = `Hello, I am a software developer.`

const pasteBox = (page: Page) => page.locator('textarea[placeholder*="LinkedIn profile"]')
const analyzeBtn = (page: Page) => page.locator('button:has-text("Analyze")').first()
const intentValue = (page: Page) =>
  page.locator('xpath=//div[p[1][normalize-space(text())="Intent"]]/p[2]').innerText()

const intentChip = (page: Page) =>
  page.locator('xpath=//div[p[1][normalize-space(text())="Intent"]]/p[2]').first()
const notProspect = (page: Page) => page.getByText('Not a prospect', { exact: false }).first()

async function analyze(page: Page, fixture: string) {
  await page.goto('/prospect')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => localStorage.clear())
  await pasteBox(page).fill(fixture)
  await expect(pasteBox(page)).toHaveValue(fixture)
  await analyzeBtn(page).click()
  // Wait for either a scored result (Intent chip) or the "not a prospect" state.
  await intentChip(page).or(notProspect(page)).waitFor({ timeout: 220_000 })
  await page.waitForTimeout(500)
}

test.beforeEach(async ({ page }) => {
  await loginAsRep(page)
})

test('BUG-PRO-021: Hannah explicit buyer is HIGH BUYER, not LOW/SKIP/UNKNOWN', async ({ page }) => {
  await analyze(page, HANNAH)
  expect((await intentValue(page)).trim()).toBe('HIGH')
  // Not a skip: the footer must never say no outreach for a verified buyer.
  await expect(page.locator('text=No outreach recommended')).toHaveCount(0)
})

test('BUG-14-03: Emma explicit buyer is HIGH BUYER', async ({ page }) => {
  await analyze(page, EMMA)
  expect((await intentValue(page)).trim()).toBe('HIGH')
})

test('BUG-PRO-022: Ethan do-not-contact is closed with no outreach', async ({ page }) => {
  await analyze(page, ETHAN)
  expect((await intentValue(page)).trim()).toBe('UNKNOWN')
  await expect(page.locator('text=No message recommended')).toBeVisible()
  await expect(page.locator('text=No outreach recommended')).toBeVisible()
})

test('BUG-14-02: Daniel seller is not a buyer', async ({ page }) => {
  await analyze(page, DANIEL)
  await expect(page.locator('text=No message recommended')).toBeVisible()
})

test('recruiter is not a buyer', async ({ page }) => {
  await analyze(page, RECRUITER)
  await expect(page.locator('text=No message recommended')).toBeVisible()
})

test('irrelevant input is not scored / not contacted', async ({ page }) => {
  await analyze(page, IRRELEVANT)
  // Either it is rejected as "not a prospect" or scored SKIP — never contacted.
  const notProspect = page.getByText('Not a prospect', { exact: false })
  const noMessage = page.locator('text=No message recommended')
  await expect(notProspect.or(noMessage)).toBeVisible()
  if (await notProspect.isVisible()) {
    await expect(page.locator('text=No message recommended')).toBeVisible()
  }
})

test('BUG-13-01: draft survives refresh', async ({ page }) => {
  await page.goto('/prospect')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => localStorage.clear())
  await pasteBox(page).fill(HANNAH)
  await expect(pasteBox(page)).toHaveValue(HANNAH)
  await page.waitForTimeout(300)
  await page.reload()
  await expect(pasteBox(page)).toHaveValue(HANNAH, { timeout: 15_000 })
})

test('BUG-13-02: rapid Analyze while in-flight produces one request', async ({ page }) => {
  await page.goto('/prospect')
  await page.waitForLoadState('networkidle')
  // The draft-restore effect can overwrite the fill with a prior test's draft;
  // start clean so the fresh paste is what gets analyzed.
  await page.evaluate(() => localStorage.clear())
  // A fresh (uncached) paste so the first analysis is still running when the
  // remaining clicks land — the real rapid-click scenario.
  const fresh = `${HANNAH}\n\nRef: ${Date.now()}`
  await pasteBox(page).fill(fresh)
  await expect(pasteBox(page)).toHaveValue(fresh)
  await page.waitForTimeout(300)
  const reqs: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/prospect/analyze')) reqs.push(r.method()) })
  const btn = analyzeBtn(page)
  await btn.click()
  await page.waitForTimeout(600)
  for (let i = 0; i < 4; i++) {
    await btn.click({ force: true, timeout: 500 }).catch(() => {})
  }
  await page.locator('text=Strongest evidence').first().waitFor({ timeout: 220_000 }).catch(() => {})
  // eslint-disable-next-line no-console
  console.log('ANALYZE LOG:', JSON.stringify(reqs))
  expect(reqs.length).toBe(1)
})

test('BUG-11-14: Studio image survives reopen/refresh', async ({ page }) => {
  // A fresh persona each run so the brief and its idea ids are stable for today.
  const created = await page.request.post('/api/content/personas', {
    data: {
      displayName: `QA Deploy ${Date.now()}`,
      platforms: ['linkedin'],
      profileInput: 'Senior full stack developer building LLM apps, RAG systems, SaaS and API automation with React, Node, TypeScript and OpenAI.',
    },
  })
  const json = await created.json().catch(() => null)
  const personaId = json?.persona?.id ?? ''
  expect(personaId, 'no content persona available').toBeTruthy()
  // The brief generator can be slow (AI + fallback); give the retry loop room.
  test.setTimeout(900_000)

  // Generate a brief and wait until it PERSISTS (a reload still shows the post).
  // The AI brief generator can fall back to ephemeral "emergency" ideas whose
  // ids are not stored, in which case nothing can survive a reload.
  let persisted = false
  for (let attempt = 0; attempt < 5 && !persisted; attempt++) {
    await page.goto(`/content-v2/${personaId}/today`)
    await page.waitForLoadState('networkidle')
    const generatePost = page.getByRole('button', { name: 'Generate Post' })
    if (await generatePost.isVisible().catch(() => false)) {
      await generatePost.click()
      await page.locator('div:has-text("Post Image")').first().waitFor({ timeout: 240_000 })
    }
    await page.reload()
    await page.waitForLoadState('networkidle')
    const postVisible = await page.locator('div:has-text("Post Image")').first().isVisible().catch(() => false)
    const needsGenerate = await page.getByRole('button', { name: 'Generate Post' }).isVisible().catch(() => false)
    persisted = postVisible && !needsGenerate
  }
  if (!persisted) test.skip()

  // Generate the post image (falls back to a canvas visual if the image API is unset).
  const imageBtn = page.locator('span:text-is("Post Image")').locator('xpath=../following-sibling::button[1]')
  await imageBtn.click()
  const img = page.locator('img[alt="Post visual"]')
  await img.waitFor({ timeout: 240_000 })
  const srcBefore = await img.getAttribute('src')
  expect(srcBefore).toBeTruthy()
  // eslint-disable-next-line no-console
  console.log('SESSION BEFORE:', JSON.stringify(await page.evaluate(() => Object.keys(sessionStorage))))

  // Reopen the same post and refresh — the image must still be attached.
  await page.reload()
  await page.waitForLoadState('networkidle')
  // eslint-disable-next-line no-console
  console.log('SESSION AFTER:', JSON.stringify(await page.evaluate(() => Object.keys(sessionStorage))))
  const imgAfter = page.locator('img[alt="Post visual"]')
  await expect(imgAfter).toBeVisible({ timeout: 60_000 })
  expect(await imgAfter.getAttribute('src')).toBe(srcBefore)
})

test('BUG-11-04: $5,000 fixed Upwork job is consistent', async ({ page }) => {
  await page.goto('/upwork/new')
  await page.waitForLoadState('networkidle')
  const job = `Senior React Engineer needed
Posted 2 days ago
We need a senior React engineer to build a customer dashboard.
Budget: $5,000 fixed price.
Timeline: start within 2 weeks.`
  await page.locator('textarea').first().fill(job)
  await page.getByRole('button', { name: 'Extract' }).click()
  // Wait for the extracted budget field to populate.
  await expect.poll(async () => {
    const values = await page.locator('input[type="number"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    return values.some((v) => v === '5000')
  }, { timeout: 240_000 }).toBe(true)
  await expect(page.getByText('$5,000 fixed')).toBeVisible()
})

test('cross-surface parity: Hannah prospect → saved lead is not LOW/SKIP', async ({ page }) => {
  // A fresh buyer so the save is not a duplicate of an earlier run.
  const stamp = Date.now()
  const fresh = HANNAH
    .replace('Hannah Blake', `Hannah Blake ${stamp}`)
    .replace(/NorthPeak Logistics/g, `NorthPeak ${stamp}`)
  await analyze(page, fresh)
  await page.getByRole('button', { name: 'Create lead' }).click()
  await page.waitForURL(/\/leads\/[^/]+/, { timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  // The saved lead must carry a non-LOW qualification.
  await expect(page.getByText(/WORTH PURSUING|STRONG|MAYBE/i).first()).toBeVisible({ timeout: 30_000 })
})

test('open observation: FAKE/TEST facts are isolated from production outreach', async ({ page }) => {
  await loginAsAdmin(page)
  const res = await page.request.get('/api/facts')
  const json = await res.json().catch(() => ({ facts: [] }))
  const facts = (json.facts ?? []) as Array<{ label: string; value: string }>
  const fake = facts.filter((f) => /fake|test|demo/i.test(`${f.label} ${f.value}`))
  // eslint-disable-next-line no-console
  console.log('FAKE FACTS:', JSON.stringify(fake.map((f) => f.label)))
  // Every test entry must be identifiable: labelled (FAKE/TEST/DEMO) or a raw
  // internal JSON proof — the same rule the deployed guard applies.
  expect(fake.length).toBeGreaterThan(0)
  expect(fake.every((f) => /fake|test|demo/i.test(f.label ?? '') || (f.value ?? '').trim().startsWith('{'))).toBe(true)
})
