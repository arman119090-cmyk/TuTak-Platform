import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { LimitsModule } from '../limits/limits.module';
import { ParksModule } from '../parks/parks.module';
import { PayoutMethodsModule } from '../payout-methods/payout-methods.module';
import { SecurityModule } from '../security/security.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AutoPayoutController } from './auto-payout.controller';
import { AutoPayoutService } from './auto-payout.service';

@Module({
  imports: [
    DriversModule,
    LimitsModule,
    ParksModule,
    PayoutMethodsModule,
    SecurityModule,
    WithdrawalsModule,
  ],
  controllers: [AutoPayoutController],
  providers: [AutoPayoutService],
  exports: [AutoPayoutService],
})
export class AutoPayoutModule {}
