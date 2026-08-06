import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  connectorId: string;

  @IsDateString()
  startAt: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(120)
  holdMinutes?: number;
}
