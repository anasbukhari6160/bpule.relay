import { test, expect, type Page, request as requestFixture } from '@playwright/test'

const ADMIN_EMAIL = 'hassan@scout.dev'
const REP_EMAIL = 'madiha@scout.dev'
const PASSWORD = 'scout-dev-password'

/** Bootstrap demo profile via onboarding API. Failures are non-fatal (app tolerates). */
export async function bootstrapDemoProfile(baseURL: string) {
  try {
    const ctx = await requestFixture.newContext({ baseURL })
    const res = await ctx.post('/api/onboarding', {
      data: {
        quiz: {
          contractions: 'sometimes',
          formality: 3,
          sentenceLength: 'medium',
          punctuation: 'standard',
          openers: 'statement',
          emoji: 'none',
          greeting: 'Hey',
          signOff: 'Best',
          neverWords: '',
          preferredWords: '',
        },
        samples: 'demo mode e2e',
      },
    })
    await res.ok()
    await ctx.dispose()
  } catch {
    // Non-fatal: some routes don't require onboarding
  }
}

async function loginWith(page: Page, email: string): Promise<void> {
  // Demo mode auto-authenticates but may redirect to /onboarding if no profile.
  // Real-auth mode (Supabase credentials configured, no demo bootstrap) shows
  // the actual sign-in form and requires a real network round-trip.
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

  const needsForm = page.url().includes('/login')
  if (needsForm) {
    // Under dev-mode compilation (Turbopack lazily compiles routes on first
    // request), domcontentloaded fires long before the page's JS bundle has
    // downloaded, executed, and React has hydrated. fill() sets the raw DOM
    // input value directly and resolves immediately regardless of hydration
    // state — so filling before hydration attaches onChange listeners
    // leaves React's controlled state at its initial empty value, and the
    // disabled-until-valid submit button then never becomes clickable no
    // matter how long you wait, because nothing ever told React the fields
    // changed. Wait for genuine interactivity first: networkidle (JS finished
    // loading) AND the email input actually accepting synthetic events
    // (proven by typing a throwaway character and seeing it reflected,
    // rather than assuming hydration = idle network).
    await page.waitForLoadState('networkidle')
    const emailInput = page
      .locator('#login-email, input[type="email"], input[name="email"], input[placeholder*="email" i]')
      .first()
    const passInput = page.locator('#login-password, input[type="password"], input[name="password"]').first()
    const submitBtn = page
      .locator('button.auth-submit, button:has-text("Sign in with password"), button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"]:not(.gv-submit-btn)')
      .first()

    await emailInput.click()
    await emailInput.pressSequentially(email, { delay: 10 })
    await passInput.click()
    await passInput.pressSequentially(PASSWORD, { delay: 10 })
    // Wait for the controlled-input state to actually reflect the typed
    // values before checking enabled.
    await expect(emailInput).toHaveValue(email)
    await expect(passInput).toHaveValue(PASSWORD)

    if (!(await submitBtn.isEnabled().catch(() => false))) {
      await emailInput.fill('')
      await emailInput.fill(email)
      await passInput.fill('')
      await passInput.fill(PASSWORD)
      await emailInput.evaluate((el, value) => {
        const input = el as HTMLInputElement
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, email)
      await passInput.evaluate((el, value) => {
        const input = el as HTMLInputElement
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, PASSWORD)
      await emailInput.blur()
      await passInput.blur()
    }

    await expect(submitBtn).toBeEnabled({ timeout: 20_000 })
    await submitBtn.click()
    // The click submits a real sign-in request (Supabase auth + server
    // session cookie exchange) in real-auth mode — wait for either a
    // navigation away from /login or a visible auth error, rather than
    // assuming the click alone completed the flow.
    await Promise.race([
      page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 }),
      page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 20_000 }),
    ]).catch(() => undefined)

    // A URL change alone doesn't guarantee the session cookie the SERVER
    // will check on the NEXT navigation has actually been written yet —
    // login-experience.tsx's own signInWithPassword() explicitly polls
    // /api/me/status up to 8x/150ms after auth succeeds specifically
    // because of this gap (see waitForServerSession() there). That budget
    // (~1.2s) is tuned for a warm app; the FIRST request in a fresh dev-mode
    // Playwright run can additionally race Turbopack lazily compiling
    // /dashboard's route bundle on first hit, which alone can take several
    // seconds — observed empirically (the first test in a run intermittently
    // bounced back to /login while every subsequent test, hitting
    // already-compiled routes, passed reliably). Poll considerably longer
    // here to cover both cases; this is dev-server compile latency, not
    // production behavior (pre-built bundles have no compile step).
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await page.request.get('/api/me/status', { failOnStatusCode: false }).catch(() => null)
      if (status?.ok()) break
      await page.waitForTimeout(300)
    }
  }

  // Handle demo-mode onboarding redirect: bootstrap profile then retry.
  if (page.url().includes('/onboarding')) {
    const origin = new URL(page.url()).origin
    await bootstrapDemoProfile(origin)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  }

  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

export async function loginAsAdmin(page: Page) {
  await loginWith(page, ADMIN_EMAIL)
}

export async function loginAsRep(page: Page) {
  await loginWith(page, REP_EMAIL)
}

export async function logout(page: Page) {
  const userMenu = page
    .locator('button:has-text("Sign out"), button:has-text("Logout"), [data-testid="user-menu"]')
    .first()
  if (await userMenu.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await userMenu.click()
  }
}
