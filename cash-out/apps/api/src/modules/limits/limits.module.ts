import { Module } from '@nestjs/common';
import { LimitsService } from './limits.service';
import { RiskService } from './risk.service';

@Module({
  providers: [LimitsService, RiskService],
  exports: [LimitsService, RiskService],
})
export class LimitsModule {}
