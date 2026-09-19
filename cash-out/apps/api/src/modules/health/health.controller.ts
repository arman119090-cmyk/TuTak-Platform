import { Controller, Get, Inject } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Liveness: is the process up. Deliberately touches nothing. */
  @Public()
  @Get('healthz')
  live() {
    return { status: 'ok', env: this.env.DEPLOYMENT_ENV };
  }

  /**
   * Readiness: can this instance actually serve traffic. Reports the integration
   * modes plainly, so a deployment running against mocks cannot be mistaken for
   * a working one at a glance.
   */
  @Public()
  @Get('readyz')
  async ready() {
    const checks: Record<string, string> = {};
    let healthy = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
      healthy = false;
    }

    try {
      const balances = await this.ledger.trialBalance();
      const unbalanced = balances.filter((row) => row.difference !== 0n);
      checks.ledger = unbalanced.length === 0 ? 'balanced' : 'UNBALANCED';
      if (unbalanced.length > 0) healthy = false;
    } catch {
      checks.ledger = 'unknown';
    }

    return {
      status: healthy ? 'ok' : 'degraded',
      yandexMode: this.env.YANDEX_MODE,
      providerMode: this.env.PROVIDER_MODE,
      checks,
    };
  }
}
