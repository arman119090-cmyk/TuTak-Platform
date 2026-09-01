import { test as base } from '@playwright/test';

/**
 * A signed-in session that survives being handed from one test to the next.
 *
 * The dashboards keep no credential in storage any more: the access token
 * lives in memory and dies with the tab, and all `storageState` can carry
 * between tests is the httpOnly refresh cookie. Every test therefore starts by
 * having the app exchange that cookie for a fresh session.
 *
 * That exchange rotates the cookie and, on a second use of the old one,
 * `AuthService.refresh` treats it as a stolen token and revokes the whole
 * device family — which is the control working. Replaying one saved cookie
 * across a suite is exactly the pattern it exists to stop, and a suite that
 * does it does not get "a slightly stale session": it gets every later test
 * bounced to /login, including the ones that had nothing to do with the
 * replay.
 *
 * So the state file rolls forward. Each test writes back the cookie its own
 * refresh produced, and the next test presents that one. Order is not a
 * problem to design around here — `playwright.config.ts` runs this suite on a
 * single worker, in series, because the money it moves is shared.
 */
export const test = base.extend<{ rollingSession: void }>({
  rollingSession: [
    async ({ context, storageState }, use) => {
      await use();
      // `test.use({ storageState })` is a path in this suite; a test that sets
      // no session has nothing to roll forward.
      if (typeof storageState === 'string') {
        await context.storageState({ path: storageState });
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
