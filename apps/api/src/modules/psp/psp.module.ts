import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PurchaseIntentsModule } from '../purchase-intents/purchase-intents.module';
import { IdramAdapter } from './idram.adapter';
import { PSP_ADAPTER } from './psp-adapter.interface';
import { PspPaymentService } from './psp-payment.service';

/**
 * Provider-backed collection of a purchase's real-money remainder.
 *
 * The adapter is injected by token, so the domain never names Idram. A second
 * provider is a second class and one line here, not a branch in the service.
 */
@Module({
  imports: [LedgerModule, PurchaseIntentsModule],
  providers: [IdramAdapter, { provide: PSP_ADAPTER, useExisting: IdramAdapter }, PspPaymentService],
  exports: [PspPaymentService, PSP_ADAPTER],
})
export class PspModule {}
