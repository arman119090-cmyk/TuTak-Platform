import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Alert, ALERT_CHANNEL, AlertChannel, AlertDelivery } from './alert-channel.interface';
import { AlertOutboxService } from './alert-outbox.service';
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
 * The window after a send that *failed* (audit 21.09.2026, D05).
 *
 * The suppression key used to be claimed before the send and kept for the
 * full fifteen minutes whatever the receiver answered, so a webhook that was
 * down for one second silenced that key for a quarter of an hour — a failed
 * alert counted as a delivered one. Now a failed send shortens the window
 * to this, doubling on every consecutive failure up to the full window, so
 * a receiver that is back a minute later hears about the problem a minute
 * later, and one that is down for good is retried at the ordinary cadence
 * rather than once. Bounded backoff is the storm protection; the key is
 * never released outright.
 */
const RETRY_WINDOW_SECONDS = 60;

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
    private readonly outbox: AlertOutboxService,
  ) {}

  /**
   * Fires an alert unless the same key fired recently.
   *
   * Returns whether it was actually sent, which is what the tests assert on —
   * "the code called alert()" and "an alert went out" are different claims,
   * and only the second one wakes anybody.
   */
  async fire(alert: Alert): Promise<AlertOutcome> {
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
        return {
          suppressed: true,
          delivered: false,
          channel: this.channel.name,
          detail: 'suppressed: the same key fired within the window',
        };
      }

      // Written down before it is sent, not after (audit 22.09.2026, D05).
      // A crash in between then leaves a PENDING row the sweep picks up,
      // where the other order would leave nothing at all — and for an alert
      // that fires once, on a dead-lettered event or a dead callback, nothing
      // at all is the end of it. Nobody fires it a second time.
      const recorded = await this.outbox.record(alert);
      const delivery = await this.channel.send(alert);
      await this.outbox.settle(recorded, delivery);
      await this.settleWindow(alert.key, delivery);
      return this.outcome(delivery);
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
      // Redis is what suppresses repeats; the outbox is what stops an alert
      // being lost. Losing the first does not excuse skipping the second.
      const recorded = await this.outbox.record(alert);
      const delivery = await this.channel.send(alert).catch((sendErr: unknown) => ({
        delivered: false,
        retryable: true,
        detail: `channel threw: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
      }));
      await this.outbox.settle(recorded, delivery);
      return this.outcome(delivery);
    }
  }

  /**
   * After a send: a delivered alert keeps the full window and clears the
   * failure streak; a retryable failure shortens the window to the bounded
   * backoff. Best-effort — Redis failing here only means the full window
   * stands, which is the old behaviour, not a new failure.
   */
  private async settleWindow(key: string, delivery: AlertDelivery): Promise<void> {
    const sentKey = `alert:sent:${key}`;
    const failuresKey = `alert:failures:${key}`;
    try {
      if (delivery.delivered) {
        await this.redis.del(failuresKey);
        return;
      }
      if (!delivery.retryable) return;
      const failures = await this.redis.incr(failuresKey);
      // Twice the full window: a receiver that is down for good keeps its
      // streak (and the long window) instead of cycling back to a minute.
      await this.redis.expire(failuresKey, SUPPRESS_WINDOW_SECONDS * 2);
      const window = Math.min(RETRY_WINDOW_SECONDS * 2 ** Math.max(0, failures - 1), SUPPRESS_WINDOW_SECONDS);
      // XX: only shorten a window this fire owns; never create one.
      await this.redis.set(sentKey, Date.now().toString(), 'EX', window, 'XX');
      this.logger.warn(
        `Alert '${key}' was not delivered (${delivery.detail}); retry allowed in ${window}s (failure ${failures})`,
      );
    } catch (err) {
      this.logger.error(
        `Could not record the delivery outcome for '${key}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private outcome(delivery: AlertDelivery): AlertOutcome {
    return { suppressed: false, channel: this.channel.name, ...delivery };
  }
}

/**
 * What `fire` did with an alert. `delivered` is the channel's word for "a
 * receiver accepted it", never "we tried" — see `AlertDelivery`.
 */
export interface AlertOutcome extends AlertDelivery {
  suppressed: boolean;
  channel: string;
}
