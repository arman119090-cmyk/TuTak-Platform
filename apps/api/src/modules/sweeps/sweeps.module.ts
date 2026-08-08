import { BullModule } from '@nestjs/bullmq';
import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { EvChargingModule } from '../ev-charging/ev-charging.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { RetentionModule } from '../retention/retention.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { EvReservationsService } from '../ev-charging/ev-reservations.service';
import { EvSessionsService } from '../ev-charging/ev-sessions.service';
import { OutboxService } from '../ledger/outbox.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RetentionService } from '../retention/retention.service';
import { AccountDeletionService } from '../users/account-deletion.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { SweepsHeartbeatService } from './sweeps.heartbeat.service';
import { SWEEPS_QUEUE, SWEEP_DEPENDENCIES, SweepDependencies } from './sweeps.jobs';
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
    RetentionModule,
    UsersModule,
  ],
  providers: [
    // The one place the sweeps' view of the domain is assembled. Adding a
    // sweep that needs a new service means a field here and a field on
    // `SweepDependencies`, and nothing else changes shape.
    {
      provide: SWEEP_DEPENDENCIES,
      inject: [
        BonusEngineService,
        EvReservationsService,
        EvSessionsService,
        OutboxService,
        ReconciliationService,
        AccountDeletionService,
        RetentionService,
      ],
      useFactory: (
        bonus: BonusEngineService,
        reservations: EvReservationsService,
        sessions: EvSessionsService,
        outbox: OutboxService,
        reconciliation: ReconciliationService,
        accountDeletion: AccountDeletionService,
        retention: RetentionService,
      ): SweepDependencies => ({
        bonus,
        reservations,
        sessions,
        outbox,
        reconciliation,
        accountDeletion,
        retention,
      }),
    },
    SweepsProcessor,
    SweepsScheduler,
    SweepsHeartbeatService,
  ],
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
