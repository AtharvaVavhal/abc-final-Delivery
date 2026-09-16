import path from 'node:path'
import { expect } from '@playwright/test'
import { test, makeTestCustomer, fillRegisterForm } from './helpers'

const customer = makeTestCustomer('checkoutval')
const TEST_IMAGE = path.resolve(import.meta.dirname, '../public/catalog/PAC01.jpg')

test('Checkout shipping validation — client and server', async ({ page }) => {
  test.setTimeout(180_000)
  let authHeader: string | undefined
  page.on('request', (req) => {
    const h = req.headers()['authorization']
    if (h && !authHeader) authHeader = h
  })

  await page.goto('/register')
  await fillRegisterForm(page, customer)
  await page.getByRole('button', { name: /create account/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'Account' })).toBeVisible({ timeout: 15_000 })

  await page.goto('/products')
  const productCard = page.locator('a[href^="/products/"]').first()
  await expect(productCard).toBeVisible({ timeout: 15_000 })
  await productCard.click()
  await page.waitForURL(/\/products\/[^/?]+$/)

  await page
    .getByRole('heading', { name: /customize this item/i })
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => {})

  const requiredUpload = await page.locator('input[type="file"][aria-required="true"]').count()
  if (requiredUpload > 0) {
    const uploadResponse = page.waitForResponse(
      (res) => res.url().includes('/uploads') && res.request().method() === 'POST',
      { timeout: 20_000 },
    )
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE)
    const uploadRes = await uploadResponse
    expect(uploadRes.ok(), `Checkout-validation upload failed: HTTP ${uploadRes.status()}`).toBe(
      true,
    )
    await expect(page.getByText(/^uploaded$/i)).toBeVisible({ timeout: 10_000 })
  }

  const addBtn = page.getByRole('button', { name: /^add to cart$/i })
  await expect(addBtn).toBeEnabled({ timeout: 15_000 })
  const cartResponse = page.waitForResponse(
    (res) => res.url().includes('/cart/items') && res.request().method() === 'POST',
    { timeout: 20_000 },
  )
  await addBtn.click()
  const cartRes = await cartResponse
  expect(cartRes.ok(), `Checkout-validation cart seed failed: HTTP ${cartRes.status()}`).toBe(true)

  await page.goto('/checkout')
  const payButton = page.getByRole('button', { name: /pay now/i })
  await expect(payButton).toBeVisible({ timeout: 15_000 })

  await test.step('empty required fields are rejected client-side', async () => {
    await payButton.click()
    await expect(page.getByText(/required/i).first()).toBeVisible({ timeout: 5000 })
    await expect(page).toHaveURL(/\/checkout/)
  })

  await test.step('invalid phone number is rejected', async () => {
    const phone = page.getByLabel('Phone number')
    await expect(phone).toBeVisible()
    await phone.fill('123')
    await phone.blur()
    await expect(page.getByText(/valid.*mobile|invalid.*phone/i)).toBeVisible({ timeout: 5000 })
  })

  await test.step('invalid postal code is rejected', async () => {
    const postal = page.getByLabel('Postal code')
    await expect(postal).toBeVisible()
    await postal.fill('12')
    await postal.blur()
    await expect(page.getByText(/6-digit|valid.*pin/i)).toBeVisible({ timeout: 5000 })
  })

  await test.step('server-side validation is enforced when the client is bypassed', async () => {
    if (!authHeader) {
      await page.goto('/account')
      await expect(page.getByRole('link', { name: 'Account' })).toBeVisible({ timeout: 10_000 })
    }
    expect(authHeader, 'Never captured an Authorization header').toBeTruthy()

    const res = await page.request.post('/api/v1/checkout/orders', {
      headers: { Authorization: authHeader!, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        shippingRecipientName: '',
        shippingPhone: 'not-a-phone',
        shippingAddressLine1: '',
        shippingCity: '',
        shippingState: '',
        shippingPostalCode: '1',
        shippingCountry: '',
      },
    })
    expect(res.status(), 'Server accepted an invalid checkout payload').toBeGreaterThanOrEqual(400)
    expect(
      res.status(),
      'Server-side checkout validation returned 401 (auth), not a validation error',
    ).not.toBe(401)
    expect(res.status()).toBeLessThan(500)
  })
})
