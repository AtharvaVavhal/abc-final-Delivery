import { expect } from '@playwright/test'
import { test, captureConsole, isBenignConsoleEntry } from './helpers'

/** Fetches one real, active product slug from the live catalog so the hard
 * refresh test exercises an actual product URL rather than an invented one. */
async function getRealProductSlug(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get('/api/v1/products?limit=1')
  const body = await res.json()
  const slug = body?.data?.[0]?.slug
  if (!slug) throw new Error('No real product found in catalog to hard-refresh test against')
  return slug as string
}

test.describe('Hard refresh — direct route load', () => {
  test('static/public routes render on direct hard refresh', async ({ page, request }) => {
    const slug = await getRealProductSlug(request)
    const routes = ['/', '/products', `/products/${slug}`]

    for (const route of routes) {
      const capture = captureConsole(page)
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), `${route} should return 200 on direct load`).toBe(200)

      // Reload = true hard refresh once already on the route
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle')

      const bodyText = await page.locator('body').innerText()
      expect(bodyText.trim().length, `${route} rendered blank content after hard refresh`).toBeGreaterThan(
        0,
      )

      const spinnerStillSpinning = await page
        .locator('[class*="loader" i], [class*="spinner" i]')
        .first()
        .isVisible()
        .catch(() => false)
      expect(spinnerStillSpinning, `${route} stuck on an infinite loader after refresh`).toBe(
        false,
      )

      const seriousErrors = capture.pageErrors.filter((e) => !isBenignConsoleEntry(e))
      expect(seriousErrors, `${route} threw uncaught errors on hard refresh: ${seriousErrors.join('; ')}`).toEqual(
        [],
      )
    }
  })

  test('protected routes redirect to login (not blank) on direct hard refresh when logged out', async ({
    page,
    context,
  }) => {
    await context.clearCookies()
    for (const route of ['/cart', '/checkout', '/account', '/orders']) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
      expect(response?.status()).toBeLessThan(400)
      await page.waitForURL(/\/login/, { timeout: 10_000 })
      await expect(page.locator('body')).not.toBeEmpty()
    }
  })

  test('static storefront shell HTML contains critical content before hydration', async ({
    request,
  }) => {
    const res = await request.get('/')
    const html = await res.text()
    expect(res.status()).toBe(200)
    // The static shell/snapshot should ship real content, not an empty <div id="root"></div>
    expect(html.length).toBeGreaterThan(500)
    expect(html).toMatch(/<title>[^<]*AB Creations[^<]*<\/title>/i)
  })
})
