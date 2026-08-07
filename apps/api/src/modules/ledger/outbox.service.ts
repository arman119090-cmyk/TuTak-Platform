import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** A handler for one event type. Must tolerate being called more than once. */
export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Give up after this many failures and leave the row for a human. */
const MAX_ATTEMPTS = 10;

/** How many events one drain pass claims. Bounded so a backlog cannot stall a worker. */
const BATCH_SIZE = 50;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();

  constructor(private readonly prisma: PrismaService) {}

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

      // Bump the attempt inside the claiming transaction. A worker that dies
      // mid-handler has still recorded the try, so a poisonous event backs
      // off instead of spinning forever.
      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { attempts: { increment: 1 } },
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
