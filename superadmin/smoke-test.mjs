import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { chromium } = require('playwright')
const { expect } = require('@playwright/test')
const server = createServer(async (request, response) => {
  const path = request.url === '/' ? 'index.html' : request.url.slice(1)
  if (!['index.html', 'app.js', 'styles.css', 'robots.txt'].includes(path)) {
    response.writeHead(404).end(); return
  }
  response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
  response.end(await readFile(new URL(`./public/${path}`, import.meta.url)))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage()
  await page.clock.install()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let authorized = false
  let loggedIn = false
  let expiryOnce = false
  let tenantFailure = false
  let refreshCount = 0
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let status = 200
    let body = { success: true, data: null }
    const session = { accessToken: 'test-token', user: { email: 'operator@example.test', role: 'ADMIN' } }
    if (url.pathname.endsWith('/auth/login')) {
      loggedIn = true; body.data = session
    } else if (url.pathname.endsWith('/auth/refresh')) {
      refreshCount += 1
      status = loggedIn ? 200 : 401; body.data = session
    } else if (url.pathname.endsWith('/auth/logout')) {
      loggedIn = false
    } else if (url.pathname.endsWith('/platform/tenants')) {
      assert.equal(route.request().headers().authorization, 'Bearer test-token')
      if (!authorized) status = 403
      else if (expiryOnce) { status = 401; expiryOnce = false }
      else if (tenantFailure) status = 503
      else {
        const currentPage = Number(url.searchParams.get('page'))
        body = { success: true, data: [{ slug: currentPage === 1 ? '<img src=x onerror=alert(1)>' : 'second-tenant', status: 'ACTIVE', storeCount: 2, createdAt: '2026-11-20T00:00:00Z' }], meta: { page: currentPage, totalPages: 2, total: 21, limit: 20 } }
      }
    } else { throw new Error(`Unexpected request: ${url.pathname}`) }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await expect(page.locator('#login-panel')).toBeVisible()
  await expect(page.locator('#console')).toBeHidden()
  const signIn = async () => {
    await page.locator('#email').fill('operator@example.test')
    await page.locator('#password').fill('test-password')
    await page.locator('#login-button').click()
  }
  await signIn()
  await expect(page.locator('#login-error')).toHaveText('This account does not have platform superadmin access.')
  await expect(page.locator('#console')).toBeHidden()
  assert.equal(loggedIn, false)
  authorized = true
  await signIn()
  await expect(page.locator('#console')).toBeVisible()
  await expect(page.locator('#tenants')).toContainText('<img src=x onerror=alert(1)>')
  assert.equal(await page.locator('#tenants img').count(), 0)
  await page.locator('#next').click()
  await expect(page.locator('#tenants')).toContainText('second-tenant')
  await expect(page.locator('#page-label')).toHaveText('Page 2 of 2')
  await expect(page.locator('#next')).toBeDisabled()
  const beforeRefresh = refreshCount
  expiryOnce = true
  await page.locator('#reload').click()
  await expect(page.locator('#reload')).toBeEnabled()
  assert.equal(refreshCount, beforeRefresh + 1)
  tenantFailure = true
  await page.locator('#reload').click()
  await expect(page.locator('#data-error')).toBeVisible()
  tenantFailure = false
  await page.reload()
  await expect(page.locator('#console')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.locator('#logout').click()
  await expect(page.locator('#login-panel')).toBeVisible()
  await expect(page.locator('#tenants')).toBeEmpty()
  await page.reload()
  await expect(page.locator('#login-panel')).toBeVisible()
  await signIn()
  await expect(page.locator('#console')).toBeVisible()
  await page.clock.fastForward(16 * 60 * 1000)
  await expect(page.locator('#login-error')).toHaveText('Signed out after 15 minutes of inactivity.')
  assert.deepEqual(errors, [])
  console.log('PASS: signed-out gate, merchant denial, authorized tenants, escaped content, pagination, refresh/reload, API failure, mobile width, logout, idle expiry.')
  if (process.argv.includes('--live')) {
    const live = await browser.newPage()
    const liveErrors = []
    live.on('pageerror', (error) => liveErrors.push(error.message))
    const liveOrigin = process.argv.includes('--custom-domain')
      ? 'https://superadmin.abcmanufactures.com'
      : 'https://abc-superadmin-one.vercel.app'
    const response = await live.goto(liveOrigin)
    assert.equal(response.status(), 200)
    assert.match(response.headers()['x-robots-tag'], /noindex/)
    assert.equal(response.headers()['cache-control'], 'no-store')
    await expect(live.locator('#login-panel')).toBeVisible()
    await expect(live.locator('#console')).toBeHidden()
    const denied = await live.request.get(`${liveOrigin}/api/v1/platform/tenants`)
    assert.equal(denied.status(), 401)
    assert.equal((await denied.json()).error.code, 'UNAUTHORIZED')
    assert.deepEqual(liveErrors, [])
    await live.screenshot({ path: '/tmp/abc-superadmin-live.png', fullPage: true })
    console.log('PASS: live HTTPS page, JavaScript boot, noindex/no-store, same-origin proxy, unauthenticated API denial.')
  }
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
