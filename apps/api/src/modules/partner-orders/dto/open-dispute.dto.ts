import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { OrderDisputeType } from '@prisma/client';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class OpenDisputeDto {
  @IsIn(Object.values(OrderDisputeType))
  type: OrderDisputeType;

  /** Wrong item, damage, mismatch, quality, delivery, payment … (spec §48). */
  @IsString()
  @Length(2, 100)
  reason: string;

  @IsString()
  @Length(0, 4000)
  @IsOptional()
  description?: string;

  @IsMoneyString({ allowZero: false })
  @IsOptional()
  disputedAmount?: string;
}
