import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

test.describe('Strategy boundary + Admin checks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('Admin Revenue Intelligence loads without crashing', async ({ page }) => {
    await page.goto('/admin/revenue-intelligence')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText(/Pipeline and revenue|Revenue Intelligence/i).first()).toBeVisible({ timeout: 30_000 })
    const body = (await page.textContent('body')) ?? ''
    // Should not show NaN or Infinity
    expect(body).not.toMatch(/NaN|Infinity/)
  })

  test('Garbage input fails immediately without AI', async ({ page }) => {
    await page.goto('/prospect')
    await page.waitForLoadState('domcontentloaded')
    const started = Date.now()
    await page.locator('textarea').first().fill('Sign in\nEmail\nPassword\nForgot password\nLog in')
    await page.getByRole('button', { name: /analyze/i }).click()
    await expect(page.getByText(/login|not a prospect|no message|IRRELEVANT/i).first()).toBeVisible({ timeout: 15_000 })
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(12_000)
  })

  test('Thin-data prospect does not invent intent', async ({ page }) => {
    await page.goto('/prospect')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('textarea').first().fill('Sam Patel\nFounder\nQuiet Labs')
    await page.getByRole('button', { name: /analyze/i }).click()
    await expect(page.getByText(/Fit/i).first()).toBeVisible({ timeout: 45_000 })
    const body = (await page.textContent('body')) ?? ''
    expect(body).toMatch(/UNKNOWN|RESEARCH_MORE|CONNECT_OR_OBSERVE|No message|not enough/i)
    expect(body).not.toMatch(/I can write a quick analysis/i)
  })
})
