import { IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';
import { LedgerDirection } from '@prisma/client';

export class ManualAdjustmentDto {
  @IsUUID()
  userId: string;

  @IsMoneyString({ allowZero: false })
  amount: string;

  @IsEnum(LedgerDirection)
  direction: LedgerDirection;

  @IsString()
  @Length(3, 300)
  reason: string;
}
