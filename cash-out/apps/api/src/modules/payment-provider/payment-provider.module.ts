import { Module } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { PaymentProviderPort } from './payment-provider.port';
import { PaymentProviderMockAdapter } from './payment-provider-mock.adapter';

/**
 * There is deliberately no live adapter in this repository yet.
 *
 * Writing one against an imagined API would produce code that looks finished
 * and is not: the request shape, the settlement semantics, the webhook envelope
 * and the reversal behaviour all come from a specific provider's documentation
 * and sandbox. `PaymentProviderPort` is the contract that provider must be made
 * to fit; until one is chosen, `PROVIDER_MODE=live` has nothing to resolve to
 * and the config validator refuses to start such a process.
 */
@Module({
  providers: [
    PaymentProviderMockAdapter,
    {
      provide: PaymentProviderPort,
      inject: [ENV, PaymentProviderMockAdapter],
      useFactory: (env: Env, mock: PaymentProviderMockAdapter) => {
        if (env.PROVIDER_MODE === 'live') {
          throw new Error(
            'PROVIDER_MODE=live is set, but no live payment provider adapter is implemented. ' +
              'Implement PaymentProviderPort for the chosen bank/PSP and register it here.',
          );
        }
        return mock;
      },
    },
  ],
  exports: [PaymentProviderPort, PaymentProviderMockAdapter],
})
export class PaymentProviderModule {}
