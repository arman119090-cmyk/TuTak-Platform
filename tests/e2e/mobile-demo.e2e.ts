import { expect, test } from '@playwright/test';

/**
 * The mobile app itself, built and run against a live API.
 *
 * Everything else that tests the mobile app tests its source: Jest, with the
 * network mocked, asserting that a component does the right thing when handed
 * the response the test author believed the server sends. That belief is the
 * part nothing checked. `isDemoDeployment` read `data.demoMode` from a body
 * shaped `{ data: { demoMode: true }, timestamp }` — the envelope every
 * endpoint in this API uses — so it answered `false` against a perfectly
 * healthy demo server and the sign-in button it gates never appeared
 * anywhere. The HTTP call succeeded, so nothing threw, nothing logged, and no
 * test failed.
 *
 * This spec bundles the app the way a release bundles it and drives the
 * result in a browser. It is deliberately about the seam rather than the
 * screens: does the built client reach the server, read what the server
 * actually said, and get someone into the app.
 *
 * ## What this does not cover
 *
 * react-native-web is not Android. Shared: the screens, navigation, stores,
 * the API client, response handling, i18n. Not shared: every native module,
 * the keyboard, the safe area, the Keystore. A green run here says the app's
 * own logic works against a real server. It says nothing about how the APK
 * behaves in a hand, and it is not a substitute for installing one.
 *
 * ## Running it
 *
 *   scripts/mobile-web-serve.sh http://localhost:4000/v1 8099   # one shell
 *   MOBILE_WEB_URL=http://localhost:8099 pnpm e2e               # another
 *
 * The API needs `DEMO_MODE=true`, the demo seed, and `http://localhost:8099`
 * in `CORS_ORIGINS`. Without `MOBILE_WEB_URL` the spec skips rather than
 * fails: the rest of the suite needs no bundler, and a hard failure here
 * would make every local `pnpm e2e` red for a missing fixture.
 */
const MOBILE_WEB_URL = process.env.MOBILE_WEB_URL;

// A phone, because the app is one. The layout is not what is under test, but
// driving a mobile app in a 1280-wide window tests a rendering path nobody
// ships.
test.use({ viewport: { width: 390, height: 780 } });

test.describe('the mobile app against a live API', () => {
  test.skip(!MOBILE_WEB_URL, 'set MOBILE_WEB_URL — see scripts/mobile-web-serve.sh');

  test('offers demo sign-in, signs in, and shows the demo customer real data', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`${error.name}: ${error.message}`));

    // Which calls the built client makes, and to where. The version prefix is
    // part of what regressed once: health is version-neutral and lives beside
    // the versioned API, not under it.
    const calls: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/\/(health|v\d\/)/.test(url) && !url.startsWith(MOBILE_WEB_URL!)) {
        calls.push(`${request.method()} ${url}`);
      }
    });

    await page.goto(MOBILE_WEB_URL!, { waitUntil: 'networkidle' });

    // Three locales ship and the browser picks one; the button is the same
    // button whichever it picked.
    const demoButton = page.getByText(/Enter the demo|Войти в демо|Դիտել դեմո/);
    await expect(demoButton, 'the demo entry never appeared — the app asked the server and either could not reach it or misread the answer').toBeVisible({ timeout: 30_000 });

    // The button is the visible half. The invisible half is that it was
    // decided by the server rather than by the build, which is what makes the
    // same APK safe to point at production.
    expect(calls.some((call) => call.endsWith('/health'))).toBe(true);
    expect(calls.some((call) => /\/v\d\/health$/.test(call))).toBe(false);

    await demoButton.click();

    // Signed in when the login screen is gone. Asserting on a home-screen
    // string instead would tie this spec to whatever that screen says this
    // month.
    await expect(demoButton).toBeHidden({ timeout: 30_000 });

    // A session that only exists in memory is not a session. The app writes
    // its tokens through the storage adapter, which is localStorage in a
    // browser and the Keystore on a phone; either way, nothing is stored if
    // the sign-in did not really complete.
    const stored = await page.evaluate(() => ({
      access: localStorage.getItem('tutak.accessToken'),
      user: localStorage.getItem('tutak.user'),
    }));
    expect(stored.access, 'signed in without keeping a token').toBeTruthy();
    expect(stored.user).toContain('+37477100001');

    // The seeded demo customer has a wallet, so the home screen has to be
    // showing the server's numbers rather than an empty shell. A zero balance
    // here means the app signed in and then failed to read anything.
    await expect(page.getByText(/\d/).first()).toBeVisible({ timeout: 30_000 });
    expect(calls.some((call) => call.includes('/auth/demo-session'))).toBe(true);
    expect(calls.some((call) => call.includes('/wallet/me'))).toBe(true);

    // A release build has no console anybody reads, so an uncaught error here
    // is exactly the kind of thing that reaches me as "it glitches".
    expect(failures, `the app threw:\n${failures.join('\n')}`).toHaveLength(0);
  });
});
