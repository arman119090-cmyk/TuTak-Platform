import { expect, test } from '@playwright/test';
import {
  ADMIN,
  ADMIN_STATE,
  PARTNER,
  PARTNER_STATE,
  PHONES,
  api,
  apiLogin,
  expectLedgerBalanced,
  unique,
} from './helpers';

/**
 * The loop the whole product exists for: a merchant raises an invoice, a
 * customer pays it, and points appear.
 *
 * Was written against the old flat-rate QR flow: the merchant typed an
 * amount into the QR screen and generated a one-time invoice; the customer
 * "scanned" it by calling the redeem endpoint with the resulting token.
 * `docs/NEXT_CLAUDE_TASK.md` replaced that with the PurchaseIntent flow the
 * rest of this suite already assumes (`money-movement.e2e.ts`'s payments,
 * `docs/LAUNCH_READINESS_2026-08-16.md` §C): the partner's QR is now a
 * static, amount-free `TUTAK-PAY:<partnerId>` code, the customer enters the
 * amount themselves and creates the `PurchaseIntent`, and the partner's
 * dashboard confirms it — see `apps/partner/.../qr/page.tsx` (no more
 * amount input) and `apps/partner/.../purchase-intents/page.tsx` (the new
 * confirm queue). This test now exercises that flow instead: the merchant
 * half moved from "generate the QR" to "confirm the request," and the
 * customer half stays on the API for the same reason as before — scanning
 * is a camera on a phone with no browser equivalent to drive, and creating
 * a PurchaseIntent is the same endpoint the app calls once it has resolved
 * the scanned code to a partner id.
 */
test.describe('QR payment loop', () => {
  // Signed in once, in auth.setup.ts. Re-authenticating per test would spend
  // the login rate limit on setup rather than on what is under test.
  test.use({ storageState: PARTNER_STATE });

  test('a merchant invoice paid by a customer accrues points and balances the ledger', async ({
    page,
  }) => {
    const adminToken = await apiLogin(PHONES.admin, 'admin');
    const customerToken = await apiLogin(PHONES.customer, 'customer');

    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const before = await api<{ availableBonus: string; lifetimeEarned: string }>(
      customerToken,
      '/wallet/me',
    );

    // ── The customer, through the API the app calls ──────────────────────
    // Scanning the partner's static code and typing the amount both happen
    // on the phone; this is the same POST /purchase-intents call the app
    // makes once it has resolved TUTAK-PAY:<partnerId>.
    const intent = await api<{ id: string }>(customerToken, '/purchase-intents', {
      method: 'POST',
      body: { partnerId: cafe.id, grossAmount: '7000' },
    });

    // ── The merchant, in the browser ─────────────────────────────────────
    await page.goto(`${PARTNER}/purchase-intents`);
    const row = page.locator('tr', { hasText: intent.id.slice(-8).toUpperCase() });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: /^confirm$/i }).click();
    // Confirmed rows drop out of the AWAITING_CONFIRMATION queue this page
    // filters on.
    await expect(row).toBeHidden({ timeout: 20_000 });

    // ── What the customer sees afterwards ────────────────────────────────
    const after = await api<{ availableBonus: string; lifetimeEarned: string }>(
      customerToken,
      '/wallet/me',
    );
    // Cafe Yerevan accrues at 5%, so the contribution pool is 350 — but the
    // customer's immediate GREEN share is only 20% of that pool (spec
    // §12-14), not the whole thing.
    expect(Number(after.lifetimeEarned) - Number(before.lifetimeEarned)).toBeCloseTo(70, 4);

    // ── What the merchant sees afterwards ────────────────────────────────
    await page.goto(`${PARTNER}/transactions`);
    // The dashboard groups with a narrow space, not a comma.
    await expect(page.getByText('7 000 ֏', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });

    await expectLedgerBalanced(adminToken);
  });

  test('the same invoice cannot be redeemed twice', async () => {
    const ownerToken = await apiLogin(PHONES.partnerOwner, 'owner');
    const customerToken = await apiLogin(PHONES.scannerA, 'scanner-a');
    const customer2Token = await apiLogin(PHONES.scannerB, 'scanner-b');
    const adminToken = await apiLogin(PHONES.admin, 'admin');

    const partners = await api<Array<{ id: string; displayName: string }>>(
      adminToken,
      '/partners',
    );
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const qr = await api<{ token: string }>(ownerToken, '/qr/issue', {
      method: 'POST',
      body: { type: 'DYNAMIC_INVOICE', partnerId: cafe.id, amount: '1500', expiresInSeconds: 900 },
    });

    await api(customerToken, '/qr/redeem', {
      method: 'POST',
      body: { token: qr.token, idempotencyKey: unique('e2e-first') },
    });

    // A second customer scanning a photograph of the same code must be
    // refused — the invoice was for one payment.
    await expect(
      api(customer2Token, '/qr/redeem', {
        method: 'POST',
        body: { token: qr.token, idempotencyKey: unique('e2e-second') },
      }),
    ).rejects.toThrow(/already redeemed|not active/i);

    await expectLedgerBalanced(adminToken);
  });

  test('a retried redemption replays the first result instead of charging again', async () => {
    const ownerToken = await apiLogin(PHONES.partnerOwner, 'owner');
    const customerToken = await apiLogin(PHONES.replayCustomer, 'replay');
    const adminToken = await apiLogin(PHONES.admin, 'admin');

    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const qr = await api<{ token: string }>(ownerToken, '/qr/issue', {
      method: 'POST',
      body: { type: 'DYNAMIC_INVOICE', partnerId: cafe.id, amount: '2200', expiresInSeconds: 900 },
    });

    const key = unique('e2e-replay');
    const first = await api<{ transactionId: string }>(customerToken, '/qr/redeem', {
      method: 'POST',
      body: { token: qr.token, idempotencyKey: key },
    });
    // The dropped-response case: the phone lost the reply and sent it again.
    const replay = await api<{ transactionId: string }>(customerToken, '/qr/redeem', {
      method: 'POST',
      body: { token: qr.token, idempotencyKey: key },
    });

    expect(replay.transactionId).toBe(first.transactionId);
    await expectLedgerBalanced(adminToken);
  });
});

test.describe('admin visibility', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the ledger screen reports every account in sync', async ({ page }) => {
    await page.goto(`${ADMIN}/ledger`);

    const firstAccount = page.locator('table tbody tr button').first();
    await expect(firstAccount).toBeVisible({ timeout: 20_000 });
    await firstAccount.click();

    // The badge is the one thing on this screen worth alarming on: the
    // cached balance disagreeing with the postings behind it.
    await expect(page.getByText('in sync')).toBeVisible({ timeout: 20_000 });
  });
});
