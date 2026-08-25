import { Module, forwardRef } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { PartnersModule } from '../partners/partners.module';
import { ReferralModule } from '../referral/referral.module';
import { FastChargeController } from './fastcharge.controller';
import { FastChargeStationsService } from './fastcharge-stations.service';
import { FastChargeSettlementService } from './fastcharge-settlement.service';
import { FastChargeCustomersService } from './fastcharge-customers.service';
import { PartnerApiKeyService } from './partner-api-key.service';
import { FastChargeApiKeyGuard } from './fastcharge-api-key.guard';
import { FASTCHARGE_PROVIDER } from './fastcharge-provider.interface';
import { NoopFastChargeProvider } from './noop-fastcharge-provider.service';

@Module({
  imports: [
    WalletModule,
    TransactionsModule,
    LedgerModule,
    forwardRef(() => AuthModule),
    PartnersModule,
    ReferralModule,
  ],
  controllers: [FastChargeController],
  providers: [
    FastChargeStationsService,
    FastChargeSettlementService,
    FastChargeCustomersService,
    PartnerApiKeyService,
    FastChargeApiKeyGuard,
    {
      // No real FastCharge endpoint exists to call yet — see that
      // interface's docblock. Swapping in an `HttpFastChargeProvider` later
      // is the same one-line change `EvChargingModule` already does for
      // `OCPI_ADAPTER`.
      provide: FASTCHARGE_PROVIDER,
      useClass: NoopFastChargeProvider,
    },
  ],
  exports: [FastChargeStationsService, FastChargeSettlementService, FastChargeCustomersService],
})
export class FastChargeModule {}
