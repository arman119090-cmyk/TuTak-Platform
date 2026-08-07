import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { OutboxService } from './outbox.service';

/** See bonus-scheduler.service.ts for why the TTL sits well above a normal run. */
const LOCK_TTL_MS = 2 * 60_000;

/**
 * Nothing else in the running process calls `OutboxService.drain()` — every
 * caller before this was a test driving it directly. Without a schedule the
 * durable-outbox pattern (docs/AUDIT_FINAL_2026-08.md H-2) writes rows
 * nothing ever reads: correct on death, but only if something eventually
 * comes back for them.
 */
@Injectable()
export class OutboxSchedulerService {
  private readonly logger = new Logger(OutboxSchedulerService.name);

  constructor(
    private readonly outbox: OutboxService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleDrain() {
    try {
      await this.lock.withLock('cron:outbox:drain', LOCK_TTL_MS, async () => {
        await this.outbox.drain();
      });
    } catch (err) {
      this.logger.error('Failed to drain outbox', err as Error);
    }
  }
}
