import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test as setup } from '@playwright/test';
import {
  ADMIN,
  ADMIN_STATE,
  LoginFailed,
  PARTNER,
  PARTNER_STATE,
  PASSWORD,
  PHONES,
  TOKENS_FILE,
  apiLogin,
  login,
} from './helpers';

/**
 * Signs in once, for the whole run.
 *
 * `/auth/login` allows five attempts a minute from one address, which is the
 * right limit for a route whose failure mode is someone guessing an
 * operator's password — and far too tight for a suite that logs in per test.
 * The first version of these tests tripped it and then reported eight
 * failures that were all the same 429.
 *
 * So the form login happens here, twice, and every later test reuses the
 * resulting browser state. The token each form login produced is returned by
 * the helper and written straight to TOKENS_FILE for the API-side assertions,
 * which means the admin and partner never authenticate a second time by any
 * route.
 *
 * That token is not read back out of the browser. The dashboards keep the
 * access token in memory and the refresh token in an httpOnly cookie, so there
 * is nothing in `localStorage` to read — and the earlier version of this file,
 * which went looking for `tutak-admin-auth` there, was asserting a storage
 * model the apps had deliberately abandoned. `storageState` still carries the
 * session onward, through the cookie.
 */

// Long, because a collision with the login rate limit is waited out here
// rather than failing every spec behind it.
setup.setTimeout(180_000);

/**
 * Waits out the login rate limit, the same way apiLogin does. A run started
 * less than a minute after the last one lands here.
 *
 * Only a 429 is waited on. Anything else — a wrong password, an API that
 * refuses, a dashboard that will not leave its login page — is not going to
 * become true by being asked four more times; retrying it only spent another
 * three minutes and three of the five attempts the limit allows, and then
 * reported the last failure instead of the first.
 */
async function loginWaiting(open: () => Promise<string>): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await open();
    } catch (err) {
      const throttled = err instanceof LoginFailed && err.status === 429;
      if (!throttled || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

setup('sign in to both dashboards', async ({ browser }) => {
  mkdirSync(dirname(ADMIN_STATE), { recursive: true });
  // A token left by an earlier run may already have expired; every run mints
  // its own rather than inheriting one it cannot check.
  rmSync(TOKENS_FILE, { force: true });

  const adminPage = await browser.newPage();
  const adminToken = await loginWaiting(() => login(adminPage, ADMIN, PHONES.admin));
  // Proof the session is real and not merely a redirect: a permission-gated
  // screen renders.
  await adminPage.goto(`${ADMIN}/ledger`);
  await expect(adminPage.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await adminPage.context().storageState({ path: ADMIN_STATE });
  await adminPage.close();

  const partnerPage = await browser.newPage();
  const partnerToken = await loginWaiting(() =>
    login(partnerPage, PARTNER, PHONES.partnerOwner),
  );
  await partnerPage.goto(`${PARTNER}/earnings`);
  await expect(partnerPage.getByText(/available to pay out/i)).toBeVisible({ timeout: 20_000 });
  await partnerPage.context().storageState({ path: PARTNER_STATE });
  await partnerPage.close();

  // Every remaining account authenticates here too, so that no spec ever
  // reaches /auth/login itself. Sequential on purpose: five at once would
  // burn the whole per-minute allowance in one burst and then wait anyway.
  const customers: Record<string, string> = {};
  for (const phone of [
    PHONES.customer,
    PHONES.scannerA,
    PHONES.scannerB,
    PHONES.refundCustomer,
    PHONES.replayCustomer,
  ]) {
    customers[phone] = await apiLogin(phone, phone.slice(-4));
  }

  // The payout approver never drives a browser — it only ever confirms
  // transfers over the API — so a plain API login is all it needs.
  const approverToken = await apiLogin(PHONES.approver, PASSWORD);

  writeFileSync(
    TOKENS_FILE,
    JSON.stringify({
      // Returned by the form login rather than fetched again: that login
      // already produced a token for each of these.
      [PHONES.admin]: adminToken,
      [PHONES.partnerOwner]: partnerToken,
      [PHONES.approver]: approverToken,
      ...customers,
    }),
  );
});
