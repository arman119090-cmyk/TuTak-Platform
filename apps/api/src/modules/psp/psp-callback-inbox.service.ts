import { Injectable, Logger } from '@nestjs/common';
import { PspCallbackKind, PspInboxStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/node';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * How many times a callback is retried before it is left for a human.
 *
 * The same figure the outbox uses, for the same reason: patient with a
 * downstream that is briefly down, not infinite with one that is broken.
 */
const MAX_ATTEMPTS = 10;

/** How long a worker's claim on a row survives that worker dying. */
const CLAIM_LEASE_MS = 60_000;

/** Rows claimed per pass. Small: each one opens a settlement transaction. */
const BATCH_SIZE = 20;

/** The value `pendingKey` holds while a row still has work outstanding. */
const PENDING = 'pending';

export interface InboundCallback {
  provider: string;
  kind: PspCallbackKind;
  billId: string | null;
  providerTransactionId: string | null;
  reportedAmount: Decimal | null;
  verified: boolean;
  rejectedReason?: string;
  raw: unknown;
}

export interface RecordResult {
  id: string;
  status: PspInboxStatus;
  /** True when this exact callback had already been written down. */
  duplicate: boolean;
}

/**
 * Everything a provider tells us, written down before anything is done.
 *
 * ## The problem this solves, measured
 *
 * A verified callback used to be settled inside the HTTP request that
 * carried it: one heavy transaction per callback, held for the whole write.
 * Ten concurrent callbacks for a single bill therefore wanted ten
 * connections from a pool of five, and **all ten failed** with "Unable to
 * start a transaction in the given time". Nothing was double-counted because
 * nothing happened at all — which is its own kind of wrong, since the
 * customer had paid. The provider, seeing errors, retries harder.
 *
 * Raising `connection_limit` moves that cliff a little further out and
 * leaves it there. So the HTTP boundary now does only what it must do
 * synchronously — prove the callback genuine and write it down — and
 * answers the provider. The money moves afterwards, once, in a worker.
 *
 * ## Why not the existing outbox
 *
 * `OutboxService.publish` deliberately takes a transaction client and has no
 * non-transactional overload, because an outbox row written outside the
 * transaction that produced it is "a queue with extra steps". That reasoning
 * is right and it is why the outbox cannot be reused here: an inbound
 * callback has no producing transaction. It arrives over HTTP, and the whole
 * point is to commit it *alone*, immediately.
 *
 * The mechanics are deliberately the same, though — `FOR UPDATE SKIP
 * LOCKED`, a lease, capped exponential backoff, a dead-letter that alerts
 * rather than discards — because those are the parts worth copying, and two
 * different answers to "how does durable work get claimed" in one codebase
 * is how one of them rots.
 */
@Injectable()
export class PspCallbackInboxService {
  private readonly logger = new Logger(PspCallbackInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Write the callback down. Fast, single-row, and never touches money.
   *
   * This is everything the provider waits for. It must stay cheap: the
   * provider's timeout is theirs, not ours, and a slow ACK is read as a
   * failure and retried — which is precisely the burst that broke the pool.
   *
   * A duplicate is not an error. `dedupeKey` is the provider's own identity
   * for the event, so a retry collides with the row it is a retry of; the
   * collision is caught and reported as a duplicate, which is the honest
   * answer and lets the caller still return 200.
   */
  async record(callback: InboundCallback): Promise<RecordResult> {
    const dedupeKey = dedupeKeyFor(callback);
    const terminal = !callback.verified || callback.kind === PspCallbackKind.PRECHECK;
    const status = callback.verified
      ? terminal
        ? PspInboxStatus.PROCESSED
        : PspInboxStatus.RECEIVED
      : PspInboxStatus.REJECTED;

    try {
      const row = await this.prisma.pspCallbackInbox.create({
        data: {
          provider: callback.provider,
          kind: callback.kind,
          status,
          dedupeKey,
          billId: callback.billId,
          providerTransactionId: callback.providerTransactionId,
          reportedAmount: callback.reportedAmount,
          verified: callback.verified,
          rejectedReason: callback.verified ? null : (callback.rejectedReason ?? 'unverified'),
          // Verbatim. A dispute is argued on what arrived, and a filtered
          // copy proves nothing. There is no secret in here — Idram's
          // checksum is a digest, and the key that made it lives only in the
          // environment.
          rawPayload: (callback.raw ?? {}) as Prisma.InputJsonValue,
          pendingKey: status === PspInboxStatus.RECEIVED ? PENDING : null,
          processedAt: status === PspInboxStatus.PROCESSED ? new Date() : null,
        },
      });

      if (!callback.verified) {
        // Kept rather than discarded: a callback that fails verification is
        // either a bug in our verifier or somebody trying it on, and both
        // are worth being able to look at afterwards.
        this.logger.warn(
          `Rejected ${callback.provider} callback for bill ${callback.billId ?? '—'}: ` +
            `${callback.rejectedReason ?? 'unverified'}`,
        );
      }
      return { id: row.id, status: row.status, duplicate: false };
    } catch (error) {
      if (!isDedupeCollision(error)) throw error;

      // The provider retrying is normal traffic, not an incident.
      const existing = await this.prisma.pspCallbackInbox.findUniqueOrThrow({
        where: { dedupeKey },
        select: { id: true, status: true },
      });
      this.logger.log(
        `Duplicate ${callback.provider} callback for bill ${callback.billId ?? '—'} ` +
          `(already ${existing.status})`,
      );
      return { id: existing.id, status: existing.status, duplicate: true };
    }
  }

  /**
   * Claim a batch of outstanding callbacks and hand each to `process`.
   *
   * The claim is the same shape the outbox uses. `FOR UPDATE SKIP LOCKED`
   * lets several workers drain without coordinating; the lease is what
   * keeps a claimed row invisible after the claiming transaction commits,
   * because the row lock is gone by the time the handler runs.
   *
   * Rows are processed **one at a time**, deliberately. Each one opens a
   * settlement transaction, and processing a batch in parallel would
   * recreate the pool exhaustion this whole mechanism exists to avoid.
   */
  async drain(
    process: (row: ClaimedCallback) => Promise<{ attemptId?: string }>,
    now = new Date(),
  ): Promise<{ processed: number; failed: number }> {
    const claimed = await this.claim(now);
    let processed = 0;
    let failed = 0;

    for (const row of claimed) {
      try {
        const result = await process(row);
        await this.prisma.pspCallbackInbox.update({
          where: { id: row.id },
          data: {
            status: PspInboxStatus.PROCESSED,
            pendingKey: null,
            leaseUntil: null,
            processedAt: new Date(),
            lastError: null,
            pspPaymentAttemptId: result.attemptId ?? null,
          },
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(row, error);
      }
    }

    return { processed, failed };
  }

  private async claim(now: Date): Promise<ClaimedCallback[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedCallback[]>`
        SELECT id, provider, kind::text AS kind, "billId", "providerTransactionId",
               "reportedAmount", "rawPayload", attempts
          FROM "psp_callback_inbox"
         WHERE "pendingKey" IS NOT NULL
           AND "nextAttemptAt" <= ${now}
           AND attempts < ${MAX_ATTEMPTS}
         ORDER BY "receivedAt"
         LIMIT ${BATCH_SIZE}
           FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return [];

      // The attempt is recorded inside the claiming transaction, so a worker
      // that dies mid-handler has still spent a try: a poisonous callback
      // backs off instead of spinning, and the lease makes the row
      // reclaimable once it lapses rather than stranded for ever.
      await tx.pspCallbackInbox.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          status: PspInboxStatus.PROCESSING,
          attempts: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
          leaseUntil: new Date(now.getTime() + CLAIM_LEASE_MS),
        },
      });
      return rows;
    });
  }

  private async recordFailure(row: ClaimedCallback, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = row.attempts + 1;
    const delayMs = Math.min(2 ** attempts * 1000, 300_000);

    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.pspCallbackInbox.update({
        where: { id: row.id },
        data: {
          status: PspInboxStatus.DEAD,
          pendingKey: null,
          leaseUntil: null,
          lastError: message.slice(0, 500),
        },
      });

      this.logger.error(
        `PSP callback ${row.id} (bill ${row.billId ?? '—'}) gave up after ${MAX_ATTEMPTS}: ${message}`,
      );
      Sentry.withScope((scope) => {
        scope.setTag('service', 'api');
        scope.setTag('psp.inbox_id', row.id);
        Sentry.captureException(error instanceof Error ? error : new Error(message));
      });

      // A dead callback is a customer who paid and whose purchase did not
      // complete. Never silently dropped: the row stays, and somebody is
      // told. Keyed per row so ten stuck callbacks make ten alerts and one
      // stuck callback does not make one a minute.
      await this.alerts.fire({
        severity: 'critical',
        key: `psp.callback-dead-letter:${row.id}`,
        title: 'A payment callback gave up',
        body:
          `A ${row.provider} callback for bill ${row.billId ?? '—'} failed ${MAX_ATTEMPTS} times ` +
          'and will not be retried. The customer may have paid for a purchase that never completed.',
        context: {
          inboxId: row.id,
          billId: row.billId ?? '—',
          providerTransactionId: row.providerTransactionId ?? '—',
          lastError: message.slice(0, 200),
        },
      });
      return;
    }

    await this.prisma.pspCallbackInbox.update({
      where: { id: row.id },
      data: {
        status: PspInboxStatus.RECEIVED,
        nextAttemptAt: new Date(Date.now() + delayMs),
        leaseUntil: null,
        lastError: message.slice(0, 500),
      },
    });
    this.logger.warn(`PSP callback ${row.id} failed, retry ${attempts}: ${message}`);
  }

  /** Callbacks that gave up. Read by the admin surface, not by the worker. */
  deadLettered() {
    return this.prisma.pspCallbackInbox.findMany({
      where: { status: PspInboxStatus.DEAD },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
  }
}

export interface ClaimedCallback {
  id: string;
  provider: string;
  kind: string;
  billId: string | null;
  providerTransactionId: string | null;
  reportedAmount: Decimal | null;
  rawPayload: unknown;
  attempts: number;
}

/**
 * The provider's own identity for an event.
 *
 * Bill plus the provider's transaction id: two deliveries of one payment
 * carry the same pair, and two genuinely different payments cannot. A
 * precheck has no transaction id, so its kind is in the key — otherwise the
 * precheck for a bill would collide with the payment for it.
 */
export function dedupeKeyFor(callback: InboundCallback): string {
  return [
    callback.provider,
    callback.kind,
    callback.billId ?? 'no-bill',
    callback.providerTransactionId ?? 'no-txn',
  ].join(':');
}

function isDedupeCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLowerCase();
  return text.includes('dedupekey');
}
