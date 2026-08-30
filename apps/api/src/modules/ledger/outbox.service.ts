import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';

type Tx = Prisma.TransactionClient;

/** A handler for one event type. Must tolerate being called more than once. */
export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Give up after this many failures and leave the row for a human. */
const MAX_ATTEMPTS = 10;

/** How many events one drain pass claims. Bounded so a backlog cannot stall a worker. */
const BATCH_SIZE = 50;

/**
 * How long a claimed row is invisible to other claimants while its handlers
 * run. `FOR UPDATE SKIP LOCKED` only holds the row lock for the claiming
 * transaction, which commits before handlers execute — without this lease, a
 * second `drain()` racing the first could SELECT the same rows the instant
 * the claim transaction commits and process them a second time before the
 * first claimant ever reaches its `processedAt` update.
 */
const CLAIM_LEASE_MS = 60_000;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Records an event.
   *
   * Takes a transaction client on purpose and has no non-transactional
   * overload: an outbox row written outside the transaction that produced it
   * is just a queue with extra steps, and loses exactly the guarantee the
   * pattern exists for.
   */
  publish(
    tx: Tx,
    event: {
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ) {
    return tx.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Registers a handler.
   *
   * Delivery is at-least-once — a worker that crashes between running a
   * handler and marking the row processed will run it again on the next pass.
   * Handlers must therefore be idempotent, and this is not a detail that can
   * be designed away: the alternative, marking first, is at-most-once and
   * silently drops work.
   */
  register(eventType: string, handler: OutboxHandler) {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Claims and processes one batch.
   *
   * `FOR UPDATE SKIP LOCKED` is what lets several workers drain the same
   * table without coordination: each claims rows the others have not locked,
   * so throughput scales with workers instead of contending. Without it two
   * replicas would either block on each other or process the same event
   * twice.
   *
   * The row lock alone is not enough, though: it is held only for the
   * claiming transaction, which commits before any handler runs. Pushing
   * `nextAttemptAt` out by `CLAIM_LEASE_MS` in that same transaction is what
   * keeps a claimed-but-not-yet-processed row invisible to a concurrent
   * `drain()` for the rest of the processing window — without it, two
   * replicas draining at once could both claim and both process the same
   * event before either reached its `processedAt` update.
   *
   * Returns the number of events successfully handled.
   */
  async drain(now = new Date()): Promise<number> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; eventType: string; payload: Record<string, unknown>; attempts: number }>
      >`
        SELECT id, "eventType", payload, attempts
          FROM "outbox_events"
         WHERE "processedAt" IS NULL
           AND "nextAttemptAt" <= ${now}
           AND attempts < ${MAX_ATTEMPTS}
         ORDER BY "createdAt"
         LIMIT ${BATCH_SIZE}
           FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      // Bump the attempt and extend the lease inside the claiming
      // transaction. A worker that dies mid-handler has still recorded the
      // try, so a poisonous event backs off instead of spinning forever, and
      // the lease means it becomes reclaimable again once it lapses rather
      // than staying invisible forever.
      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
      });

      return rows;
    });

    let handled = 0;
    for (const event of claimed) {
      try {
        for (const handler of this.handlers.get(event.eventType) ?? []) {
          await handler(event.payload);
        }
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), lastError: null },
        });
        handled += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = event.attempts + 1;
        // Exponential backoff, capped. A downstream that is down should be
        // retried patiently, not hammered.
        const delayMs = Math.min(2 ** attempts * 1000, 300_000);

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { nextAttemptAt: new Date(Date.now() + delayMs), lastError: message.slice(0, 500) },
        });

        if (attempts >= MAX_ATTEMPTS) {
          // Left unprocessed and out of the claim query. Silently discarding
          // a financial event would be worse than a row someone has to look
          // at, so it stays visible.
          this.logger.error(
            `Outbox event ${event.id} (${event.eventType}) exhausted ${MAX_ATTEMPTS} attempts: ${message}`,
          );

          // Alongside the alert below, not instead of it. This is the
          // "worker/job failure that escapes existing handling" case — the
          // handler threw, every retry was exhausted, and nothing above this
          // point crashes the process or fails an HTTP request.
          Sentry.withScope((scope) => {
            scope.setTag('service', 'api');
            scope.setTag('outbox.event_type', event.eventType);
            scope.setTag('outbox.attempts', MAX_ATTEMPTS);
            Sentry.captureException(err instanceof Error ? err : new Error(message));
          });

          // A dead-lettered event is work the platform promised itself it
          // would do and then stopped trying to do — most often a settlement
          // that never posted. The money is not lost, but it is stuck, and
          // nothing else in the system will notice: the drain simply stops
          // selecting the row. Keyed per event so ten stuck events produce
          // ten alerts, while one stuck event does not produce one a minute.
          await this.alerts.fire({
            severity: 'critical',
            key: `outbox.dead-letter:${event.id}`,
            title: 'An outbox event gave up',
            body:
              `${event.eventType} failed ${MAX_ATTEMPTS} times and will not be retried. ` +
              'Whatever it was meant to settle has not settled.',
            context: { eventId: event.id, eventType: event.eventType, lastError: message.slice(0, 200) },
          });
        } else {
          this.logger.warn(`Outbox event ${event.id} failed, retry ${attempts}: ${message}`);
        }
      }
    }

    return handled;
  }

  /** Events that gave up. Surfaced so they can be alerted on, not hidden. */
  deadLettered() {
    return this.prisma.outboxEvent.findMany({
      where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
