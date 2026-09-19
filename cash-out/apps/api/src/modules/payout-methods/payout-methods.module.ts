import { Module } from '@nestjs/common';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { PayoutMethodsController } from './payout-methods.controller';
import { PayoutMethodsService } from './payout-methods.service';

@Module({
  imports: [PaymentProviderModule],
  controllers: [PayoutMethodsController],
  providers: [PayoutMethodsService],
  exports: [PayoutMethodsService],
})
export class PayoutMethodsModule {}
