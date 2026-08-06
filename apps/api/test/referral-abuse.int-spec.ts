import { PrismaClient, ReferralInviteStatus, RoleName, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { ReferralService } from '../src/modules/referral/referral.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { QrCodeType } from '@prisma/client';
import { createCustomer, createDynamicInvoiceQr, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §C4 and §C5.
 *
 * The referral reward was farmable because three gaps composed: registration
 * is unverified, any customer could self-issue a payable QR code and redeem
 * it, and the reward fired on any first completed transaction of any kind.
 * Register a throwaway account with the attacker's code, self-pay 1 AMD,
 * collect 1000 points. Repeat.
 *
 * Separately the reward itself could be paid twice under concurrency, or
 * repeatedly if the status write failed after the accrual.
 */
describe('Referral abuse (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let referral: ReferralService;
  let qrPayments: QrPaymentsService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    referral = harness.app.get(ReferralService);
    qrPayments = harness.app.get(QrPaymentsService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const asUser = (id: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
  });

  /** A referrer, a referee, and a PENDING invite between them. */
  const invited = async () => {
    const referrer = await createCustomer(prisma);
    const referee = await createCustomer(prisma);
    const invite = await prisma.referralInvite.create({
      data: { referrerUserId: referrer.user.id, refereeUserId: referee.user.id },
    });
    return { referrer, referee, invite };
  };

  /**
   * A real, partner-backed, above-threshold purchase by the referee.
   *
   * Qualification is driven explicitly rather than through the
   * `transaction.completed` listener: that listener is fire-and-forget, so
   * awaiting `redeem` guarantees nothing about whether it has run. (That the
   * reward can be lost entirely if the process dies before the listener fires
   * is a real gap, recorded in the report rather than papered over here.)
   */
  const qualifyingPurchase = async (userId: string, amount = '5000') => {
    const partner = await createPartner(prisma);
    const tx = await transactions.create({
      userId,
      partnerId: partner.id,
      type: TransactionType.QR_PAYMENT,
      amount,
    });
    await transactions.markCompleted(tx.id);
    await referral.handleQualifyingTransaction(userId, tx.id);
    return tx;
  };

  // ── §C4 the farming loop ───────────────────────────────────────────────

  describe('the §C4 farming loop', () => {
    it('refuses to let a customer redeem their own QR code', async () => {
      const { user } = await createCustomer(prisma);

      // The vehicle for the loop: a self-issued token with an amount on it,
      // redeemed by its own issuer, producing a COMPLETED transaction out of
      // nothing.
      const qr = await qrPayments.issue(
        { type: QrCodeType.USER_PAY_TOKEN, amount: '1' },
        asUser(user.id),
      );

      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'self-pay-1' }, user.id),
      ).rejects.toThrow(/cannot redeem a code you issued/);

      expect(await prisma.transaction.count({ where: { status: 'COMPLETED' } })).toBe(0);
    });

    it('does not reward a referral on a transaction with no partner', async () => {
      const { referrer, referee, invite } = await invited();

      // Even reaching a completed partnerless transaction by another route
      // must not qualify: there is no commerce behind it to reward.
      const tx = await transactions.create({
        userId: referee.user.id,
        type: TransactionType.QR_PAYMENT,
        amount: '1',
      });
      await transactions.markCompleted(tx.id);

      expect(await referral.handleQualifyingTransaction(referee.user.id, tx.id)).toBeNull();
      expect(
        (await prisma.referralInvite.findUniqueOrThrow({ where: { id: invite.id } })).status,
      ).toBe(ReferralInviteStatus.PENDING);
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } })).lifetimeEarned
          .toFixed(4),
      ).toBe('0.0000');
    });

    it('does not reward a referral below the qualifying amount', async () => {
      const { referrer, referee } = await invited();
      await qualifyingPurchase(referee.user.id, '1');

      // A one-dram purchase is as cheap to fabricate as no purchase at all.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } });
      expect(wallet.lifetimeEarned.toFixed(4)).toBe('0.0000');
    });

    it('rewards a genuine partner purchase above the threshold', async () => {
      const { referrer, referee, invite } = await invited();

      await qualifyingPurchase(referee.user.id, '5000');

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } });
      expect(wallet.lifetimeEarned.toFixed(4)).toBe('1000.0000');
      expect(
        (await prisma.referralInvite.findUniqueOrThrow({ where: { id: invite.id } })).status,
      ).toBe(ReferralInviteStatus.REWARDED);
      await assertWalletIntegrity(prisma, referrer.wallet.id);
    });

    it('refuses a self-referral even if an invite row is forged', async () => {
      const { user, wallet } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerUserId: user.id, refereeUserId: user.id },
      });

      await qualifyingPurchase(user.id, '5000');

      // Paying yourself for introducing yourself is the whole farm in one row.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const referralCredit = await prisma.bonusLedgerEntry.count({
        where: { walletId: wallet.id, type: 'ACCRUAL_REFERRAL' },
      });
      expect(referralCredit).toBe(0);
      expect(after.lifetimeEarned.toFixed(4)).not.toBe('1000.0000');
    });
  });

  // ── §C5 the reward race ────────────────────────────────────────────────

  describe('the §C5 double-reward race', () => {
    it('pays exactly once when two completions land together', async () => {
      const { referrer, referee } = await invited();
      const partner = await createPartner(prisma);

      const first = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });
      const second = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });
      const [a, b] = await Promise.all([
        transactions.create({
          userId: referee.user.id,
          partnerId: partner.id,
          type: TransactionType.QR_PAYMENT,
          amount: '5000',
        }),
        transactions.create({
          userId: referee.user.id,
          partnerId: partner.id,
          type: TransactionType.QR_PAYMENT,
          amount: '5000',
        }),
      ]);
      await Promise.all([transactions.markCompleted(a.id), transactions.markCompleted(b.id)]);
      void first;
      void second;

      // Both observed a PENDING invite and both accrued, because the claim was
      // a plain read followed by an unconditional write.
      await Promise.all([
        referral.handleQualifyingTransaction(referee.user.id, a.id),
        referral.handleQualifyingTransaction(referee.user.id, b.id),
      ]);

      const credits = await prisma.bonusLedgerEntry.findMany({
        where: { walletId: referrer.wallet.id, type: 'ACCRUAL_REFERRAL' },
      });
      expect(credits).toHaveLength(1);
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } })).lifetimeEarned
          .toFixed(4),
      ).toBe('1000.0000');
      await assertWalletIntegrity(prisma, referrer.wallet.id);
    });

    it('does not pay again on a later transaction', async () => {
      const { referrer, referee } = await invited();

      await qualifyingPurchase(referee.user.id, '5000');
      await qualifyingPurchase(referee.user.id, '9000');

      const credits = await prisma.bonusLedgerEntry.count({
        where: { walletId: referrer.wallet.id, type: 'ACCRUAL_REFERRAL' },
      });
      expect(credits).toBe(1);
    });

    it('leaves the invite claimable if the accrual fails', async () => {
      const { referrer, referee, invite } = await invited();
      const partner = await createPartner(prisma);
      const tx = await transactions.create({
        userId: referee.user.id,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        amount: '5000',
      });
      await transactions.markCompleted(tx.id);

      // Claim and accrual share one transaction: if the money write fails the
      // claim must roll back too, or the referral is silently lost forever.
      await prisma.wallet.delete({ where: { id: referrer.wallet.id } });
      await expect(
        referral.handleQualifyingTransaction(referee.user.id, tx.id),
      ).rejects.toThrow();

      expect(
        (await prisma.referralInvite.findUniqueOrThrow({ where: { id: invite.id } })).status,
      ).toBe(ReferralInviteStatus.PENDING);
    });

    it('records the amount it actually paid', async () => {
      const { referrer, referee, invite } = await invited();
      await qualifyingPurchase(referee.user.id, '5000');

      const row = await prisma.referralInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(new Decimal(row.rewardAmount!).toFixed(4)).toBe('1000.0000');
      expect(row.rewardedAt).not.toBeNull();
      void referrer;
    });
  });
});
