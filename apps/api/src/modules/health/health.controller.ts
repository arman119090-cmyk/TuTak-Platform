import { Controller, Get, HttpException, HttpStatus, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from '../../common/decorators/public.decorator';
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
  ) {}

  /**
   * Liveness: the process is up and answering HTTP. Deliberately checks
   * nothing else — a database blip should not make an orchestrator kill and
   * restart a process that would otherwise recover on its own.
   */
  @Get()
  live() {
    return { status: 'ok' };
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
