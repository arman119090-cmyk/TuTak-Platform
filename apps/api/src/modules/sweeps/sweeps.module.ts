import { BullModule } from '@nestjs/bullmq';
import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { EvChargingModule } from '../ev-charging/ev-charging.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { WalletModule } from '../wallet/wallet.module';
import { SweepsHeartbeatService } from './sweeps.heartbeat.service';
import { SWEEPS_QUEUE } from './sweeps.jobs';
import { SweepsProcessor } from './sweeps.processor';
import { SweepsScheduler } from './sweeps.scheduler';

/**
 * Everything that runs without a request behind it.
 *
 * This module is the only place recurring work is wired up, and it depends on
 * the domain modules rather than the reverse — so a domain service has no idea
 * it is being swept, and nothing in the request path drags a queue in with it.
 *
 * Both halves are gated on `SWEEPS_ENABLED` (default on). Turning it off gives
 * a process that serves HTTP and runs nothing on a timer, which is what the
 * load harness wants — a background drainer competing for the same rows is
 * measurement noise — and what a dedicated web tier wants if the sweeps are
 * ever moved to their own deployment.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: SWEEPS_QUEUE }),
    WalletModule,
    EvChargingModule,
    LedgerModule,
    ReconciliationModule,
  ],
  providers: [SweepsProcessor, SweepsScheduler, SweepsHeartbeatService],
})
export class SweepsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(SweepsModule.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('sweeps.enabled', { infer: true })) {
      this.logger.warn(
        'SWEEPS_ENABLED is false — no recurring jobs will be scheduled or processed by this instance.',
      );
    }
  }
}
