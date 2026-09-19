import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

/**
 * Liquidity, kept separate from accounting on purpose.
 *
 * `PartnerSettlementService` answers "what do we owe"; this answers "what can
 * we actually pay today". Putting them in one service would invite exactly
 * the conflation the split exists to prevent.
 */
@Module({
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
