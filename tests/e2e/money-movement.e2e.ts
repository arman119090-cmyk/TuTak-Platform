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
  waitForSettlement,
} from './helpers';

interface Wallet {
  availableBonus: string;
  pendingBonus: string;
  reservedBonus: string;
}

/** Everything the customer holds, mature or not. */
const heldPoints = (w: Wallet) =>
  Number(w.availableBonus) + Number(w.pendingBonus) + Number(w.reservedBonus);

interface Payment {
  id: string;
  amount: string;
  refundedAmount: string;
  status: string;
  settledAt: string | null;
}

/**
 * Money leaving the platform, in both directions: back to a customer as a
 * refund, and out to a partner as a payout.
 *
 * These are the operations an admin performs in the browser and cannot undo,
 * so the assertions are about consequences rather than confirmations — what
 * the partner's balance became, what happened to the points the refunded
 * payment had issued, and whether the ledger still adds up afterwards.
 */
test.describe('refunds', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin refund returns money and claws back the points it issued', async ({ page }) => {
    const adminToken = await apiLogin(PHONES.admin, 'admin');
    const customerToken = await apiLogin(PHONES.refundCustomer, 'refund-customer');

    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;
    // Captured with the customer's own token. There is no "charge this other
    // user" parameter on purpose — naming the payer would be how one account
    // charges another's card — so the payer is always whoever is calling.
    const payment = await api<{ paymentId: string }>(customerToken, '/payments', {
      method: 'POST',
      body: {
        partnerId: cafe.id,
        amount: '20000',
        sourceToken: 'tok_demo_visa',
        idempotencyKey: unique('e2e-pay'),
      },
    });

    // Points are issued at settlement, not at capture — a payment that is
    // charged back must never have issued any — so the clawback this test is
    // really about only has something to claw back once settlement has run.
    await waitForSettlement(adminToken, payment.paymentId);

    const walletBefore = await api<Wallet>(customerToken, '/wallet/me');
    const balanceBefore = await api<{ availableBalance: string }>(
      adminToken,
      `/payouts/partners/${cafe.id}/balance`,
    );

    // ── The refund, through the admin's own screen ───────────────────────
    await page.goto(`${ADMIN}/refunds`);

    const row = page.locator('table tbody tr', { hasText: '20,000' }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: /^Refund .+ payment$/ }).click();

    // The form opens inline above the table. Both inputs are wrapped in
    // their own <label>, so they are addressable by what an operator reads
    // rather than by position.
    await page.getByLabel('Amount (blank = full)').fill('5000');
    // The confirm button stays disabled until a reason is typed, which is the
    // point of requiring one.
    await page.getByLabel('Reason').fill('e2e partial refund');
    // The confirm button, distinct from the twelve row buttons that open the
    // form — those name the payment they act on.
    await page.getByRole('button', { name: 'Refund', exact: true }).click();

    // ── What it did ──────────────────────────────────────────────────────
    await expect
      .poll(
        async () => {
          const after = await api<Payment>(adminToken, `/payments/${payment.paymentId}`);
          return Number(after.refundedAmount);
        },
        { timeout: 20_000 },
      )
      .toBe(5000);

    // Polled, not read once. `refundedAmount` is claimed up front as the
    // over-refund guard, so it reaches 5,000 while the clawback behind it is
    // still running — watching that field and then reading the wallet is a
    // race the test loses about half the time.
    //
    // Held points, not available ones: fresh accrual sits in `pendingBonus`
    // behind a cooling-off window, so comparing `availableBonus` compares
    // zero with zero and passes whether or not anything came back.
    await expect
      .poll(
        async () => heldPoints(await api<Wallet>(customerToken, '/wallet/me')),
        { timeout: 20_000 },
      )
      .toBeLessThan(heldPoints(walletBefore));

    const balanceAfter = await api<{ availableBalance: string }>(
      adminToken,
      `/payouts/partners/${cafe.id}/balance`,
    );
    expect(Number(balanceAfter.availableBalance)).toBeLessThan(
      Number(balanceBefore.availableBalance),
    );

    await expectLedgerBalanced(adminToken);
  });

  test('a refund larger than what remains on the payment is refused', async () => {
    const adminToken = await apiLogin(PHONES.admin, 'admin');
    const customerToken = await apiLogin(PHONES.refundCustomer, 'refund-customer');
    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;
    const payment = await api<{ paymentId: string }>(customerToken, '/payments', {
      method: 'POST',
      body: {
        partnerId: cafe.id,
        amount: '4000',
        sourceToken: 'tok_demo_visa',
        idempotencyKey: unique('e2e-over'),
      },
    });

    await expect(
      api(adminToken, '/refunds', {
        method: 'POST',
        body: {
          paymentId: payment.paymentId,
          amount: '4001',
          reason: 'e2e over-refund',
          idempotencyKey: unique('e2e-over-refund'),
        },
      }),
    ).rejects.toThrow();

    const after = await api<Payment>(adminToken, `/payments/${payment.paymentId}`);
    expect(Number(after.refundedAmount)).toBe(0);
    await expectLedgerBalanced(adminToken);
  });
});

