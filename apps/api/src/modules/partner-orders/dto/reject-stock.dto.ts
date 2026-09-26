import { IsOptional, IsString, Length } from 'class-validator';

export class RejectStockDto {
  @IsString()
  @Length(0, 500)
  @IsOptional()
  reason?: string;
}
