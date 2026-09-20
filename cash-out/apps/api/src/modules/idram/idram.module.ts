import { Module } from '@nestjs/common';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { IdramController } from './idram.controller';
import { IdramService } from './idram.service';

@Module({
  imports: [PaymentProviderModule],
  controllers: [IdramController],
  providers: [IdramService],
  exports: [IdramService],
})
export class IdramModule {}
