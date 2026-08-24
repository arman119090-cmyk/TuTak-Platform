import { LedgerAccountType, PrismaClient } from '@prisma/client';
import { Job } from 'bullmq';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { AlertsService } from '../src/infrastructure/alerts/alerts.service';
import { SweepsProcessor } from '../src/modules/sweeps/sweeps.processor';
import { ConfigService } from '@nestjs/config';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { DistributedLockService } from '../src/infrastructure/redis/distributed-lock.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The alerting path.
 *
 * These are the three events that mean money is at risk and no other part of
 * the system will notice: the ledger disagreeing with itself, an outbox event
 * giving up, and a background job that has stopped working. Each was
 * previously written to the log and nowhere else, which is indistinguishable
 * from healthy to anyone not reading logs at the time.
 *
 * Every test here asserts on what an operator would *receive*, not on whether
 * a service called a method — the suppression window sits between the two,
 * and a suppressed alert wakes nobody.
 */
describe('Alerting (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let outbox: OutboxService;
  let reconciliation: ReconciliationService;
  let alerts: AlertsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    outbox = harness.app.get(OutboxService);
    reconciliation = harness.app.get(ReconciliationService);
    alerts = harness.app.get(AlertsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
  });

  describe('reconciliation drift', () => {
    it('tells a human when an account stops agreeing with its own postings', async () => {
      const customer = await createCustomer(prisma);
      const partner = await createPartner(prisma);

      await payments.capture({
        userId: customer.user.id,
        partnerId: partner.id,
        amount: '5000',
        sourceToken: 'tok_ok',
        idempotencyKey: 'alert-drift-1',
      });

      // Corrupt a balance behind the ledger's back — the same shape as a
      // partial write, a bad migration, or a hand-run UPDATE at 2am.
      const account = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: LedgerAccountType.PSP_RECEIVABLE },
      });
      await prisma.ledgerAccount.update({
        where: { id: account.id },
        data: { balance: account.balance.plus(1) },
      });

      await reconciliation.reconcile({ periodStart: new Date() });

      const fired = harness.alerts.matching('reconciliation.drift');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.severity).toBe('critical');
      // The operator must be able to act without opening a terminal: which
      // run, how bad, and whether anyone is currently being refused money.
      expect(fired[0]!.context).toMatchObject({ findings: 1 });
      expect(fired[0]!.context!.runId).toBeDefined();
      expect(fired[0]!.context!.partnersBlocked).toBeDefined();
    });

    it('stays quiet when reconciliation is clean', async () => {
      const customer = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await payments.capture({
        userId: customer.user.id,
        partnerId: partner.id,
        amount: '1000',
        sourceToken: 'tok_ok',
        idempotencyKey: 'alert-clean-1',
      });

      await reconciliation.reconcile({ periodStart: new Date() });

      // An alerting system that fires on success is one people learn to
      // ignore, which costs more than it saves.
      expect(harness.alerts.matching('reconciliation.drift')).toHaveLength(0);
    });
  });

  describe('outbox dead-letter', () => {
    /**
     * An event type whose handler always throws.
     *
     * The first version of this test simply renamed an event to something no
     * handler claimed — which does not fail at all: the drain finds zero
     * handlers, runs none of them, and marks the row processed. A test that
     * proves an alert fires has to make the work genuinely fail, not merely
     * go missing.
     */
    const FAILING = 'test.always-fails';
    const MAX_ATTEMPTS = 10;

    beforeAll(() => {
      outbox.register(FAILING, () => Promise.reject(new Error('handler exploded')));
    });

    /** Writes a failing event already one attempt short of giving up. */
    const armFailingEvent = async () => {
      const created = await prisma.outboxEvent.create({
        data: {
          aggregateType: 'Test',
          aggregateId: 'test',
          eventType: FAILING,
          payload: {},
        },
      });
      return created;
    };

    it('tells a human when an event gives up for good', async () => {
      const event = await armFailingEvent();
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) },
      });

      await outbox.drain();

      const fired = harness.alerts.matching('outbox.dead-letter');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.severity).toBe('critical');
      expect(fired[0]!.context).toMatchObject({ eventId: event.id });

      // And the row is still there to be fixed by hand — the alert reports
      // the problem, it does not clean it up.
      expect(await outbox.deadLettered()).toHaveLength(1);
    });

    it('does not alert while an event still has retries left', async () => {
      const event = await armFailingEvent();
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: 0, nextAttemptAt: new Date(0) },
      });

      await outbox.drain();

      // A transient failure that the next retry fixes is not an incident.
      expect(harness.alerts.matching('outbox.dead-letter')).toHaveLength(0);
    });
  });

  describe('failed background jobs', () => {
    /**
     * Built by hand rather than pulled from the harness.
     *
     * `SweepsModule` is deliberately absent from the test module — a running
     * BullMQ worker would sweep tables in the middle of other suites'
     * assertions. Constructing the processor directly gets the real
     * `onFailed` with the real AlertsService behind it, without ever calling
     * `worker.run()`.
     */
    const buildProcessor = () =>
      new SweepsProcessor(
        {
          bonus: harness.app.get(BonusEngineService),
          reservations: harness.app.get(EvReservationsService),
          sessions: harness.app.get(EvSessionsService),
          outbox,
          reconciliation,
          // Neither is reachable from `onFailed`, which is all this suite
          // drives — and the bundle is now one parameter, so adding a sweep
          // no longer changes this constructor's shape.
          cdrs: undefined as never,
          accountDeletion: undefined as never,
          retention: undefined as never,
          deferredBonusLots: undefined as never,
          purchaseIntents: undefined as never,
          partnerSettlement: undefined as never,
          refunds: undefined as never,
        },
        harness.app.get(DistributedLockService),
        harness.app.get(ConfigService),
        alerts,
        harness.prisma as unknown as PrismaService,
      );

    it('tells a human once a job has stopped retrying', async () => {
      const processor = buildProcessor();

      await processor.onFailed(
        { name: 'outbox.drain', attemptsMade: 3, opts: { attempts: 3 } } as unknown as Job,
        new Error('connection reset'),
      );

      const fired = harness.alerts.matching('sweep.failed');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.context).toMatchObject({ job: 'outbox.drain', attempts: 3 });
    });

    it('is silent while retries remain', async () => {
      const processor = buildProcessor();

      await processor.onFailed(
        { name: 'outbox.drain', attemptsMade: 1, opts: { attempts: 3 } } as unknown as Job,
        new Error('connection reset'),
      );

      // BullMQ emits `failed` on every attempt. Paging on the first of three
      // means paging for blips that fix themselves seconds later.
      expect(harness.alerts.matching('sweep.failed')).toHaveLength(0);
    });
  });

  describe('suppression', () => {
    it('sends the first alert for a key and swallows the rest', async () => {
      const alert = {
        severity: 'critical' as const,
        key: 'test.repeat',
        title: 'Something',
        body: 'Happened',
      };

      expect(await alerts.fire(alert)).toBe(true);
      expect(await alerts.fire(alert)).toBe(false);
      expect(await alerts.fire(alert)).toBe(false);

      // The window exists so an operator does not mute the channel — and a
      // muted channel is worse than none, because it still looks alive.
      expect(harness.alerts.matching('test.repeat')).toHaveLength(1);
    });

    it('treats distinct keys independently', async () => {
      await alerts.fire({ severity: 'warning', key: 'test.a', title: 'A', body: 'a' });
      await alerts.fire({ severity: 'warning', key: 'test.b', title: 'B', body: 'b' });

      // Ten stuck outbox events are ten problems; the window must not
      // collapse them into one.
      expect(harness.alerts.sent).toHaveLength(2);
    });
  });
});
