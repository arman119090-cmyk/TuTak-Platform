import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { EvReservationsService } from './ev-reservations.service';
import { EvSessionsService } from './ev-sessions.service';

/** See bonus-scheduler.service.ts for why the TTL sits well above a normal run. */
const LOCK_TTL_MS = 4 * 60_000;

@Injectable()
export class EvSchedulerService {
  private readonly logger = new Logger(EvSchedulerService.name);

  constructor(
    private readonly reservationsService: EvReservationsService,
    private readonly sessionsService: EvSessionsService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleStaleReservations() {
    try {
      await this.lock.withLock('cron:ev:expire-stale-reservations', LOCK_TTL_MS, () =>
        this.reservationsService.expireStaleReservations(),
      );
    } catch (err) {
      this.logger.error('Failed to expire stale EV reservations', err as Error);
    }
  }

  /**
   * Frees bays held by sessions nobody ever stopped. Without it a connector
   * stayed CHARGING indefinitely and the station was lost to the network.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleStaleSessions() {
    try {
      await this.lock.withLock('cron:ev:expire-stale-sessions', LOCK_TTL_MS, () =>
        this.sessionsService.expireStaleSessions(),
      );
    } catch (err) {
      this.logger.error('Failed to close stale EV sessions', err as Error);
    }
  }
}
