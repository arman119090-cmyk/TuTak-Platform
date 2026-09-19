import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentProviderPort } from '../payment-provider/payment-provider.port';
import { YandexFleetPort } from '../yandex/yandex.port';

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
    private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async probe(): Promise<void> {
    await this.record(
      'yandex-fleet',
      await this.safe(() => this.yandex.ping(this.env.YANDEX_PARK_ID ?? 'unknown')),
    );
    await this.record('payment-provider', await this.safe(() => this.provider.ping()));
  }

  async snapshot() {
    const rows = await this.prisma.integrationHealth.findMany();
    const byName = new Map(rows.map((row) => [row.integration, row]));

    return [
      this.describe('yandex-fleet', byName.get('yandex-fleet'), this.env.YANDEX_MODE),
      this.describe('payment-provider', byName.get('payment-provider'), this.env.PROVIDER_MODE),
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

  private async record(integration: string, ok: boolean): Promise<void> {
    const now = this.clock.now();
    await this.prisma.integrationHealth.upsert({
      where: { integration },
      create: {
        integration,
        status: ok ? 'OK' : 'DOWN',
        lastOkAt: ok ? now : null,
        lastErrorAt: ok ? null : now,
        okCount: ok ? 1 : 0,
        errorCount: ok ? 0 : 1,
      },
      update: {
        status: ok ? 'OK' : 'DOWN',
        ...(ok
          ? { lastOkAt: now, okCount: { increment: 1 } }
          : { lastErrorAt: now, errorCount: { increment: 1 }, lastError: 'ping failed' }),
      },
    });
  }
}
