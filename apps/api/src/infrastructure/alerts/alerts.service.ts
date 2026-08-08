import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Alert, ALERT_CHANNEL, AlertChannel } from './alert-channel.interface';
import { REDIS_CLIENT } from '../redis/redis-client.token';

/**
 * How long the same alert key stays quiet after firing once.
 *
 * Fifteen minutes is chosen against the sweep schedule rather than picked as
 * a round number: the outbox drains every minute, so an event stuck in
 * dead-letter would otherwise alert sixty times an hour, every hour, until
 * someone fixed it. The failure mode this avoids is not noise for its own
 * sake — it is that an operator mutes the channel, and a muted alert channel
 * is strictly worse than none, because it also looks like it is working.
 */
const SUPPRESS_WINDOW_SECONDS = 15 * 60;

/**
 * The one place code asks for a human to be told something.
 *
 * Two properties matter more than the transport:
 *
 * 1. **It never throws.** Callers are already in a failure path; an alert
 *    that could fail the caller would destroy the finding it was reporting.
 * 2. **It repeats itself rarely.** See the window above.
 *
 * Suppression state lives in Redis rather than in memory, because every
 * replica would otherwise alert independently and the window would do
 * nothing at three instances.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(ALERT_CHANNEL) private readonly channel: AlertChannel,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Fires an alert unless the same key fired recently.
   *
   * Returns whether it was actually sent, which is what the tests assert on —
   * "the code called alert()" and "an alert went out" are different claims,
   * and only the second one wakes anybody.
   */
  async fire(alert: Alert): Promise<boolean> {
    try {
      // SET NX EX is the whole suppression mechanism: the first caller to
      // claim the key within the window wins, everyone else is told the key
      // already exists. Atomic, so two replicas noticing the same
      // discrepancy in the same second still produce one notification.
      const claimed = await this.redis.set(
        `alert:sent:${alert.key}`,
        Date.now().toString(),
        'EX',
        SUPPRESS_WINDOW_SECONDS,
        'NX',
      );

      if (claimed !== 'OK') {
        this.logger.debug(`Alert '${alert.key}' suppressed — already sent within the window`);
        return false;
      }

      await this.channel.send(alert);
      return true;
    } catch (err) {
      // Redis being down must not take the alert with it: send anyway and
      // accept the possibility of repeats. An operator complaining about
      // duplicate pages is a much better outcome than silence during a Redis
      // outage, which is exactly when things tend to be going wrong.
      this.logger.error(
        `Suppression check failed for '${alert.key}', sending anyway: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.channel.send(alert).catch(() => undefined);
      return true;
    }
  }
}
