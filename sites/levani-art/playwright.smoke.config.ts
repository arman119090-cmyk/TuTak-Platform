import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of the PUBLIC deployment (not localhost):
 *   SMOKE_URL=https://levani-art.onrender.com npx playwright test -c playwright.smoke.config.ts
 * Run by .github/workflows/levani-art-smoke.yml after each deploy.
 */
export default defineConfig({
  testDir: 'tests/smoke',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: process.env.SMOKE_URL ?? 'https://levani-art.onrender.com' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
