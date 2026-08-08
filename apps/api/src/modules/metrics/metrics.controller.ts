import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfig } from '../../config/configuration';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint.
 *
 * Version-neutral for the same reason as `/health`: a scrape config points at
 * a fixed path, and moving it on a version bump silently blinds the
 * dashboards.
 *
 * `@Public()` only in the sense that it does not carry a user session — it is
 * gated on a shared token instead, because these numbers are the business:
 * revenue per hour, outstanding liability, how much is sitting in clearing.
 * Serving that to the internet would be handing a competitor the operating
 * figures and an attacker a map of when the platform is busy.
 *
 * With no token configured the endpoint refuses outright rather than falling
 * back to open. An accidentally public metrics endpoint is the classic way
 * this data leaks, and it leaks quietly.
 */
@Public()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Headers('authorization') authorization?: string): Promise<string> {
    const expected = this.config.get('metrics.token', { infer: true });

    if (!expected) {
      throw new ForbiddenException(
        'Metrics are disabled: set METRICS_TOKEN and scrape with a bearer token.',
      );
    }

    const provided = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (!MetricsController.matches(provided, expected)) {
      throw new ForbiddenException('Invalid metrics token');
    }

    return this.metrics.scrape();
  }

  /**
   * Constant-time comparison.
   *
   * A `===` here leaks the token one byte at a time to anyone willing to
   * measure response times across a few thousand requests, and a scrape
   * endpoint is exactly the sort of thing that gets hammered without anyone
   * finding it suspicious. Lengths are compared first because
   * `timingSafeEqual` throws on a mismatch — that comparison leaks only the
   * length, which is not secret.
   */
  private static matches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
