import { defineConfig } from '@playwright/test'

/** Isolated UI contract tests: all API calls intercepted; no live account writes. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'otp-login.spec.ts',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5180', channel: 'chrome', headless: true },
})
