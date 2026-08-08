import { LedgerAccountType, PrismaClient } from '@prisma/client';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RetentionService } from '../src/modules/retention/retention.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

const DAY = 86_400_000;

/**
 * What the platform stops keeping, and what it must never stop keeping.
 *
 * Half of these tests assert deletions and half assert the absence of them,
 * and the second half is the more important one. A retention sweep is a
 * scheduled, unattended `DELETE` against a database holding a double-entry
 * ledger — the failure mode is not that it deletes too little.
 */
describe('Retention (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let retention: RetentionService;
  let payments: PaymentEngineService;

  /** Far enough past every configured period that everything prunable is due. */
  const wellPast = () => new Date(Date.now() + 400 * DAY);

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    retention = harness.app.get(RetentionService);
    payments = harness.app.get(PaymentEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('what it prunes', () => {
    it('removes read notifications and keeps unread ones', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.notification.create({
        data: { userId: user.id, channel: 'PUSH', titleKey: 'a', bodyKey: 'a', isRead: true },
      });
      await prisma.notification.create({
        data: { userId: user.id, channel: 'PUSH', titleKey: 'b', bodyKey: 'b', isRead: false },
      });

      const result = await retention.prune(wellPast());

      expect(result.notifications).toBe(1);
      // An unread notification is still owed to its recipient however old it
      // is. Dropping it means a customer never learns their points expired.
      const left = await prisma.notification.findMany();
      expect(left).toHaveLength(1);
      expect(left[0]!.isRead).toBe(false);
    });

    it('removes dead sessions and leaves a live one alone', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: 'revoked',
          deviceId: 'd1',
          expiresAt: new Date(Date.now() + 30 * DAY),
          revokedAt: new Date(),
        },
      });
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: 'live',
          deviceId: 'd2',
          // Still valid at the simulated instant below, so pruning it would
          // sign a working customer out of their phone.
          expiresAt: new Date(Date.now() + 500 * DAY),
        },
      });

      const result = await retention.prune(wellPast());

      expect(result.refreshTokens).toBe(1);
      const left = await prisma.refreshToken.findMany();
      expect(left.map((t) => t.tokenHash)).toEqual(['live']);
    });

    it('removes spent challenge codes', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, codeHash: 'x', expiresAt: new Date() },
      });
      await prisma.phoneVerificationToken.create({
        data: { userId: user.id, codeHash: 'y', expiresAt: new Date() },
      });

      const result = await retention.prune(wellPast());

      expect(result.passwordResetTokens).toBe(1);
      expect(result.phoneVerificationTokens).toBe(1);
    });

    it('removes completed idempotency records and keeps in-flight ones', async () => {
      await prisma.idempotencyRecord.create({
        data: {
          scope: 'user:1',
          key: 'done',
          requestHash: 'h',
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      await prisma.idempotencyRecord.create({
        data: { scope: 'user:1', key: 'in-flight', requestHash: 'h', status: 'IN_FLIGHT' },
      });

      const result = await retention.prune(wellPast());

      expect(result.idempotencyRecords).toBe(1);
      // Deleting an in-flight key lets a retry execute a second payment.
      const left = await prisma.idempotencyRecord.findMany();
      expect(left.map((r) => r.key)).toEqual(['in-flight']);
    });

    it('removes processed outbox events and keeps unprocessed ones', async () => {
      await prisma.outboxEvent.create({
        data: {
          aggregateType: 'T',
          aggregateId: '1',
          eventType: 'done',
          payload: {},
          processedAt: new Date(),
        },
      });
      await prisma.outboxEvent.create({
        data: { aggregateType: 'T', aggregateId: '2', eventType: 'pending', payload: {} },
      });

      const result = await retention.prune(wellPast());

      expect(result.outboxEvents).toBe(1);
      // An unprocessed outbox row is settlement that has not happened yet.
      // Pruning one loses money silently — the exact failure the outbox
      // pattern exists to prevent.
      const left = await prisma.outboxEvent.findMany();
      expect(left.map((e) => e.eventType)).toEqual(['pending']);
    });
  });

  describe('what it must never touch', () => {
    it('leaves the ledger, the payments and the balances exactly as they were', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await payments.capture({
        userId: user.id,
        partnerId: partner.id,
        amount: '7500',
        sourceToken: 'tok_ok',
        idempotencyKey: 'retention-keeps-money',
      });

      const before = {
        postings: await prisma.ledgerPosting.count(),
        transactions: await prisma.ledgerTransaction.count(),
        payments: await prisma.payment.count(),
        lots: await prisma.bonusLot.count(),
        entries: await prisma.bonusLedgerEntry.count(),
      };
      expect(before.postings).toBeGreaterThan(0);

      // Four hundred days out — past every period this sweep knows about.
      await retention.prune(wellPast());

      expect(await prisma.ledgerPosting.count()).toBe(before.postings);
      expect(await prisma.ledgerTransaction.count()).toBe(before.transactions);
      expect(await prisma.payment.count()).toBe(before.payments);
      expect(await prisma.bonusLot.count()).toBe(before.lots);
      expect(await prisma.bonusLedgerEntry.count()).toBe(before.entries);

      // And the books still balance, which is the assertion that would catch
      // a partial deletion the counts above happened to miss.
      const sum = await prisma.ledgerAccount.aggregate({ _sum: { balance: true } });
      expect(Number(sum._sum.balance ?? 0)).toBe(0);
      const psp = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: LedgerAccountType.PSP_RECEIVABLE },
      });
      expect(psp.balance.toNumber()).toBeGreaterThan(0);
    });

    it('leaves the audit trail complete', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.auditLog.create({
        data: { actorUserId: user.id, action: 'USER_LOGIN', entityType: 'User', entityId: user.id },
      });

      await retention.prune(wellPast());

      // A trail with a hole in it is not a trail. "Who confirmed that payout"
      // has to stay answerable for longer than any of these periods.
      expect(await prisma.auditLog.count()).toBe(1);
    });

    it('leaves fraud signals, which exist to recognise a repeat', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.fraudSignal.create({
        data: { userId: user.id, type: 'QR_REPLAY_ATTEMPT', severity: 'MEDIUM', metadata: {} },
      });

      await retention.prune(wellPast());

      expect(await prisma.fraudSignal.count()).toBe(1);
    });

    it('leaves users, including ones deleted long ago', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date(Date.now() - 400 * DAY) },
      });

      await retention.prune(wellPast());

      // Anonymisation is a different sweep with a different contract. This
      // one must never remove a row the ledger points at.
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('the sweep itself', () => {
    it('does nothing to rows that are still inside their period', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.notification.create({
        data: { userId: user.id, channel: 'PUSH', titleKey: 'a', bodyKey: 'a', isRead: true },
      });
      await prisma.idempotencyRecord.create({
        data: {
          scope: 's',
          key: 'k',
          requestHash: 'h',
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      const result = await retention.prune(new Date());

      expect(Object.values(result).every((n) => n === 0)).toBe(true);
    });

    it('is safe to run twice', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.notification.create({
        data: { userId: user.id, channel: 'PUSH', titleKey: 'a', bodyKey: 'a', isRead: true },
      });

      expect((await retention.prune(wellPast())).notifications).toBe(1);
      expect((await retention.prune(wellPast())).notifications).toBe(0);
    });

    it('runs on an empty database without complaining', async () => {
      const result = await retention.prune(wellPast());
      expect(Object.values(result).every((n) => n === 0)).toBe(true);
    });
  });
});
