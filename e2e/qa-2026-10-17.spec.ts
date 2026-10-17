/**
 * QA 17-10-2026 — browser regression on a real server with fictional data.
 * Create Lead → evidence/score → save → pipeline vs detail score →
 * connection without note → rejection closes the thread → empty states.
 * A daily send ceiling on the account is reported as NOT RUN, never PASS.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { loginAsAdmin } from './helpers'

const OUT = process.env.QA_EVIDENCE_DIR ?? path.join('test-results', 'qa-2026-10-17')
fs.mkdirSync(OUT, { recursive: true })
const STAMP = Date.now().toString(36).slice(-4).toUpperCase()
const COMPANY = `Fieldnote Apps ${STAMP}`
const RESEARCH = `Jordan Reyes
CTO at ${COMPANY}
Location: Austin, Texas, USA
We are looking for a software development agency to rebuild our mobile app in React Native.
"Our release cycle is killing us, we need outside help to ship faster."`
const results: Record<string, string> = {}
const record = (k: string, v: string) => {
  const file = path.join(OUT, 'results.json')
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string> : {}
  results[k] = v
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...results }, null, 2))
}
let leadUrl = process.env.QA_LEAD_URL ?? ''
let company = process.env.QA_LEAD_COMPANY ?? ''

async function ringScore(page: Page, scope = page.locator('body')): Promise<string> {
  const label = await scope.getByRole('img', { name: /score/i }).first().getAttribute('aria-label')
  return (label ?? '').replace(/^.*?score\s*/i, '')
}

