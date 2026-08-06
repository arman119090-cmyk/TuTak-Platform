import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  BonusEntryType,
  PrismaClient,
  QrCodeStatus,
  QrCodeType,
  RoleName,
  TransactionStatus,
} from '@prisma/client';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createDynamicInvoiceQr, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * The QR payment saga end to end: charge, apply a bonus discount, accrue on
 * the paid portion, and roll everything back when a later step fails.
 *
 * Several tests here are named after the exploits proven in
 * docs/AUDIT_2026-08.md. They exist to make those exploits permanently
 * un-reintroducible: each one performs the original attack and asserts it
 * now fails.
 */
describe('QR payments (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let qrPayments: QrPaymentsService;
  let engine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    qrPayments = harness.app.get(QrPaymentsService);
    engine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const asRequestUser = (id: string, roles: RoleName[] = [RoleName.CUSTOMER]): RequestUser =>
    ({ id, phone: '+37400000000', roles, permissions: [], partnerScopes: {} }) as RequestUser;

  const fundedCustomer = async (available: string) => {
    const { user, wallet } = await createCustomer(prisma);
    await engine.accrue({
      walletId: wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount: available,
      pendingHours: 0,
    });
    return { user, wallet };
  };

  // ── Happy path ──────────────────────────────────────────────────────────

  it('charges the full amount and accrues at the partner rate', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 }); // 5%
    const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

    const result = await qrPayments.redeem(
      { token: qr.token, idempotencyKey: 'idem-happy-1' },
      user.id,
    );

    expect(result.amountCharged).toBe('10000');
    expect(result.bonusApplied).toBe('0');
    expect(result.bonusEarned).toBe('500');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // Fresh points cool off before they can be spent.
    expect(after.pendingBonus.toFixed(4)).toBe('500.0000');
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');

    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: result.transactionId },
    });
    expect(transaction.status).toBe(TransactionStatus.COMPLETED);
    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('accrues only on the portion actually paid in money', async () => {
    const { user, wallet } = await fundedCustomer('3000');
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 1000 }); // 10%
    const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

    const result = await qrPayments.redeem(
      { token: qr.token, bonusAmountToApply: '3000', idempotencyKey: 'idem-mixed-1' },
      user.id,
    );

    // 10000 - 3000 paid with points = 7000 cash → 10% = 700.
    // Accruing on the full 10000 would pay the customer for spending points.
    expect(result.bonusEarned).toBe('700');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');
    expect(after.pendingBonus.toFixed(4)).toBe('700.0000');
    expect(after.lifetimeSpent.toFixed(4)).toBe('3000.0000');
    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('records the spend exactly once in the ledger', async () => {
    const { user, wallet } = await fundedCustomer('3000');
    const partner = await createPartner(prisma);
    const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

    await qrPayments.redeem(
      { token: qr.token, bonusAmountToApply: '3000', idempotencyKey: 'idem-once-1' },
      user.id,
    );

    const redemptions = await prisma.bonusLedgerEntry.findMany({
      where: { walletId: wallet.id, type: BonusEntryType.REDEMPTION_QR_PAYMENT },
    });
    // The hold and the settlement used to write one of these each, so every
    // redemption was double-counted in reporting.
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.amount.toFixed(4)).toBe('3000.0000');
    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('consumes a single-use QR code but leaves a static merchant code reusable', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);

    const dynamic = await createDynamicInvoiceQr(prisma, {
      partnerId: partner.id,
      amount: '1000',
    });
    await qrPayments.redeem({ token: dynamic.token, idempotencyKey: 'idem-d1' }, user.id);
    expect(
      (await prisma.qrCode.findUniqueOrThrow({ where: { id: dynamic.id } })).status,
    ).toBe(QrCodeStatus.REDEEMED);

    const staticQr = await prisma.qrCode.create({
      data: {
        type: QrCodeType.STATIC_MERCHANT,
        token: 'static-merchant-token-0001',
        partnerId: partner.id,
        amount: '1000',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await qrPayments.redeem({ token: staticQr.token, idempotencyKey: 'idem-s1' }, user.id);
    await qrPayments.redeem({ token: staticQr.token, idempotencyKey: 'idem-s2' }, user.id);
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id: staticQr.id } })).status).toBe(
      QrCodeStatus.ACTIVE,
    );
  });

  // ── Regression: proven exploits ─────────────────────────────────────────

  describe('regressions for exploits proven in the audit', () => {
    it('rejects a negative bonus amount instead of minting points (§B1)', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 1000 });
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

      // The original attack: -1000000 made `amount.minus(bonus)` an addition,
      // so the accrual base became 1,010,000 and paid out 101,000 points on a
      // 10,000 payment. Repeat at will for unlimited free points.
      await expect(
        qrPayments.redeem(
          { token: qr.token, bonusAmountToApply: '-1000000', idempotencyKey: 'idem-exploit-1' },
          user.id,
        ),
      ).rejects.toThrow(BadRequestException);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it.each(['NaN', 'Infinity', '1e40', '1.00005'])(
      'rejects the malformed bonus amount %p',
      async (bonusAmountToApply) => {
        const { user, wallet } = await createCustomer(prisma);
        const partner = await createPartner(prisma);
        const qr = await createDynamicInvoiceQr(prisma, {
          partnerId: partner.id,
          amount: '10000',
        });

        await expect(
          qrPayments.redeem(
            { token: qr.token, bonusAmountToApply, idempotencyKey: `idem-${bonusAmountToApply}` },
            user.id,
          ),
        ).rejects.toThrow(BadRequestException);
        await assertWalletIntegrity(prisma, wallet.id);
      },
    );

    it('scopes idempotency keys per user, so one account cannot read another (§B3)', async () => {
      const { user: victim } = await createCustomer(prisma);
      const { user: attacker } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      const victimQr = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '50000',
      });
      const victimResult = await qrPayments.redeem(
        { token: victimQr.token, idempotencyKey: 'shared-key' },
        victim.id,
      );

      // Replaying the victim's key used to return the victim's transaction —
      // amount, partner and all — to whoever guessed it.
      const attackerQr = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '100',
      });
      const attackerResult = await qrPayments.redeem(
        { token: attackerQr.token, idempotencyKey: 'shared-key' },
        attacker.id,
      );

      expect(attackerResult.transactionId).not.toBe(victimResult.transactionId);
      expect(attackerResult.amountCharged).toBe('100');
    });

    it('replays the caller’s own key without charging twice', async () => {
      const { user, wallet } = await fundedCustomer('3000');
      const partner = await createPartner(prisma);
      const qr = await prisma.qrCode.create({
        data: {
          type: QrCodeType.STATIC_MERCHANT,
          token: 'static-idem-token-0001',
          partnerId: partner.id,
          amount: '1000',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const first = await qrPayments.redeem(
        { token: qr.token, bonusAmountToApply: '500', idempotencyKey: 'retry-key' },
        user.id,
      );
      const second = await qrPayments.redeem(
        { token: qr.token, bonusAmountToApply: '500', idempotencyKey: 'retry-key' },
        user.id,
      );

      expect(second.transactionId).toBe(first.transactionId);
      // A network retry must not spend the customer's points a second time.
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).lifetimeSpent.toFixed(
          4,
        ),
      ).toBe('500.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('refuses to issue a merchant QR code for a partner the issuer has no claim to', async () => {
      const { user: outsider } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      await expect(
        qrPayments.issue(
          { type: QrCodeType.DYNAMIC_INVOICE, partnerId: partner.id, amount: '999999' },
          asRequestUser(outsider.id),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Validation and refusals ─────────────────────────────────────────────

  describe('refusals', () => {
    it('rejects a bonus larger than the payment', async () => {
      const { user, wallet } = await fundedCustomer('100000');
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '1000' });

      await expect(
        qrPayments.redeem(
          { token: qr.token, bonusAmountToApply: '5000', idempotencyKey: 'idem-over-1' },
          user.id,
        ),
      ).rejects.toThrow(/cannot exceed the payment amount/);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects a bonus larger than the balance and leaves the wallet untouched', async () => {
      const { user, wallet } = await fundedCustomer('100');
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

      await expect(
        qrPayments.redeem(
          { token: qr.token, bonusAmountToApply: '5000', idempotencyKey: 'idem-poor-1' },
          user.id,
        ),
      ).rejects.toThrow(/Insufficient available bonus/);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toFixed(4)).toBe('100.0000');
      expect(after.reservedBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects an expired QR code', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '1000',
        expiresInSeconds: -60,
      });

      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'idem-exp-1' }, user.id),
      ).rejects.toThrow(/expired/);
    });

    it('rejects a second redemption of a single-use code', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '1000' });

      await qrPayments.redeem({ token: qr.token, idempotencyKey: 'idem-first' }, user.id);
      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'idem-second' }, user.id),
      ).rejects.toThrow(/not active/);
    });

    it('rejects an unknown token', async () => {
      const { user } = await createCustomer(prisma);
      await expect(
        qrPayments.redeem({ token: 'does-not-exist', idempotencyKey: 'idem-404' }, user.id),
      ).rejects.toThrow(/not found/);
    });
  });

  // ── Rollback ────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('returns the customer’s points when the redemption fails after settling', async () => {
      const { user, wallet } = await fundedCustomer('3000');
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '10000' });

      // Simulate the QR being consumed by a concurrent request in the window
      // between settling the points and flipping the code. The saga fails
      // *after* the customer's points were already spent.
      const spy = jest
        .spyOn(prisma.qrCode, 'updateMany')
        .mockImplementationOnce((() => Promise.resolve({ count: 0 })) as never);

      await expect(
        qrPayments.redeem(
          { token: qr.token, bonusAmountToApply: '3000', idempotencyKey: 'idem-rollback-1' },
          user.id,
        ),
      ).rejects.toThrow(/already redeemed/);

      spy.mockRestore();

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // Before compensateReservation existed, releaseReservation threw on the
      // settled hold, the error was swallowed, and the customer lost 3000
      // points against a transaction that ended up FAILED.
      expect(after.availableBonus.toFixed(4)).toBe('3000.0000');
      expect(after.lifetimeSpent.toFixed(4)).toBe('0.0000');

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { userId: user.id, idempotencyKey: 'idem-rollback-1' },
      });
      expect(transaction.status).toBe(TransactionStatus.FAILED);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });
});
