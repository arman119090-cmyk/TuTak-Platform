import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { ReconciliationService } from './reconciliation.service';

/** Reconciliation reads every account and replays every posting — give it room. */
const LOCK_TTL_MS = 15 * 60_000;

/**
 * Runs the internal-consistency half of reconciliation nightly.
 *
 * No external statement is passed, because neither an acquirer feed nor a
 * bank feed exists yet. What it can do without either — replay every
 * account against its own postings — is the check most worth running
 * unattended anyway: it catches the ledger disagreeing with itself, which is
 * a bug in this codebase rather than a dispute with a third party.
 */
@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNightlyReconciliation() {
    try {
      await this.lock.withLock('cron:reconciliation:nightly', LOCK_TTL_MS, async () => {
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const periodStart = new Date(
          Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()),
        );

        await this.reconciliation.reconcile({ periodStart });
      });
    } catch (err) {
      this.logger.error('Nightly reconciliation failed', err as Error);
    }
  }
}
