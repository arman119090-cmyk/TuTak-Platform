import { IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * Q5: a partner-scoped override of the partner's own base rate
 * (`bonusAccrualRateBps`) for one serviceType and/or category — never a
 * platform-wide default, never a hardcoded per-partner percentage.
 */
export class CreateCommissionRuleDto {
  @IsUUID()
  partnerId: string;

  @IsString()
  @Length(1, 100)
  @IsOptional()
  serviceType?: string;

  @IsString()
  @Length(1, 100)
  @IsOptional()
  category?: string;

  @IsString()
  @Length(1, 200)
  name: string;

  /** Same 0.5–20% grid as the partner's base rate (checked in the service). */
  @IsInt()
  rateBps: number;
}
