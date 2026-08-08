import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack.
 *
 * These do not start anything. They expect the demo stack to be up and
 * seeded — `./scripts/demo-up.sh`, or the equivalent CI job — because the
 * thing under test is the real system talking to a real database, and a test
 * harness that boots its own faster, emptier version of it would be testing
 * something else.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  // Money flows through a shared database; two specs refunding the same
  // payment would fight. Serial is the honest choice here, and the suite is
  // small enough that it costs a minute rather than an afternoon.
  fullyParallel: false,
  workers: 1,
  // A failure here means a real regression, so let it fail rather than
  // retrying until it passes. On CI one retry absorbs genuine flake from a
  // cold container without hiding a broken flow.
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'e2e',
      dependencies: ['setup'],
      testMatch: '**/*.e2e.ts',
    },
  ],
  use: {
    baseURL: process.env.ADMIN_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      // The container ships Chromium at a fixed path; `playwright install`
      // is not available here.
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
});
