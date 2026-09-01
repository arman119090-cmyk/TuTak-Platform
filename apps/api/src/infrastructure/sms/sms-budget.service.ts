import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { REDIS_CLIENT } from '../redis/redis-client.token';

/**
 * A ceiling on how many text messages this platform will send, in total,
 * per hour and per day.
 *
 * Every other limit in the OTP path is keyed to something the caller
 * controls — their phone number, their address — and so bounds one
 * attacker's reach, not the bill. A botnet spread across enough addresses
 * and numbers stays under all of them simultaneously while the carrier
 * invoice grows linearly with the size of the botnet. This is the only
 * limit that does not care who is asking, which is why it is the one that
 * can be reasoned about financially: whatever else happens, the platform
 * cannot be made to send more than `SMS_GLOBAL_MAX_PER_DAY` messages.
 *
 * It lives in the SMS layer rather than in any one flow, so registration,
 * login, phone verification and password reset all draw on the same budget
 * without each having to remember to.
 *
 * ## Fail closed
 *
 * If Redis cannot be reached, sending is refused. This is the opposite of
 * `OtpIpRateLimitService`, and deliberately so: there, failing open costs a
 * weaker rate limit while sign-in keeps working; here, failing open means
 * the *only* protection against unbounded spend is gone, and the damage is
 * money leaving the company rather than a control being loosened. An
 * operator can raise the ceiling in seconds; nobody can un-send a hundred
 * thousand messages.
 */
@Injectable()
export class SmsBudgetService {
  private readonly logger = new Logger(SmsBudgetService.name);
  private readonly maxPerHour: number;
  private readonly maxPerDay: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<AppConfig, true>,
  ) {
    const budget = config.get('sms', { infer: true });
    this.maxPerHour = budget.globalMaxPerHour;
    this.maxPerDay = budget.globalMaxPerDay;
  }

  /**
   * Claims one message against both windows, or throws.
   *
   * Both counters are incremented in a single pipeline so the two windows
   * cannot drift apart under concurrency, and each key's TTL is set only on
   * the increment that created it. `INCR` is atomic, so a message is either
   * fully counted or not counted at all — two replicas racing the last unit
   * of budget produce one success and one refusal, never two successes.
   *
   * A refusal does not decrement. Over-counting a rejected attempt is the
   * safe direction: it costs a little headroom in the current window, while
   * decrementing would let a caller who is being refused keep the budget
   * from ever filling.
   */
  async claim(): Promise<void> {
    const now = Date.now();
    const hourKey = `sms:budget:hour:${Math.floor(now / 3_600_000)}`;
    const dayKey = `sms:budget:day:${Math.floor(now / 86_400_000)}`;

    let hourUsed: number;
    let dayUsed: number;
    try {
      const results = await this.redis
        .pipeline()
        .incr(hourKey)
        .expire(hourKey, 3600, 'NX')
        .incr(dayKey)
        .expire(dayKey, 86_400, 'NX')
        .exec();

      if (!results) throw new Error('Redis pipeline returned no results');
      const hourResult = results[0];
      const dayResult = results[2];
      if (hourResult?.[0] || dayResult?.[0]) {
        throw (hourResult?.[0] ?? dayResult?.[0]) as Error;
      }
      hourUsed = Number(hourResult?.[1]);
      dayUsed = Number(dayResult?.[1]);
      if (!Number.isFinite(hourUsed) || !Number.isFinite(dayUsed)) {
        throw new Error('Redis returned a non-numeric counter');
      }
    } catch (err) {
      this.logger.error(
        `Refusing to send SMS: the global budget could not be checked (${(err as Error).message}). ` +
          'Failing closed — an unmetered carrier bill is not an acceptable degraded mode.',
      );
      throw new ServiceUnavailableException(
        'Verification code delivery is temporarily unavailable. Please try again later.',
      );
    }

    if (hourUsed > this.maxPerHour || dayUsed > this.maxPerDay) {
      const which = hourUsed > this.maxPerHour ? 'hourly' : 'daily';
      this.logger.error(
        `Global SMS ${which} budget exhausted (hour ${hourUsed}/${this.maxPerHour}, ` +
          `day ${dayUsed}/${this.maxPerDay}). Refusing further sends until the window rolls over. ` +
          'If this is legitimate traffic, raise SMS_GLOBAL_MAX_PER_HOUR / SMS_GLOBAL_MAX_PER_DAY.',
      );
      throw new ServiceUnavailableException(
        'Verification code delivery is temporarily unavailable. Please try again later.',
      );
    }
  }
}
