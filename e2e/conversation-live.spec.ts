/**
 * Live conversation flow on a fictional test lead (real AI, real store):
 * connection note → accepted → first DM → client reply → AI reply that
 * answers it → refine → log → client asks to talk → AI proposes a call →
 * Chats inbox. Creates a fictional lead per run unless
 * CONVERSATION_TEST_LEAD_ID names a fresh test lead you own.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { loginAsAdmin } from './helpers'

const STAMP = Date.now().toString(36).slice(-4).toUpperCase()
const COMPANY = `Westbrook Analytics ${STAMP}`
const CONTACT = 'Jordan Blake'
const BRIEF = `${CONTACT}
CTO at ${COMPANY}
Company: ${COMPANY}
Role: CTO
LinkedIn Post:
We are looking for an external software development agency to build a customer portal in React.
We want an outsourced team, not full-time employees.
Approved project budget: $30,000
Expected start: Within 3 weeks.
Interested agencies should contact us with their portfolio.`
let leadId = process.env.CONVERSATION_TEST_LEAD_ID ?? ''

/** A fresh fictional lead through Prospect → Create lead, unless one is given. */
async function ensureLead(page: Page): Promise<string> {
  if (leadId) return leadId
  await page.goto('/prospect')
  await page.getByPlaceholder('Paste the LinkedIn profile here...').fill(BRIEF)
  await page.getByRole('button', { name: /^Analyze$/ }).click()
  await expect(page.getByRole('button', { name: /Create lead/ })).toBeEnabled({ timeout: 180_000 })
  await page.getByRole('button', { name: /Create lead/ }).click()
  await page.waitForURL(/\/leads\/[^/?]+/, { timeout: 60_000 })
  leadId = new URL(page.url()).pathname.split('/')[2]
  fs.writeFileSync(path.join(OUT, 'conversation-lead-url.txt'), page.url())
  return leadId
}
const OUT = process.env.QA_EVIDENCE_DIR ?? path.join('test-results', 'conversation')
fs.mkdirSync(OUT, { recursive: true })

const composer = (page: Page) => page.getByRole('textbox', { name: 'Your message' })

async function writeWithAi(page: Page) {
  const before = await composer(page).inputValue()
  await page.getByRole('button', { name: /Write with AI|Rewrite with AI/ }).click()
  await expect.poll(async () => (await composer(page).inputValue()).trim() !== before.trim() && (await composer(page).inputValue()).trim().length > 0, { timeout: 90_000 }).toBe(true)
  return (await composer(page).inputValue()).trim()
}

async function logAsSent(page: Page) {
  const text = (await composer(page).inputValue()).trim()
  await page.getByRole('button', { name: 'Log as sent', exact: true }).click()
  await expect(composer(page)).toHaveValue('', { timeout: 60_000 })
  return text
}

