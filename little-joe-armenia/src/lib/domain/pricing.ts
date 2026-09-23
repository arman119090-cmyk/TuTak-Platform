// Pure cart pricing: promotions, delivery and totals. No I/O here so the
// same function prices the cart drawer, the checkout summary and the order
// that is finally written — the server always re-prices from the database.

export type PricingLine = {
  variantId: string;
  productId: string;
  collectionId: string;
  unitAmd: number;
  quantity: number;
};

export type PromotionRule = {
  id: string;
  code: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotalAmd: number | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  productIds: string[];
  collectionIds: string[];
};

export type DeliveryRule = {
  code: string;
  priceAmd: number;
  freeFromAmd: number | null;
};

export type PromoRejection =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "USAGE_LIMIT"
  | "MIN_SUBTOTAL"
  | "NOT_APPLICABLE";

export type PromoEvaluation =
  | { ok: true; discountAmd: number; eligibleSubtotalAmd: number }
  | { ok: false; reason: PromoRejection; minSubtotalAmd?: number };

export function subtotal(lines: PricingLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitAmd * l.quantity, 0);
}

export function evaluatePromotion(
  promo: PromotionRule | null,
  lines: PricingLine[],
  now: Date,
): PromoEvaluation {
  if (!promo) return { ok: false, reason: "NOT_FOUND" };
  if (!promo.isActive) return { ok: false, reason: "INACTIVE" };
  if (promo.startsAt && now < promo.startsAt) return { ok: false, reason: "NOT_STARTED" };
  if (promo.endsAt && now > promo.endsAt) return { ok: false, reason: "EXPIRED" };
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    return { ok: false, reason: "USAGE_LIMIT" };
  }
  const total = subtotal(lines);
  if (promo.minSubtotalAmd !== null && total < promo.minSubtotalAmd) {
    return { ok: false, reason: "MIN_SUBTOTAL", minSubtotalAmd: promo.minSubtotalAmd };
  }

  const targeted = promo.productIds.length > 0 || promo.collectionIds.length > 0;
  const eligible = targeted
    ? lines.filter(
        (l) => promo.productIds.includes(l.productId) || promo.collectionIds.includes(l.collectionId),
      )
    : lines;
  const eligibleSubtotalAmd = subtotal(eligible);
  if (eligibleSubtotalAmd <= 0) return { ok: false, reason: "NOT_APPLICABLE" };

  const raw =
    promo.type === "PERCENT"
      ? Math.floor((eligibleSubtotalAmd * promo.value) / 100)
      : promo.value;
  // A discount can never exceed what it applies to.
  const discountAmd = Math.max(0, Math.min(raw, eligibleSubtotalAmd));
  return { ok: true, discountAmd, eligibleSubtotalAmd };
}

export function deliveryPrice(rule: DeliveryRule | null, merchandiseAmd: number): number {
  if (!rule) return 0;
  if (rule.freeFromAmd !== null && merchandiseAmd >= rule.freeFromAmd) return 0;
  return rule.priceAmd;
}

export type Totals = {
  subtotalAmd: number;
  discountAmd: number;
  deliveryAmd: number;
  totalAmd: number;
  // How much more is needed for free delivery (null = no threshold).
  freeDeliveryRemainingAmd: number | null;
};

export function computeTotals(input: {
  lines: PricingLine[];
  discountAmd: number;
  delivery: DeliveryRule | null;
}): Totals {
  const subtotalAmd = subtotal(input.lines);
  const discountAmd = Math.min(input.discountAmd, subtotalAmd);
  // The free-delivery threshold is measured after discounts.
  const merchandise = subtotalAmd - discountAmd;
  const deliveryAmd = deliveryPrice(input.delivery, merchandise);
  const threshold = input.delivery?.freeFromAmd ?? null;
  return {
    subtotalAmd,
    discountAmd,
    deliveryAmd,
    totalAmd: merchandise + deliveryAmd,
    freeDeliveryRemainingAmd: threshold === null ? null : Math.max(0, threshold - merchandise),
  };
}

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
