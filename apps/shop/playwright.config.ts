import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E configuration.
 *
 * The suite runs the demo the way it is demonstrated: one desktop project and
 * one real phone viewport, against a server this config starts if one is not
 * already running.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },
  projects: [
    // The phone-only specs belong to the mobile project, not to both.
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    {
      name: 'mobile',
      // iPhone 13 viewport and touch emulation, driven by Chromium so the suite
      // needs a single browser download instead of WebKit as well.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    // The suite signs in many times from one address; the production rate
    // limit would (correctly) start rejecting it, so the test server raises it.
    env: { AUTH_RATE_LIMIT_MAX: '500' },
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
