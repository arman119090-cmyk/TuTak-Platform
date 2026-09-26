import { IsOptional, IsString, Length } from 'class-validator';

export class CancelPartnerOrderDto {
  @IsString()
  @Length(1, 500)
  @IsOptional()
  reason?: string;
}
