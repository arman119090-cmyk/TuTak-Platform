import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { Clock } from '../clock';
import { AppLogger } from '../logging/logger.service';
import { InMemoryRateLimiter, RateLimiter } from '../rate-limit.service';
import { Env } from '../../config/env';
import { RedisRateLimiter } from './redis-rate-limiter';

/** The Redis client behind the limiter, exposed so health checks can reach it. */
export const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

/**
 * Picks the limiter from configuration. `memory` is for one process — local
 * work and tests. `redis` is what every deployment with more than one API
 * instance needs, and production refuses to start with anything else (see
 * env.ts). The client is tuned to fail fast: during an outage a request must
 * get its answer (deny, per policy) in well under a second, not hang.
 */
export function rateLimiterProviders(env: Env): Provider[] {
  if (env.RATE_LIMIT_BACKEND !== 'redis') {
    return [
      { provide: RATE_LIMIT_REDIS, useValue: null },
      {
        provide: RateLimiter,
        useFactory: (clock: Clock) => new InMemoryRateLimiter(clock),
        inject: [Clock],
      },
    ];
  }
  return [
    {
      provide: RATE_LIMIT_REDIS,
      useFactory: (logger: AppLogger) => {
        const client = new Redis(env.REDIS_URL as string, {
          lazyConnect: false,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          connectTimeout: 2000,
          commandTimeout: 1000,
          retryStrategy: (attempt) => Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)),
        });
        client.on('error', (error: Error) => {
          // ioredis emits every reconnect failure; the limiter logs the outage once.
          logger.debug(`redis: ${error.message}`, 'RateLimiterRedis');
        });
        return client;
      },
      inject: [AppLogger],
    },
    {
      provide: RateLimiter,
      useFactory: (client: Redis, logger: AppLogger) =>
        new RedisRateLimiter(
          client,
          {
            keyPrefix: env.REDIS_KEY_PREFIX,
            outagePolicy: env.RATE_LIMIT_REDIS_OUTAGE,
          },
          logger,
        ),
      inject: [RATE_LIMIT_REDIS, AppLogger],
    },
  ];
}
