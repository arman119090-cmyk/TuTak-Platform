import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EvReservationsService } from './ev-reservations.service';

@Injectable()
export class EvSchedulerService {
  private readonly logger = new Logger(EvSchedulerService.name);

  constructor(private readonly reservationsService: EvReservationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleStaleReservations() {
    try {
      await this.reservationsService.expireStaleReservations();
    } catch (err) {
      this.logger.error('Failed to expire stale EV reservations', err as Error);
    }
  }
}
