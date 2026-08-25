import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsPositive,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { EvConnectorType } from '@prisma/client';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

class FastChargeConnectorSyncDto {
  @IsString()
  @Length(1, 128)
  fastChargeConnectorId: string;

  @IsEnum(EvConnectorType)
  connectorType: EvConnectorType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  powerKw: number;
}

/**
 * One station/location and its connectors, as FastCharge reports them —
 * "each station/EVSE/connector needs its own stable external ID from
 * FastCharge, synced into TuTak" and "each station stores its own
 * standard/retail tariff". Idempotent upsert keyed by `fastChargeStationId`
 * / `fastChargeConnectorId` — see `FastChargeStationsService.sync`.
 */
export class FastChargeStationSyncDto {
  @IsString()
  @Length(1, 128)
  fastChargeStationId: string;

  @IsString()
  @Length(1, 200)
  name: string;

  @IsString()
  @Length(1, 300)
  address: string;

  @IsString()
  @Length(1, 120)
  city: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsMoneyString()
  standardRetailRatePerKwh: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FastChargeConnectorSyncDto)
  connectors: FastChargeConnectorSyncDto[];
}
