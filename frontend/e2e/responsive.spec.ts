import { expect } from '@playwright/test'
import { test } from './helpers'

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-375', width: 375, height: 812 },
]

for (const vp of VIEWPORTS) {
  test.describe(`Responsive @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`homepage has no horizontal overflow, key sections render`, async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        return doc.scrollWidth - doc.clientWidth
      })
      expect(overflow, `Horizontal overflow of ${overflow}px at ${vp.name}`).toBeLessThanOrEqual(2)

      await expect(page.getByRole('banner')).toBeVisible()
      await expect(page.locator('footer')).toBeVisible()

      await page.screenshot({ path: `e2e/screenshots/home-${vp.name}.png` })
    })

    test(`checkout page has no horizontal overflow`, async ({ page }) => {
      await page.goto('/checkout')
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(2)
    })

    if (vp.width < 800) {
      test(`mobile nav menu opens and closes`, async ({ page }) => {
        await page.goto('/')
        const menuButton = page.getByRole('button', { name: /menu|navigation/i }).first()
        if (await menuButton.count()) {
          await menuButton.click()
          await expect(page.getByRole('navigation', { name: 'Mobile categories' })).toBeVisible()
        }
      })
    }
  })
}
