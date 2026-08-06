import { IsNumberString, IsOptional, IsUUID } from 'class-validator';

export class StartSessionDto {
  @IsUUID()
  connectorId: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string;
}

export class StopSessionDto {
  @IsOptional()
  @IsNumberString()
  bonusAmountToApply?: string;
}

export class MeterValueDto {
  @IsNumberString()
  energyKwh: string;
}
