import path from 'node:path'
import { expect } from '@playwright/test'
import { test, captureConsole, isBenignConsoleEntry, SEED_ADMIN, RUN_TAG } from './helpers'

const TEST_IMAGE = path.resolve(import.meta.dirname, '../public/catalog/PAC01.jpg')
const TEST_PRODUCT_NAME = `E2E TEST DELETE ME ${RUN_TAG}`

test.describe('Store Admin', () => {
  test.skip(
    !SEED_ADMIN.email || !SEED_ADMIN.password,
    'SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD not present in backend/.env — cannot log in as admin',
  )

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(SEED_ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill(SEED_ADMIN.password)
    await page.getByRole('button', { name: /log in|sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
  })

  test('admin login lands on dashboard, direct /admin hard refresh works, admin bundle isolated', async ({
    page,
  }) => {
    const capture = captureConsole(page)
    await page.goto('/admin')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.locator('body')).not.toBeEmpty()

    const seriousErrors = capture.pageErrors.filter((e) => !isBenignConsoleEntry(e))
    expect(seriousErrors).toEqual([])
  })

  test('categories, orders, and settings pages load without crashing', async ({ page }) => {
    for (const route of ['/admin/categories', '/admin/orders', '/admin/settings']) {
      const capture = captureConsole(page)
      const res = await page.goto(route);
      expect(res?.status()).toBeLessThan(400)
      await page.waitForLoadState('networkidle')
      const seriousErrors = capture.pageErrors.filter((e) => !isBenignConsoleEntry(e))
      expect(seriousErrors, `${route}: ${seriousErrors.join('; ')}`).toEqual([])
    }
  })

  test('settings page exposes hero/announcement/whatsapp controls, no raw payment secrets in DOM', async ({
    page,
  }) => {
    await page.goto('/admin/settings')
    await page.waitForLoadState('networkidle')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toMatch(/hero|announcement|whatsapp/i)

    // Nothing that looks like a live Razorpay/Cloudinary secret should ever
    // be rendered into the DOM, even on an authenticated admin page.
    expect(bodyText).not.toMatch(/rzp_live_[A-Za-z0-9]{10,}/)
    const html = await page.content()
    expect(html).not.toMatch(/RAZORPAY_KEY_SECRET|CLOUDINARY_API_SECRET/i)
  })

  test('create product, upload real image via Cloudinary, verify it renders on the public storefront', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/products/new')

    await page.getByLabel(/^Name/i).fill(TEST_PRODUCT_NAME)
    const slugField = page.getByLabel(/slug/i)
    if (await slugField.count()) {
      const currentSlug = await slugField.inputValue()
      if (!currentSlug) await slugField.fill(`e2e-test-delete-me-${RUN_TAG}`)
    }
    const priceField = page.getByLabel(/base price/i)
    if (await priceField.count()) await priceField.fill('199')

    const categorySelect = page.getByLabel(/category/i).first()
    if (await categorySelect.count()) {
      const options = await categorySelect.locator('option').all()
      if (options.length > 1) await categorySelect.selectOption({ index: 1 })
    }

    await page.getByRole('button', { name: /create|save/i }).first().click()
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    const productId = page.url().split('/').pop()!

    const uploadsPromise = page.waitForResponse(
      (res) => /\/api\/v1\/uploads\/?$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
      { timeout: 60_000 },
    )
    const attachPromise = page.waitForResponse(
      (res) => /\/products\/[^/]+\/images\/?$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
      { timeout: 60_000 },
    )
    const fileInput = page.locator('#admin-main-content input[type="file"]').first()
    await fileInput.setInputFiles(TEST_IMAGE)

    const uploadsRes = await uploadsPromise
    expect(uploadsRes.ok(), `Cloudinary upload failed: HTTP ${uploadsRes.status()}`).toBe(true)
    const uploadsBody = await uploadsRes.json().catch(() => null)
    const uploadedUrl = uploadsBody?.data?.url as string | undefined
    expect(uploadedUrl, 'Upload response did not include a Cloudinary URL').toBeTruthy()
    expect(uploadedUrl).toMatch(/res\.cloudinary\.com|cloudinary/)
    expect(uploadedUrl).not.toMatch(/\/catalog\//)

    const attachRes = await attachPromise
    expect(attachRes.ok(), `Attach image failed: HTTP ${attachRes.status()}`).toBe(true)
    const attachBody = await attachRes.json().catch(() => null)
    test.info().annotations.push({
      type: 'cloudinary-upload-response',
      description: JSON.stringify({ uploads: uploadsBody, attach: attachBody }).slice(0, 800),
    })

    const slug = await page.getByLabel(/slug/i).inputValue()

    await expect(
      page.locator('#admin-main-content img[src*="cloudinary"]').first(),
    ).toBeVisible({ timeout: 15_000 })

    const productApiRes = await request.get(`/api/v1/products/${slug}`)
    let publicUrl: string | undefined
    if (productApiRes.ok()) {
      const body = await productApiRes.json()
      publicUrl = body?.data?.images?.[0]?.url
    }

    if (!publicUrl) {
      publicUrl = uploadedUrl
    }
    expect(publicUrl, 'No image URL found after upload').toBeTruthy()
    expect(publicUrl).not.toMatch(/\/catalog\//)

    const imgCheck = await request.get(publicUrl!.startsWith('http') ? publicUrl! : `http://127.0.0.1:4173${publicUrl}`)
    expect(imgCheck.ok(), `Uploaded image is not publicly reachable at ${publicUrl}`).toBe(true)

    const storefront = await page.goto(`/products/${slug}`)
    expect(storefront?.status()).toBeLessThan(400)
    await expect(page.locator(`img[src="${publicUrl}"], img[src*="cloudinary"]`).first()).toBeVisible({
      timeout: 15_000,
    })

    test.info().annotations.push({
      type: 'CLEANUP-NEEDED',
      description: `Test product created: id=${productId}, name="${TEST_PRODUCT_NAME}" — delete via admin after review.`,
    })
  })

  test('logout ends the admin session', async ({ page }) => {
    await page.goto('/admin')
    const logoutButton = page.getByRole('button', { name: /log out|sign out/i })
    await logoutButton.click()
    await page.waitForURL((url) => url.pathname === '/' || url.pathname.includes('/login'), {
      timeout: 10_000,
    })
    await page.goto('/admin')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })
})
