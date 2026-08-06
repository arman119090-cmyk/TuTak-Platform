import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class RedeemQrDto {
  @IsString()
  token: string;

  @IsOptional()
  @IsNumberString()
  bonusAmountToApply?: string;

  @IsString()
  idempotencyKey: string;
}
