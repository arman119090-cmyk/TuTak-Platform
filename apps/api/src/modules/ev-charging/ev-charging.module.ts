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

@Module({
  imports: [WalletModule, TransactionsModule, SecurityModule, forwardRef(() => AuthModule)],
  controllers: [EvChargingController],
  providers: [
    EvStationsService,
    EvSessionsService,
    EvReservationsService,
    EvSchedulerService,
    { provide: OCPI_ADAPTER, useClass: NoopOcpiAdapter },
  ],
  exports: [EvStationsService, EvSessionsService, EvReservationsService],
})
export class EvChargingModule {}
