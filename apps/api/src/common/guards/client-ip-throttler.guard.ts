import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

import type { AppConfig } from '../../config/configuration';
import { clientIpIsPerCaller } from '../../config/client-ip';

/**
 * The global rate limiter, taught the thing the OTP limiter already knew.
 *
 * ## What went wrong
 *
 * `ThrottlerGuard` keys every bucket on `req.ip`. Behind a load balancer,
 * with `TRUST_PROXY` deliberately unset because Render does not strip an
 * inbound `X-Forwarded-For`, `req.ip` is the balancer — the same value for
 * every request on earth. So the per-endpoint limits in `AuthController`
 * were not per caller at all. They were global:
 *
 *   * eight requests a minute locked **every** user out of `/auth/login`;
 *   * three locked password reset for everybody for five minutes.
 *
 * No account, no tooling, no authentication. `curl` in a loop.
 *
 * `client-ip.ts` describes exactly this failure and says
 * `OtpIpRateLimitService` "detects this and stands down rather than locking
 * the whole service out". That was true of the OTP limiter and false of the
 * global guard standing next to it — one mechanism had the defence, the
 * other did not.
 *
 * ## Why standing down is the right answer and not a weakening
 *
 * Without a trustworthy per-caller address there is nothing left to key on.
 * Every alternative — a device id, a header, a body field — is written by the
 * caller, so an attacker rotates it and a legitimate user does not. Such a
 * key stops nobody while still letting one client exhaust a shared bucket.
 *
 * So the choice is between a limit that locks out everyone and no limit at
 * all, and the brute-force protection that actually matters does not depend
 * on this guard:
 *
 *   * per-account lockout (`failedLoginCount` / `lockedUntil`) bounds
 *     credential stuffing against any single account;
 *   * `SmsBudgetService` bounds what an attacker can spend on messages,
 *     in Redis, shared across instances;
 *   * `OtpIpRateLimitService` re-enables itself the moment the address is
 *     trustworthy.
 *
 * This guard does the same: the moment `CLIENT_IP_STRATEGY=xff-depth` is set
 * with a measured hop count, every limit here starts applying per caller
 * again, with no further change.
 *
 * The state is announced once at startup rather than left to be discovered,
 * because "the limiter is off" is exactly the kind of thing that should not
 * be quiet.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  private readonly log = new Logger(ClientIpThrottlerGuard.name);
  private readonly perCallerIp: boolean;
  private announced = false;

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<AppConfig, true>,
  ) {
    super(options, storageService, reflector);
    this.perCallerIp = clientIpIsPerCaller(config.get('clientIp', { infer: true }));
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (this.perCallerIp) return super.shouldSkip(context);

    if (!this.announced) {
      this.announced = true;
      this.log.warn(
        'Request rate limiting is STOOD DOWN: req.ip is the load balancer, so every ' +
          'caller shares one bucket and any single client could lock the rest out. ' +
          'Per-account lockout and the global SMS budget still apply. Set ' +
          'CLIENT_IP_STRATEGY=xff-depth with a measured CLIENT_IP_TRUSTED_HOPS to ' +
          'restore per-caller limits.',
      );
    }
    return true;
  }
}
