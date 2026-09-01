import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis-client.token';

/**
 * Per-source-address ceilings on OTP issuance and OTP verification.
 *
 * `AuthOtpService`'s own ceilings are keyed by phone number, which bounds
 * what can be done to *one* account and nothing else: an attacker walking a
 * list of numbers gets a fresh budget for every number, because each one is
 * a different key. `ThrottlerGuard` does key on `req.ip`, but only in a
 * 5-minute burst window and only in this process's memory, so the ceiling
 * multiplies by the number of replicas — this platform runs more than one
 * (docs/MULTI_INSTANCE.md). These counters close both gaps: one hour wide,
 * and in Redis, so every replica decrements the same budget.
 *
 * The numbers are deliberately loose. Carrier-grade NAT puts thousands of
 * real subscribers behind one address, so a limit tuned to "how many codes
 * should one *person* need" would lock out an entire mobile network. They
 * are set instead to sit above plausible shared-address traffic and far
 * below what a credential attack needs, leaving the per-phone limits to do
 * the precise work. Verification is allowed a higher ceiling than issuance
 * because one legitimately issued code can be mistyped a few times.
 *
 * Fails open. Redis being unreachable must not take sign-in down with it
 * (docs/AUDIT_2026-08-B.md §H12), and the per-phone ceilings — which live in
 * Postgres — still apply when this returns without deciding.
 */
export const MAX_OTP_ISSUANCE_PER_IP_PER_HOUR = 60;
export const MAX_OTP_VERIFICATION_PER_IP_PER_HOUR = 120;
const WINDOW_SECONDS = 3600;

export type OtpIpAction = 'issue' | 'verify';

@Injectable()
export class OtpIpRateLimitService {
  private readonly logger = new Logger(OtpIpRateLimitService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private limitFor(action: OtpIpAction): number {
    return action === 'issue'
      ? MAX_OTP_ISSUANCE_PER_IP_PER_HOUR
      : MAX_OTP_VERIFICATION_PER_IP_PER_HOUR;
  }

  /**
   * Counts one attempt from `ipAddress` and throws once the hour's budget is
   * spent. A missing address is not counted: `req.ip` is only absent for
   * in-process calls (tests, internal callers), and inventing a shared
   * "unknown" bucket for those would let one such caller exhaust a budget
   * that no real client shares.
   *
   * The error deliberately matches the phone-keyed one word for word. A
   * distinct message would tell an attacker which ceiling they hit, and
   * therefore whether the number they are probing is one they have already
   * spent attempts on.
   */
  async consume(ipAddress: string | undefined, action: OtpIpAction): Promise<void> {
    if (!ipAddress) return;

    const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `otp:ip:${action}:${ipAddress}:${bucket}`;

    let used: number;
    try {
      used = await this.redis.incr(key);
      if (used === 1) await this.redis.expire(key, WINDOW_SECONDS);
    } catch (err) {
      this.logger.warn(
        `OTP per-IP limit not enforced for this request: ${(err as Error).message}`,
      );
      return;
    }

    if (used > this.limitFor(action)) {
      throw new BadRequestException('Too many codes requested. Try again later.');
    }
  }
}
