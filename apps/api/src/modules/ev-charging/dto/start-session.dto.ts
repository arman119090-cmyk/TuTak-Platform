import { IsOptional, IsUUID } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class StartSessionDto {
  @IsUUID()
  connectorId: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string;
}

export class StopSessionDto {
  @IsOptional()
  @IsMoneyString()
  bonusAmountToApply?: string;
}

export class MeterValueDto {
  @IsMoneyString()
  energyKwh: string;
}
