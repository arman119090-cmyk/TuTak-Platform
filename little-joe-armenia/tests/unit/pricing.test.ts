import { describe, expect, it } from "vitest";
import {
  computeTotals,
  deliveryPrice,
  evaluatePromotion,
  normalizePromoCode,
  subtotal,
  type PricingLine,
  type PromotionRule,
} from "@/lib/domain/pricing";

const NOW = new Date("2026-06-15T12:00:00Z");

const lines: PricingLine[] = [
  { variantId: "v1", productId: "p1", collectionId: "c1", unitAmd: 2500, quantity: 2 }, // 5000
  { variantId: "v2", productId: "p2", collectionId: "c2", unitAmd: 3000, quantity: 1 }, // 3000
];

function promo(over: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id: "promo1",
    code: "SALE",
    type: "PERCENT",
    value: 10,
    startsAt: null,
    endsAt: null,
    minSubtotalAmd: null,
    usageLimit: null,
    usedCount: 0,
    isActive: true,
    productIds: [],
    collectionIds: [],
    ...over,
  };
}

describe("subtotal", () => {
  it("sums unit × quantity", () => {
    expect(subtotal(lines)).toBe(8000);
    expect(subtotal([])).toBe(0);
  });
});

describe("evaluatePromotion", () => {
  it("rejects null promo as NOT_FOUND and inactive as INACTIVE", () => {
    expect(evaluatePromotion(null, lines, NOW)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(evaluatePromotion(promo({ isActive: false }), lines, NOW)).toEqual({ ok: false, reason: "INACTIVE" });
  });

  it("percent discount floors to whole AMD", () => {
    expect(evaluatePromotion(promo({ value: 10 }), lines, NOW)).toEqual({ ok: true, discountAmd: 800, eligibleSubtotalAmd: 8000 });
    // 8000 * 7% = 560; 3000*33% = 990 exactly; use odd value to check floor
    const r = evaluatePromotion(promo({ value: 7 }), [{ ...lines[1]!, unitAmd: 2999 }], NOW);
    expect(r).toEqual({ ok: true, discountAmd: Math.floor((2999 * 7) / 100), eligibleSubtotalAmd: 2999 });
  });

  it("fixed discount is the fixed amount", () => {
    expect(evaluatePromotion(promo({ type: "FIXED", value: 1500 }), lines, NOW)).toEqual({
      ok: true,
      discountAmd: 1500,
      eligibleSubtotalAmd: 8000,
    });
  });

  it("targets by product id only the matching lines", () => {
    const r = evaluatePromotion(promo({ value: 50, productIds: ["p2"] }), lines, NOW);
    expect(r).toEqual({ ok: true, discountAmd: 1500, eligibleSubtotalAmd: 3000 });
  });

  it("targets by collection id only the matching lines", () => {
    const r = evaluatePromotion(promo({ value: 10, collectionIds: ["c1"] }), lines, NOW);
    expect(r).toEqual({ ok: true, discountAmd: 500, eligibleSubtotalAmd: 5000 });
  });

  it("product OR collection targeting unions the lines", () => {
    const r = evaluatePromotion(promo({ value: 10, productIds: ["p2"], collectionIds: ["c1"] }), lines, NOW);
    expect(r).toEqual({ ok: true, discountAmd: 800, eligibleSubtotalAmd: 8000 });
  });

  it("targeted promo with no matching line is NOT_APPLICABLE", () => {
    expect(evaluatePromotion(promo({ productIds: ["nope"] }), lines, NOW)).toEqual({ ok: false, reason: "NOT_APPLICABLE" });
    expect(evaluatePromotion(promo(), [], NOW)).toEqual({ ok: false, reason: "NOT_APPLICABLE" });
  });

  it("enforces minimum subtotal (inclusive)", () => {
    expect(evaluatePromotion(promo({ minSubtotalAmd: 8001 }), lines, NOW)).toEqual({
      ok: false,
      reason: "MIN_SUBTOTAL",
      minSubtotalAmd: 8001,
    });
    expect(evaluatePromotion(promo({ minSubtotalAmd: 8000 }), lines, NOW).ok).toBe(true);
  });

  it("enforces usage limit", () => {
    expect(evaluatePromotion(promo({ usageLimit: 3, usedCount: 3 }), lines, NOW)).toEqual({ ok: false, reason: "USAGE_LIMIT" });
    expect(evaluatePromotion(promo({ usageLimit: 3, usedCount: 2 }), lines, NOW).ok).toBe(true);
    expect(evaluatePromotion(promo({ usageLimit: 0, usedCount: 0 }), lines, NOW)).toEqual({ ok: false, reason: "USAGE_LIMIT" });
  });

  it("enforces start and end dates", () => {
    expect(evaluatePromotion(promo({ startsAt: new Date(NOW.getTime() + 1) }), lines, NOW)).toEqual({
      ok: false,
      reason: "NOT_STARTED",
    });
    expect(evaluatePromotion(promo({ endsAt: new Date(NOW.getTime() - 1) }), lines, NOW)).toEqual({ ok: false, reason: "EXPIRED" });
    // boundaries are inclusive
    expect(evaluatePromotion(promo({ startsAt: NOW, endsAt: NOW }), lines, NOW).ok).toBe(true);
  });

  it("discount never exceeds the eligible subtotal", () => {
    expect(evaluatePromotion(promo({ type: "FIXED", value: 100_000 }), lines, NOW)).toEqual({
      ok: true,
      discountAmd: 8000,
      eligibleSubtotalAmd: 8000,
    });
    expect(evaluatePromotion(promo({ type: "FIXED", value: 100_000, productIds: ["p2"] }), lines, NOW)).toEqual({
      ok: true,
      discountAmd: 3000,
      eligibleSubtotalAmd: 3000,
    });
    expect(evaluatePromotion(promo({ type: "PERCENT", value: 100 }), lines, NOW)).toMatchObject({ discountAmd: 8000 });
  });
});

describe("delivery and totals", () => {
  const courier = { code: "courier", priceAmd: 1000, freeFromAmd: 10_000 };

  it("deliveryPrice: free at/above threshold, null rule is 0, no threshold never free", () => {
    expect(deliveryPrice(courier, 9999)).toBe(1000);
    expect(deliveryPrice(courier, 10_000)).toBe(0);
    expect(deliveryPrice(null, 5000)).toBe(0);
    expect(deliveryPrice({ code: "x", priceAmd: 700, freeFromAmd: null }, 1_000_000)).toBe(700);
  });

  it("free delivery threshold is measured after the discount", () => {
    const big: PricingLine[] = [{ variantId: "v", productId: "p", collectionId: "c", unitAmd: 5000, quantity: 2 }]; // 10000
    const noDiscount = computeTotals({ lines: big, discountAmd: 0, delivery: courier });
    expect(noDiscount).toEqual({
      subtotalAmd: 10_000,
      discountAmd: 0,
      deliveryAmd: 0,
      totalAmd: 10_000,
      freeDeliveryRemainingAmd: 0,
    });
    const discounted = computeTotals({ lines: big, discountAmd: 500, delivery: courier });
    expect(discounted).toEqual({
      subtotalAmd: 10_000,
      discountAmd: 500,
      deliveryAmd: 1000,
      totalAmd: 10_500,
      freeDeliveryRemainingAmd: 500,
    });
  });

  it("freeDeliveryRemaining is null without threshold / without delivery", () => {
    expect(computeTotals({ lines, discountAmd: 0, delivery: null }).freeDeliveryRemainingAmd).toBeNull();
    expect(
      computeTotals({ lines, discountAmd: 0, delivery: { code: "x", priceAmd: 700, freeFromAmd: null } }).freeDeliveryRemainingAmd,
    ).toBeNull();
    expect(computeTotals({ lines, discountAmd: 0, delivery: courier }).freeDeliveryRemainingAmd).toBe(2000);
  });

  it("clamps an oversized discount to the subtotal; total never negative", () => {
    const t = computeTotals({ lines, discountAmd: 999_999, delivery: courier });
    expect(t.discountAmd).toBe(8000);
    expect(t.totalAmd).toBe(1000);
    expect(t.freeDeliveryRemainingAmd).toBe(10_000);
  });
});

describe("normalizePromoCode", () => {
  it("trims, uppercases and removes inner whitespace", () => {
    expect(normalizePromoCode("  sum mer 10 ")).toBe("SUMMER10");
  });
});
