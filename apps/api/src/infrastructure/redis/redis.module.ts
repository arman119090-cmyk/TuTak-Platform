import { isPublicDeployment } from '../../config/app-environment';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { DistributedLockService } from './distributed-lock.service';
import { REDIS_CLIENT } from './redis-client.token';

export { REDIS_CLIENT };

/**
 * Unlike DATABASE_URL/JWT secrets (always required), REDIS_URL has a
 * `redis://localhost:6379` default so local dev never needs an env file.
 * That same default is a launch hazard: a production deploy that simply
 * forgets REDIS_URL would silently connect to a localhost Redis inside its
 * own container — usually nothing there — instead of failing at boot the
 * way SmsModule/PushModule/the PSP adapter already do for their own
 * required-in-production settings. Advisory locks and the sweep queue
 * depend on this being the real shared instance, not an
 * accidentally-empty local one. Extracted so this decision is testable
 * without opening a real Redis connection.
 */
export function assertRedisUrlConfigured(opts: {
  isProduction: boolean;
  hasExplicitUrl: boolean;
  demoMode: boolean;
}): void {
  if (opts.isProduction && !opts.hasExplicitUrl && !opts.demoMode) {
    throw new Error(
      'REDIS_URL must be configured in production — advisory locks and the sweep ' +
        'queue cannot share state with a default localhost connection.',
    );
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const logger = new Logger('Redis');

        assertRedisUrlConfigured({
          isProduction: isPublicDeployment(config.get('appEnv', { infer: true })),
          hasExplicitUrl: Boolean(process.env.REDIS_URL),
          demoMode: config.get('demoMode', { infer: true }),
        });

        const client = new Redis(config.get('redis.url', { infer: true }), {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });

        // Without a listener, ioredis's 'error' event is an unhandled
        // EventEmitter error and Node terminates the process: a Redis blip
        // took the whole API down (docs/AUDIT_2026-08-B.md §H12). Logging it
        // lets the built-in retry strategy do its job.
        client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
        client.on('reconnecting', () => logger.warn('Reconnecting to Redis'));

        return client;
      },
    },
    DistributedLockService,
  ],
  exports: [REDIS_CLIENT, DistributedLockService],
})
export class RedisModule {}
