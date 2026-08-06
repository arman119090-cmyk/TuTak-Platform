import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BonusEngineService } from './bonus-engine.service';

@Injectable()
export class BonusSchedulerService {
  private readonly logger = new Logger(BonusSchedulerService.name);

  constructor(private readonly bonusEngine: BonusEngineService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePromotion() {
    try {
      await this.bonusEngine.promotePendingLots();
    } catch (err) {
      this.logger.error('Failed to promote pending bonus lots', err as Error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiry() {
    try {
      await this.bonusEngine.expireLots();
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
      await this.bonusEngine.releaseExpiredReservations();
    } catch (err) {
      this.logger.error('Failed to release expired bonus reservations', err as Error);
    }
  }
}
