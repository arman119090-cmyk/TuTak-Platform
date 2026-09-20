import { PartnerStatus, Prisma } from '@prisma/client';

/**
 * The one rule that decides whether a Home "Partner Spotlight" card is shown.
 *
 * Kept as a pure function with a matching Prisma `where`, so the SQL the
 * featured endpoint runs and the `live` flag the admin page shows cannot
 * disagree: both are this file, and the unit spec pins them together.
 *
 * A card is live when all of these hold:
 *  - the administrator switched it on (`active`);
 *  - the partner trades — `isActive` and `status = ACTIVE`. A suspended or
 *    still-pending partner must not be promoted to every customer, whatever
 *    the card says;
 *  - the window has started (`startAt` null or in the past);
 *  - the window has not ended (`endAt` null or in the future).
 *
 * `endAt` is exclusive: a card that ends at midnight is gone at midnight.
 */
export interface PromoWindowFacts {
  active: boolean;
  startAt: Date | null;
  endAt: Date | null;
  partner: { isActive: boolean; status: PartnerStatus };
}

export function isPromoLive(promo: PromoWindowFacts, now: Date): boolean {
  if (!promo.active) return false;
  if (!promo.partner.isActive || promo.partner.status !== PartnerStatus.ACTIVE) return false;
  if (promo.startAt && promo.startAt.getTime() > now.getTime()) return false;
  if (promo.endAt && promo.endAt.getTime() <= now.getTime()) return false;
  return true;
}

/** The same rule, as the filter `PromosService.featured` hands to Prisma. */
export function livePromoWhere(now: Date): Prisma.PartnerPromoWhereInput {
  return {
    active: true,
    partner: { isActive: true, status: PartnerStatus.ACTIVE },
    AND: [
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
      { OR: [{ endAt: null }, { endAt: { gt: now } }] },
    ],
  };
}

/**
 * A window that ends before (or exactly when) it starts is a typo, and the
 * filter above would honour it by never showing the card. Refused at the
 * boundary, and by the `partner_promos_window_is_ordered` CHECK beneath.
 */
export function isWindowOrdered(startAt: Date | null, endAt: Date | null): boolean {
  if (!startAt || !endAt) return true;
  return endAt.getTime() > startAt.getTime();
}

/** How many cards the strip shows at most — 3–5 is the product's own range. */
export const FEATURED_PROMO_LIMIT = 5;
