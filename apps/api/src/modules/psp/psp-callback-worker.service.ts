import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { ClaimedCallback, PspCallbackInboxService } from './psp-callback-inbox.service';
import { PspPaymentService } from './psp-payment.service';

/**
 * How long one bill's settlement may hold its lock.
 *
 * Generous against how long a settlement actually takes, so a slow run is
 * not mistaken for a dead one; short enough that a worker killed mid-flight
 * does not block that bill for long.
 */
const BILL_LOCK_TTL_MS = 60_000;

/**
 * Turns written-down callbacks into money, one at a time.
 *
 * ## The two things it is careful about
 *
 * **One bill, one settlement at a time.** The inbox's unique `dedupeKey`
 * already collapses a retry of the *same* event into one row, but a provider
 * can legitimately send two different events for one bill — a pre-check and
 * a payment, or a payment and a correction. Those are different rows, and
 * without a per-bill lock two workers could pick them up together and open
 * two settlement transactions for the same purchase. The lock makes that
 * sequential; `settleVerifiedConfirmation` makes the second one a no-op.
 *
 * **Crash safety is the idempotency, not the bookkeeping.** A worker that
 * dies after committing the ledger but before marking the inbox row
 * processed will pick that row up again when its lease lapses. That is
 * correct and intended: the settlement it re-runs finds the attempt already
 * `SUCCEEDED` and returns "already settled" without posting anything. The
 * alternative — marking the row first — is at-most-once, and would lose a
 * payment on a crash rather than repeat a no-op.
 */
@Injectable()
export class PspCallbackWorkerService {
  private readonly logger = new Logger(PspCallbackWorkerService.name);

  constructor(
    private readonly inbox: PspCallbackInboxService,
    private readonly payments: PspPaymentService,
    private readonly locks: DistributedLockService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async processPending(): Promise<{ processed: number; failed: number }> {
    if (!this.config.get('features.tutakPspEnabled', { infer: true })) {
      return { processed: 0, failed: 0 };
    }
    return this.inbox.drain((row) => this.settle(row));
  }

  private async settle(row: ClaimedCallback): Promise<{ attemptId?: string }> {
    if (!row.billId) {
      // Unreachable through the controller, which only queues FINAL rows
      // that verified — and verification requires a bill. Thrown rather than
      // skipped so that if it ever happens it is visible as a failure and
      // eventually dead-letters, instead of being quietly marked processed.
      throw new Error(`Callback ${row.id} has no bill to settle`);
    }

    let settled: { attemptId: string } | undefined;
    const ran = await this.locks.withLock(`psp:bill:${row.billId}`, BILL_LOCK_TTL_MS, async () => {
      const result = await this.payments.settleVerifiedConfirmation({
        billId: row.billId!,
        providerTransactionId: row.providerTransactionId ?? '',
        amount: row.reportedAmount ?? new Decimal(0),
        raw: row.rawPayload,
      });
      settled = { attemptId: result.attemptId };
    });

    if (!ran) {
      // Another worker holds this bill. Not an error and not a success:
      // thrown so the row is retried with backoff rather than marked
      // processed on work that did not happen.
      throw new Error(`Bill ${row.billId} is being settled by another worker`);
    }
    this.logger.log(`Settled callback ${row.id} for bill ${row.billId}`);
    return settled ?? {};
  }
}
