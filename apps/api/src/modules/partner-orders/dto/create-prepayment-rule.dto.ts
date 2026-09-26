import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PrepaymentMode } from '@prisma/client';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/** Spec §30: 0% (no rule), a percentage, or a fixed amount — per partner, service type or category. */
export class CreatePrepaymentRuleDto {
  @IsUUID()
  partnerId: string;

  @IsString()
  @Length(1, 100)
  @IsOptional()
  serviceType?: string;

  @IsString()
  @Length(1, 100)
  @IsOptional()
  category?: string;

  @IsIn(Object.values(PrepaymentMode))
  mode: PrepaymentMode;

  @IsInt()
  @IsOptional()
  percentBps?: number;

  @IsMoneyString({ allowZero: false })
  @IsOptional()
  fixedAmount?: string;
}
