import { UnitOfMeasure } from '@prisma/client';
import { IsEnum, IsISO8601, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * What a till sends to open a purchase — brief §20. The gross is the
 * partner's statement of the sale; the customer never types it on this path.
 */
export class CreatePartnerCheckoutDto {
  @IsUUID()
  @IsOptional()
  partnerBranchId?: string;

  /** The till's own receipt / order id. Unique per partner — a retry cannot open the sale twice. */
  @IsString()
  @MaxLength(128)
  externalReference: string;

  @IsNumberString()
  grossAmount: string;

  @IsNumberString()
  @IsOptional()
  quantity?: string;

  @IsEnum(UnitOfMeasure)
  @IsOptional()
  quantityUnit?: UnitOfMeasure;

  @IsNumberString()
  @IsOptional()
  unitPrice?: string;

  /** The till's own clock for the sale. Defaults to now. */
  @IsISO8601()
  @IsOptional()
  occurredAt?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  idempotencyKey?: string;
}
