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
 * The merchant half runs through the real dashboard, because the QR screen
 * is what a cashier actually uses. The customer half runs through the API,
 * because scanning is a camera on a phone and there is no browser equivalent
 * to drive — but it is the same endpoint the app calls, with the same token.
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

    const before = await api<{ availableBonus: string; lifetimeEarned: string }>(
      customerToken,
      '/wallet/me',
    );

    // ── The merchant, in the browser ─────────────────────────────────────
    await page.goto(`${PARTNER}/qr`);

    await page.locator('form input').first().fill('7000');
    await page.getByRole('button', { name: /generate qr/i }).click();

    // The token is what the customer's camera would read. It is rendered on
    // the page once the invoice exists.
    const tokenText = page.locator('[data-testid="qr-token"]');
    await expect(tokenText).toBeVisible({ timeout: 20_000 });
    const token = (await tokenText.innerText()).trim();
    expect(token.length).toBeGreaterThan(10);

    // ── The customer, through the API the app calls ──────────────────────
    const redemption = await api<{
      transactionId: string;
      amountCharged: string;
      bonusEarned: string;
    }>(customerToken, '/qr/redeem', {
      method: 'POST',
      body: { token, idempotencyKey: unique('e2e-qr') },
    });

    expect(redemption.amountCharged).toBe('7000');
    // Cafe Yerevan accrues at 5%.
    expect(Number(redemption.bonusEarned)).toBeCloseTo(350, 4);

    // ── What the customer sees afterwards ────────────────────────────────
    const after = await api<{ availableBonus: string; lifetimeEarned: string }>(
      customerToken,
      '/wallet/me',
    );
    expect(Number(after.lifetimeEarned) - Number(before.lifetimeEarned)).toBeCloseTo(350, 4);

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
