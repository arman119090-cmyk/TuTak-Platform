import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SourcingResultSourceType } from '@prisma/client';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

const RESULT_STATUSES = ['FOUND_EXACT', 'FOUND_ALTERNATE', 'NOT_FOUND'] as const;
export type RecordSourcingResultStatus = (typeof RESULT_STATUSES)[number];

/** Spec §13's three buttons: НАШЁЛ ТОЧНЫЙ ТОВАР / НАШЁЛ АНАЛОГ / НЕ НАЙДЕН. */
export class RecordSourcingResultDto {
  @IsIn(RESULT_STATUSES)
  status: RecordSourcingResultStatus;

  // Everything below is required for FOUND_EXACT/FOUND_ALTERNATE, ignored
  // for NOT_FOUND — validated by SourcingTaskService, not here, since the
  // requirement depends on `status`.

  @IsIn(Object.values(SourcingResultSourceType))
  @IsOptional()
  sourceType?: SourcingResultSourceType;

  @IsUUID()
  @IsOptional()
  sourcePartnerId?: string;

  @IsString()
  @Length(1, 200)
  @IsOptional()
  productName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsMoneyString({ allowZero: false })
  @IsOptional()
  price?: string;

  /** Spec §40: what differs from the original (brand, model, condition, spec, kit) — shown to the customer. */
  @IsString()
  @Length(0, 2000)
  @IsOptional()
  differences?: string;

  @IsString()
  @Length(0, 500)
  @IsOptional()
  notes?: string;
}
