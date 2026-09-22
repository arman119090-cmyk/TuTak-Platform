import { AlertDeliveryStatus, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import {
  Alert,
  AlertChannel,
  AlertDelivery,
} from '../src/infrastructure/alerts/alert-channel.interface';
import { AlertOutboxService } from '../src/infrastructure/alerts/alert-outbox.service';
import { AlertsService } from '../src/infrastructure/alerts/alerts.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.module';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Audit of 22.09.2026, D05 re-opened: the alert that fires exactly once.
 *
 * The 21.09 fix shortened the Redis suppression window after a failed send,
 * so the *next* `fire()` of the same key is retried rather than swallowed.
 * That is right, and it is not enough. Two of the most serious alerts in the
 * platform have no next fire:
 *
 *   - `outbox.dead-letter:<id>` — the event has exhausted its attempts and
 *     leaves the drain's claim query for good;
 *   - `psp.callback-dead-letter:<id>` — the row is DEAD and never claimed
 *     again.
 *
 * Nothing re-detects either (checked across the codebase: the only other
 * reader is a metrics gauge and an admin list, both of which require somebody
 * to already be looking). So if the channel was down for the one second that
 * alert was sent, the notice is gone — the alert was never delivered and will
 * never be attempted again.
 *
 * These tests drive that case against a real PostgreSQL and a real Redis,
 * with a channel whose answers are scripted. They assert on what a human
 * would receive, and on the rows that guarantee it.
 */
describe('Audit 22.09 — an alert survives a channel that was down (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    redis = harness.app.get(REDIS_CLIENT);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await prisma.alertOutboxEvent.deleteMany({});
    const keys = await redis.keys('alert:*');
    if (keys.length) await redis.del(...keys);
  });

  /** A channel that answers from a script, and counts what it was handed. */
  class ScriptedChannel implements AlertChannel {
    readonly name = 'scripted';
    readonly received: Alert[] = [];
    constructor(private script: AlertDelivery[]) {}
    send(alert: Alert): Promise<AlertDelivery> {
      this.received.push(alert);
      const answer = this.script[Math.min(this.received.length - 1, this.script.length - 1)]!;
      return Promise.resolve(answer);
    }
    rescript(script: AlertDelivery[]) {
      this.script = script;
    }
  }

  const down: AlertDelivery = { delivered: false, detail: 'connect ECONNREFUSED', retryable: true };
  const up: AlertDelivery = { delivered: true, detail: 'telegram answered ok:true' };
  const consoleOnly: AlertDelivery = { delivered: false, detail: 'logged only' };

  const alertFor = (key: string): Alert => ({
    severity: 'critical',
    key,
    title: 'An outbox event gave up',
    body: 'settlement.requested failed 5 times and will not be retried.',
    context: { eventId: 'evt-1' },
  });

  function build(script: AlertDelivery[]) {
    const channel = new ScriptedChannel(script);
    const outbox = new AlertOutboxService(channel, prisma as unknown as PrismaService);
    const alerts = new AlertsService(channel, redis, outbox);
    return { channel, outbox, alerts };
  }

  /** Moves a row's next attempt into the past, the way waiting would. */
  async function makeDue(id?: string) {
    await prisma.alertOutboxEvent.updateMany({
      where: id ? { id } : {},
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
  }

  // ── the case the audit is about ───────────────────────────────────────────

  it('a single fire() whose delivery fails is redelivered when the channel comes back', async () => {
    const { channel, outbox, alerts } = build([down]);

    const outcome = await alerts.fire(alertFor('outbox.dead-letter:evt-1'));
    expect(outcome).toMatchObject({ suppressed: false, delivered: false });

    // Written down as undelivered, with the failure recorded.
    const pending = await prisma.alertOutboxEvent.findMany();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      status: AlertDeliveryStatus.PENDING,
      attempts: 1,
      key: 'outbox.dead-letter:evt-1',
    });
    expect(pending[0]!.lastError).toContain('ECONNREFUSED');
    expect(pending[0]!.deliveredAt).toBeNull();

    // Nobody fires it again — the event is dead-lettered and out of every
    // claim query. The sweep is the only thing left.
    channel.rescript([up]);
    await makeDue();
    const result = await outbox.redeliverDue();

    expect(result).toEqual({ claimed: 1, delivered: 1 });
    expect(channel.received).toHaveLength(2);
    expect(channel.received[1]).toMatchObject({
      key: 'outbox.dead-letter:evt-1',
      title: 'An outbox event gave up',
      context: { eventId: 'evt-1' },
    });
    const settled = await prisma.alertOutboxEvent.findFirstOrThrow();
    expect(settled.status).toBe(AlertDeliveryStatus.DELIVERED);
    expect(settled.deliveredAt).not.toBeNull();
    expect(settled.attempts).toBe(2);
  });

  it('a still-broken channel keeps the alert and backs off instead of dropping it', async () => {
    const { outbox, alerts } = build([down]);
    await alerts.fire(alertFor('psp.callback-dead-letter:cb-1'));

    for (let round = 0; round < 3; round += 1) {
      await makeDue();
      const result = await outbox.redeliverDue();
      expect(result.claimed).toBe(1);
      expect(result.delivered).toBe(0);
    }

    const row = await prisma.alertOutboxEvent.findFirstOrThrow();
    expect(row.status).toBe(AlertDeliveryStatus.PENDING);
    expect(row.attempts).toBe(4);
    // Backoff, not a fixed cadence, and never abandoned.
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(await outbox.undelivered()).toHaveLength(1);
  });

  it('a row written but never sent — the crash between the two — is picked up', async () => {
    // Exactly what a process killed between `record()` and `send()` leaves.
    const orphan = await prisma.alertOutboxEvent.create({
      data: {
        key: 'outbox.dead-letter:evt-crash',
        severity: 'critical',
        title: 'An outbox event gave up',
        body: 'The process died before this was sent.',
        context: { eventId: 'evt-crash' },
      },
    });
    expect(orphan.attempts).toBe(0);

    const { channel, outbox } = build([up]);
    const result = await outbox.redeliverDue();

    expect(result).toEqual({ claimed: 1, delivered: 1 });
    expect(channel.received[0]!.key).toBe('outbox.dead-letter:evt-crash');
    expect((await prisma.alertOutboxEvent.findFirstOrThrow()).status).toBe(
      AlertDeliveryStatus.DELIVERED,
    );
  });

  it('two workers draining together deliver each alert once', async () => {
    const first = build([down]);
    await first.alerts.fire(alertFor('outbox.dead-letter:evt-a'));
    await first.alerts.fire(alertFor('outbox.dead-letter:evt-b'));
    await makeDue();

    const workerA = build([up]);
    const workerB = build([up]);
    const [a, b] = await Promise.all([
      workerA.outbox.redeliverDue(),
      workerB.outbox.redeliverDue(),
    ]);

    // Between them they deliver both, and neither alert goes twice.
    expect(a.delivered + b.delivered).toBe(2);
    const handed = [...workerA.channel.received, ...workerB.channel.received].map((x) => x.key);
    expect(handed.sort()).toEqual(['outbox.dead-letter:evt-a', 'outbox.dead-letter:evt-b']);
    expect(
      await prisma.alertOutboxEvent.count({ where: { status: AlertDeliveryStatus.DELIVERED } }),
    ).toBe(2);
  });

  it('a lease that expires lets another worker finish what a dead one started', async () => {
    const { alerts } = build([down]);
    await alerts.fire(alertFor('outbox.dead-letter:evt-lease'));
    // A worker claimed it and died: lease in the past, still PENDING.
    await prisma.alertOutboxEvent.updateMany({
      data: { leaseUntil: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const { outbox } = build([up]);
    expect(await outbox.redeliverDue()).toEqual({ claimed: 1, delivered: 1 });
  });

  it('a live lease keeps a second worker off the same row', async () => {
    const { alerts } = build([down]);
    await alerts.fire(alertFor('outbox.dead-letter:evt-held'));
    await prisma.alertOutboxEvent.updateMany({
      data: { leaseUntil: new Date(Date.now() + 60_000), nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const { outbox, channel } = build([up]);
    expect(await outbox.redeliverDue()).toEqual({ claimed: 0, delivered: 0 });
    expect(channel.received).toHaveLength(0);
  });

  it('a send whose outcome was never recorded is retried, not lost', async () => {
    // The channel accepted it; the process died before the row was settled.
    // The row still says PENDING, so the alert goes again — a duplicate an
    // operator can read, rather than a silence they cannot.
    const { alerts } = build([up]);
    await alerts.fire(alertFor('outbox.dead-letter:evt-ack-lost'));
    await prisma.alertOutboxEvent.updateMany({
      data: {
        status: AlertDeliveryStatus.PENDING,
        deliveredAt: null,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    const { outbox, channel } = build([up]);
    expect(await outbox.redeliverDue()).toEqual({ claimed: 1, delivered: 1 });
    expect(channel.received).toHaveLength(1);
  });

  it('with no channel that can deliver, the alert is kept and marked, not retried forever', async () => {
    const { outbox, alerts } = build([consoleOnly]);
    await alerts.fire(alertFor('outbox.dead-letter:evt-console'));

    const row = await prisma.alertOutboxEvent.findFirstOrThrow();
    expect(row.status).toBe(AlertDeliveryStatus.UNDELIVERABLE);
    await makeDue();
    expect(await outbox.redeliverDue()).toEqual({ claimed: 0, delivered: 0 });
    // Still visible to an operator, which is the point of keeping it.
    expect(await outbox.undelivered()).toHaveLength(1);
  });

  it('Redis being down does not stop the alert being recorded and redelivered', async () => {
    const { channel, outbox } = build([down]);
    const brokenRedis = {
      set: () => Promise.reject(new Error('redis is down')),
      del: () => Promise.reject(new Error('redis is down')),
      incr: () => Promise.reject(new Error('redis is down')),
      expire: () => Promise.reject(new Error('redis is down')),
    } as unknown as Redis;
    const alerts = new AlertsService(
      channel,
      brokenRedis,
      new AlertOutboxService(channel, prisma as unknown as PrismaService),
    );

    const outcome = await alerts.fire(alertFor('outbox.dead-letter:evt-redisdown'));
    expect(outcome.delivered).toBe(false);
    expect(await prisma.alertOutboxEvent.count()).toBe(1);

    channel.rescript([up]);
    await makeDue();
    expect((await outbox.redeliverDue()).delivered).toBe(1);
  });

  it('the database being unavailable never fails the alert itself', async () => {
    const channel = new ScriptedChannel([up]);
    const brokenPrisma = {
      alertOutboxEvent: {
        create: () => Promise.reject(new Error('database is down')),
      },
    } as unknown as PrismaService;
    const alerts = new AlertsService(channel, redis, new AlertOutboxService(channel, brokenPrisma));

    const outcome = await alerts.fire(alertFor('outbox.dead-letter:evt-dbdown'));
    // The send still happened. Recording is best-effort; alerting is not.
    expect(outcome).toMatchObject({ delivered: true });
    expect(channel.received).toHaveLength(1);
  });

  it('a deployment with no database at all still alerts (the verify script)', async () => {
    const channel = new ScriptedChannel([up]);
    const outbox = new AlertOutboxService(channel);
    expect(outbox.durable).toBe(false);
    const alerts = new AlertsService(channel, redis, outbox);
    expect(await alerts.fire(alertFor('alert-verify:x'))).toMatchObject({ delivered: true });
  });

  it('redelivery carries exactly what was sent, and nothing the caller did not put there', async () => {
    const { channel, outbox, alerts } = build([down]);
    await alerts.fire({
      severity: 'warning',
      key: 'psp.callback-dead-letter:cb-2',
      title: 'A payment callback gave up',
      body: 'A callback for bill 42 failed 5 times.',
      context: { inboxId: 'cb-2', billId: '42', lastError: 'upstream 500' },
    });

    channel.rescript([up]);
    await makeDue();
    await outbox.redeliverDue();

    const [original, replayed] = channel.received;
    expect(replayed).toEqual({
      severity: original!.severity,
      key: original!.key,
      title: original!.title,
      body: original!.body,
      context: original!.context,
    });
    // Nothing about the row's own bookkeeping leaks into the message.
    expect(JSON.stringify(replayed)).not.toMatch(/attempts|leaseUntil|nextAttemptAt/);
  });

  // ── the real caller, end to end ───────────────────────────────────────────

  it('a dead-lettered outbox event reaches a human even though the channel was down', async () => {
    const ledgerOutbox = harness.app.get(OutboxService);
    const alertChannel = new ScriptedChannel([down]);
    const alertOutbox = new AlertOutboxService(alertChannel, prisma as unknown as PrismaService);
    const alerts = new AlertsService(alertChannel, redis, alertOutbox);
    // The service under test is the real one; only its alerting is scripted.
    (ledgerOutbox as unknown as { alerts: AlertsService }).alerts = alerts;
    // A handler that refuses, so the drain takes the failure path for real
    // rather than the test asserting on a path it arranged by hand.
    ledgerOutbox.register('audit.alert-probe', () => {
      throw new Error('downstream refused');
    });

    await prisma.outboxEvent.create({
      data: {
        aggregateType: 'Payment',
        aggregateId: 'pay-1',
        eventType: 'audit.alert-probe',
        payload: {},
        // One short of the limit, so this failure is the one that gives up.
        attempts: 9,
      },
    });

    await ledgerOutbox.drain();

    const row = await prisma.alertOutboxEvent.findFirst({
      where: { key: { startsWith: 'outbox.dead-letter:' } },
    });
    expect(row?.status).toBe(AlertDeliveryStatus.PENDING);

    alertChannel.rescript([up]);
    await makeDue(row!.id);
    expect((await alertOutbox.redeliverDue()).delivered).toBe(1);
    expect(alertChannel.received.map((a) => a.title)).toEqual([
      'An outbox event gave up',
      'An outbox event gave up',
    ]);
  });
});
