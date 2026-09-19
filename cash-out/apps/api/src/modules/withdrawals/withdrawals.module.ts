import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LimitsModule } from '../limits/limits.module';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { PayoutMethodsModule } from '../payout-methods/payout-methods.module';
import { YandexModule } from '../yandex/yandex.module';
import { ProviderWebhookController } from './provider-webhook.controller';
import { ProviderWebhookService } from './provider-webhook.service';
import { QuoteService } from './quote.service';
import { WithdrawalOrchestrator } from './withdrawal.orchestrator';
import { WithdrawalStateService } from './withdrawal-state.service';
import { WithdrawalWorker } from './withdrawal.worker';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [
    DriversModule,
    FeesModule,
    LedgerModule,
    LimitsModule,
    PaymentProviderModule,
    PayoutMethodsModule,
    YandexModule,
  ],
  controllers: [WithdrawalsController, ProviderWebhookController],
  providers: [
    QuoteService,
    WithdrawalsService,
    WithdrawalStateService,
    WithdrawalOrchestrator,
    WithdrawalWorker,
    ProviderWebhookService,
  ],
  exports: [WithdrawalsService, WithdrawalOrchestrator, WithdrawalStateService, WithdrawalWorker],
})
export class WithdrawalsModule {}
