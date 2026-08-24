import { BullModule } from '@nestjs/bullmq';
import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { EvChargingModule } from '../ev-charging/ev-charging.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { PurchaseIntentsModule } from '../purchase-intents/purchase-intents.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { RetentionModule } from '../retention/retention.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { EvCdrReconciliationService } from '../ev-charging/ev-cdr-reconciliation.service';
import { EvReservationsService } from '../ev-charging/ev-reservations.service';
import { EvSessionsService } from '../ev-charging/ev-sessions.service';
import { OutboxService } from '../ledger/outbox.service';
import { RefundEngineService } from '../payments/refund-engine.service';
import { PartnerSettlementCheckService } from '../payouts/partner-settlement-check.service';
import { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RetentionService } from '../retention/retention.service';
import { AccountDeletionService } from '../users/account-deletion.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { SweepsHeartbeatService } from './sweeps.heartbeat.service';
import { SWEEPS_QUEUE, SWEEP_DEPENDENCIES, SweepDependencies } from './sweeps.jobs';
import { SweepsProcessor } from './sweeps.processor';
import { SweepsScheduler } from './sweeps.scheduler';

/**
 * Same flag, same reasoning, as `app.module.ts`'s own `cardPaymentsEnabled`
 * and `sweeps.jobs.ts`'s copy of it: `PaymentsModule` must stay out of the
 * dependency graph entirely unless the legacy card-payment subsystem is
 * explicitly turned on, because its own provider factory refuses to boot in
 * production without a real PSP or `DEMO_MODE=true` — a canonical
 * deployment (no PSP, no card payments) must not be forced through that
 * guard just because this module unconditionally imported it.
 */
const cardPaymentsEnabled = process.env.CARD_PAYMENTS_ENABLED === 'true';

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
    ...(cardPaymentsEnabled ? [PaymentsModule] : []),
    PayoutsModule,
    PurchaseIntentsModule,
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
        EvCdrReconciliationService,
        AccountDeletionService,
        RetentionService,
        DeferredBonusLotService,
        PurchaseIntentsService,
        PartnerSettlementCheckService,
        // Only resolvable when PaymentsModule was actually imported above —
        // Nest calls useFactory with exactly as many arguments as `inject`
        // has entries, so `refunds` below is simply never passed (and stays
        // `undefined`) when this is omitted, rather than a missing-provider
        // boot error.
        ...(cardPaymentsEnabled ? [RefundEngineService] : []),
      ],
      useFactory: (
        bonus: BonusEngineService,
        reservations: EvReservationsService,
        sessions: EvSessionsService,
        outbox: OutboxService,
        reconciliation: ReconciliationService,
        cdrs: EvCdrReconciliationService,
        accountDeletion: AccountDeletionService,
        retention: RetentionService,
        deferredBonusLots: DeferredBonusLotService,
        purchaseIntents: PurchaseIntentsService,
        partnerSettlement: PartnerSettlementCheckService,
        refunds?: RefundEngineService,
      ): SweepDependencies => ({
        bonus,
        reservations,
        sessions,
        outbox,
        reconciliation,
        cdrs,
        accountDeletion,
        retention,
        deferredBonusLots,
        purchaseIntents,
        partnerSettlement,
        refunds,
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
