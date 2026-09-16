import { expect, type Page } from '@playwright/test'
import { test, makeTestCustomer } from './helpers'

/**
 * IDOR check (§11/§20): two distinct customers, each with their own order,
 * neither should be able to read the other's order. Safe, non-destructive
 * — GET only.
 *
 * The access token lives only in memory (services/api/authStore.ts — never
 * a cookie, never localStorage, by design) and is attached as an
 * Authorization header by the app's own axios interceptor. Playwright's
 * `request` fixture is a separate HTTP client that doesn't share that
 * in-memory JS state, so a direct `request.get()` from a logged-in page
 * would 401 regardless of IDOR protection. Instead, this captures the real
 * bearer token off a real authenticated request the browser makes during
 * normal navigation, then reuses that exact header — the same value the
 * app itself would send.
 */
const customerA = makeTestCustomer('ordersec-a')
const customerB = makeTestCustomer('ordersec-b')

async function registerAndCaptureAuthHeader(page: Page, email: string, password: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)

  let authHeader: string | undefined
  page.on('request', (req) => {
    const h = req.headers()['authorization']
    if (h && !authHeader) authHeader = h
  })

  await page.getByRole('button', { name: /create account/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15_000 })

  // Force one authenticated request if registration itself didn't trigger one
  if (!authHeader) {
    await page.goto('/orders')
    await page.waitForLoadState('networkidle')
  }
  if (!authHeader) throw new Error(`Never observed an Authorization header for ${email}`)
  return authHeader
}

test('a customer cannot read another customer\'s order by reusing an order id', async ({ browser }) => {
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  const authA = await registerAndCaptureAuthHeader(pageA, customerA.email, customerA.password)

  // Give A a real order to attempt cross-account access to: add a
  // no-required-customization product to the cart and create an order
  // (order creation alone never touches Razorpay/charges anything).
  const productsRes = await pageA.request.get('/api/v1/products?limit=25')
  const products = (await productsRes.json())?.data ?? []
  const product = products.find(
    (p: { customizationFields: { isRequired: boolean }[] }) =>
      !p.customizationFields?.some((f) => f.isRequired),
  )
  let orderId: string | undefined
  if (product) {
    await pageA.request.post('/api/v1/cart/items', {
      headers: { Authorization: authA },
      data: { productId: product.id, quantity: 1, customizations: {} },
    })
    const createRes = await pageA.request.post('/api/v1/checkout/orders', {
      headers: { Authorization: authA, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        shippingRecipientName: customerA.name,
        shippingPhone: '9876543210',
        shippingAddressLine1: '221B, E2E Test Lane',
        shippingCity: 'Pune',
        shippingState: 'Maharashtra',
        shippingPostalCode: '411046',
        shippingCountry: 'India',
      },
    })
    if (createRes.ok()) {
      orderId = (await createRes.json())?.data?.id
    }
  }

  if (!orderId) {
    const ordersRes = await pageA.request.get('/api/v1/orders', {
      headers: { Authorization: authA },
    })
    orderId = (await ordersRes.json())?.data?.[0]?.id
  }
  await contextA.close()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  const authB = await registerAndCaptureAuthHeader(pageB, customerB.email, customerB.password)

  if (orderId) {
    const crossRes = await pageB.request.get(`/api/v1/orders/${orderId}`, {
      headers: { Authorization: authB },
    })
    expect(
      [403, 404],
      `Customer B could read customer A's order via GET /orders/${orderId} — IDOR (HTTP ${crossRes.status()})`,
    ).toContain(crossRes.status())
  } else {
    test.info().annotations.push({
      type: 'NOT APPLICABLE',
      description: 'Customer A (freshly registered) had no existing order to attempt cross-account access with.',
    })
  }

  const bOwnOrders = await pageB.request.get('/api/v1/orders', { headers: { Authorization: authB } })
  const bOwnBody = await bOwnOrders.json()
  const leaked = (bOwnBody?.data ?? []).some((o: { id: string }) => o.id === orderId)
  expect(leaked, "Customer B's own order list includes customer A's order").toBe(false)

  await contextB.close()
})
