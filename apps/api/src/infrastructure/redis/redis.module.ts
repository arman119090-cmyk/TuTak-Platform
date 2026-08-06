import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const logger = new Logger('Redis');
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
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
