import { Module } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { IdramMockAdapter } from '../idram/idram-mock.adapter';
import { IdramProviderPort } from '../idram/idram.port';
import { PaymentProviderPort } from './payment-provider.port';
import { PaymentProviderMockAdapter } from './payment-provider-mock.adapter';

/**
 * The payout rail is iDram. There is deliberately no live adapter here.
 *
 * Writing one against an imagined API would produce code that looks finished
 * and is not: the request shape, the settlement semantics, the webhook envelope
 * and the account-lookup call all come from iDram's own documentation and
 * sandbox, neither of which this project has. `IdramProviderPort` is the
 * contract that adapter must fit; until it exists, `PROVIDER_MODE=live` has
 * nothing to resolve to and the process refuses to start. `PROVIDER_MODE=mock`
 * is refused in production by the config validator.
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
          throw new Error(
            'PROVIDER_MODE=live is set, but no live iDram adapter is implemented. ' +
              'Implement IdramProviderPort against the iDram payout API and register it here.',
          );
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
