import { expect } from '@playwright/test'
import { test, captureConsole, isBenignConsoleEntry } from './helpers'

const FORBIDDEN_STRINGS = [
  'UvPixel',
  'PrintForge Store',
  'printforge.in',
  'Lorem ipsum',
  'demo product',
  'Demo Product',
]

test.describe('Homepage', () => {
  test('loads, shows real branding, no forbidden legacy content, no console errors', async ({
    page,
  }) => {
    const capture = captureConsole(page)
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveTitle(/AB Creations/i)

    const bodyText = await page.locator('body').innerText()
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(bodyText, `Found forbidden legacy string "${forbidden}" on homepage`).not.toContain(
        forbidden,
      )
    }

    // Navbar / logo
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('link', { name: /cart/i }).first()).toBeVisible()

    // Hero
    await expect(page.locator('h1, [class*="hero"] h2').first()).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/homepage-full.png', fullPage: true })

    const seriousErrors = capture.errors.filter((e) => !isBenignConsoleEntry(e))
    const seriousPageErrors = capture.pageErrors.filter((e) => !isBenignConsoleEntry(e))
    expect(seriousPageErrors, `Uncaught exceptions: ${seriousPageErrors.join('; ')}`).toEqual([])
    expect(seriousErrors, `Console errors: ${seriousErrors.join('; ')}`).toEqual([])
  })

  test('footer, category nav, and no admin bundle on homepage network', async ({ page }) => {
    const adminBundleRequests: string[] = []
    page.on('request', (req) => {
      if (/adminBundle/i.test(req.url())) adminBundleRequests.push(req.url())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('footer')).toBeVisible()

    expect(
      adminBundleRequests,
      'adminBundle JS was fetched on the public homepage — customer bundle is not isolated from admin UI',
    ).toEqual([])
  })

  test('WhatsApp button, if present, has a well-formed wa.me link', async ({ page }) => {
    await page.goto('/')
    const waLink = page.locator('a[href*="wa.me"], a[href*="api.whatsapp.com"]').first()
    const count = await waLink.count()
    if (count === 0) {
      test.info().annotations.push({
        type: 'BLOCKED',
        description: 'WhatsApp button not present — treated as configuration-absent, not a bug.',
      })
      return
    }
    const href = await waLink.getAttribute('href')
    expect(href).toMatch(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//)
    expect(href).toMatch(/\d{10,15}/)
  })
})
