import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { Currency, FulfillmentMethod } from '@prisma/client';
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
   * Q11 (closed): AMD only — no multi-currency ledger. A site pricing in USD
   * (e.g. Euro Import's service fee) converts at its own rate and sends
   * TuTak the authoritative AMD amount.
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

  /**
   * Item 8: the site's own cancellation-cost terms, shown to the customer
   * before "Подтвердить заказ" — e.g. "Если курьер уже выехал, стоимость
   * доставки 2 000 AMD не возвращается". Only a cost disclosed here can
   * ever be claimed, and only as an actual amount reviewed by TuTak — never
   * a fixed or percentage penalty. Omitted = every cancellation is a full
   * refund.
   */
  @IsString()
  @Length(1, 1000)
  @IsOptional()
  cancellationTerms?: string;

  /** Delivery or self-pickup, if the site already knows. */
  @IsIn(Object.values(FulfillmentMethod))
  @IsOptional()
  fulfillmentMethod?: FulfillmentMethod;

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
