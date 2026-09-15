import { Module } from '@nestjs/common';
import { AlertsModule } from '../../infrastructure/alerts/alerts.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PurchaseIntentsModule } from '../purchase-intents/purchase-intents.module';
import { PspAdapterModule } from './psp-adapter.module';
import { PspAttemptAgeingService } from './psp-attempt-ageing.service';
import { PspAdminController, PspController } from './psp.controller';
import { PspCallbackController } from './psp-callback.controller';
import { PspCallbackInboxService } from './psp-callback-inbox.service';
import { PspCallbackWorkerService } from './psp-callback-worker.service';
import { PspPaymentService } from './psp-payment.service';

/**
 * Provider-backed collection of a purchase's real-money remainder.
 *
 * The adapter is injected by token, so the domain never names Idram. A second
 * provider is a second class and one line here, not a branch in the service.
 */
@Module({
  imports: [AlertsModule, LedgerModule, PurchaseIntentsModule, PspAdapterModule],
  controllers: [PspCallbackController, PspController, PspAdminController],
  providers: [
    PspPaymentService,
    PspAttemptAgeingService,
    PspCallbackInboxService,
    PspCallbackWorkerService,
  ],
  // Re-exports the adapter module rather than the token: the token now lives
  // in `PspAdapterModule`, and Nest may only export what it provides itself.
  exports: [
    PspPaymentService,
    PspAttemptAgeingService,
    PspCallbackInboxService,
    PspCallbackWorkerService,
    PspAdapterModule,
  ],
})
export class PspModule {}
