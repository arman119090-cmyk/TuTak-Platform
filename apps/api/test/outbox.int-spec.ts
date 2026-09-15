import {
  PrismaClient,
  ReferralChallengeParticipantStatus,
  TransactionType,
} from '@prisma/client';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Spec §18: qualification is cumulative turnover (10 000 AMD by default), not
 * a single-purchase flag — so the durability/redelivery tests below drive a
 * `ReferralChallengeParticipant` through `advanceChallengeProgress` rather
 * than the old flat one-time `ReferralInvite.status` reward this replaced.
 */

/**
 * The outbox, and what it fixes.
 *
 * `transaction.completed` used to be an in-process event emitted after the
 * write. A process death between the two lost the referral reward silently:
 * the listener caught the error, logged it, and the invite stayed PENDING
 * with nothing in the system that would ever retry it
 * (docs/AUDIT_FINAL_2026-08.md H-2).
 *
 * The tests below simulate that death the only way a test can — by declining
 * to run the drainer — and then assert the work is still pending and still
 * completes when a worker comes back.
 */
describe('Outbox (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let outbox: OutboxService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    outbox = harness.app.get(OutboxService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const completedPurchase = async (userId: string, partnerId: string, amount = '5000') => {
    const tx = await transactions.create({
      userId,
      partnerId,
      type: TransactionType.QR_PAYMENT,
      amount,
    });
    return transactions.markCompleted(tx.id);
  };

  // ── Durability ─────────────────────────────────────────────────────────

  describe('durability', () => {
    it('records the event in the same transaction as the status change', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      const completed = await completedPurchase(user.id, partner.id);

      const events = await prisma.outboxEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe('transaction.completed');
      expect((events[0]!.payload as { transactionId: string }).transactionId).toBe(completed.id);
      expect(events[0]!.processedAt).toBeNull();
    });

    it('records nothing when the status change is rolled back', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const tx = await transactions.create({
        userId: user.id,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        amount: '5000',
      });

      await prisma
        .$transaction(async (client) => {
          await transactions.markCompleted(tx.id, {}, client);
          throw new Error('caller aborted after completing');
        })
        .catch(() => undefined);

      // An event that outlived its transaction would have a consumer settle
      // a payment the database says never completed.
      expect(await prisma.outboxEvent.count()).toBe(0);
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status,
      ).toBe('INITIATED');
    });

    it('survives a process that dies before the handler runs', async () => {
      const referrer = await createCustomer(prisma);
      const referee = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const participant = await prisma.referralChallengeParticipant.create({
        data: {
          referrerUserId: referrer.user.id,
          refereeUserId: referee.user.id,
          requiredAmount: '10000',
        },
      });

      // The transaction completes; the worker never gets to it. Before the
      // outbox this qualification was gone for good.
      await completedPurchase(referee.user.id, partner.id, '10000');
      expect(
        (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: participant.id } }))
          .status,
      ).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);

      // A worker comes back.
      expect(await outbox.drain()).toBe(1);

      expect(
        (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: participant.id } }))
          .status,
      ).toBe(ReferralChallengeParticipantStatus.REWARDED);
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { id: referrer.wallet.id } }))
          .lifetimeEarned.toFixed(4),
      ).toBe('1000.0000');
    });
  });

  // ── Delivery semantics ─────────────────────────────────────────────────

  describe('delivery', () => {
    it('marks an event processed exactly once', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await completedPurchase(user.id, partner.id);

      expect(await outbox.drain()).toBe(1);
      // A second pass must find nothing: processed rows leave the claim query.
      expect(await outbox.drain()).toBe(0);

      const event = await prisma.outboxEvent.findFirstOrThrow();
      expect(event.processedAt).not.toBeNull();
    });

    it('delivers each event to one worker only when several drain at once', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      for (let i = 0; i < 10; i += 1) {
        await completedPurchase(user.id, partner.id);
      }

      const seen: string[] = [];
      outbox.register('probe.event', (payload) => {
        seen.push(payload.id as string);
        return Promise.resolve();
      });
      await prisma.outboxEvent.deleteMany({});
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < 10; i += 1) {
          await outbox.publish(tx, {
            aggregateType: 'Probe',
            aggregateId: `p-${i}`,
            eventType: 'probe.event',
            payload: { id: `p-${i}` },
          });
        }
      });

      // FOR UPDATE SKIP LOCKED is what makes this safe: without it the two
      // passes either block on each other or hand the same row to both.
      const [a, b] = await Promise.all([outbox.drain(), outbox.drain()]);

      expect(a + b).toBe(10);
      expect(new Set(seen).size).toBe(10);
      expect(await prisma.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
    });

    it('does not let a second drain reclaim a row while the first is still inside its handler', async () => {
      // The claim transaction commits before any handler runs, so the row
      // lock from FOR UPDATE SKIP LOCKED is gone by the time a handler is
      // slow — this is what a second `drain()` racing into that gap looks
      // like. A slow handler here is standing in for exactly that gap,
      // widened deliberately so the assertion does not depend on incidental
      // scheduling luck the way the test above does.
      let concurrentHandlerCalls = 0;
      let maxConcurrentHandlerCalls = 0;
      outbox.register('slow.event', async () => {
        concurrentHandlerCalls += 1;
        maxConcurrentHandlerCalls = Math.max(maxConcurrentHandlerCalls, concurrentHandlerCalls);
        await new Promise((resolve) => setTimeout(resolve, 150));
        concurrentHandlerCalls -= 1;
      });

      await prisma.$transaction((tx) =>
        outbox.publish(tx, {
          aggregateType: 'Probe',
          aggregateId: 'slow-1',
          eventType: 'slow.event',
          payload: {},
        }),
      );

      const [a, b] = await Promise.all([outbox.drain(), outbox.drain()]);

      expect(a + b).toBe(1);
      expect(maxConcurrentHandlerCalls).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { processedAt: { not: null } } })).toBe(1);
    });

    it('retries a failing handler with backoff rather than dropping the event', async () => {
      let attempts = 0;
      outbox.register('flaky.event', () => {
        attempts += 1;
        if (attempts < 2) return Promise.reject(new Error('downstream unavailable'));
        return Promise.resolve();
      });

      await prisma.$transaction((tx) =>
        outbox.publish(tx, {
          aggregateType: 'Probe',
          aggregateId: 'flaky-1',
          eventType: 'flaky.event',
          payload: {},
        }),
      );

      expect(await outbox.drain()).toBe(0);
      const failed = await prisma.outboxEvent.findFirstOrThrow();
      expect(failed.processedAt).toBeNull();
      expect(failed.attempts).toBe(1);
      expect(failed.lastError).toContain('downstream unavailable');
      // Backed off, so an immediate pass leaves it alone.
      expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      // When the backoff elapses, it goes through.
      expect(await outbox.drain(new Date(Date.now() + 600_000))).toBe(1);
      expect(
        (await prisma.outboxEvent.findFirstOrThrow()).processedAt,
      ).not.toBeNull();
    });

    it('leaves an exhausted event visible instead of discarding it', async () => {
      outbox.register('poison.event', () => Promise.reject(new Error('always fails')));

      await prisma.$transaction((tx) =>
        outbox.publish(tx, {
          aggregateType: 'Probe',
          aggregateId: 'poison-1',
          eventType: 'poison.event',
          payload: {},
        }),
      );

      for (let i = 0; i < 12; i += 1) {
        await outbox.drain(new Date(Date.now() + i * 600_000));
      }

      // Silently discarding a financial event is worse than a row somebody
      // has to look at, so it stays queryable.
      const dead = await outbox.deadLettered();
      expect(dead).toHaveLength(1);
      expect(dead[0]!.lastError).toContain('always fails');
    });

    it('tolerates a redelivered event, because the handler is idempotent', async () => {
      const referrer = await createCustomer(prisma);
      const referee = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await prisma.referralChallengeParticipant.create({
        data: {
          referrerUserId: referrer.user.id,
          refereeUserId: referee.user.id,
          requiredAmount: '10000',
        },
      });
      await completedPurchase(referee.user.id, partner.id, '10000');

      await outbox.drain();
      // Simulates a worker that ran the handler and died before marking the
      // row — the case at-least-once delivery exists to survive.
      await prisma.outboxEvent.updateMany({ data: { processedAt: null, attempts: 0 } });
      await outbox.drain();

      // Paid once. The participant's QUALIFIED→REWARDED claim is a
      // conditional update, so redelivery finds it already claimed.
      expect(
        await prisma.bonusLedgerEntry.count({
          where: { walletId: referrer.wallet.id, type: 'ACCRUAL_PROMOTION' },
        }),
      ).toBe(1);
    });
  });
});
