import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { BonusEngineService } from './bonus-engine.service';
import { BonusSchedulerService } from './bonus-scheduler.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuditModule, UsersModule],
  controllers: [WalletController],
  providers: [WalletService, BonusEngineService, BonusSchedulerService],
  exports: [WalletService, BonusEngineService],
})
export class WalletModule {}
