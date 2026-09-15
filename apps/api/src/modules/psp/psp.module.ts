import { Module } from '@nestjs/common';
import { AlertsModule } from '../../infrastructure/alerts/alerts.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PurchaseIntentsModule } from '../purchase-intents/purchase-intents.module';
import { PspAdapterModule } from './psp-adapter.module';
import { PspAttemptAgeingService } from './psp-attempt-ageing.service';
import { PspPaymentService } from './psp-payment.service';

/**
 * Provider-backed collection of a purchase's real-money remainder.
 *
 * The adapter is injected by token, so the domain never names Idram. A second
 * provider is a second class and one line here, not a branch in the service.
 */
@Module({
  imports: [AlertsModule, LedgerModule, PurchaseIntentsModule, PspAdapterModule],
  providers: [PspPaymentService, PspAttemptAgeingService],
  // Re-exports the adapter module rather than the token: the token now lives
  // in `PspAdapterModule`, and Nest may only export what it provides itself.
  exports: [PspPaymentService, PspAttemptAgeingService, PspAdapterModule],
})
export class PspModule {}
