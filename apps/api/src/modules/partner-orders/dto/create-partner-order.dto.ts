import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { Currency } from '@prisma/client';
import { CreatePartnerOrderItemDto } from './create-partner-order-item.dto';

/**
 * Server-to-server only (the partner's backend, API key) — spec §3. The
 * customer's browser never sends prices to TuTak.
 */
export class CreatePartnerOrderDto {
  @IsString()
  @Length(1, 200)
  externalOrderId: string;

  /**
   * Q11 (pending): AMD only. v1 accepted any `Currency`, including
   * `BONUS_POINT` — never a real order currency. A site pricing in USD
   * converts at its own rate before calling TuTak.
   */
  @IsIn([Currency.AMD])
  @IsOptional()
  currency?: Currency;

  /**
   * Commission/prepayment scope (Q5): e.g. Euro Import's
   * "vehicle_import_service" — whose items then carry only the service fee,
   * never the car price — vs. "parts".
   */
  @IsString()
  @Length(1, 100)
  @IsOptional()
  serviceType?: string;

  @IsString()
  @Length(1, 100)
  @IsOptional()
  category?: string;

  /** The fulfilling branch, if the site knows it. Must belong to the partner. */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePartnerOrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  items: CreatePartnerOrderItemDto[];
}
