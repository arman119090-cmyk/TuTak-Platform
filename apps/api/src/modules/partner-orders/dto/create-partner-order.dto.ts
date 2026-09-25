import { Type } from 'class-transformer';
import { ArrayMinSize, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Currency } from '@prisma/client';
import { CreatePartnerOrderItemDto } from './create-partner-order-item.dto';

/**
 * Spec §3-4: created server-to-server by a partner's own website backend,
 * authenticated with a `PartnerApiKey` scoped to a `PartnerIntegration(type:
 * WEBSITE)` — see `PartnerOrdersController`. Deliberately carries no
 * `customerId`, `partnerId` or price total: the partner is identified by
 * which API key signed the request (never a body field a caller could lie
 * about), and every amount here is a per-item unit price the service sums
 * itself — spec §3's "не доверять ценам от клиента" boundary is the
 * *browser*, not this endpoint, but every total is still computed
 * server-side from `items`, never accepted as a lump sum.
 */
export class CreatePartnerOrderDto {
  /** The partner site's own order id — this endpoint's create-time idempotency key. */
  @IsString()
  @Length(1, 200)
  externalOrderId: string;

  @IsIn(Object.values(Currency))
  @IsOptional()
  currency?: Currency;

  /** Spec §19: which `CommissionRule.category` applies, if the partner has one configured. */
  @IsString()
  @IsOptional()
  category?: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePartnerOrderItemDto)
  @ArrayMinSize(1)
  items: CreatePartnerOrderItemDto[];
}
