import { PaymentRoute, UnitOfMeasure } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional, IsUUID } from 'class-validator';

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

  /**
   * Partner Commerce v2 (Q1 = C): how much of the purchase to pay from the
   * customer's own TuTak money balance (`CUSTOMER_PREPAID_BALANCE`) —
   * separate from, and never mixed with, the discount above. Whatever
   * remains after both is paid to the partner directly (external).
   */
  @IsNumberString()
  @IsOptional()
  tutakMoneyAmount?: string;

  /**
   * How the remainder is paid.
   *
   * Optional, and omitting it means `DIRECT_PARTNER` — the route every
   * client built before 15.09.2026 uses, where the customer hands cash or a
   * card to the partner and the partner's own till takes the money. Clients
   * that know about `TUTAK_PSP` ask for it explicitly; every older one keeps
   * working untouched, which is the whole reason this is optional rather
   * than required.
   *
   * It is a request, not a decision: `create` refuses `TUTAK_PSP` when card
   * payments are switched off, and the chosen route is then fixed for the
   * life of the purchase by a database constraint — one purchase, one money
   * route.
   */
  @IsEnum(PaymentRoute)
  @IsOptional()
  paymentRoute?: PaymentRoute;

  /**
   * What was actually sold, for a partner whose terms are priced per unit —
   * 50 litres at 300 AMD.
   *
   * All three travel together or not at all; a quantity with no unit price is
   * a receipt nobody can re-derive, and the database refuses that combination
   * outright (`purchase_intents_quantity_is_complete`).
   *
   * Required when the partner's live terms are `FIXED_PER_UNIT` or `HYBRID`,
   * because there is otherwise nothing to multiply the per-unit margin by.
   * Ignored by percentage partners, who charge on the total.
   */
  @IsNumberString()
  @IsOptional()
  quantity?: string;

  /**
   * The unit that quantity is in. Must match the partner's terms.
   *
   * A closed enum rather than free text since 15.09.2026: this value is
   * compared for equality against the contract's own unit, and that
   * comparison decides whether a per-unit margin may be multiplied. "L" and
   * "л" being different units is not a display problem, it is a wrong
   * invoice. Labels live in the client's translations.
   */
  @IsEnum(UnitOfMeasure)
  @IsOptional()
  quantityUnit?: UnitOfMeasure;

  @IsNumberString()
  @IsOptional()
  unitPrice?: string;
}
