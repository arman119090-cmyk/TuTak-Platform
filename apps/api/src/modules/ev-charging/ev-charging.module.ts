import { Module, forwardRef } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { SecurityModule } from '../security/security.module';
import { AuthModule } from '../auth/auth.module';
import { EvChargingController } from './ev-charging.controller';
import { EvReservationsService } from './ev-reservations.service';
import { EvSchedulerService } from './ev-scheduler.service';
import { EvSessionsService } from './ev-sessions.service';
import { EvStationsService } from './ev-stations.service';
import { OCPI_ADAPTER } from './ocpi/ocpi-adapter.interface';
import { NoopOcpiAdapter } from './ocpi/noop-ocpi-adapter.service';
import { HttpOcpiAdapter } from './ocpi/http-ocpi-adapter.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

@Module({
  imports: [WalletModule, TransactionsModule, SecurityModule, forwardRef(() => AuthModule)],
  controllers: [EvChargingController],
  providers: [
    EvStationsService,
    EvSessionsService,
    EvReservationsService,
    EvSchedulerService,
    {
      // Real client when a roaming partner is configured, refusal when not.
      //
      // The Noop adapter is not a stub standing in for missing work — it is
      // the correct behaviour for a station with no `ocpiEvseUid`, which is
      // every TuTak-owned charger. It only ever runs on the roaming path, and
      // there it fails loudly rather than pretending to have commanded
      // hardware that does not exist.
      provide: OCPI_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const ocpi = config.get('ocpi', { infer: true });
        if (!ocpi.baseUrl || !ocpi.token) {
          return new NoopOcpiAdapter();
        }
        return new HttpOcpiAdapter({
          baseUrl: ocpi.baseUrl.replace(/\/$/, ''),
          token: ocpi.token,
          partyId: ocpi.partyId,
          countryCode: ocpi.countryCode,
        });
      },
    },
  ],
  exports: [EvStationsService, EvSessionsService, EvReservationsService],
})
export class EvChargingModule {}
