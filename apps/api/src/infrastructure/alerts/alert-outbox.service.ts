import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AlertDeliveryStatus, Prisma } from '@prisma/client';
import { Alert, ALERT_CHANNEL, AlertChannel, AlertDelivery } from './alert-channel.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Backoff between redelivery attempts, capped.
 *
 * A channel that is down for a minute should not delay the alert by an hour,
 * and a channel that is down for a day should not be hammered every minute.
 * One minute doubling to fifteen is the same shape, and the same ceiling, as
 * the suppression window `AlertsService` uses for new fires.
 */
const FIRST_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 15 * 60;

/** How long a worker may hold a row before another may take it over. */
const LEASE_SECONDS = 60;

/** Rows per drain. Enough to clear a backlog, small enough to bound one run. */
const BATCH = 25;

/**
 * Delivered rows are evidence for a while and clutter forever.
 *
 * Thirty days matches the retention the rest of the platform uses for
 * operational records, and is long enough to answer "were we told, and when"
 * about last month's incident.
 */
const KEEP_DELIVERED_DAYS = 30;

export function retryDelaySeconds(attempts: number): number {
  return Math.min(FIRST_RETRY_SECONDS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_SECONDS);
}

/**
 * The durable half of alerting (audit 22.09.2026, D05).
 *
 * `AlertsService` suppresses repeats and sends; this remembers. The
 * distinction matters for exactly one class of alert — the kind that fires
 * once and never again, because the thing it describes has reached a terminal
 * state: a dead-lettered outbox event, a PSP callback that gave up. For those
 * there is no "next fire" to shorten a window for. If the channel is down in
 * that second, the only notice anyone would ever have had is gone.
 *
 * So the alert is written here *before* it is sent, and `redeliverDue()` —
 * run by the `alerts.redeliver` sweep — keeps trying until a channel accepts
 * it. Claiming is `FOR UPDATE SKIP LOCKED` under a lease, so several replicas
 * drain the same table without delivering the same row twice.
 *
 * What this does *not* promise is exactly-once delivery to a human. A channel
 * that accepts a message and loses its answer will be sent the message again:
 * the platform would rather an operator sees a duplicate than misses a dead
 * payment callback. That trade is stated here because it is a choice, not an
 * oversight.
 */
@Injectable()
export class AlertOutboxService {
  private readonly logger = new Logger(AlertOutboxService.name);

