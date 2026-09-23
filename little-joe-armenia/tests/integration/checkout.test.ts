import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../support/db";
import { checkoutData, createGuestCart, createShopSettings, createVariant, variantStock } from "../support/fixtures";
import { findOrderForViewer, placeOrder } from "@/lib/domain/checkout";
import { adminTransition, TransitionError } from "@/lib/domain/orders";

beforeEach(async () => {
  await resetDb();
  await createShopSettings();
});
afterAll(async () => {
  await testDb.$disconnect();
});

describe("stock race", () => {
  it("10 concurrent checkouts for the last unit: exactly one wins", async () => {
    const { variant } = await createVariant({ stock: 1 });
    const owners = await Promise.all(Array.from({ length: 10 }, () => createGuestCart([{ variantId: variant.id, quantity: 1 }])));

    const results = await Promise.all(owners.map((o) => placeOrder(o, checkoutData(), "hy")));

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const f of failed) expect(f).toEqual({ ok: false, error: "OUT_OF_STOCK" });

    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 1, reserved: 1 });
    expect(await testDb.order.count()).toBe(1);
    expect(await testDb.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(1);
    // losers keep their cart; the winner's line is consumed
    expect(await testDb.cartItem.count()).toBe(9);
  });
});

describe("idempotency", () => {
  it("the same idempotency key twice creates one order", async () => {
    const { variant } = await createVariant({ stock: 5 });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 2 }]);
    const data = checkoutData();

    const first = await placeOrder(owner, data, "en");
    const second = await placeOrder(owner, data, "en");
    expect(first).toMatchObject({ ok: true, existing: false, online: false });
    expect(second).toMatchObject({ ok: true, existing: true });
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.number).toBe(first.number);
    expect(second.orderId).toBe(first.orderId);
    expect(second.accessToken).toBe(first.accessToken);
    expect(await testDb.order.count()).toBe(1);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 2 });
  });

  it("concurrent double submit with the same key creates one order and one reservation", async () => {
    const { variant } = await createVariant({ stock: 5 });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 2 }]);
    const data = checkoutData();

    const [a, b] = await Promise.all([placeOrder(owner, data, "en"), placeOrder(owner, data, "en")]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(a.number).toBe(b.number);
    expect([a.existing, b.existing].sort()).toEqual([false, true]);
    expect(await testDb.order.count()).toBe(1);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 2 });
  });
});

describe("cash on delivery lifecycle", () => {
  it("PENDING with reservation → CONFIRMED commits → CANCELLED restocks", async () => {
    const { variant } = await createVariant({ stock: 5, priceAmd: 3000 });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 2 }]);
    const res = await placeOrder(owner, checkoutData(), "ru");
    expect(res).toMatchObject({ ok: true, online: false });
    if (!res.ok) throw new Error("unreachable");

    const order = await testDb.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { items: true } });
    expect(order).toMatchObject({
      status: "PENDING",
      paymentProvider: "CASH_ON_DELIVERY",
      paymentStatus: "PENDING",
      stockState: "RESERVED",
      reservationExpiresAt: null,
      subtotalAmd: 6000,
      deliveryAmd: 1000,
      totalAmd: 7000,
      customerPhone: "+37491234567",
      deliveryMethodName: "Курьер",
    });
    expect(order.items).toHaveLength(1);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 2 });
    expect(await testDb.cartItem.count()).toBe(0);

    await adminTransition(res.orderId, "CONFIRMED", "admin@shop.am");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 3, reserved: 0 });
    expect((await testDb.order.findUniqueOrThrow({ where: { id: res.orderId } })).stockState).toBe("COMMITTED");

    await adminTransition(res.orderId, "CANCELLED", "admin@shop.am", "customer changed mind");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
    const cancelled = await testDb.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { history: { orderBy: { createdAt: "asc" } } } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.stockState).toBe("RELEASED");
    expect(cancelled.history.map((h) => [h.from, h.to])).toEqual([
      [null, "PENDING"],
      ["PENDING", "CONFIRMED"],
      ["CONFIRMED", "CANCELLED"],
    ]);
    expect(await testDb.auditLog.count({ where: { action: "order.transition", entityId: res.orderId } })).toBe(2);

    const types = await testDb.inventoryMovement.findMany({ where: { variantId: variant.id }, orderBy: { createdAt: "asc" }, select: { type: true } });
    expect(types.map((t) => t.type)).toEqual(["RESERVE", "SALE", "CANCEL_RETURN"]);
  });

  it("cancelling a PENDING order releases the reservation", async () => {
    const { variant } = await createVariant({ stock: 5 });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 3 }]);
    const res = await placeOrder(owner, checkoutData(), "hy");
    if (!res.ok) throw new Error("order failed");
    await adminTransition(res.orderId, "CANCELLED", "admin@shop.am");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
  });

  it("admin cannot mark an order PAID and terminal orders cannot move", async () => {
    const { variant } = await createVariant({ stock: 5 });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 1 }]);
    const res = await placeOrder(owner, checkoutData(), "hy");
    if (!res.ok) throw new Error("order failed");
    await expect(adminTransition(res.orderId, "PAID", "admin@shop.am")).rejects.toBeInstanceOf(TransitionError);
    await adminTransition(res.orderId, "CANCELLED", "admin@shop.am");
    await expect(adminTransition(res.orderId, "CONFIRMED", "admin@shop.am")).rejects.toBeInstanceOf(TransitionError);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
  });
});

