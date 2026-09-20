import { Controller, Get, Header, Headers, Inject } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { constantTimeEquals } from '../../common/crypto/crypto.service';
import { ENV, Env } from '../../config/env';
import { Public } from '../auth/auth.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint. Public in the driver-auth sense (a scraper has
 * no driver token) but gated by METRICS_TOKEN: without it the endpoint does
 * not exist in production, and with it a bearer must match.
 */
@Controller()
export class MetricsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly metrics: MetricsService,
  ) {}

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Headers('authorization') authorization?: string): Promise<string> {
    const token = this.env.METRICS_TOKEN;
    if (!token) {
      if (this.env.NODE_ENV === 'production') throw AppError.notFound('Route');
      return this.metrics.render();
    }
    const presented = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!constantTimeEquals(Buffer.from(presented), Buffer.from(token))) {
      throw new AppError('UNAUTHENTICATED', 'Metrics token required');
    }
    return this.metrics.render();
  }
}