async function clientSays(page: Page, text: string) {
  await page.getByRole('tab', { name: /replied/ }).click()
  await page.getByRole('textbox', { name: /message$/ }).first().fill(text)
  await page.getByRole('button', { name: 'Add to conversation' }).click()
  // Saving also analyzes the message with AI; the composer returns when done.
  await expect(page.getByRole('textbox', { name: 'Your message' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText(text, { exact: true })).toBeVisible()
}

test.describe('Conversation — live', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(600_000)

  test('full deal conversation with the AI composer', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome')
    await loginAsAdmin(page)
    const LEAD_ID = await ensureLead(page)
    await page.goto(`/leads/${LEAD_ID}?tab=conversation`)
    await expect(page.getByRole('tab', { name: 'Conversation', selected: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible({ timeout: 60_000 })
    const transcript: string[] = []

    // 1. Connection note: suggested, written by AI, under 300 characters.
    await expect(page.getByRole('button', { name: /Connection note · suggested/ })).toBeVisible()
    const note = await writeWithAi(page)
    expect(note.length).toBeLessThanOrEqual(300)
    expect(note).not.toMatch(/[—–!]/)
    transcript.push(`ME (connection): ${await logAsSent(page)}`)

    // 2. Accepted → first DM is suggested, no call ask.
    const accepted = await page.request.post(`/api/leads/${LEAD_ID}/connection-accepted`)
    expect(accepted.ok()).toBe(true)
    await page.reload()
    await expect(page.getByRole('button', { name: /First message · suggested/ })).toBeVisible({ timeout: 60_000 })
    const dm = await writeWithAi(page)
    expect(dm).not.toMatch(/\b(call|zoom|meeting|calendar)\b/i)
    transcript.push(`ME (dm): ${await logAsSent(page)}`)

    // 3. Client replies with questions → reply is suggested and answers them.
    const q = 'Mainly customer-facing. How long would a portal like this take, and have you worked with Stripe billing before?'
    await clientSays(page, q)
    transcript.push(`CLIENT: ${q}`)
    await expect(page.getByRole('button', { name: /Reply · suggested/ })).toBeVisible()
    await expect(page.getByText('Waiting for your answer')).toBeVisible({ timeout: 60_000 })
    const reply = await writeWithAi(page)
    expect(reply).toMatch(/week|month|stripe/i)
    await expect(page.getByText(/^Answers:/).first()).toBeVisible()
    await page.screenshot({ path: path.join(OUT, 'conversation-reply-draft.png'), fullPage: true })

    // Refine: shorter.
    await page.getByRole('button', { name: 'Shorter' }).click()
    await expect.poll(async () => (await composer(page).inputValue()).trim() !== reply, { timeout: 90_000 }).toBe(true)
    const shorter = (await composer(page).inputValue()).trim()
    expect(shorter.split(/\s+/).length).toBeLessThanOrEqual(reply.split(/\s+/).length + 3)

    // Draft survives a reload.
    await page.waitForTimeout(1500)
    await page.reload()
    await expect(composer(page)).toHaveValue(shorter, { timeout: 60_000 })
    transcript.push(`ME (reply): ${await logAsSent(page)}`)
    await expect(page.getByText('Waiting for client').first()).toBeVisible()

    // 4. Second client reply asks to talk → our move again; AI may propose a call.
    const q2 = 'That works. Budget is approved on our side. Could we talk this week about timeline and scope?'
    await clientSays(page, q2)
    transcript.push(`CLIENT: ${q2}`)
    await expect(page.getByRole('button', { name: /Reply · suggested/ })).toBeVisible()
    const callReply = await writeWithAi(page)
    expect(callReply).toMatch(/call|talk|chat|meet|monday|tuesday|wednesday|thursday|friday|\d{1,2}(:\d{2})?\s?(am|pm)/i)
    await page.screenshot({ path: path.join(OUT, 'conversation-call-proposal.png'), fullPage: true })
    // Not logged: keeps the rep's daily reply quota for real work.
    transcript.push(`ME (draft, not logged): ${callReply}`)

    // Deal panel learned from the client.
    await expect(page.getByRole('complementary', { name: 'Deal context' })).toContainText(/Budget/)
    await page.screenshot({ path: path.join(OUT, 'conversation-final.png'), fullPage: true })
    fs.writeFileSync(path.join(OUT, 'conversation-transcript.txt'), transcript.join('\n\n'))

    // 5. Chats inbox lists the lead.
    await page.goto('/chats')
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(COMPANY) })).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: path.join(OUT, 'chats-inbox.png'), fullPage: true })
  })

  test('mobile layout of the conversation', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-iphone' || !process.env.CONVERSATION_TEST_LEAD_ID, 'needs CONVERSATION_TEST_LEAD_ID')
    await loginAsAdmin(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/leads/${process.env.CONVERSATION_TEST_LEAD_ID}?tab=conversation`)
    await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible({ timeout: 60_000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: path.join(OUT, 'conversation-mobile.png'), fullPage: true })
  })
})
