import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

/**
 * The BullMQ connection.
 *
 * Deliberately not the shared `REDIS_CLIENT`. That client is configured with
 * `maxRetriesPerRequest: 3` so an application request fails fast when Redis
 * is unreachable rather than hanging a customer's HTTP call. A BullMQ worker
 * needs the opposite: it blocks on `BRPOPLPUSH` for seconds at a time, and
 * with a finite retry count ioredis eventually errors the blocking read and
 * BullMQ refuses to start at all. Two connections with two policies is the
 * correct answer, not one compromise.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: {
          url: config.get('redis.url', { infer: true }),
          maxRetriesPerRequest: null,
        },
        // Namespaced so a Redis shared with the rate limiter, the advisory
        // locks and the SMS throttles cannot collide with queue keys — and so
        // staging and production can share an instance without one draining
        // the other's jobs.
        prefix: config.get('queue.prefix', { infer: true }),
        defaultJobOptions: {
          // Keep enough history to answer "did the nightly reconciliation
          // run, and what happened", and no more.
          removeOnComplete: { age: 7 * 24 * 3600, count: 200 },
          removeOnFail: { age: 30 * 24 * 3600, count: 500 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
