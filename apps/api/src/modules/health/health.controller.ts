import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfig } from '../../config/configuration';
import { MEDIA_STORAGE, MediaStorage } from '../../infrastructure/media/media-storage.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

/**
 * Version-neutral on purpose: an orchestrator's liveness/readiness probe
 * checks a fixed path, and `/v1/health` breaking on the next version bump
 * would take the health check down with the API it is supposed to protect.
 */
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Liveness: the process is up and answering HTTP. Deliberately checks
   * nothing else — a database blip should not make an orchestrator kill and
   * restart a process that would otherwise recover on its own.
   */
  @Get()
  live() {
    // `demoMode` is reported here rather than only in the boot log so that a
    // deployment can be asked what it is, from outside, by anyone — a
    // dashboard deciding whether to show a banner, or a person wondering
    // whether the payments they are looking at were real. An instance
    // running on a fake acquirer should never be able to keep that quiet.
    return { status: 'ok', demoMode: this.config.get('demoMode', { infer: true }) };
  }

  /**
   * Readiness: the process can actually serve traffic. A load balancer
   * should stop routing here the moment either dependency is unreachable,
   * which liveness alone cannot express.
   */
  @Get('ready')
  async ready() {
    const [db, redis, storage] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
      // A read of a key that does not exist: the cheapest round-trip that
      // still proves the provider is reachable *and* the credentials work.
      // Deliberately expressed through the existing `get` rather than a new
      // `healthCheck()` on `MediaStorage` — that interface's own docblock
      // explains why it stays tiny, and a probe the fake cannot faithfully
      // implement would be a probe that lies in the test suite.
      this.storage.get('__readiness__/probe'),
    ]);

    const checks = {
      database: db.status === 'fulfilled' ? 'ok' : 'error',
      redis: redis.status === 'fulfilled' ? 'ok' : 'error',
      storage: storage.status === 'fulfilled' ? 'ok' : 'error',
      storageDriver: this.storage.driverName,
    };

    if (storage.status === 'rejected') {
      // Reported in the body *and* written to the log, because nothing else
      // would ever say it: a bucket outage is invisible from the outside
      // until somebody notices a missing logo. This line is what an alert
      // can be built on, and what the readiness probe leaves behind.
      this.logger.error(
        `Object storage (${this.storage.driverName}) is unreachable: ${
          storage.reason instanceof Error ? storage.reason.message : String(storage.reason)
        }`,
      );
    }

    // Only the two that make a request impossible take the instance out of
    // rotation. Object storage deliberately does not: without it an avatar or
    // a partner logo fails to load, while purchases, bonus accrual, referral
    // payouts and refunds all complete normally. Failing readiness on it
    // would turn a cosmetic outage into a total one — the load balancer would
    // pull every replica out and the till would stop working because a logo
    // could not be fetched. It is reported, loudly, and an alert can act on
    // it; it is not a reason to stop serving.
    if (db.status === 'rejected' || redis.status === 'rejected') {
      throw new HttpException({ status: 'error', checks }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status: 'ok', checks };
  }
}
