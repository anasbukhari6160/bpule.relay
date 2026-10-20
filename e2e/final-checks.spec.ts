/**
 * Final conditional-go checks against the signed-in development database.
 * Synthetic prospect only. Sender switch stays with the creating rep.
 * Explicit refer moves ownership. Message drafts must land in ai_traces.
 */
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { loginAsAdmin } from './helpers'

const RUN = Date.now().toString(36).slice(-5)
const NOT_HELD_PROFILE = 'f67c1ba3-69bd-43a4-8410-7b35e0b79d44'
const OTHER_REP = 'ec4f844d-24ca-4fb5-ae4f-4138244abace'

const BUYER = `Maya Lindqvist ${RUN}
Head of Product at Northwind Freight ${RUN} | Stockholm, Sweden
1st · Message
About
We run a logistics SaaS for mid-size freight forwarders.
Posts
Maya Lindqvist ${RUN} posted this • 3d
We are looking for a development agency to rebuild our customer portal in React and Node. Budget around 60k EUR, need to start within 6 weeks. Email maya@northwindfreight.example`

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service env is missing')
  return createClient(url, key)
}

async function analyzeAndSave(page: Page, text: string) {
  await page.goto('/prospect')
  await page.waitForLoadState('networkidle')
  await page.locator('textarea').first().fill(text)
  await page.locator('button:has-text("Analyze")').first().click()
  await expect(page.locator('[data-testid="decision-why"]').first()).toBeVisible({ timeout: 180_000 })
  const create = page.locator('button:has-text("Create lead")').first()
  await expect(create).toBeEnabled({ timeout: 30_000 })
  await create.click()
  await page.waitForURL(/\/leads\/[^/]+/, { timeout: 90_000 })
  const leadId = page.url().split('/leads/')[1]?.split(/[/?#]/)[0]
  expect(leadId).toBeTruthy()
  return leadId!
}

async function generateAndLog(page: Page, buttonName: RegExp, fallback: string) {
  const seen: string[] = []
  const onResponse = async (response: { url: () => string; text: () => Promise<string> }) => {
    if (!response.url().includes('/draft')) return
    const body = await response.text().catch(() => '')
    const types = [...body.matchAll(/"type":"([^"]+)"/g)].map((match) => match[1])
    const messages = [...body.matchAll(/"message":"([^"]{0,180})"/g)].map((match) => match[1])
    seen.push(`${types.join(',') || 'empty'}${messages.length ? `:${messages.join(';')}` : ''}`)
  }
  page.on('response', onResponse)
  const button = page.locator('button').filter({ hasText: buttonName }).first()
  await expect(button).toBeVisible({ timeout: 30_000 })
  await button.click()
  const editor = page.locator('textarea[placeholder="Edit before sending..."]').first()
  try {
    await expect(editor).toBeVisible({ timeout: 90_000 })
  } catch (error) {
    throw new Error(`Draft did not open (${seen.join(' | ') || 'no draft response'})`)
  }
  page.off('response', onResponse)
  await expect.poll(async () => (await editor.inputValue()).trim().length, { timeout: 30_000 }).toBeGreaterThan(10)
  await editor.fill(fallback)
  const log = page.locator('button:has-text("Log as sent")').first()
  await expect(log).toBeEnabled({ timeout: 10_000 })
  await log.click()
  await expect(editor).toBeHidden({ timeout: 30_000 })
}

test.describe('final checks', () => {
  test.describe.configure({ timeout: 420_000 })
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('sender switch keeps the owner; explicit assign moves it; the workspace stamp stays', async ({ page }) => {
    await page.goto('/prospect')
    await page.waitForLoadState('networkidle')
    await page.locator('textarea').first().fill(BUYER.replace('Northwind Freight', 'Harbor Freight'))
    await page.locator('button:has-text("Analyze")').first().click()
    await expect(page.locator('[data-testid="sender-section"]').first()).toBeVisible({ timeout: 180_000 })

    const sendingAs = page.locator('[data-testid="sender-section"]').getByText('Sending as:')
    const beforeSender = (await sendingAs.textContent()) ?? ''
    const choices = page.locator('[data-testid="sender-section"] ul button')
    expect(await choices.count()).toBeGreaterThan(1)
    await choices.nth(1).click()
    await expect(sendingAs).not.toHaveText(beforeSender)

    const create = page.locator('button:has-text("Create lead")').first()
    await expect(create).toBeEnabled({ timeout: 30_000 })
    await create.click()
    await page.waitForURL(/\/leads\/[^/]+/, { timeout: 90_000 })
    const leadId = page.url().split('/leads/')[1]?.split(/[/?#]/)[0]!

    const saved = await page.request.get(`/api/leads/${leadId}`)
    expect(saved.ok()).toBeTruthy()
    const created = (await saved.json()).lead
    const ownerBefore = created.ownerRepId as string
    const workspaceBefore = created.revenueIdentityId as string
    const senderAfterSwitch = created.senderProfileId as string
    expect(ownerBefore).toBeTruthy()
    expect(workspaceBefore).toBeTruthy()
    expect(senderAfterSwitch).toBeTruthy()

    await page.goto('/leads')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(`Harbor Freight ${RUN}`).first()).toBeVisible({ timeout: 30_000 })

    let refer = await page.request.post(`/api/leads/${leadId}/refer`, { data: { toProfileId: NOT_HELD_PROFILE }, timeout: 60_000 }).catch(() => null)
    if (!refer) refer = await page.request.post(`/api/leads/${leadId}/refer`, { data: { toProfileId: NOT_HELD_PROFILE }, timeout: 60_000 })
    expect(refer.ok(), await refer.text()).toBeTruthy()
    const referJson = await refer.json()
    expect(referJson.switchedSender).toBe(false)
    expect(referJson.toRepId).toBe(OTHER_REP)

    const after = await page.request.get(`/api/leads/${leadId}`)
    const moved = (await after.json()).lead
    expect(moved.ownerRepId).toBe(OTHER_REP)
    expect(moved.ownerRepId).not.toBe(ownerBefore)
    expect(moved.revenueIdentityId).toBe(workspaceBefore)

    await page.goto('/leads')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(`Harbor Freight ${RUN}`).first()).toBeVisible({ timeout: 30_000 })
  })

  test('an accepted conversation writes DM, follow-up, and reply traces', async ({ page }) => {
    const leadId = 'b85485f1-f4a7-4bd4-8c05-6a46bec17090'
    const dmAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const connectionAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const db = service()
    const dmUpdate = await db.from('messages').update({ sent_at: dmAt }).eq('lead_id', leadId).eq('type', 'dm')
    const connectionUpdate = await db.from('messages').update({ sent_at: connectionAt }).eq('lead_id', leadId).eq('type', 'connection')
    expect(dmUpdate.error).toBeNull()
    expect(connectionUpdate.error).toBeNull()

    await page.goto(`/leads/${leadId}`)
    await page.waitForLoadState('networkidle')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await generateAndLog(
      page,
      /Send follow-up/,
      'Hi Maya, still happy to scope the portal milestone whenever the six-week start is real. No rush if the timing moved.',
    )

    const reply = await page.request.post(`/api/leads/${leadId}/reply`, {
      data: { text: 'Yes, we are still looking. Can you send a short note on timing?' },
    })
    expect(reply.ok(), await reply.text()).toBeTruthy()
    await page.reload()
    await page.waitForLoadState('networkidle')
    await generateAndLog(
      page,
      /Generate reply|Reply to/,
      'Hi Maya, the first milestone can start inside six weeks if the portal scope stays on the customer account flow. I can send a one-page timing note.',
    )

    const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const { data, error: traceError } = await service()
      .from('ai_traces')
      .select('feature,lead_id,error')
      .eq('lead_id', leadId)
      .gte('created_at', since)
    expect(traceError).toBeNull()
    const features = new Set((data ?? []).map((row) => row.feature))
    expect(features.has('dm')).toBe(true)
    expect(features.has('follow_up')).toBe(true)
    expect(features.has('reply')).toBe(true)
    expect((data ?? []).some((row) => row.error)).toBe(false)
  })
})
