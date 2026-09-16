import { expect } from '@playwright/test'
import { test } from './helpers'

test.describe('Failure / graceful degradation', () => {
  test('invalid product URL shows a 404/not-found state, not a blank page or crash', async ({
    page,
  }) => {
    await page.goto('/products/this-slug-does-not-exist-e2e-999')
    await page.waitForLoadState('networkidle')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.trim().length).toBeGreaterThan(0)
    await expect(page.getByText(/not found|doesn.?t exist|404/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('invalid category id shows an empty/not-found state, not a crash', async ({ page }) => {
    await page.goto('/products?categoryId=00000000-0000-0000-0000-000000000000')
    await page.waitForLoadState('networkidle')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.trim().length).toBeGreaterThan(0)
  })

  test('unknown route renders the app 404 page, not a blank screen', async ({ page }) => {
    const res = await page.goto('/this-route-does-not-exist-e2e')
    expect(res?.status()).toBeLessThan(500)
    await expect(page.getByText(/not found|404/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('API temporarily unavailable: homepage degrades gracefully instead of crashing', async ({
    page,
  }) => {
    await page.route('**/api/v1/products**', (route) => route.abort('connectionrefused'))
    await page.route('**/api/v1/categories**', (route) => route.abort('connectionrefused'))

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/')
    await page.waitForTimeout(2000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText.trim().length, 'Homepage went blank when the API was unreachable').toBeGreaterThan(0)
    expect(errors, `Uncaught exceptions when API unreachable: ${errors.join('; ')}`).toEqual([])

    const infiniteLoader = await page
      .locator('[class*="loader" i], [class*="spinner" i]')
      .first()
      .isVisible()
      .catch(() => false)
    // A brief loader is fine; we already waited 2s, so it should have resolved to an error/empty state
    expect(infiniteLoader, 'Homepage stuck in an infinite loader when API is unreachable').toBe(false)
  })

  test('a corrupted/expired session (refresh cookie) does not silently show stale protected data', async ({
    page,
    context,
  }) => {
    // The access token lives only in memory (never persisted client-side —
    // see services/api/authStore.ts); the durable session artifact is the
    // HttpOnly pf_refresh_token cookie the SPA bootstraps from on load. A
    // corrupted value here is the real analog of an expired/invalid session.
    await context.addCookies([
      {
        name: 'pf_refresh_token',
        value: 'this-is-not-a-valid-refresh-token',
        domain: '127.0.0.1',
        path: '/',
      },
    ])
    await page.goto('/account')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })
})
