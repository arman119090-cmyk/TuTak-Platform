import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateStationDto {
  @IsUUID()
  partnerId: string;

  @IsString()
  @Length(2, 150)
  name: string;

  @IsString()
  @Length(2, 300)
  address: string;

  @IsString()
  @Length(2, 100)
  city: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  ocpiLocationId?: string;
}
