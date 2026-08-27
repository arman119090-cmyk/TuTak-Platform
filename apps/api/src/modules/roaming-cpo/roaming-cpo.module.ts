import { Module, forwardRef } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { PartnersModule } from '../partners/partners.module';
import { ReferralModule } from '../referral/referral.module';
import { RoamingCpoController } from './roaming-cpo.controller';
import { RoamingCpoStationsService } from './roaming-cpo-stations.service';
import { RoamingCpoSettlementService } from './roaming-cpo-settlement.service';
import { RoamingCpoCustomersService } from './roaming-cpo-customers.service';
import { PartnerApiKeyService } from './partner-api-key.service';
import { RoamingCpoApiKeyGuard } from './roaming-cpo-api-key.guard';
import { ROAMING_CPO_PROVIDER } from './roaming-cpo-provider.interface';
import { NoopRoamingCpoProvider } from './noop-roaming-cpo-provider.service';

@Module({
  imports: [
    WalletModule,
    TransactionsModule,
    LedgerModule,
    forwardRef(() => AuthModule),
    PartnersModule,
    ReferralModule,
  ],
  controllers: [RoamingCpoController],
  providers: [
    RoamingCpoStationsService,
    RoamingCpoSettlementService,
    RoamingCpoCustomersService,
    PartnerApiKeyService,
    RoamingCpoApiKeyGuard,
    {
      // No real partner endpoint exists to call yet — see that
      // interface's docblock. Swapping in an `HttpRoamingCpoProvider` later
      // is the same one-line change `EvChargingModule` already does for
      // `OCPI_ADAPTER`.
      provide: ROAMING_CPO_PROVIDER,
      useClass: NoopRoamingCpoProvider,
    },
  ],
  exports: [RoamingCpoStationsService, RoamingCpoSettlementService, RoamingCpoCustomersService],
})
export class RoamingCpoModule {}