test.describe('QA 17-10-2026 — browser', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(300_000)

  test.beforeEach(async ({ page }) => { await loginAsAdmin(page) })

  test('CL-001: empty research → one inline message, no request', async ({ page }) => {
    let calls = 0
    page.on('request', (r) => { if (r.url().includes('/api/leads/extract')) calls++ })
    await page.goto('/leads/new')
    await page.getByRole('button', { name: /^Extract$/ }).click()
    await expect(page.locator('#raw-input-error')).toHaveText(/Paste some raw research first/)
    await expect(page.getByText('Paste some raw research first.')).toHaveCount(1)
    await expect(page.getByText('Something failed')).toHaveCount(0)
    await expect(page.getByText('Check the paste')).toHaveCount(0)
    await page.locator('#raw-input').fill('   \n  ')
    await page.getByRole('button', { name: /^Extract$/ }).click()
    await expect(page.getByText('Paste some raw research first.')).toHaveCount(1)
    expect(calls).toBe(0)
    await page.screenshot({ path: path.join(OUT, 'cl-001.png'), fullPage: true })
    record('CL-001', 'PASS')
  })

  test('CL-002/004/005/006/003 + save: extraction, evidence checks, summary', async ({ page }) => {
    await page.goto('/leads/new')
    await page.locator('#raw-input').fill(RESEARCH)
    await page.getByRole('button', { name: /^Extract$/ }).click()
    await expect(page.locator('#company')).toHaveValue(new RegExp(COMPANY), { timeout: 120_000 })
    await expect(page.locator('#location')).toHaveValue('Austin, Texas, USA')
    record('CL-002', 'PASS'); record('CL-004', 'PASS')

    // Fabricated quote → flagged, 0 credit.
    await page.locator('#quote').fill('This sentence does not exist anywhere in the original research.')
    await expect(page.getByTestId('quote-unverified')).toBeVisible()
    // Unsupported signal → flagged, 0 credit.
    await page.locator('#signal').selectOption({ label: 'Raised money (funding)' })
    await expect(page.getByTestId('signal-unverified')).toBeVisible()
    await expect(page.getByText(/issues? needs? attention/)).toBeVisible()
    await expect(page.getByText('Nothing flagged. Every field checked out.')).toHaveCount(0)
    await page.screenshot({ path: path.join(OUT, 'cl-003-005-006-unsupported.png'), fullPage: true })

    // Supported choices verify.
    await page.locator('#quote').fill('we need outside help to ship faster')
    await expect(page.getByTestId('quote-unverified')).toHaveCount(0)
    await page.locator('#signal').selectOption({ label: 'Asking for help (asking)' })
    await expect(page.getByTestId('signal-verified')).toBeVisible()
    record('CL-005', 'PASS'); record('CL-006', 'PASS'); record('CL-003', 'PASS')

    await page.getByRole('button', { name: 'Save lead' }).click()
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 60_000 })
    leadUrl = page.url().split('?')[0]
    company = COMPANY
    fs.writeFileSync(path.join(OUT, 'lead-url.txt'), `${leadUrl}\n${COMPANY}`)
  })

  test('CL-002: legal-entity company in a job ad is extracted', async ({ page }) => {
    const org = `NORTHWIND SOFTLABS ${STAMP} (PVT) LTD`
    await page.goto('/leads/new')
    await page.locator('#raw-input').fill(`We're Hiring!
${org} is looking for a Senior Laravel Developer.
Location: Lahore, Pakistan
Requirements:
- 3+ years of PHP and Laravel
Send your CV to careers@example.com`)
    await page.getByRole('button', { name: /^Extract$/ }).click()
    await expect(page.locator('#company')).toHaveValue(org, { timeout: 120_000 })
    await expect(page.locator('#location')).toHaveValue('Lahore, Pakistan')
    await page.screenshot({ path: path.join(OUT, 'cl-002-job-ad.png'), fullPage: true })
    record('CL-002 (job ad)', 'PASS')
  })

  test('LEAD-005: pipeline score equals lead detail score', async ({ page }) => {
    test.skip(!leadUrl, 'no lead saved')
    await page.goto(leadUrl)
    const detail = await ringScore(page)
    await page.goto('/leads')
    await page.getByPlaceholder('Search by name, company, or title…').fill(company)
    await expect(page.getByText(new RegExp(company)).first()).toBeVisible()
    // The search leaves one card; its ring is the only score ring on the board.
    await expect(page.getByRole('img', { name: /score/i })).toHaveCount(1)
    const pipeline = await ringScore(page)
    expect(pipeline).toBe(detail)

    // And a canonical (AI-scored) lead, if the account has one on the board.
    await page.getByPlaceholder('Search by name, company, or title…').fill('')
    // Prefer a band where the old /10 rounding and the qualification policy disagree.
    const discriminating = page.getByRole('img', { name: /^Opportunity score [579]\/10$/ }).first()
    const canonicalRing = (await discriminating.count()) ? discriminating : page.getByRole('img', { name: /^Opportunity score \d+\/10$/ }).first()
    if (await canonicalRing.count()) {
      const listValue = (await canonicalRing.getAttribute('aria-label'))!.replace(/^.*score\s*/i, '')
      const href = await canonicalRing
        .locator('xpath=ancestor::*[.//a[starts-with(@href,"/leads/")]][1]//a[starts-with(@href,"/leads/")]')
        .first()
        .getAttribute('href')
      expect(href).toBeTruthy()
      await page.goto(href!.split('?')[0])
      expect(await ringScore(page)).toBe(listValue)
      record('LEAD-005', `PASS (legacy ${detail}, canonical ${listValue})`)
    } else {
      record('LEAD-005', `PASS (legacy ${detail}; no canonical lead on board)`)
    }
  })

  test('BUG-01: send without note → waiting for acceptance, persists', async ({ page }) => {
    test.skip(!leadUrl, 'no lead saved')
    await page.goto(leadUrl)
    await page.getByRole('button', { name: 'Send without note' }).click()
    const alert = page.getByRole('alert').filter({ hasText: /ceiling|limit/i })
    const waiting = page.getByText(/Waiting for (connection|acceptance)/i).first()
    await Promise.race([waiting.waitFor({ timeout: 30_000 }), alert.waitFor({ timeout: 30_000 })])
    if (await alert.count()) { record('BUG-01', `NOT RUN (account limit: ${await alert.innerText()})`); return }
    await expect(page.getByRole('button', { name: 'Send without note' })).toHaveCount(0)
    await expect(page.getByText('Connection request sent (no note).')).toBeVisible()
    await page.reload()
    await expect(page.getByText(/Waiting for (connection|acceptance)/i).first()).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: path.join(OUT, 'bug-01.png'), fullPage: true })
    record('BUG-01', 'PASS')
  })

  test('LEAD-003: rejection then "ok bye" → client declined, no reply/follow-up', async ({ page }) => {
    test.skip(!leadUrl, 'no lead saved')
    await page.goto(`${leadUrl}?tab=conversation`)
    for (const text of ["I'M NOT INTERESTED PLEASE TRY AGAIN", 'ok bye']) {
      await page.getByRole('tab', { name: /replied/ }).click()
      await page.getByRole('textbox', { name: /message$/ }).first().fill(text)
      await page.getByRole('button', { name: 'Add to conversation' }).click()
      await expect(page.getByRole('textbox', { name: 'Your message' })).toBeVisible({ timeout: 90_000 })
    }
    await expect(page.getByText('Client declined')).toBeVisible()
    await expect(page.getByRole('button', { name: /Reply · suggested/ })).toHaveCount(0)
    await expect(page.getByText(/Buying signals/)).toHaveCount(0)
    await page.screenshot({ path: path.join(OUT, 'lead-003-conversation.png'), fullPage: true })
    await page.goto(leadUrl)
    await expect(page.getByText('Client declined').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Reply to|Send follow-up|Follow up/ })).toHaveCount(0)
    record('LEAD-003', 'PASS')
  })

  test('LEAD-004: search vs empty stage copy', async ({ page }) => {
    await page.goto('/leads')
    await page.getByPlaceholder('Search by name, company, or title…').fill('zzqq-no-such-lead')
    await expect(page.getByText('No leads match "zzqq-no-such-lead".')).toBeVisible()
    await page.getByPlaceholder('Search by name, company, or title…').fill('')
    let emptyStage = 'none empty on this account'
    for (const label of ['To Contact', 'Needs Reply', 'Follow-Up', 'Waiting', 'Done']) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click()
      const status = page.getByRole('status').filter({ hasText: /^No / })
      if (await status.count()) {
        await expect(status.first()).not.toContainText(/match/i)
        emptyStage = label
        break
      }
    }
    await page.screenshot({ path: path.join(OUT, 'lead-004.png'), fullPage: true })
    record('LEAD-004', `PASS (search copy; empty stage checked: ${emptyStage})`)
  })
})
