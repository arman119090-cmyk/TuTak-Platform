import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/**
 * One completed FastCharge session, exactly the fields requirement 4 lists:
 * "FastCharge's own customer ID, session ID, actual kWh delivered, the
 * actual tariff applied to that specific customer for that specific
 * session, and the final charging amount". Shaped to match
 * `FastChargeSessionReport` field for field — see that interface's docblock
 * for why this DTO is not itself the adapter boundary.
 */
export class FastChargeSessionSettleDto {
  @IsString()
  @Length(1, 128)
  fastChargeSessionId: string;

  @IsString()
  @Length(1, 128)
  fastChargeCustomerId: string;

  @IsString()
  @Length(1, 128)
  fastChargeStationId: string;

  @IsString()
  @Length(1, 128)
  fastChargeConnectorId: string;

  @IsMoneyString({ allowZero: false })
  energyKwh: string;

  @IsMoneyString({ allowZero: false })
  appliedCustomerRatePerKwh: string;

  @IsMoneyString()
  finalAmount: string;

  /** AMD of `finalAmount` the customer asked to settle from their TuTak bonus balance — see `FastChargeSettlementService`. */
  @IsOptional()
  @IsMoneyString()
  bonusAmountToApply?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  stoppedAt?: string;
}
