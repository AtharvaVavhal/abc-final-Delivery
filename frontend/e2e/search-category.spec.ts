import { expect } from '@playwright/test'
import { test } from './helpers'

test.describe('Search & category browsing', () => {
  test('navbar search returns relevant results and works after a hard refresh', async ({
    page,
  }) => {
    await page.goto('/products')
    const productCard = page.locator('a[href^="/products/"]').first()
    await expect(productCard).toBeVisible({ timeout: 15_000 })
    let name = (await productCard.innerText()).trim()
    if (!name) {
      await productCard.click()
      await page.waitForURL(/\/products\/[^/?]+$/)
      name = (await page.locator('h1').first().innerText()).trim()
      await page.goto('/products')
    }
    test.skip(!name, 'No products in catalog to search for')
    const term = name.split(/\s+/).find((part) => /[A-Za-z]{3,}/.test(part)) ?? name.split(/\s+/)[0]

    await page.goto('/')
    const searchIcon = page.getByRole('button', { name: /search/i }).first()
    if (await searchIcon.count()) await searchIcon.click()
    const searchInput = page.getByRole('searchbox').or(page.locator('input[name="query"]')).first()
    await searchInput.fill(term)
    await searchInput.press('Enter')

    await page.waitForURL(/\/products\?.*search=/)
    await expect(page.locator('body')).toContainText(new RegExp(term, 'i'))

    // Direct URL + refresh
    const url = page.url()
    await page.goto(url)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page).toHaveURL(url)
  })

  test('search with no matches shows an empty state, not a crash', async ({ page }) => {
    await page.goto('/products?search=zzzznomatchxyz999')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/no.*(products|results)|nothing found/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('category navigation via URL works directly and after refresh, results stay within that category', async ({
    page,
    request,
  }) => {
    const catRes = await request.get('/api/v1/categories')
    const categories = (await catRes.json())?.data ?? []
    const leaf = categories.find((c: { parentCategoryId: string | null }) => c.parentCategoryId !== null)
    test.skip(!leaf, 'No leaf category found to test')

    await page.goto(`/products?categoryId=${leaf.id}`)
    await page.waitForLoadState('networkidle')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page).toHaveURL(new RegExp(leaf.id))

    const productsInCategory = await request.get(`/api/v1/products?categoryId=${leaf.id}`)
    const body = await productsInCategory.json()
    for (const p of body.data ?? []) {
      expect(p.categoryId).toBe(leaf.id)
    }
  })
})
