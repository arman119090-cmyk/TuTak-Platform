import { Module } from '@nestjs/common';
import { IdramAdapter } from './idram.adapter';
import { PSP_ADAPTER } from './psp-adapter.interface';

/**
 * The provider adapter alone, with no domain service attached.
 *
 * Split out of `PspModule` so that code which only needs to *ask what the
 * provider can do* does not have to import the module that collects money —
 * `PspModule` imports `PurchaseIntentsModule`, so importing it from
 * `PurchaseIntentsModule` in turn would be a cycle.
 *
 * The first caller is the refund path, which must know whether the provider
 * has a refund API before offering a customer their money back. That is a
 * question about the provider, not about collecting a payment, and this is
 * where such questions belong.
 */
@Module({
  providers: [IdramAdapter, { provide: PSP_ADAPTER, useExisting: IdramAdapter }],
  exports: [PSP_ADAPTER],
})
export class PspAdapterModule {}
