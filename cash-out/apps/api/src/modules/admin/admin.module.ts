import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { YandexModule } from '../yandex/yandex.module';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { IntegrationHealthService } from './integration-health.service';
import { PricingService } from './pricing.service';

@Module({
  imports: [
    LedgerModule,
    PaymentProviderModule,
    ReconciliationModule,
    WithdrawalsModule,
    YandexModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService, AdminAuthService, AdminGuard, PricingService, IntegrationHealthService],
  exports: [AdminAuthService, AdminService, IntegrationHealthService],
})
export class AdminModule {}
