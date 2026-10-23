import { expect, test } from '@playwright/test'

const localBrowser = process.env.PLAYWRIGHT_EXECUTABLE_PATH
test.use(localBrowser ? { launchOptions: { executablePath: localBrowser } } : {})

function analysisResponse(label: string, company: string, contactName: string) {
  return {
    intelligence: {
      wants: label,
      intent: 'Explicit buyer request (verified)',
      fitScore: 82,
      displayScore: 82,
      fitRelevance: 'Strong',
      opportunityQuality: 'high',
      recommendedIdentity: null,
      identityFitReason: 'No profiles available',
      matchingSkills: [],
      strongestProof: [],
      missingInfo: [],
      recommendedAction: 'reply',
      canGenerateResume: false,
    },
    extracted: { company, contactName, contactTitle: 'VP Engineering', url: null },
    canonical: { canonicalScore: 82 },
    buyerIntent: { verifiedBuyerRequest: true },
    qualification: 'STRONG',
  }
}

test.describe('inbound analysis input binding', () => {
  test('context edits invalidate auto identity while preserving same-input manual overrides', async ({ page }) => {
    let requestNumber = 0
    await page.route('**/api/inbound/analyze', async (route) => {
      requestNumber += 1
      const response = requestNumber === 1
        ? analysisResponse('Old-context project', 'Old Context Co', 'Old Contact')
        : analysisResponse('New-context project', 'New Context Co', 'New Contact')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
    })

    await page.goto('/inbound')
    const newMessage = page.getByRole('button', { name: 'New message' })
    if (await newMessage.isVisible()) await newMessage.click()

    await page.getByLabel('Their message').fill('We need a delivery partner for a platform rebuild.')
    await page.getByRole('button', { name: 'Add profile or job context' }).click()
    await page.getByLabel('Extra context').fill('Old context')
    await page.getByRole('button', { name: 'Read the message' }).click()

    await expect(page.getByLabel('Company')).toHaveValue('Old Context Co')
    await page.getByLabel('Name').fill('Manual Name')

    await page.getByLabel('Extra context').fill('New context')
    await expect(page.getByLabel('Company')).toHaveValue('')
    await expect(page.getByLabel('Name')).toHaveValue('Manual Name')
    await expect(page.getByText('Old-context project')).toHaveCount(0)

    await page.getByRole('button', { name: 'Read the message' }).click()
    await expect(page.getByLabel('Company')).toHaveValue('New Context Co')
    await expect(page.getByLabel('Name')).toHaveValue('Manual Name')
    await expect(page.getByText('New-context project')).toBeVisible()

    await page.getByRole('button', { name: 'Read the message' }).click()
    await expect(page.getByLabel('Name')).toHaveValue('Manual Name')
    await expect(page.getByLabel('Company')).toHaveValue('New Context Co')
  })

  test('an edited message cannot be overwritten by an older in-flight response', async ({ page }) => {
    let releaseOld!: () => void
    const oldResponseMayFinish = new Promise<void>((resolve) => { releaseOld = resolve })
    let oldRequestStarted!: () => void
    const oldRequest = new Promise<void>((resolve) => { oldRequestStarted = resolve })

    await page.route('**/api/inbound/analyze', async (route) => {
      const body = route.request().postDataJSON() as { message: string }
      if (body.message.startsWith('Old')) {
        oldRequestStarted()
        await oldResponseMayFinish
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(analysisResponse('Old delayed project', 'Old Co', 'Old Contact')),
        }).catch(() => {})
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(analysisResponse('Current project', 'Current Co', 'Current Contact')),
      })
    })

    await page.goto('/inbound')
    const newMessage = page.getByRole('button', { name: 'New message' })
    if (await newMessage.isVisible()) await newMessage.click()

    await page.getByLabel('Their message').fill('Old message requesting a platform rebuild.')
    await page.getByRole('button', { name: 'Add profile or job context' }).click()
    await page.getByLabel('Extra context').fill('Initial context')
    await page.getByRole('button', { name: 'Read the message' }).click()
    await oldRequest

    await page.getByRole('button', { name: 'Email' }).click()
    await page.getByLabel('Extra context').fill('Updated context')
    await page.getByLabel('Their message').fill('Current message requesting a billing rebuild.')
    await expect(page.getByRole('button', { name: 'Read the message' })).toBeEnabled()

    await page.getByRole('button', { name: 'Read the message' }).click()
    await expect(page.getByText('Current project')).toBeVisible()
    await expect(page.getByLabel('Company')).toHaveValue('Current Co')
    releaseOld()
    await expect(page.getByText('Old delayed project')).toHaveCount(0)
    await expect(page.getByText('Current project')).toBeVisible()

    await page.getByRole('button', { name: 'Upwork' }).click()
    await expect(page.getByText('Current project')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save as a lead' })).toHaveCount(0)
  })

  test('save retries reuse one operation key and never send client canonical decisions', async ({ page }) => {
    const savedBodies: Array<Record<string, unknown>> = []
    await page.route('**/api/inbound/analyze', async (route) => {
      const base = analysisResponse('Recoverable project', 'Recovery Co', 'Rina Patel')
      const response = {
        ...base,
        intelligence: {
          ...base.intelligence,
          recommendedIdentity: { id: 'profile-1', label: 'Authorized Sender' },
        },
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
    })
    await page.route('**/api/inbound/lead', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      savedBodies.push(body)
      if (savedBodies.length === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'The lead was saved, but its conversation could not be initialized. Retry to repair it.',
            retryable: true,
            incomplete: true,
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lead: { id: 'lead-recovered' }, idempotent: true, recovered: true }),
      })
    })

    await page.goto('/inbound')
    const newMessage = page.getByRole('button', { name: 'New message' })
    if (await newMessage.isVisible()) await newMessage.click()
    await page.getByLabel('Their message').fill('We need an external team to rebuild our billing platform.')
    await page.getByRole('button', { name: 'Read the message' }).click()
    await expect(page.getByText('Recoverable project')).toBeVisible()

    await page.getByRole('button', { name: 'Save as a lead' }).click()
    await expect(page.getByRole('main').getByText(/conversation could not be initialized/i)).toBeVisible()
    await page.getByRole('button', { name: 'Save as a lead' }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reply' })).toHaveAttribute('href', '/leads/lead-recovered?tab=conversation')

    expect(savedBodies).toHaveLength(2)
    expect(savedBodies[0].idempotencyKey).toBeTruthy()
    expect(savedBodies[1].idempotencyKey).toBe(savedBodies[0].idempotencyKey)
    expect(savedBodies[0].assignedProfileId).toBe('profile-1')
    expect(savedBodies[0]).not.toHaveProperty('canonicalScore')
    expect(savedBodies[0]).not.toHaveProperty('buyerIntent')
    expect(savedBodies[0]).not.toHaveProperty('qualification')
    expect(savedBodies[0]).not.toHaveProperty('canonicalIntelligence')
  })

  test('one save stays bound to immutable inputs and suppresses rapid duplicate submission', async ({ page }) => {
    let releaseSave!: () => void
    const saveMayFinish = new Promise<void>((resolve) => { releaseSave = resolve })
    const savedBodies: Array<Record<string, unknown>> = []
    await page.route('**/api/inbound/analyze', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(analysisResponse('Immutable save project', 'Locked Co', 'Ari Singh')),
      })
    })
    await page.route('**/api/inbound/lead', async (route) => {
      savedBodies.push(route.request().postDataJSON() as Record<string, unknown>)
      await saveMayFinish
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ lead: { id: 'lead-immutable' } }),
      })
    })

    await page.goto('/inbound')
    const newMessage = page.getByRole('button', { name: 'New message' })
    if (await newMessage.isVisible()) await newMessage.click()
    await page.getByLabel('Their message').fill('We need an external team for a new platform.')
    await page.getByRole('button', { name: 'Read the message' }).click()
    await expect(page.getByText('Immutable save project')).toBeVisible()

    const save = page.getByRole('button', { name: 'Save as a lead' })
    await save.click()
    await expect(save).toBeDisabled()
    await expect(page.getByLabel('Their message')).toBeDisabled()
    await expect(page.getByLabel('Company')).toBeDisabled()
    expect(savedBodies).toHaveLength(1)

    releaseSave()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    expect(savedBodies).toHaveLength(1)
  })
})
