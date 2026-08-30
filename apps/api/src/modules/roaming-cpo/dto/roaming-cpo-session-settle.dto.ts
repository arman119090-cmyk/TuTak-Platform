import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/**
 * One completed roaming-CPO session, exactly the fields requirement 4 lists:
 * "the partner's own customer ID, session ID, actual kWh delivered, the
 * actual tariff applied to that specific customer for that specific
 * session, and the final charging amount".
 */
export class RoamingCpoSessionSettleDto {
  @IsString()
  @Length(1, 128)
  externalSessionId: string;

  @IsString()
  @Length(1, 128)
  externalCustomerId: string;

  @IsString()
  @Length(1, 128)
  externalStationId: string;

  @IsString()
  @Length(1, 128)
  externalConnectorId: string;

  @IsMoneyString({ allowZero: false })
  energyKwh: string;

  @IsMoneyString({ allowZero: false })
  appliedCustomerRatePerKwh: string;

  @IsMoneyString()
  finalAmount: string;

  /** AMD of `finalAmount` the customer asked to settle from their TuTak bonus balance — see `RoamingCpoSettlementService`. */
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
