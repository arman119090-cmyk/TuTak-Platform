import { DynamicModule, Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './common/clock';
import { AppLogger } from './common/logging/logger.service';
import { RateLimiter } from './common/rate-limit.service';
import { RATE_LIMIT_REDIS, rateLimiterProviders } from './common/rate-limit/rate-limiter.provider';
import { ENV, Env } from './config/env';

/**
 * Cross-cutting singletons: configuration, the clock, the logger, the rate
 * limiter.
 *
 * Global because everything needs them and threading them through every module's
 * imports adds noise without adding safety. Note what is *not* here: nothing
 * that touches money. Convenience is a fine reason to make a logger global and a
 * poor reason to make a ledger global.
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: ENV, useValue: env },
        AppLogger,
        { provide: Clock, useClass: SystemClock },
        ...rateLimiterProviders(env),
      ],
      exports: [ENV, AppLogger, Clock, RateLimiter, RATE_LIMIT_REDIS],
    };
  }
}
