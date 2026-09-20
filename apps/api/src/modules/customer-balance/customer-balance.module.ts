import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { CustomerBalanceController } from './customer-balance.controller';
import { CustomerBalanceTopUpController } from './customer-balance-topup.controller';
import { CustomerBalanceService } from './customer-balance.service';
import { BANK_TOPUP_ADAPTER } from './bank-topup-adapter.interface';
import { NoopBankTopUpAdapter } from './noop-bank-topup.adapter';

/**
 * Connecting a real bank, once its credentials and the legal question exist:
 * write a class implementing `BankTopUpAdapter`, add whatever config it
 * needs to `AppConfig` (same shape as `ocpi`/`sms`), and change the
 * `useClass` below to point at it — the rest of this module, the
 * controller, and `EvCdrReconciliationService`'s auto-collection never need
 * to change. Exactly the seam `EvChargingModule` already has for
 * `OCPI_ADAPTER`/`HttpOcpiAdapter`.
 *
 * **Idram is deliberately not that bank.** The provider integration in
 * `PspModule` collects a *purchase* the customer is making right now; it
 * does not, and must not, fund a stored balance. Pointing it here would turn
 * a payment rail into a deposit-taking one on nothing but a line of wiring.
 *
 * ## Why the controller is conditional
 *
 * The service stays registered unconditionally, because the EV roaming path
 * spends balances through `collectFromBalance` and a customer who already
 * has a balance must be able to see and use it. What is conditional is the
 * HTTP surface: with `CUSTOMER_PREPAID_TOPUP_ENABLED` unset — which is
 * production — `/balance/me`, `/balance/topup` and `/balance/topup/webhook`
 * are not routes at all, and a request to any of them gets a 404 rather than
 * a refusal that confirms the feature exists.
 *
 * Evaluated statically from `process.env` rather than through
 * `ConfigService`, for the reason `app.module.ts` gives about
 * `cardPaymentsEnabled`: `@Module()` metadata is read at import time, before
 * DI exists. `CustomerBalanceService` carries its own check as well, so a
 * future internal caller cannot credit real money just because it bypassed
 * the controller.
 */
const topUpEnabled = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED === 'true';

@Module({
  imports: [LedgerModule],
  // The read controller is always present and gates itself per request —
  // see its own docblock. Only the paying-in surface is absent when off.
  controllers: [CustomerBalanceController, ...(topUpEnabled ? [CustomerBalanceTopUpController] : [])],
  providers: [CustomerBalanceService, { provide: BANK_TOPUP_ADAPTER, useClass: NoopBankTopUpAdapter }],
  exports: [CustomerBalanceService],
})
export class CustomerBalanceModule {}