describe("checkout guards", () => {
  it("empty cart, unknown delivery method, disabled payment method", async () => {
    const { variant } = await createVariant({ stock: 5 });
    const empty = await createGuestCart([]);
    expect(await placeOrder(empty, checkoutData(), "hy")).toEqual({ ok: false, error: "EMPTY_CART" });

    const owner = await createGuestCart([{ variantId: variant.id, quantity: 1 }]);
    expect(await placeOrder(owner, checkoutData({ deliveryMethod: "teleport" }), "hy")).toEqual({ ok: false, error: "DELIVERY_INVALID" });
    expect(await placeOrder(owner, checkoutData({ payment: "TELCELL" }), "hy")).toEqual({ ok: false, error: "PAYMENT_UNAVAILABLE" });
    expect(await testDb.order.count()).toBe(0);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
  });

  it("archived product in the cart → CART_PROBLEM", async () => {
    const { variant, product } = await createVariant({ stock: 5 });
    await testDb.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 1 }]);
    expect(await placeOrder(owner, checkoutData(), "hy")).toEqual({ ok: false, error: "CART_PROBLEM" });
  });
});

describe("promotions at checkout", () => {
  async function promo(usageLimit: number | null) {
    return testDb.promotion.create({ data: { code: "ONE", name: "One", type: "FIXED", value: 500, usageLimit } });
  }

  it("usage limit 1: second order gets PROMO_INVALID; cancelling returns the usage", async () => {
    const { variant } = await createVariant({ stock: 10, priceAmd: 2000 });
    const p = await promo(1);

    const o1 = await placeOrder(await createGuestCart([{ variantId: variant.id, quantity: 1 }], "ONE"), checkoutData(), "hy");
    expect(o1).toMatchObject({ ok: true });
    if (!o1.ok) throw new Error("unreachable");
    const order1 = await testDb.order.findUniqueOrThrow({ where: { id: o1.orderId } });
    expect(order1).toMatchObject({ discountAmd: 500, subtotalAmd: 2000, totalAmd: 2500, promoCode: "ONE", promotionId: p.id });
    expect((await testDb.promotion.findUniqueOrThrow({ where: { id: p.id } })).usedCount).toBe(1);

    const owner2 = await createGuestCart([{ variantId: variant.id, quantity: 1 }], "ONE");
    expect(await placeOrder(owner2, checkoutData(), "hy")).toEqual({ ok: false, error: "PROMO_INVALID" });
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 10, reserved: 1 });

    await adminTransition(o1.orderId, "CANCELLED", "admin@shop.am");
    expect((await testDb.promotion.findUniqueOrThrow({ where: { id: p.id } })).usedCount).toBe(0);
    expect(await testDb.promotionRedemption.count()).toBe(0);

    // the usage is available again
    expect(await placeOrder(owner2, checkoutData(), "hy")).toMatchObject({ ok: true });
  });

  it("usage limit 1 under concurrency: exactly one order gets the promo", async () => {
    const { variant } = await createVariant({ stock: 10, priceAmd: 2000 });
    const p = await promo(1);
    const owners = await Promise.all(Array.from({ length: 5 }, () => createGuestCart([{ variantId: variant.id, quantity: 1 }], "ONE")));
    const results = await Promise.all(owners.map((o) => placeOrder(o, checkoutData(), "hy")));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === "PROMO_INVALID")).toBe(true);
    expect((await testDb.promotion.findUniqueOrThrow({ where: { id: p.id } })).usedCount).toBe(1);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 10, reserved: 1 });
  });
});

describe("order viewer", () => {
  it("loading the order page never changes its state; wrong token sees nothing", async () => {
    const { variant } = await createVariant({ stock: 5 });
    const owner = await createGuestCart([{ variantId: variant.id, quantity: 1 }]);
    const res = await placeOrder(owner, checkoutData({ payment: "IDRAM" }), "en");
    if (!res.ok) throw new Error("order failed");
    expect(res.online).toBe(true);

    const before = await testDb.order.findUniqueOrThrow({ where: { id: res.orderId } });
    const seen = await findOrderForViewer(res.number, res.accessToken, { customerId: null, guestId: null });
    expect(seen?.id).toBe(res.orderId);
    expect(seen?.status).toBe("AWAITING_PAYMENT");
    expect(await findOrderForViewer(res.number, "wrong-token", { customerId: null, guestId: null })).toBeNull();
    expect(await findOrderForViewer(res.number, undefined, owner)).toBeNull();

    const after = await testDb.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(after.status).toBe("AWAITING_PAYMENT");
    expect(after.paymentStatus).toBe("PENDING");
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });
  });
});
