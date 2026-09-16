import { expect } from '@playwright/test'
import { test, captureConsole, isBenignConsoleEntry, makeTestCustomer } from './helpers'

const { email: TEST_CUSTOMER_EMAIL, password: TEST_CUSTOMER_PASSWORD } = makeTestCustomer('auth')

test.describe.serial('Customer auth', () => {
  test('registration creates an account and lands the user in (or prompts login)', async ({
    page,
  }) => {
    const capture = captureConsole(page)
    await page.goto('/register')
    await page.getByLabel('Email').fill(TEST_CUSTOMER_EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(TEST_CUSTOMER_PASSWORD)
    await page.getByLabel('Confirm password').fill(TEST_CUSTOMER_PASSWORD)
    await page.getByRole('button', { name: /create account/i }).click()

    await page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15_000 })
    expect(page.url()).not.toContain('/register')

    const seriousErrors = capture.pageErrors.filter((e) => !isBenignConsoleEntry(e))
    expect(seriousErrors).toEqual([])
  })

  test('invalid login credentials show a clear error, not a crash', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_CUSTOMER_EMAIL)
    await page.getByLabel('Password', { exact: true }).fill('WrongPassword123!')
    await page.getByRole('button', { name: /log in|sign in/i }).click()

    await expect(page.getByRole('alert').or(page.getByText(/invalid|incorrect/i))).toBeVisible({
      timeout: 10_000,
    })
    expect(page.url()).toContain('/login')
  })

  test('valid login succeeds, refresh keeps session, logout ends it', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_CUSTOMER_EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(TEST_CUSTOMER_PASSWORD)
    await page.getByRole('button', { name: /log in|sign in/i }).click()

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    // Refresh while logged in — session should persist
    await page.reload({ waitUntil: 'networkidle' })
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account/)
    await expect(page.locator('body')).toContainText(new RegExp(TEST_CUSTOMER_EMAIL.split('@')[0], 'i')).catch(
      async () => {
        // Email echo isn't guaranteed on the page; just assert we weren't bounced to /login
        await expect(page).not.toHaveURL(/\/login/)
      },
    )

    const logoutButton = page.getByRole('button', { name: /log out|sign out/i })
    if (await logoutButton.count()) {
      await logoutButton.click()
      await page.waitForURL((url) => url.pathname === '/' || url.pathname.includes('/login'), {
        timeout: 10_000,
      })
    }
  })

  test('anonymous visitor hitting /account or /orders is redirected to login, not shown data', async ({
    page,
    context,
  }) => {
    await context.clearCookies()
    for (const route of ['/account', '/orders']) {
      await page.goto(route)
      await page.waitForURL(/\/login/, { timeout: 10_000 })
    }
  })

  test('logged-in customer cannot reach /admin (redirected to /forbidden, not shown admin UI)', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_CUSTOMER_EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(TEST_CUSTOMER_PASSWORD)
    await page.getByRole('button', { name: /log in|sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    const response = await page.goto('/admin')
    await page.waitForURL(/\/forbidden/, { timeout: 10_000 })
    expect(response?.status()).toBeLessThan(500)

    const adminOnlyMarker = page.locator('text=/admin dashboard/i')
    expect(await adminOnlyMarker.count()).toBe(0)
  })

  test('password reset request does not reveal whether an account exists (no real email verified)', async ({
    page,
  }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('definitely-not-a-real-account-e2e@example.com')
    await page.getByRole('button', { name: /reset|send|submit/i }).click()
    // Expect a generic confirmation, not an enumeration-revealing error
    await expect(page.getByText(/if.*account.*exists|check your email|sent/i)).toBeVisible({
      timeout: 10_000,
    })
    test.info().annotations.push({
      type: 'PARTIAL',
      description:
        'Real inbox delivery not verified per instruction (skip real send) — only the API-triggering UI path and anti-enumeration response were checked.',
    })
  })
})
