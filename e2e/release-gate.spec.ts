/**
 * Release-gate browser checks against the signed-in development database.
 * Synthetic names only. Does not rewrite stored production packets.
 */
import { test, expect, type Page } from '@playwright/test'
import { loginAsAdmin } from './helpers'

const RUN = Date.now().toString(36).slice(-5)

const SELLER = `Amina Yusuf ${RUN}
Founder at Northline Digital ${RUN} | Web and mobile agency
2nd · Connect
About
Northline Digital ${RUN} is a software agency. We design and build web and mobile products for clients.
Posts
Amina Yusuf ${RUN} posted this • 2d
Our team has capacity for two more product builds this quarter. If you need a development partner, send a note.
Experience
Founder
Northline Digital ${RUN}
Jan 2019 - Present · 6 yrs`

const BUYER = `Maya Lindqvist ${RUN}
Head of Product at Northwind Freight ${RUN} | Stockholm, Sweden
500+ connections · 1st · Message
About
We run a logistics SaaS for mid-size freight forwarders.
Posts
Maya Lindqvist ${RUN} posted this • 3d
We are looking for a development agency to rebuild our customer portal in React and Node. Budget around 60k EUR, need to start within 6 weeks. DM me or email maya@northwindfreight.example`

function scoreOnPage(body: string): number | null {
  const m = body.match(/(\d{1,2})\s*\/\s*10(?!\d)/)
  if (!m) return null
  const v = Number(m[1])
  return v > 10 ? v % 10 : v
}

async function visibleMain(page: Page): Promise<string> {
  return (await page.locator('main').innerText()) ?? ''
}

async function analyze(page: Page, text: string) {
  await page.goto('/prospect')
  await page.waitForLoadState('networkidle')
  await page.locator('textarea').first().fill(text)
  await page.locator('button:has-text("Analyze")').first().click()
  await expect(page.locator('[data-testid="decision-why"]').first()).toBeVisible({ timeout: 180_000 })
}

