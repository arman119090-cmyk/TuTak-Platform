import { IsNumberString, IsOptional, IsUUID } from 'class-validator';

/**
 * Spec §7: customer scans the partner/branch QR, then enters the amounts
 * themselves. There is no per-branch QR-code entity yet (spec §2 says a
 * branch *may* have one, not that it must) — `partnerId`/`partnerBranchId`
 * stand in for "what the QR resolved to" until that exists; the mobile
 * client is expected to have already resolved a scanned code to these ids
 * the same way it resolves a `QrCode.partnerId` today.
 */
export class CreatePurchaseIntentDto {
  @IsUUID()
  partnerId: string;

  @IsUUID()
  @IsOptional()
  partnerBranchId?: string;

  /** Full gross amount of the purchase — spec §9, never the post-bonus remainder. */
  @IsNumberString()
  grossAmount: string;

  /** 0 up to the partner's max_bonus_payment_percent of grossAmount — spec §11. */
  @IsNumberString()
  @IsOptional()
  bonusAmountRequested?: string;
}
