import { IsEnum } from 'class-validator';
import { BranchFuelType } from '@prisma/client';

/** Owner/admin classifying one branch's actual product — never inferred, see the migration doc. */
export class SetBranchFuelTypeDto {
  @IsEnum(BranchFuelType)
  fuelType: BranchFuelType;
}
