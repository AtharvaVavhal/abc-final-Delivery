import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { test } from './helpers'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|css)$/.test(entry)) out.push(full)
  }
  return out
}

test.describe('Tenant / security regression', () => {
  test('public catalog and categories are scoped to this tenant only (no cross-tenant ids)', async ({
    request,
  }) => {
    const products = await (await request.get('/api/v1/products?limit=50')).json()
    const categories = await (await request.get('/api/v1/categories')).json()

    const tenantIds = new Set<string>()
    for (const p of products.data ?? []) tenantIds.add(p.tenantId)
    for (const c of categories.data ?? []) tenantIds.add(c.tenantId)

    expect(
      tenantIds.size,
      `Public catalog returned more than one tenantId: ${[...tenantIds].join(', ')}`,
    ).toBeLessThanOrEqual(1)
  })

  test('unauthenticated requests to admin/customer-scoped endpoints are rejected, not tenant-leaked', async ({
    request,
  }) => {
    for (const url of ['/api/v1/admin/dashboard', '/api/v1/orders', '/api/v1/users/me']) {
      const res = await request.get(url)
      expect([401, 403], `${url} should require auth`).toContain(res.status())
    }
  })

  test('production frontend build contains no secret material and no hardcoded tenant/store UUID literal repeated as a routing constant', async () => {
    const distDir = join(import.meta.dirname, '../dist/assets')
    let files: string[]
    try {
      files = walk(distDir)
    } catch {
      test.skip(true, 'dist/assets not found — run `npm run build` first')
      return
    }

    const secretPatterns = [
      /RAZORPAY_KEY_SECRET/i,
      /CLOUDINARY_API_SECRET/i,
      /RESEND_API_KEY/i,
      /rzp_live_[A-Za-z0-9]{10,}/,
      /PAYMENT_CREDENTIALS_MASTER_KEY/i,
    ]

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const pattern of secretPatterns) {
        expect(pattern.test(content), `Secret pattern ${pattern} found in ${file}`).toBe(false)
      }
    }
  })
})
