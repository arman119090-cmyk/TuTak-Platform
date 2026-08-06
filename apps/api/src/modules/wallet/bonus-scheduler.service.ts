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
}
