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
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
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
    private readonly alerts: AlertsService,
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
      const reason =
        storage.reason instanceof Error ? storage.reason.message : String(storage.reason);

      // Reported in the body *and* written to the log, because nothing else
      // would ever say it: a bucket outage is invisible from the outside
      // until somebody notices a missing logo.
      this.logger.error(`Object storage (${this.storage.driverName}) is unreachable: ${reason}`);

      // And told to a person, which the log alone never does. This is the
      // alert this line was always described as being available for — the
      // one dependency whose failure deliberately does *not* take the
      // instance out of rotation, and therefore the one failure that
      // produces no other signal anywhere. Everything else that can break
      // here either fails readiness (and shows up as a deployment going
      // unhealthy) or already fires its own alert.
      //
      // One key for the whole condition rather than one per probe: readiness
      // is polled every few seconds, and `AlertsService` suppresses a
      // repeated key for fifteen minutes, so a bucket outage is one
      // notification rather than several hundred. Not awaited — readiness
      // must answer the load balancer on time whatever the alert channel is
      // doing, and a rejected send is already handled inside `fire`.
      void this.alerts.fire({
        key: `storage.unreachable:${this.storage.driverName}`,
        severity: 'warning',
        title: 'Object storage is unreachable',
        body:
          `Readiness could not read from ${this.storage.driverName}: ${reason}. ` +
          'Partner logos and customer avatars will not load. Purchases, bonus accrual, ' +
          'referral payouts and refunds are unaffected and the API stays in rotation.',
      });
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
      // Readiness failing takes this instance out of rotation, and that is
      // visible to the platform — but not to a person. Nothing else fires
      // here: the sweeps that would notice a dead database need Redis to
      // run at all, and a dead Redis stops them the same way. So the one
      // process that has just proved a dependency is down is the one that
      // has to say so. Suppressed per dependency for the window; when Redis
      // itself is the failure the suppression check fails and `fire` sends
      // anyway, which is the right trade — a repeated page beats silence.
      // Not awaited: the load balancer is owed an answer on time.
      for (const [name, result] of [
        ['database', db],
        ['redis', redis],
      ] as const) {
        if (result.status !== 'rejected') continue;
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.error(`Readiness: ${name} is unreachable: ${reason}`);
        void this.alerts.fire({
          key: `readiness.${name}.unreachable`,
          severity: 'critical',
          title: `${name === 'database' ? 'Postgres' : 'Redis'} is unreachable`,
          body:
            `Readiness could not reach ${name}: ${reason}. This instance is out of rotation; ` +
            'purchases, bonus accrual and settlements are not being served until it is back.',
        });
      }
      throw new HttpException({ status: 'error', checks }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status: 'ok', checks };
  }
}
