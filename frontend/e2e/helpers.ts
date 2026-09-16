import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test as base, type Page, type ConsoleMessage } from '@playwright/test'

const HTTP_429_LOG = '/tmp/ab-creations-e2e-429.log'

/** Browser-level 429 recorder. Does not change throttle policy. */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    const hits: { at: string; method: string; url: string }[] = []
    context.on('response', (res) => {
      if (res.status() !== 429) return
      const row = {
        at: new Date().toISOString(),
        method: res.request().method(),
        url: res.url(),
      }
      hits.push(row)
      appendFileSync(
        HTTP_429_LOG,
        `${row.at}\t${testInfo.title}\t${row.method}\t${row.url}\n`,
      )
    })
    await use(context)
    if (hits.length > 0) {
      const body = hits.map((h) => `${h.at} ${h.method} ${h.url}`).join('\n')
      await testInfo.attach('http-429', { body, contentType: 'text/plain' })
      // eslint-disable-next-line no-console
      console.log(`[HTTP 429] ${hits.length} during "${testInfo.title}"\n${body}`)
    }
  },
})


/** Minimal .env parser — avoids adding dotenv as a dependency just for
 * the E2E harness to read backend/.env (seed admin credentials) without
 * ever printing the values to the terminal/tool output. */
function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const backendEnv = loadEnvFile(resolve(import.meta.dirname, '../../backend/.env'))

export const SEED_ADMIN = {
  email: backendEnv.SEED_OWNER_EMAIL,
  password: backendEnv.SEED_OWNER_PASSWORD,
}

/** Every run gets one tag so test data created against the live
 * production DB during this E2E pass is trivially identifiable and can be
 * found/cleaned up afterward (e2e-report cites this). */
export const RUN_TAG = `e2e-${Date.now()}`
export const TEST_CUSTOMER_EMAIL = `ujjwaldole01+${RUN_TAG}@gmail.com`
export const TEST_CUSTOMER_PASSWORD = 'E2eTest!Pass123'
export const TEST_CUSTOMER_NAME = `E2E Test Runner (${RUN_TAG})`

/** Each spec file that needs its own registered account calls this with a
 * distinct suffix so specs never collide or depend on each other's
 * execution order. All addresses land in the same real inbox (Gmail "+"
 * tagging) so they're easy to spot and delete afterward. */
export function makeTestCustomer(suffix: string) {
  const email = `ujjwaldole01+${RUN_TAG}-${suffix}@gmail.com`
  return { email, password: TEST_CUSTOMER_PASSWORD, name: `E2E ${suffix} (${RUN_TAG})` }
}

/** Fill the storefront register form. Playwright's `fill()` can lose the
 * email value to browser autofill in this Chrome channel; verify after. */
export async function fillRegisterForm(
  page: Page,
  customer: { email: string; password: string },
) {
  const emailField = page.getByLabel('Email')
  await expect(emailField).toBeVisible()
  await emailField.click()
  await emailField.fill('')
  await emailField.pressSequentially(customer.email, { delay: 15 })
  await expect(emailField).toHaveValue(customer.email)
  await page.getByLabel('Password', { exact: true }).fill(customer.password)
  await page.getByLabel('Confirm password').fill(customer.password)
}

export interface ConsoleCapture {
  errors: string[]
  warnings: string[]
  pageErrors: string[]
  failedRequests: string[]
}

/** Attaches listeners for the console/network audit every section of the
 * E2E brief asks for, and returns the running capture so a test can assert
 * on it at the end. */
export function captureConsole(page: Page): ConsoleCapture {
  const capture: ConsoleCapture = {
    errors: [],
    warnings: [],
    pageErrors: [],
    failedRequests: [],
  }
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') capture.errors.push(msg.text())
    if (msg.type() === 'warning') capture.warnings.push(msg.text())
  })
  page.on('pageerror', (err) => {
    capture.pageErrors.push(err.message)
  })
  page.on('requestfailed', (req) => {
    capture.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
  })
  page.on('response', (res) => {
    if (res.status() >= 500) {
      capture.failedRequests.push(`${res.request().method()} ${res.url()} — HTTP ${res.status()}`)
    }
  })
  return capture
}

/** Console noise that's expected/benign and shouldn't fail a test:
 * Razorpay's own third-party script and known dev-only React warnings. */
export function isBenignConsoleEntry(text: string): boolean {
  return (
    text.includes('razorpay.com') ||
    text.includes('Download the React DevTools') ||
    text.includes('[vite]') ||
    // AuthProvider silently POSTs /auth/refresh on every app boot to try to
    // re-establish a session from the HttpOnly cookie (see
    // features/auth/AuthProvider.tsx) — an anonymous visitor's 401 here is
    // expected and is not the application logging an error itself; it's
    // Chromium's own network-failure console line for a non-2xx response.
    (text.includes('401') && text.includes('Failed to load resource')) ||
    (text.includes('429') && text.includes('Failed to load resource'))
  )
}