test.describe('payouts', () => {
  test.use({ storageState: PARTNER_STATE });

  test('a payout leaves the partner balance and shows up on their earnings screen', async ({
    page,
  }) => {
    const adminToken = await apiLogin(PHONES.admin, 'admin');
    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const before = await api<{ availableBalance: string }>(
      adminToken,
      `/payouts/partners/${cafe.id}/balance`,
    );
    const amount = 1500;
    expect(Number(before.availableBalance)).toBeGreaterThan(amount);

    const payout = await api<{ payoutId: string; remainingBalance: string }>(
      adminToken,
      '/payouts',
      {
        method: 'POST',
        body: { partnerId: cafe.id, amount: String(amount), idempotencyKey: unique('e2e-payout') },
      },
    );

    expect(Number(payout.remainingBalance)).toBeCloseTo(
      Number(before.availableBalance) - amount,
      4,
    );

    // ── The partner's own view of it ─────────────────────────────────────
    await page.goto(`${PARTNER}/earnings`);
    await expect(page.getByText('1,500.00', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });

    await expectLedgerBalanced(adminToken);
  });

  test('a confirmed payout drains the clearing account rather than parking there', async () => {
    const adminToken = await apiLogin(PHONES.admin, 'admin');
    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const payout = await api<{ payoutId: string }>(adminToken, '/payouts', {
      method: 'POST',
      body: { partnerId: cafe.id, amount: '900', idempotencyKey: unique('e2e-payout-confirm') },
    });

    const clearingBefore = await clearingBalance(adminToken);
    expect(clearingBefore).toBeLessThan(0); // credit-normal: in flight

    await api(adminToken, `/payouts/${payout.payoutId}/confirm`, {
      method: 'POST',
      body: { bankReference: unique('E2E-WIRE') },
    });

    // The whole point of a clearing account: settled money leaves it.
    expect(await clearingBalance(adminToken)).toBeCloseTo(clearingBefore + 900, 4);
    await expectLedgerBalanced(adminToken);
  });

  test('a payout larger than the partner has earned is refused', async () => {
    const adminToken = await apiLogin(PHONES.admin, 'admin');
    const partners = await api<Array<{ id: string; displayName: string }>>(adminToken, '/partners');
    const cafe = partners.find((p) => p.displayName === 'Cafe Yerevan')!;

    const { availableBalance } = await api<{ availableBalance: string }>(
      adminToken,
      `/payouts/partners/${cafe.id}/balance`,
    );

    await expect(
      api(adminToken, '/payouts', {
        method: 'POST',
        body: {
          partnerId: cafe.id,
          amount: String(Number(availableBalance) + 10_000),
          idempotencyKey: unique('e2e-payout-over'),
        },
      }),
    ).rejects.toThrow();

    await expectLedgerBalanced(adminToken);
  });
});

async function clearingBalance(token: string): Promise<number> {
  const accounts = await api<Array<{ type: string; balance: string; partnerId: string | null }>>(
    token,
    '/admin/ledger/accounts',
  );
  const clearing = accounts.find((a) => a.type === 'BANK_CLEARING');
  return Number(clearing?.balance ?? 0);
}
