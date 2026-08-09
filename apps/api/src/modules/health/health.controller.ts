import { Controller, Get, HttpException, HttpStatus, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfig } from '../../config/configuration';
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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    const [db, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const checks = {
      database: db.status === 'fulfilled' ? 'ok' : 'error',
      redis: redis.status === 'fulfilled' ? 'ok' : 'error',
    };

    if (db.status === 'rejected' || redis.status === 'rejected') {
      throw new HttpException({ status: 'error', checks }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status: 'ok', checks };
  }
}
