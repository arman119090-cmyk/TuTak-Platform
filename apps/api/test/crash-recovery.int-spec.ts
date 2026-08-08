import { BonusEntryType, BonusReservationStatus, PrismaClient, TransactionStatus } from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createDynamicInvoiceQr, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * The process dies in the middle of a saga.
 *
 * The outbox and the idempotency lease both have their own suites, and both
 * cover the crash they were built for. What is not covered is the crash with
 * no cleanup at all: a `kill -9` between two steps, where the `catch` block
 * that compensates never runs because there is no longer a process to run it.
 * A saga is only crash-safe if the state it leaves behind is recoverable by
 * something *other* than its own error handling.
 *
 * Two mechanisms are supposed to provide that, and each is exercised here
 * against the state a real interruption leaves:
 *
 *  - a bonus hold that nobody settles or releases is returned by
 *    `bonus.release-expired-reservations`;
 *  - a charging session nobody stops is closed by `ev.expire-stale-sessions`.
 *
 * Failures injected mid-saga are simulated by making a specific downstream
 * call throw, which is the closest a single process can get to dying at a
 * chosen instant while still being able to assert afterwards.
 */
describe('Crash recovery (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let engine: BonusEngineService;
  let qr: QrPaymentsService;
  let sessions: EvSessionsService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    engine = harness.app.get(BonusEngineService);
    qr = harness.app.get(QrPaymentsService);
    sessions = harness.app.get(EvSessionsService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const funded = async (amount = '1000') => {
    const { user, wallet } = await createCustomer(prisma);
    await engine.accrue({
      walletId: wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount,
      pendingHours: 0,
    });
    return { user, wallet };
  };

  describe('a hold nobody ever resolves', () => {
    it('returns the points once the hold expires', async () => {
      // The literal crash case: `reserve` committed, then the process was
      // gone. No catch block ran, no release was attempted, and the points
      // are sitting in `reserved` where the customer cannot see or spend
      // them. Without the sweep this is permanent and needs a manual
      // database edit to fix.
      const { wallet } = await funded('1000');
      await engine.reserve(wallet.id, '400', 'tx-crashed', 1);

      const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(before.reservedBonus.toString()).toBe('400');
      expect(before.availableBonus.toString()).toBe('600');

      await engine.releaseExpiredReservations(new Date(Date.now() + 10_000));

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('1000');
      expect(after.reservedBonus.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('returns the points to the lots they came from, keeping their expiry', async () => {
      // Points returned as a fresh lot would silently gain a new lifetime —
      // a customer whose points were about to expire could park them in a
      // hold and get another year.
      const { wallet } = await funded('1000');
      const lotBefore = await prisma.bonusLot.findFirstOrThrow({ where: { walletId: wallet.id } });
      await engine.reserve(wallet.id, '400', 'tx-crashed-2', 1);

      await engine.releaseExpiredReservations(new Date(Date.now() + 10_000));

      const lots = await prisma.bonusLot.findMany({ where: { walletId: wallet.id } });
      expect(lots).toHaveLength(1);
      expect(lots[0]!.id).toBe(lotBefore.id);
      expect(lots[0]!.expiresAt.getTime()).toBe(lotBefore.expiresAt.getTime());
      expect(lots[0]!.remainingAmount.toString()).toBe('1000');
    });

    it('leaves a hold that is still inside its window alone', async () => {
      // The sweep must not collect a payment that is merely slow.
      const { wallet } = await funded('1000');
      await engine.reserve(wallet.id, '400', 'tx-in-flight', 300);

      await engine.releaseExpiredReservations(new Date());

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.reservedBonus.toString()).toBe('400');
    });

    it('does not disturb a hold that was already settled', async () => {
      const { wallet } = await funded('1000');
      const reservation = await engine.reserve(wallet.id, '400', 'tx-settled', 1);
      await engine.settleReservation(reservation.reservationId);

      await engine.releaseExpiredReservations(new Date(Date.now() + 10_000));

      // Returning settled points would credit a customer for a purchase they
      // completed — money out of nothing.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('600');
      expect(after.lifetimeSpent.toString()).toBe('400');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('a QR redemption interrupted after the points were spent', () => {
    it('gives the points back and marks the transaction failed', async () => {
      const { user, wallet } = await funded('1000');
      const partner = await createPartner(prisma);
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '5000',
      });

      // Fail after the hold has been settled — the customer's points are
      // already gone at this instant, which is the state that used to be
      // left behind permanently.
      jest
        .spyOn(transactions, 'markCompleted')
        .mockRejectedValueOnce(new Error('database went away'));

      await expect(
        qr.redeem({ token: code.token, bonusAmountToApply: '400', idempotencyKey: 'crash-1' }, user.id),
      ).rejects.toThrow('database went away');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('1000');
      expect(after.reservedBonus.toString()).toBe('0');
      expect(after.lifetimeSpent.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);

      const charge = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id } });
      expect(charge.status).toBe(TransactionStatus.FAILED);
    });

    it('leaves the QR code unredeemed so the customer can try again', async () => {
      const { user } = await funded('1000');
      const partner = await createPartner(prisma);
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '5000',
      });

      jest
        .spyOn(transactions, 'markCompleted')
        .mockRejectedValueOnce(new Error('database went away'));
      await expect(
        qr.redeem({ token: code.token, idempotencyKey: 'crash-2' }, user.id),
      ).rejects.toThrow();

      jest.restoreAllMocks();
      // A failed attempt must not consume the invoice. The merchant is still
      // owed the money and the customer still has to be able to pay it.
      const retried = await qr.redeem({ token: code.token, idempotencyKey: 'crash-3' }, user.id);
      expect(retried.amountCharged).toBe('5000');
    });
  });

  describe('a charging session interrupted after the points were spent', () => {
    it('gives the points back and frees the bay', async () => {
      const { user, wallet } = await funded('1000');
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.00',
      });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 2 * 3_600_000) },
      });
      await sessions.reportMeterValue(session.id, '25', user.id);

      jest
        .spyOn(transactions, 'markCompleted')
        .mockRejectedValueOnce(new Error('database went away'));

      await expect(
        sessions.stop(session.id, user.id, { bonusAmountToApply: '400' }),
      ).rejects.toThrow('database went away');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('1000');
      expect(after.reservedBonus.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);

      // The bay must not stay occupied by a session that failed.
      const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(bay.status).toBe('AVAILABLE');
    });
  });

  describe('the ledger after every interruption above', () => {
    it('still reconstructs the wallet from its own entries', async () => {
      // The invariant that makes the rest meaningful: whatever sequence of
      // failures and compensations happened, replaying the bonus ledger has
      // to produce the wallet exactly.
      const { user, wallet } = await funded('1000');
      const partner = await createPartner(prisma);

      for (const key of ['a', 'b', 'c']) {
        const code = await createDynamicInvoiceQr(prisma, {
          partnerId: partner.id,
          amount: '1000',
        });
        if (key === 'b') {
          jest.spyOn(transactions, 'markCompleted').mockRejectedValueOnce(new Error('crash'));
          await expect(
            qr.redeem({ token: code.token, bonusAmountToApply: '100', idempotencyKey: key }, user.id),
          ).rejects.toThrow();
          jest.restoreAllMocks();
        } else {
          await qr.redeem(
            { token: code.token, bonusAmountToApply: '100', idempotencyKey: key },
            user.id,
          );
        }
      }

      // Two of three redemptions succeeded, each spending 100.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeSpent.toString()).toBe('200');
      expect(after.reservedBonus.toString()).toBe('0');
      const stranded = await prisma.bonusReservation.count({
        where: { walletId: wallet.id, status: BonusReservationStatus.ACTIVE },
      });
      expect(stranded).toBe(0);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });
});
