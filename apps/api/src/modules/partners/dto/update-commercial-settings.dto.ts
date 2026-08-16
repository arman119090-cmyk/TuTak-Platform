import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Spec §11: only `maxBonusPaymentPercent` is owner-editable. The negotiated
 * `bonusAccrualRateBps` is deliberately absent — spec §10 is explicit that a
 * partner cannot override a rate that TuTak negotiated with them.
 */
export class UpdateCommercialSettingsDto {
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  maxBonusPaymentPercent?: number;
}
