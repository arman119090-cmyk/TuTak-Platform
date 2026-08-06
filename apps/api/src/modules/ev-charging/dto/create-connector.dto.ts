import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import { EvConnectorType } from '@prisma/client';

export class CreateConnectorDto {
  @IsUUID()
  stationId: string;

  @IsEnum(EvConnectorType)
  connectorType: EvConnectorType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  powerKw: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  pricePerKwh: number;

  @IsOptional()
  @IsString()
  ocpiEvseUid?: string;
}
