import { Module } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { IdramLiveAdapter } from '../idram/idram-live.adapter';
import { IdramMockAdapter } from '../idram/idram-mock.adapter';
import { IdramProviderPort } from '../idram/idram.port';
import { PaymentProviderPort } from './payment-provider.port';
import { PaymentProviderMockAdapter } from './payment-provider-mock.adapter';

/**
 * The payout rail is iDram. The live adapter is a slot, not an implementation.
 *
 * Writing one against an imagined API would produce code that looks finished
 * and is not: the request shape, the settlement semantics, the webhook envelope
 * and the account-lookup call all come from iDram's own documentation and
 * sandbox, neither of which this project has. `IdramLiveAdapter` fits the
 * port, is built from the IDRAM_* variables, and refuses to serve — naming
 * each unknown — until they are implemented. `PROVIDER_MODE=mock` is refused
 * in production by the config validator.
 *
 * One instance serves three tokens — the iDram port, the generic payment port
 * the orchestrator uses, and the mock class tests reach for — so every caller
 * sees the same in-memory state.
 */
@Module({
  providers: [
    IdramMockAdapter,
    {
      provide: PaymentProviderPort,
      inject: [ENV, IdramMockAdapter],
      useFactory: (env: Env, mock: IdramMockAdapter) => {
        if (env.PROVIDER_MODE === 'live') {
          const live = new IdramLiveAdapter({
            baseUrl: env.IDRAM_BASE_URL as string,
            merchantId: env.IDRAM_MERCHANT_ID as string,
            apiKey: env.IDRAM_API_KEY as string,
            webhookSecret: env.PROVIDER_WEBHOOK_SECRET as string,
            timeoutMs: env.PROVIDER_TIMEOUT_MS,
          });
          // Refuses to serve until every unknown in IdramLiveAdapter.missing() is resolved.
          live.assertReady();
          return live;
        }
        return mock;
      },
    },
    { provide: IdramProviderPort, useExisting: PaymentProviderPort },
    { provide: PaymentProviderMockAdapter, useExisting: IdramMockAdapter },
  ],
  exports: [PaymentProviderPort, IdramProviderPort, PaymentProviderMockAdapter, IdramMockAdapter],
})
export class PaymentProviderModule {}
