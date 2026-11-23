import { expect, test, type Page } from '@playwright/test'

// UI contract checks, deliberately mocked. Real OTP/session behavior is tested
// against local PostgreSQL in backend/test/e2e/phone-otp-auth.e2e-spec.ts.
async function stubApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/refresh'))
      return route.fulfill({ status: 401, json: { success: false } })
    if (path.endsWith('/auth/otp/request'))
      return route.fulfill({ status: 204 })
    if (path.endsWith('/auth/otp/verify'))
      return route.fulfill({
        json: {
          success: true,
          data: {
            accessToken: 'ui-test-only',
            user: {
              id: 'ui-only',
              email: null,
              role: 'CUSTOMER',
              createdAt: new Date().toISOString(),
            },
          },
        },
      })
    if (path.includes('public'))
      return route.fulfill({
        json: {
          success: true,
          data: { maintenance_mode: false, storeName: 'AB CREATIONS' },
        },
      })
    return route.fulfill({ json: { success: true, data: [] } })
  })
}

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`layout and accessible controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await stubApi(page)
    const images: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('portrait-lamp')) images.push(r.url())
    })
    await page.goto('/login')
    await expect(
      page.getByRole('heading', { name: 'ENTER MOBILE NUMBER' }),
    ).toBeVisible()
    await expect(page.getByRole('banner')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Terms & Conditions' }),
    ).toHaveAttribute('href', '/terms')
    await expect(
      page.getByRole('link', { name: 'Privacy Policy' }),
    ).toHaveAttribute('href', '/privacy')
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      button: getComputedStyle(document.querySelector('button[type=submit]')!)
        .backgroundColor,
    }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(width)
    expect(layout.scrollHeight).toBeLessThanOrEqual(900)
    expect(layout.button).toBe('rgb(255, 255, 255)')
    if (width <= 768) {
      await expect(page.getByRole('complementary')).toBeHidden()
      expect(images).toEqual([])
    } else {
      const hero = await page.getByRole('complementary').boundingBox()
      expect(hero?.width).toBe(width / 2)
      expect(hero?.height).toBe(900)
    }
    await page.screenshot({ path: `e2e/screenshots/otp-login-${width}.png` })
    await page.getByLabel(/Mobile number/).fill('9876543210')
    await page.getByRole('button', { name: 'SEND OTP', exact: true }).click()
    await expect(page.getByLabel('Verification code')).toBeFocused()
    await expect(page.getByText(/XXXXXXX210/)).toBeVisible()
    if (width === 390 || width === 1440) {
      await page.screenshot({ path: `e2e/screenshots/otp-verify-${width}.png` })
    }
    await expect(
      page.getByRole('button', { name: /Resend OTP in/ }),
    ).toBeDisabled()
    await page.getByLabel('Verification code').fill('123456')
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'VERIFY & CONTINUE' }),
    ).toBeFocused()
    await page.getByRole('button', { name: 'Change number' }).click()
    await expect(page.getByLabel(/Mobile number/)).toBeFocused()
  })
}

test('checkout redirect keeps the intended query after verification', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/login')
  // Router state is how ProtectedRoute carries the destination; keep this UI
  // test independent of checkout's shipping/payment API fixtures.
  await page.evaluate(() => {
    history.replaceState(
      {
        ...history.state,
        usr: { from: { pathname: '/checkout', search: '?resume=cart' } },
      },
      '',
      '/login',
    )
  })
  await page.reload()
  await page.getByLabel(/Mobile number/).fill('9876543210')
  await page.getByRole('button', { name: 'SEND OTP', exact: true }).click()
  await page.getByLabel('Verification code').fill('123456')
  await page.getByRole('button', { name: 'VERIFY & CONTINUE' }).click()
  await expect(page).toHaveURL(/\/checkout\?resume=cart$/)
})

test('short desktop and keyboard-sized mobile viewport stay usable', async ({
  page,
}) => {
  await stubApi(page)
  for (const viewport of [
    { width: 1440, height: 600 },
    { width: 390, height: 420 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/login')
    const button = page.getByRole('button', { name: 'SEND OTP', exact: true })
    await expect(button).toBeInViewport()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width)
    if (viewport.width > 768)
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBe(viewport.height)
  }
})
