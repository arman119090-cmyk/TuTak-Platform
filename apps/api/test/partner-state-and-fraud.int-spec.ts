import { BadRequestException } from '@nestjs/common';
import {
  FraudSignalType,
  PrismaClient,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createDynamicInvoiceQr, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §H3 and §H7.
 *
 * §H3 — `partner.isActive` was written by the admin endpoint and read by
 * nothing. Switching off a fraudulent merchant left their QR codes redeeming
 * and accruing at the platform's expense, while the control appeared to work.
 *
 * §H7 — the velocity check raised a signal whose return value nobody read, and
 * `markFlagged` was dead code. Fraud detection was decorative.
 */
describe('Partner state and fraud enforcement (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let qrPayments: QrPaymentsService;
  let sessions: EvSessionsService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    qrPayments = harness.app.get(QrPaymentsService);
    sessions = harness.app.get(EvSessionsService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // ── §H3 partner deactivation ───────────────────────────────────────────

  describe('deactivating a partner', () => {
    it('stops their QR codes redeeming', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      await prisma.partner.update({ where: { id: partner.id }, data: { isActive: false } });

      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'off-1' }, user.id),
      ).rejects.toThrow(/not currently active/);
      expect(await prisma.transaction.count({ where: { status: 'COMPLETED' } })).toBe(0);
    });

    it('stops accrual against them', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 1000 });
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });
      await prisma.partner.update({ where: { id: partner.id }, data: { isActive: false } });

      await qrPayments
        .redeem({ token: qr.token, idempotencyKey: 'off-2' }, user.id)
        .catch(() => undefined);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
    });

    it('stops charging sessions starting on their connectors', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });
      await prisma.partner.update({ where: { id: partner.id }, data: { isActive: false } });

      await expect(sessions.start({ connectorId: connector.id }, user.id)).rejects.toThrow(
        /not currently active/,
      );
    });

    it('still works normally while the partner is active', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'on-1' }, user.id),
      ).resolves.toMatchObject({ amountCharged: '5000' });
    });
  });

  // ── §H7 fraud enforcement ──────────────────────────────────────────────

  describe('velocity signals', () => {
    /** Pushes the account past the 8-transactions-in-10-minutes threshold. */
    const saturate = async (userId: string, partnerId: string) => {
      for (let i = 0; i < 8; i += 1) {
        await transactions.create({
          userId,
          partnerId,
          type: TransactionType.QR_PAYMENT,
          amount: '100',
        });
      }
    };

    it('holds a QR payment once the velocity limit is exceeded', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await saturate(user.id, partner.id);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      // The signal used to be raised and dropped, and the payment completed.
      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'fast-1' }, user.id),
      ).rejects.toThrow(BadRequestException);

      const flagged = await prisma.transaction.findFirst({
        where: { userId: user.id, status: TransactionStatus.FLAGGED },
      });
      expect(flagged).not.toBeNull();
      expect(
        await prisma.fraudSignal.count({
          where: { userId: user.id, type: FraudSignalType.VELOCITY_LIMIT_EXCEEDED },
        }),
      ).toBeGreaterThan(0);
    });

    it('does not consume the QR code when a payment is held', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await saturate(user.id, partner.id);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      await qrPayments
        .redeem({ token: qr.token, idempotencyKey: 'fast-2' }, user.id)
        .catch(() => undefined);

      // A held payment must not cost the customer their invoice.
      expect((await prisma.qrCode.findUniqueOrThrow({ where: { id: qr.id } })).status).toBe(
        'ACTIVE',
      );
    });

    it('holds an EV session too, and frees the connector', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });
      await saturate(user.id, partner.id);

      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 3_600_000) },
      });
      await sessions.reportMeterValue(session.id, '10', user.id);

      // The EV path had no fraud check at all.
      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(BadRequestException);

      expect(
        (await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } })).status,
      ).toBe('AVAILABLE');
      expect(
        await prisma.transaction.count({
          where: { userId: user.id, status: TransactionStatus.FLAGGED },
        }),
      ).toBe(1);
    });

    it('leaves a normal rate of payment alone', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

      await expect(
        qrPayments.redeem({ token: qr.token, idempotencyKey: 'normal-1' }, user.id),
      ).resolves.toBeDefined();
      expect(await prisma.fraudSignal.count()).toBe(0);
    });
  });
});
