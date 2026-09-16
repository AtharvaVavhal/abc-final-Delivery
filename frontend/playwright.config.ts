import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config for the AB Creations production-readiness browser test pass.
 * Targets the already-running production preview (vite preview, port 4173)
 * proxying to the already-running backend (port 4000) against the real
 * delivery database — see e2e/README for why no webServer block starts
 * new servers here.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'Desktop-1920',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
})
