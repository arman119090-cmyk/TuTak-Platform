import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { CustomerBalanceController } from './customer-balance.controller';
import { CustomerBalanceService } from './customer-balance.service';
import { BANK_TOPUP_ADAPTER } from './bank-topup-adapter.interface';
import { NoopBankTopUpAdapter } from './noop-bank-topup.adapter';

/**
 * Connecting a real bank (Idram or otherwise), once its credentials exist:
 * write a class implementing `BankTopUpAdapter`, add whatever config it
 * needs to `AppConfig` (same shape as `ocpi`/`sms`), and change the
 * `useClass` below to point at it — the rest of this module, the
 * controller, and `EvCdrReconciliationService`'s auto-collection never need
 * to change. Exactly the seam `EvChargingModule` already has for
 * `OCPI_ADAPTER`/`HttpOcpiAdapter`.
 */
@Module({
  imports: [LedgerModule],
  controllers: [CustomerBalanceController],
  providers: [CustomerBalanceService, { provide: BANK_TOPUP_ADAPTER, useClass: NoopBankTopUpAdapter }],
  exports: [CustomerBalanceService],
})
export class CustomerBalanceModule {}
