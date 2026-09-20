import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Records the outcome of a call to an external system, so "is X up" is a
 * fact in a table rather than a guess from a pile of failed withdrawals. Any
 * adapter may call it; the admin tile and the alert rules read it.
 */
@Injectable()
export class IntegrationHealthRecorder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async record(integration: string, ok: boolean, error?: string): Promise<void> {
    const now = this.clock.now();
    const lastError = ok ? undefined : (error ?? 'call failed').slice(0, 500);
    try {
      await this.prisma.integrationHealth.upsert({
        where: { integration },
        create: {
          integration,
          status: ok ? 'OK' : 'DOWN',
          lastOkAt: ok ? now : null,
          lastErrorAt: ok ? null : now,
          lastError: lastError ?? null,
          okCount: ok ? 1 : 0,
          errorCount: ok ? 0 : 1,
        },
        update: {
          status: ok ? 'OK' : 'DOWN',
          ...(ok
            ? { lastOkAt: now, okCount: { increment: 1 } }
            : { lastErrorAt: now, errorCount: { increment: 1 }, lastError }),
        },
      });
    } catch {
      // Health bookkeeping must never take a request down with it.
    }
  }
}
