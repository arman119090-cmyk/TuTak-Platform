import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppConfig } from '../../config/configuration';

/**
 * The platform-wide off switch for anything that changes state.
 *
 * `EMERGENCY_FREEZE=true` on the API service and every POST/PUT/PATCH/DELETE
 * answers 503 `PLATFORM_FROZEN` before it reaches a controller — purchases,
 * redemptions, settlements, refunds, sign-ups, all of it. Reads keep working
 * so customers can still see their balances and operators can still look at
 * the ledger, and the routes needed to *operate* the freeze stay open: health
 * (so the platform is not pulled from rotation for being frozen), auth (so
 * an operator can log in and an app can refresh its session) and metrics.
 *
 * Why a guard and not a feature flag per module: an incident does not wait
 * for anyone to remember which flags exist. One variable, one restart, and
 * nothing moves money until a human has decided it may again. Webhooks from
 * banks and the PSP are frozen too — they are retried by their senders, and a
 * callback accepted while the platform is being investigated is exactly the
 * kind of write the freeze exists to stop.
 *
 * Deliberately independent of the request's identity: it runs before
 * `JwtAuthGuard`, so an unauthenticated write is refused as frozen rather
 * than as unauthenticated. Nothing about who is calling changes the answer.
 */
@Injectable()
export class EmergencyFreezeGuard implements CanActivate {
  private readonly logger = new Logger(EmergencyFreezeGuard.name);
  private readonly frozen: boolean;
  private announced = false;

  constructor(config: ConfigService<AppConfig, true>) {
    this.frozen = config.get('emergency', { infer: true }).freeze;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.frozen) return true;

    if (!this.announced) {
      this.announced = true;
      this.logger.warn(
        'EMERGENCY_FREEZE is on: every state-changing request outside /health, /auth and ' +
          '/metrics is being refused with 503 PLATFORM_FROZEN. Unset the variable to resume.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (isAllowedWhileFrozen(request.method, request.path ?? request.url ?? '')) return true;

    // `error` is the field `AllExceptionsFilter` surfaces as the response
    // `code`, so clients see `PLATFORM_FROZEN` rather than the class name.
    throw new ServiceUnavailableException({
      error: 'PLATFORM_FROZEN',
      message:
        'The platform is temporarily frozen for maintenance or an incident. Nothing was changed. ' +
        'Please try again later.',
    });
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Anchored on the path with or without the URI version prefix (`/v1/auth/...`,
// `/health` is VERSION_NEUTRAL).
const ALLOWED_PATHS = [/^\/health(\/|$)/, /^\/(v\d+\/)?auth(\/|$)/, /^\/(v\d+\/)?metrics(\/|$)/];

/** Exported for the unit test: the whole decision, with no Nest around it. */
export function isAllowedWhileFrozen(method: string, path: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const pathname = path.split('?')[0] ?? '';
  return ALLOWED_PATHS.some((re) => re.test(pathname));
}