test.describe('release gate', () => {
  test.describe.configure({ timeout: 420_000 })
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('seller paste is not worth pursuing; buyer paste is', async ({ page }) => {
    test.setTimeout(360_000)
    await analyze(page, SELLER)
    const sellerBody = await visibleMain(page)
    const sellerScore = scoreOnPage(sellerBody)
    expect(sellerScore, 'seller display score').not.toBeNull()
    expect(sellerScore!).toBeLessThanOrEqual(5)
    expect(sellerBody).toMatch(/Maybe — needs more signal|Low priority|Probably skip/i)
    expect(sellerBody).not.toMatch(/Worth pursuing|Strong opportunity/i)
    expect(sellerBody).toMatch(/OBSERVE|SKIP|close/i)
    expect(sellerBody).not.toMatch(/contact now/i)

    await analyze(page, BUYER)
    const buyerBody = await visibleMain(page)
    const buyerScore = scoreOnPage(buyerBody)
    expect(buyerScore, 'buyer display score').not.toBeNull()
    expect(buyerScore!).toBeGreaterThanOrEqual(6)
    expect(buyerBody).toMatch(/Worth pursuing|Strong opportunity/i)
    expect(buyerBody).toMatch(/contact now|connect with note/i)
  })

  test('save, sender switch, and assign keep workspace until ownership changes', async ({ page }) => {
    test.setTimeout(360_000)
    await analyze(page, BUYER)
    const before = scoreOnPage(await visibleMain(page))
    const canonical = (await visibleMain(page)).match(/\d{1,3}\/100/)?.[0] ?? null

    const senderButtons = page.locator('[data-testid="sender-section"] button')
    const senderCount = await senderButtons.count()
    if (senderCount > 1) {
      await senderButtons.nth(1).click()
    }

    const create = page.locator('button:has-text("Create lead")').first()
    await expect(create).toBeEnabled({ timeout: 30_000 })
    await create.click()
    await page.waitForURL(/\/leads\/[^/]+/, { timeout: 90_000 })
    const leadUrl = page.url()
    const leadId = leadUrl.split('/leads/')[1]?.split(/[/?#]/)[0]
    expect(leadId).toBeTruthy()

    await expect(page.getByText(/\/10/).first()).toBeVisible({ timeout: 60_000 })
    await page.reload()
    await page.waitForLoadState('networkidle')
    const afterText = await visibleMain(page)
    expect(scoreOnPage(afterText)).toBe(before)
    if (canonical) expect(afterText.includes(canonical) || (await page.locator('body').textContent())?.includes(canonical)).toBeTruthy()

    const saved = await page.request.get(`/api/leads/${leadId}`)
    expect(saved.ok()).toBeTruthy()
    const savedJson = await saved.json()
    const ownerBefore = savedJson.lead?.ownerRepId as string | null
    const workspaceBefore = savedJson.lead?.revenueIdentityId as string | null
    const senderBefore = savedJson.lead?.senderProfileId as string | null
    expect(ownerBefore).toBeTruthy()
    expect(workspaceBefore).toBeTruthy()

    await page.goto('/leads')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(`Northwind Freight ${RUN}`).first()).toBeVisible({ timeout: 30_000 })

    const rec = await page.request.get(`/api/leads/${leadId}/refer`)
    const recJson = rec.ok() ? await rec.json() : { recommendations: [] }
    const recommendations = (recJson.recommendations ?? []) as Array<{ profileId?: string; repId?: string }>
    const other = recommendations.find((r) => r.profileId && r.profileId !== senderBefore && r.repId && r.repId !== ownerBefore)
    const sameOwner = recommendations.find((r) => r.profileId && r.profileId !== senderBefore && (!r.repId || r.repId === ownerBefore))
    const target = sameOwner ?? other
    if (target?.profileId) {
      const refer = await page.request.post(`/api/leads/${leadId}/refer`, { data: { toProfileId: target.profileId } })
      expect(refer.ok()).toBeTruthy()
      const referJson = await refer.json()
      const again = await page.request.get(`/api/leads/${leadId}`)
      const againJson = await again.json()
      expect(againJson.lead?.revenueIdentityId).toBe(workspaceBefore)
      if (referJson.switchedSender) {
        expect(againJson.lead?.ownerRepId).toBe(ownerBefore)
        expect(againJson.lead?.senderProfileId).toBe(target.profileId)
      } else {
        expect(againJson.lead?.ownerRepId).not.toBe(ownerBefore)
      }
      await page.goto('/leads')
      await page.waitForLoadState('networkidle')
      if (referJson.switchedSender) {
        await expect(page.getByText(`Northwind Freight ${RUN}`).first()).toBeVisible({ timeout: 30_000 })
      }
    }

    await page.goto(leadUrl)
    await page.waitForLoadState('networkidle')
    const note = page.locator('button:has-text("Generate connection note")').first()
    if (await note.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await note.click()
      const editor = page.locator('textarea[placeholder="Edit before sending..."]').first()
      await expect(editor).toBeVisible({ timeout: 120_000 })
      const text = await editor.inputValue()
      expect(text.length).toBeGreaterThan(0)
      expect(text.length).toBeLessThanOrEqual(120)
    }
    const logSent = page.locator('button').filter({ hasText: /log sent|mark (as )?sent|sent it/i }).first()
    if (await logSent.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await logSent.click()
      await page.waitForTimeout(1_500)
    }
    const accepted = page.locator('button:has-text("Mark accepted")').first()
    if (await accepted.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await accepted.click()
      const dm = page.locator('button:has-text("Send first message")').first()
      await expect(dm).toBeVisible({ timeout: 20_000 })
      await dm.click()
      await expect(page.locator('textarea').first()).toBeVisible({ timeout: 120_000 })
    }

    await page.goto('/admin/ai-usage')
    await expect(page.getByText('By feature').first()).toBeVisible({ timeout: 30_000 })
    const usage = (await page.textContent('body')) ?? ''
    expect(usage.length).toBeGreaterThan(80)
  })

  test('upwork extract scores and can generate a proposal', async ({ page }) => {
    test.setTimeout(420_000)
    const job = `Rebuild tenant portal ${RUN} in React and Node
Posted 3 hours ago
Worldwide

We run a B2B SaaS for property managers and need a senior engineer to rebuild our tenant portal.
Current stack is React, Node and PostgreSQL on AWS.
Timeline: first milestone within 3 weeks.

$25
-
$60
Hourly
Expert

Skills and Expertise
React
Node.js
PostgreSQL

Screening questions
1. Describe your recent experience with similar projects
2. What is your hourly rate and availability?`

    await page.goto('/upwork/new')
    await page.waitForLoadState('networkidle')
    await page.locator('textarea').first().fill(job)
    await page.locator('button:has-text("Extract")').first().click()
    await expect.poll(async () => {
      const inputs = await page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
      return inputs.includes('25') && inputs.includes('60')
    }, { timeout: 150_000 }).toBe(true)
    const body = (await page.textContent('body')) ?? ''
    expect(body).toMatch(/Canonical \d{1,3}\/100/)

    const save = page.locator('button').filter({ hasText: /^save/i }).first()
    await save.click()
    await page.waitForURL((u) => /\/upwork\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/new'), { timeout: 90_000 })
    await expect(page.locator('[data-testid="upwork-why"]')).toBeVisible({ timeout: 30_000 })
    const score = await page.getByText(/\(\d{1,3}\/100\)/).first().textContent()
    await page.reload()
    if (score) await expect(page.getByText(score, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

    const generate = page.locator('button:has-text("Generate proposal")').first()
    await expect(generate).toBeVisible({ timeout: 30_000 })
    await generate.click()
    await expect(page.getByText(/Screening Answers|Proposal Quality/i).first()).toBeVisible({ timeout: 180_000 })
  })
})
