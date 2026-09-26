import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/** Spec §4: one line of a PartnerOrder, exactly as the partner's site sent it. */
export class CreatePartnerOrderItemDto {
  @IsString()
  @IsOptional()
  externalProductId?: string;

  @IsString()
  @Length(1, 200)
  name: string;

  @IsString()
  @IsOptional()
  sku?: string;

  /** Auto-parts OEM number (Euro Import) — never interpreted, only stored. */
  @IsString()
  @IsOptional()
  oemNumber?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  /** Per-unit price — server-to-server only, never trusted from a browser. */
  @IsMoneyString({ allowZero: false })
  unitPrice: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
