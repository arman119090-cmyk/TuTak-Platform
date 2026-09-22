import { expect, test } from './fixtures';
import {
  ADMIN,
  ADMIN_STATE,
  PARTNER,
  PARTNER_STATE,
  PHONES,
  api,
  apiLogin,
  expectLedgerBalanced,
} from './helpers';

/**
 * The loop the whole product exists for: a merchant raises an invoice, a
 * customer pays it, and points appear.
 *
 * Was written against the old flat-rate QR flow: the merchant typed an
 * amount into the QR screen and generated a one-time invoice; the customer
 * "scanned" it by calling the redeem endpoint with the resulting token.
 * `docs/REFERRAL_3_LEVEL_REWORK_2026-08-22.md` replaced that with the PurchaseIntent flow the
 * rest of this suite already assumes (`money-movement.e2e.ts`'s payments,
 * `docs/LAUNCH_READINESS_2026-08-16.md` §C): the QR carries no amount, the
 * customer enters it themselves and creates the `PurchaseIntent`, and the
 * partner's dashboard confirms it — see `apps/partner/.../qr/page.tsx` (no
 * more amount input) and `apps/partner/.../purchase-intents/page.tsx` (the
 * confirm queue).
 *
 * The customer half stays on the API because scanning is a camera on a
 * phone with no browser equivalent to drive — but it now scans what the
 * phone actually scans. Cafe Yerevan has two branches, and a purchase at a
 * partner with branches must name the one it happened at, so these tests
 * used to create an intent belonging to neither: invisible in every
 * branch-scoped queue, confirmable by a cashier from the other branch, and
 * counted in no branch's takings. `resolveBranchQr` below is the same
 * `GET /partner-branch-qr/resolve/:token` call the app makes after reading
 * a `TUTAK-BRANCH:<token>` code off the table, and it is the only thing
 * that turns an opaque token into a partner and a branch.
 */
test.describe('QR payment loop', () => {
  // Signed in once, in auth.setup.ts. Re-authenticating per test would spend
  // the login rate limit on setup rather than on what is under test.
  test.use({ storageState: PARTNER_STATE });

  /**
   * What the phone gets back from scanning the code on the table.
   *
   * The owner reads their own branch's active QR — the same screen that
   * prints it — and the token is then resolved through the public endpoint
   * the customer's app calls. Nothing here trusts an id the test chose: the
   * partner and branch both come back from the server, which is the whole
   * point of the token being opaque.
   */
  const scanBranchCode = async (ownerToken: string, partnerId: string) => {
    const branches = await api<Array<{ id: string; name: string; isActive: boolean }>>(
      ownerToken,
      `/partners/${partnerId}/branches`,
    );
    const branch = branches.find((b) => b.isActive)!;
    const qr = await api<{ token: string }>(
      ownerToken,
      `/partners/${partnerId}/branches/${branch.id}/qr`,
    );
    return api<{ partnerId: string; partnerBranchId: string }>(
      ownerToken,
      `/partner-branch-qr/resolve/${qr.token}`,
    );
  };

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
    // Scanning the code on the table and typing the amount both happen on
    // the phone; this is the same resolve-then-create pair the app makes.
    const ownerToken = await apiLogin(PHONES.partnerOwner, 'owner');
    const scanned = await scanBranchCode(ownerToken, cafe.id);
    const intent = await api<{ id: string }>(customerToken, '/purchase-intents', {
      method: 'POST',
      body: {
        partnerId: scanned.partnerId,
        partnerBranchId: scanned.partnerBranchId,
        grossAmount: '7000',
      },
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

  // These two used to drive the legacy /qr/issue + /qr/redeem endpoints
  // directly — the same "invoice token" mechanism the top comment describes
  // moving away from. `QrPaymentsController.redeem()` now unconditionally
  // refuses to settle a purchase (see GitHub issue #28); the guarantees
  // these tests exist to prove — no double payout, a retry replays rather
  // than re-settles — now live entirely in `PurchaseIntentsService.confirm`,
  // so both are rewritten against that endpoint instead.
  test('confirming the same purchase intent twice does not double-credit the customer', async () => {
    const ownerToken = await apiLogin(PHONES.partnerOwner, 'owner');
    const customerToken = await apiLogin(PHONES.scannerA, 'scanner-a');
    const adminToken = await apiLogin(PHONES.admin, 'admin');

    const partners = await api<Array<{ id: string; displayName: string }>>(
      adminToken,
      '/partners',
    );
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const before = await api<{ lifetimeEarned: string }>(customerToken, '/wallet/me');

    const scanned = await scanBranchCode(ownerToken, cafe.id);
    const intent = await api<{ id: string }>(customerToken, '/purchase-intents', {
      method: 'POST',
      body: {
        partnerId: scanned.partnerId,
        partnerBranchId: scanned.partnerBranchId,
        grossAmount: '1500',
      },
    });

    await api(ownerToken, `/purchase-intents/${intent.id}/confirm`, { method: 'POST' });

    // A second confirmation of the same intent — a double-tap on the
    // dashboard, or a network retry — must not pay the customer again.
    await api(ownerToken, `/purchase-intents/${intent.id}/confirm`, { method: 'POST' });

    const after = await api<{ lifetimeEarned: string }>(customerToken, '/wallet/me');
    // Cafe Yerevan accrues at 5%, so the pool is 75 — but the customer's
    // immediate GREEN share is only 20% of that pool (spec §12-14), once.
    expect(Number(after.lifetimeEarned) - Number(before.lifetimeEarned)).toBeCloseTo(15, 4);

    await expectLedgerBalanced(adminToken);
  });

  test('a retried confirmation replays the first result instead of re-settling', async () => {
    const ownerToken = await apiLogin(PHONES.partnerOwner, 'owner');
    const customerToken = await apiLogin(PHONES.replayCustomer, 'replay');
    const adminToken = await apiLogin(PHONES.admin, 'admin');

    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const scanned = await scanBranchCode(ownerToken, cafe.id);
    const intent = await api<{ id: string }>(customerToken, '/purchase-intents', {
      method: 'POST',
      body: {
        partnerId: scanned.partnerId,
        partnerBranchId: scanned.partnerBranchId,
        grossAmount: '2200',
      },
    });

    const first = await api<{ status: string; confirmedAt: string }>(
      ownerToken,
      `/purchase-intents/${intent.id}/confirm`,
      { method: 'POST' },
    );
    // The dropped-response case: the dashboard lost the reply and the
    // browser sent the same confirmation again.
    const replay = await api<{ status: string; confirmedAt: string }>(
      ownerToken,
      `/purchase-intents/${intent.id}/confirm`,
      { method: 'POST' },
    );

    expect(replay.status).toBe('CONFIRMED');
    expect(replay.confirmedAt).toBe(first.confirmedAt);
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
