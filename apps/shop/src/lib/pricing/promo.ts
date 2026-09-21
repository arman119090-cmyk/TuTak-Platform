import { percentOf } from '../money';
import type { PricedPromo, PromoRejection } from './types';

export type PromoEvaluation =
  | { ok: true; discountMinor: number; freeDelivery: boolean }
  | { ok: false; reason: PromoRejection; minSubtotalMinor?: number };

/**
 * Decides whether a promo code applies and how much it takes off.
 *
 * Runs on the server only: the browser may *display* a discount, but this
 * function is what an order is actually charged against.
 */
export const evaluatePromo = (
  promo: PricedPromo | null,
  subtotalMinor: number,
  now: Date = new Date(),
): PromoEvaluation => {
  if (!promo) return { ok: false, reason: 'NOT_FOUND' };
  if (!promo.isActive) return { ok: false, reason: 'INACTIVE' };
  if (promo.startsAt && promo.startsAt.getTime() > now.getTime())
    return { ok: false, reason: 'NOT_STARTED' };
  if (promo.endsAt && promo.endsAt.getTime() < now.getTime())
    return { ok: false, reason: 'EXPIRED' };
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit)
    return { ok: false, reason: 'USAGE_LIMIT' };
  if (promo.minSubtotalMinor !== null && subtotalMinor < promo.minSubtotalMinor)
    return { ok: false, reason: 'MIN_SUBTOTAL', minSubtotalMinor: promo.minSubtotalMinor };

  let discount =
    promo.discountType === 'PERCENT' ? percentOf(subtotalMinor, promo.value) : promo.value;

  if (promo.maxDiscountMinor !== null) discount = Math.min(discount, promo.maxDiscountMinor);
  // A promo code can never make an order negative or free.
  discount = Math.max(0, Math.min(discount, subtotalMinor));

  return { ok: true, discountMinor: discount, freeDelivery: promo.freeDelivery };
};
