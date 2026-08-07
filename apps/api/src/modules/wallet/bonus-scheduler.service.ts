import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { BonusEngineService } from './bonus-engine.service';

/**
 * Lock TTLs are generous relative to how long a sweep actually takes, so a
 * slow run is not mistaken for a dead one and double-claimed by the next
 * tick — but short enough that a replica that crashes mid-sweep does not
 * lock everyone else out for long.
 */
const LOCK_TTL_MS = 4 * 60_000;

@Injectable()
export class BonusSchedulerService {
  private readonly logger = new Logger(BonusSchedulerService.name);

  constructor(
    private readonly bonusEngine: BonusEngineService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePromotion() {
    try {
      await this.lock.withLock('cron:bonus:promote-pending', LOCK_TTL_MS, () =>
        this.bonusEngine.promotePendingLots(),
      );
    } catch (err) {
      this.logger.error('Failed to promote pending bonus lots', err as Error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiry() {
    try {
      await this.lock.withLock('cron:bonus:expire-lots', LOCK_TTL_MS, () =>
        this.bonusEngine.expireLots(),
      );
    } catch (err) {
      this.logger.error('Failed to expire bonus lots', err as Error);
    }
  }

  /**
   * Returns holds that were never settled.
   *
   * A reservation is created before the payment completes. If the process
   * dies in between, nothing else in the system ever revisits it — the
   * points sit in `reserved` indefinitely, invisible to the customer and
   * unrecoverable without a manual database edit. This sweep is what makes
   * the reserve/settle pair crash-safe.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleExpiredReservations() {
    try {
      await this.lock.withLock('cron:bonus:release-expired-reservations', LOCK_TTL_MS, () =>
        this.bonusEngine.releaseExpiredReservations(),
      );
    } catch (err) {
      this.logger.error('Failed to release expired bonus reservations', err as Error);
    }
  }
}
