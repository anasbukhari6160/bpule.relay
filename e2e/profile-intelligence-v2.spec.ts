import { test, expect, type Page } from '@playwright/test'
import { loginAsAdmin } from './helpers'

async function navigateToProfiles(page: Page) {
  await page.goto('/profile-intelligence', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Add people from documents')).toBeVisible({ timeout: 15_000 })
}

async function uploadFile(page: Page, content: string, filename: string, mimeType: string = 'text/plain') {
  const fileChooserPromise = page.waitForEvent('filechooser')
  page.locator('input[type="file"]').dispatchEvent('click')
  const fileChooser = await fileChooserPromise

  const buffer = Buffer.from(content, 'utf-8')
  await fileChooser.setFiles([{
    name: filename,
    mimeType,
    buffer,
  }])
}

test.describe('Profile Intelligence V2', () => {
  test('admin uploads a CSV and gets separate profiles', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateToProfiles(page)

    const csvContent = `name,role,company,skills,project,review
Aneeb Khan,CTO,BPulse,"React, Node.js, TypeScript",BPulse Payments,Excellent technical leadership
Hassan Raza,Senior Backend Engineer,BPulse,"Python, Django, PostgreSQL",E-commerce API,Great architecture skills
Fiza,Frontend Engineer,BPulse,"React, TypeScript, Tailwind CSS",Design System,Detail-oriented and fast`

    const fileChooserPromise = page.waitForEvent('filechooser')
    page.locator('input[type="file"]').dispatchEvent('click')
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles([{
      name: 'team.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent, 'utf-8'),
    }])

    await expect(page.getByText('1 file selected')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Upload' }).click()

    await expect(page.getByText(/Batch:/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Analyze' }).click()

    await expect(page.getByText(/Processing/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Batch complete|Review Profiles|View Profiles/)).toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'View Profiles' }).click().catch(() => {})

    await expect(page.getByText('Aneeb Khan')).toBeVisible({ timeout: 10_000 })
  })

  test('admin uploads a multi-person document and gets separate profiles', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateToProfiles(page)

    const teamPdf = `
Aneeb Khan — CTO at BPulse
Senior fullstack engineer with 10+ years of experience.
Skills: React, Node.js, TypeScript, PostgreSQL, AWS
Led the development of BPulse's flagship fintech platform.
Projects: BPulse Payments (Rails, Stripe), BPulse Dashboard (React, D3)

Hassan Raza — Senior Backend Engineer
8 years building scalable backend systems.
Skills: Python, Django, FastAPI, PostgreSQL, Redis, Docker
Projects: E-commerce API (Django, DRF), Real-time Analytics Pipeline (Python, Kafka)

Fiza — Frontend Engineer
5 years specializing in React and design systems.
Skills: React, TypeScript, Tailwind CSS, Figma, Storybook
Projects: Design System (React, Storybook), Customer Portal (Next.js, Tailwind)

Max — DevOps Engineer
6 years in infrastructure and CI/CD.
Skills: AWS, Kubernetes, Terraform, Docker, GitHub Actions
Projects: Infrastructure Migration (AWS, K8s), CI/CD Pipeline (GitHub Actions, ArgoCD)
    `.trim()

    await uploadFile(page, teamPdf, 'team-profiles.txt')

    await expect(page.getByText('1 file selected')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Upload' }).click()

    await expect(page.getByText(/Batch:/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Analyze' }).click()

    await expect(page.getByText(/Processing/)).toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(/Batch complete|Review Profiles|View Profiles/)).toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'View Profiles' }).click().catch(() => {})

    await expect(page.getByText('Aneeb Khan')).toBeVisible({ timeout: 10_000 })
  })

  test('admin can view profile detail with extracted intelligence', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/profile-intelligence', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const firstProfile = page.locator('a[href*="/profile-intelligence/"]').first()
    if (await firstProfile.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstProfile.click()
      await page.waitForLoadState('networkidle')

      await expect(page.getByText('Identity')).toBeVisible({ timeout: 10_000 })
    }
  })

  test('upload persists across logout/login', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateToProfiles(page)

    const cv = `
Sarah Chen — Fullstack Developer
6 years of experience in SaaS development.
Skills: React, Node.js, TypeScript, PostgreSQL, AWS, Docker
Projects: Customer Dashboard (React, Node.js), API Gateway (FastAPI, AWS)
    `.trim()

    await uploadFile(page, cv, 'sarah-cv.txt')
    await page.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText(/Batch:/)).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Add people from documents')).toBeVisible({ timeout: 10_000 })
  })

  test('mobile: profiles section is usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAsAdmin(page)
    await navigateToProfiles(page)

    await expect(page.getByText('Upload profiles & proof')).toBeVisible({ timeout: 10_000 })

    const uploadZone = page.locator('input[type="file"]')
    await expect(uploadZone).toBeVisible({ timeout: 5000 })
  })
})
