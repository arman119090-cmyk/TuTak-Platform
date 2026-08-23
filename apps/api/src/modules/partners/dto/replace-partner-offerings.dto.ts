import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/** One row of the offering list the partner is submitting. */
export class PartnerOfferingInputDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  /**
   * `allowZero: false` — a priced product/service is expected to cost
   * something; a genuinely free offer is better described in `about` than
   * listed here at 0. Re-checked with `parseMoney` in the service, same
   * belt-and-braces reasoning `IsMoneyString`'s own doc comment gives for
   * every other monetary DTO field in this codebase.
   */
  @IsMoneyString({ allowZero: false })
  price: string;
}

/**
 * A full replacement of the partner's offering list — spec: partner public
 * profile, confirmed 2026-08-23. Bulk-replace rather than per-item
 * add/update/delete/reorder: a small business's product list does not need
 * optimistic-concurrency control on individual rows, and "here is my whole
 * list, in the order I want it shown" is both simpler to implement correctly
 * and simpler for the dashboard form to reason about (one save button, one
 * request, no partial-failure state to reconcile).
 *
 * 50-row cap: generous for a shop's menu/catalogue, small enough that this
 * never becomes the unbounded list `NearbyPartnerDto` was deliberately kept
 * away from.
 */
export class ReplacePartnerOfferingsDto {
  @ValidateNested({ each: true })
  @Type(() => PartnerOfferingInputDto)
  @ArrayMaxSize(50)
  offerings: PartnerOfferingInputDto[];
}
