import { IsEnum, IsNumberString, IsString, IsUUID, Length } from 'class-validator';
import { LedgerDirection } from '@prisma/client';

export class ManualAdjustmentDto {
  @IsUUID()
  userId: string;

  @IsNumberString()
  amount: string;

  @IsEnum(LedgerDirection)
  direction: LedgerDirection;

  @IsString()
  @Length(3, 300)
  reason: string;
}
