import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentProviderPort } from '../payment-provider/payment-provider.port';
import { YandexFleetPort } from '../yandex/yandex.port';
import { NotificationPort } from '../notifications/notification.port';
import { RateLimiter } from '../../common/rate-limit.service';
import { IntegrationHealthRecorder } from '../integration-health/integration-health.recorder';
import { SmsGatewayPort } from '../auth/sms-gateway.port';
import { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter';

/**
 * Integration health, recorded rather than inferred.
 *
 * The admin panel needs to answer "is Yandex up" without an operator guessing
 * from a pile of failed withdrawals, and the tile must say plainly when it is
 * looking at a mock rather than the real thing — an integration tile that shows
 * a green mock is worse than no tile.
 */
@Injectable()
export class IntegrationHealthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly yandex: YandexFleetPort,
    private readonly provider: PaymentProviderPort,
    private readonly push: NotificationPort,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsGatewayPort,
    private readonly recorder: IntegrationHealthRecorder,
    private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async probe(): Promise<void> {
    const park = await this.prisma.park.findFirst({
      where: { status: 'ACTIVE', credential: { isNot: null } },
      orderBy: { createdAt: 'asc' },
      select: { yandexParkId: true },
    });
    const yandexParkId = park?.yandexParkId ?? this.env.YANDEX_PARK_ID;
    await this.record(
      'yandex-fleet',
      yandexParkId ? await this.safe(() => this.yandex.ping(yandexParkId)) : false,
    );
    await this.record('idram', await this.safe(() => this.provider.ping()));
    if (this.sms.mode === 'live') {
      await this.record(this.sms.name, await this.safe(() => this.sms.ping()));
    }
    if (this.limiter instanceof RedisRateLimiter) {
      await this.record('redis', await this.limiter.ping());
    }
  }

  async snapshot() {
    const rows = await this.prisma.integrationHealth.findMany();
    const byName = new Map(rows.map((row) => [row.integration, row]));

    return [
      this.describe('yandex-fleet', byName.get('yandex-fleet'), this.env.YANDEX_MODE),
      this.describe('idram', byName.get('idram'), this.env.PROVIDER_MODE),
      this.describe('sms', byName.get(this.sms.name), this.sms.mode),
      this.describe('push', byName.get(this.push.name), this.push.mode),
      // The rate limiter's store: `memory` is a mode, not a fake, but it is
      // shown the same way so an operator sees at once that only one API
      // instance is being limited.
      this.describe(
        'redis',
        byName.get('redis'),
        this.env.RATE_LIMIT_BACKEND === 'redis' ? 'live' : 'mock',
      ),
    ];
  }

  private describe(
    name: string,
    row:
      | {
          status: string;
          lastOkAt: Date | null;
          lastErrorAt: Date | null;
          lastError: string | null;
          okCount: number;
          errorCount: number;
        }
      | undefined,
    mode: 'mock' | 'live',
  ) {
    return {
      integration: name,
      mode,
      /** Never let a mock look like a working integration. */
      status: mode === 'mock' ? 'MOCK' : (row?.status ?? 'UNKNOWN'),
      lastOkAt: row?.lastOkAt?.toISOString() ?? null,
      lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      okCount: row?.okCount ?? 0,
      errorCount: row?.errorCount ?? 0,
    };
  }

  private async safe(fn: () => Promise<boolean>): Promise<boolean> {
    try {
      return await fn();
    } catch {
      return false;
    }
  }

  private record(integration: string, ok: boolean): Promise<void> {
    return this.recorder.record(integration, ok, ok ? undefined : 'ping failed');
  }
}