  constructor(
    @Inject(ALERT_CHANNEL) private readonly channel: AlertChannel,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** False when this deployment has no database wired in (the verify script). */
  get durable(): boolean {
    return this.prisma !== undefined;
  }

  /**
   * Writes the alert down before anybody tries to send it.
   *
   * Returns the row id, or `null` when there is nothing to write to. A
   * failure here is logged and swallowed: alerting must never throw into the
   * failure path that raised it, and a sent-but-unrecorded alert is strictly
   * better than a recorded-but-unsent one.
   */
  async record(alert: Alert): Promise<string | null> {
    if (!this.prisma) return null;
    try {
      const row = await this.prisma.alertOutboxEvent.create({
        data: {
          key: alert.key,
          severity: alert.severity,
          title: alert.title,
          body: alert.body,
          context: (alert.context ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      this.logger.error(
        `Could not record alert '${alert.key}' for redelivery: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Records what the channel answered for a row `record()` created.
   *
   * `delivered` comes from the channel, never from the attempt. A channel
   * that cannot deliver by design — the console fallback, which leaves
   * `retryable` unset — makes the row `UNDELIVERABLE` instead of queueing a
   * retry nothing could satisfy; it stays visible to an operator either way.
   */
  async settle(id: string | null, delivery: AlertDelivery): Promise<void> {
    if (!id || !this.prisma) return;
    try {
      if (delivery.delivered) {
        await this.prisma.alertOutboxEvent.update({
          where: { id },
          data: {
            status: AlertDeliveryStatus.DELIVERED,
            deliveredAt: new Date(),
            attempts: { increment: 1 },
            leaseUntil: null,
            lastError: null,
          },
        });
        return;
      }

      const retryable = delivery.retryable === true;
      const attempts = (
        await this.prisma.alertOutboxEvent.update({
          where: { id },
          data: {
            attempts: { increment: 1 },
            lastError: delivery.detail.slice(0, 500),
            leaseUntil: null,
            status: retryable ? AlertDeliveryStatus.PENDING : AlertDeliveryStatus.UNDELIVERABLE,
          },
          select: { attempts: true },
        })
      ).attempts;

      if (retryable) {
        await this.prisma.alertOutboxEvent.update({
          where: { id },
          data: { nextAttemptAt: new Date(Date.now() + retryDelaySeconds(attempts) * 1000) },
        });
      }
    } catch (err) {
      this.logger.error(
        `Could not settle alert row ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Sends everything that is due and not already in someone else's hands.
   *
   * Claim and send are separate transactions on purpose: holding a database
   * transaction open across an HTTP call to Telegram would tie a connection
   * to a third party's latency. The lease is what covers the gap — a worker
   * that dies mid-send leaves a row whose lease expires and is picked up
   * again, which is the restart case this whole table exists for.
   */
  async redeliverDue(now = new Date()): Promise<{ claimed: number; delivered: number }> {
    if (!this.prisma) return { claimed: 0, delivered: 0 };

    const claimed = await this.claim(now);
    let delivered = 0;

    for (const row of claimed) {
      const delivery = await this.channel
        .send({
          severity: row.severity as Alert['severity'],
          title: row.title,
          body: row.body,
          key: row.key,
          context: (row.context ?? undefined) as Alert['context'],
        })
        .catch((err: unknown) => ({
          delivered: false,
          retryable: true,
          detail: `channel threw: ${err instanceof Error ? err.message : String(err)}`,
        }));

      await this.settle(row.id, delivery);
      if (delivery.delivered) {
        delivered += 1;
        this.logger.log(`Alert '${row.key}' delivered on retry ${row.attempts + 1}`);
      }
    }

    await this.pruneDelivered(now);
    return { claimed: claimed.length, delivered };
  }

  /**
   * Takes a batch under a lease.
   *
   * `SKIP LOCKED` rather than a lock the losers wait on: a second worker
   * should take *different* rows, not queue behind the first. The lease is
   * written in the same statement that selects, so there is no window where a
   * row is selected but unclaimed.
   */
  private async claim(now: Date) {
    const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000);
    return this.prisma!.$queryRaw<
      Array<{
        id: string;
        key: string;
        severity: string;
        title: string;
        body: string;
        context: unknown;
        attempts: number;
      }>
    >`
      UPDATE "alert_outbox_events" SET "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
      WHERE id IN (
        SELECT id FROM "alert_outbox_events"
        WHERE "status" = 'PENDING'::"AlertDeliveryStatus"
          AND "nextAttemptAt" <= ${now}
          AND ("leaseUntil" IS NULL OR "leaseUntil" < ${now})
        ORDER BY "nextAttemptAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH}
      )
      RETURNING id, "key", "severity", "title", "body", "context", "attempts"
    `;
  }

  /** Alerts nobody has been told about yet. What an operator should look at. */
  async undelivered(olderThanMs = 0) {
    if (!this.prisma) return [];
    return this.prisma.alertOutboxEvent.findMany({
      where: {
        status: { in: [AlertDeliveryStatus.PENDING, AlertDeliveryStatus.UNDELIVERABLE] },
        createdAt: { lte: new Date(Date.now() - olderThanMs) },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  private async pruneDelivered(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - KEEP_DELIVERED_DAYS * 24 * 60 * 60 * 1000);
    try {
      await this.prisma!.alertOutboxEvent.deleteMany({
        where: { status: AlertDeliveryStatus.DELIVERED, deliveredAt: { lt: cutoff } },
      });
    } catch (err) {
      this.logger.warn(
        `Could not prune delivered alerts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
