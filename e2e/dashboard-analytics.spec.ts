/**
 * Dashboard analytics in a real browser: charts render, the range switch
 * works, numbers match the Leads board, and the layout holds on a phone and
 * in dark mode. Read-only: creates no data.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { loginAsAdmin } from './helpers'

const OUT = process.env.QA_EVIDENCE_DIR ?? path.join('test-results', 'dashboard-analytics')
fs.mkdirSync(OUT, { recursive: true })

async function boardStat(page: Page, label: string): Promise<number> {
  const value = await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=preceding-sibling::p[1]').innerText()
  return Number(value.trim())
}

test.describe('Dashboard analytics', () => {
  test.setTimeout(180_000)
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page) })

  test('charts render, range switches, numbers match the board', async ({ page }, info) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text()) })

    await page.goto('/dashboard')
    const view = page.getByTestId('pipeline-analytics')
    await expect(view).toBeVisible({ timeout: 90_000 })
    for (const title of ['Outreach and replies', 'Pipeline now', 'Conversion funnel', 'Lead quality', 'Outcomes', 'Sending consistency', 'Markets', 'Sources']) {
      await expect(view.getByRole('region', { name: title })).toBeVisible()
    }
    for (const kpi of ['Leads added', 'Outreach sent', 'Client replies', 'Reply rate', 'Time to answer']) {
      await expect(view.getByText(kpi, { exact: true }).first()).toBeVisible()
    }
    // Recharts drew real SVG.
    expect(await view.locator('svg.recharts-surface').count()).toBeGreaterThan(2)

    // 30 days is the default; switching to 7 updates the URL and the selected tab.
    await expect(view.getByRole('link', { name: '30d' })).toHaveAttribute('aria-current', 'page')
    await view.getByRole('link', { name: '7d' }).click()
    await page.waitForURL(/range=7/)
    await expect(page.getByTestId('pipeline-analytics').getByRole('link', { name: '7d' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('pipeline-analytics').getByText(/last 7 days/).first()).toBeVisible()

    // Same rows, same rules: dashboard totals equal the Leads board.
    const total = Number(await page.getByTestId('analytics-totals').getAttribute('data-total'))
    const stage = async (k: string) => Number(await page.locator(`[data-stage="${k}"]`).getAttribute('data-value'))
    const dash = { total, to_contact: await stage('to_contact'), needs_reply: await stage('needs_reply'), follow_up_due: await stage('follow_up_due') }
    await page.screenshot({ path: path.join(OUT, `dashboard-${info.project.name}.png`), fullPage: true })

    await page.goto('/leads')
    await expect(page.getByText('Total', { exact: true })).toBeVisible({ timeout: 60_000 })
    const board = {
      total: await boardStat(page, 'Total'),
      to_contact: await boardStat(page, 'To Contact'),
      needs_reply: await boardStat(page, 'Needs Reply'),
      follow_up_due: await boardStat(page, 'Follow-Up Due'),
    }
    expect(dash).toEqual(board)
    expect(errors).toEqual([])
    fs.writeFileSync(path.join(OUT, `parity-${info.project.name}.json`), JSON.stringify({ dash, board }, null, 2))
  })

  test('dark mode and no horizontal scroll', async ({ page }, info) => {
    await page.addInitScript(() => { try { localStorage.setItem('relay-theme', 'dark') } catch {} })
    await page.goto('/dashboard?range=90')
    await expect(page.getByTestId('pipeline-analytics')).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('html')).toHaveClass(/dark/)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: path.join(OUT, `dashboard-dark-${info.project.name}.png`), fullPage: true })
  })
})
