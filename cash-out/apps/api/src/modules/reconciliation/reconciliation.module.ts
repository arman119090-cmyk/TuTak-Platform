import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { YandexModule } from '../yandex/yandex.module';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [LedgerModule, PaymentProviderModule, YandexModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
