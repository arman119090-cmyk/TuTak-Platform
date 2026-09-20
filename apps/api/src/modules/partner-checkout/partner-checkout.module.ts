import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PartnersModule } from '../partners/partners.module';
import { PurchaseIntentsModule } from '../purchase-intents/purchase-intents.module';
import { RoamingCpoModule } from '../roaming-cpo/roaming-cpo.module';
import { PartnerApiKeyGuard } from './partner-api-key.guard';
import { PartnerCheckoutController } from './partner-checkout.controller';
import { PartnerCheckoutService } from './partner-checkout.service';

/**
 * The POS front door to the purchase engine — see `PartnerCheckoutService`.
 * `RoamingCpoModule` is imported only for `PartnerApiKeyService`, the
 * partner-generic M2M credential mechanism that happens to live there.
 */
@Module({
  imports: [AuditModule, PartnersModule, PurchaseIntentsModule, RoamingCpoModule],
  controllers: [PartnerCheckoutController],
  providers: [PartnerCheckoutService, PartnerApiKeyGuard],
  exports: [PartnerCheckoutService],
})
export class PartnerCheckoutModule {}
