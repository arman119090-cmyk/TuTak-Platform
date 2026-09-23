import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../support/db";
import { checkoutData, createGuestCart, createShopSettings, createVariant, variantStock } from "../support/fixtures";
import { placeOrder } from "@/lib/domain/checkout";
import { expireReservations } from "@/lib/domain/orders";
import { handleCallback, startPayment } from "@/lib/payments/service";
import { signMockBody } from "@/lib/payments/adapters/mock";

beforeEach(async () => {
  await resetDb();
  await createShopSettings();
});
afterAll(async () => {
  await testDb.$disconnect();
});

type Body = { eventId: string; paymentId: string; outcome: "SUCCEEDED" | "FAILED"; amountAmd: number; providerRef: string };

function callback(body: Body, opts: { signature?: string } = {}) {
  const raw = JSON.stringify(body);
  return new Request("http://localhost:3000/api/payments/callback/mock", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": opts.signature ?? signMockBody(raw) },
    body: raw,
  });
}

/** Online (IDRAM, mock mode) order with a started payment. */
async function onlineOrder(opts: { stock?: number; quantity?: number; priceAmd?: number } = {}) {
  const { variant } = await createVariant({ stock: opts.stock ?? 5, priceAmd: opts.priceAmd ?? 2500 });
  const owner = await createGuestCart([{ variantId: variant.id, quantity: opts.quantity ?? 1 }]);
  const res = await placeOrder(owner, checkoutData({ payment: "IDRAM" }), "en");
  if (!res.ok) throw new Error(`placeOrder failed: ${res.error}`);
  expect(res.online).toBe(true);
  const start = await startPayment(res.orderId, "en");
  const payment = await testDb.payment.findFirstOrThrow({ where: { orderId: res.orderId } });
  return { variant, orderId: res.orderId, payment, start };
}

const order = (id: string) => testDb.order.findUniqueOrThrow({ where: { id } });
const ev = (paymentId: string, amountAmd: number, outcome: Body["outcome"] = "SUCCEEDED", eventId = `evt_${randomUUID()}`): Body => ({
  eventId,
  paymentId,
  outcome,
  amountAmd,
  providerRef: `ref_${eventId}`,
});

describe("mock payment callbacks", () => {
  it("startPayment creates a PENDING payment and redirects to the sandbox; order awaits payment", async () => {
    const { orderId, payment, start, variant } = await onlineOrder();
    const o = await order(orderId);
    expect(o.status).toBe("AWAITING_PAYMENT");
    expect(o.reservationExpiresAt).not.toBeNull();
    expect(payment).toMatchObject({ adapter: "mock", provider: "IDRAM", status: "PENDING", amountAmd: o.totalAmd });
    expect(start).toEqual({ kind: "redirect", url: `http://localhost:3000/en/pay/mock/${payment.id}` });
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });
  });

  it("verified success marks PAID, payment SUCCEEDED, stock committed", async () => {
    const { orderId, payment, variant } = await onlineOrder({ quantity: 2 });
    const { outcome, response } = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd)));
    expect(outcome).toBe("APPLIED_SUCCESS");
    expect(response.status).toBe(200);

    const o = await order(orderId);
    expect(o).toMatchObject({ status: "PAID", paymentStatus: "SUCCEEDED", stockState: "COMMITTED" });
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SUCCEEDED");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 3, reserved: 0 });
  });

  it("duplicate webhook (sequential) is processed once", async () => {
    const { payment, variant } = await onlineOrder();
    const body = ev(payment.id, payment.amountAmd);
    expect((await handleCallback("mock", callback(body))).outcome).toBe("APPLIED_SUCCESS");
    const second = await handleCallback("mock", callback(body));
    expect(second.outcome).toBe("DUPLICATE");
    expect(second.response.status).toBe(200);

    expect(await testDb.paymentEvent.count({ where: { eventId: body.eventId } })).toBe(1);
    expect(await testDb.inventoryMovement.count({ where: { variantId: variant.id, type: "SALE" } })).toBe(1);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 4, reserved: 0 });
  });

  it("duplicate webhook (concurrent) is processed once", async () => {
    const { orderId, payment, variant } = await onlineOrder();
    const body = ev(payment.id, payment.amountAmd);
    const results = await Promise.all(Array.from({ length: 5 }, () => handleCallback("mock", callback(body))));
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["APPLIED_SUCCESS", "DUPLICATE", "DUPLICATE", "DUPLICATE", "DUPLICATE"]);
    for (const r of results) expect(r.response.status).toBe(200);

    expect(await testDb.paymentEvent.count({ where: { eventId: body.eventId } })).toBe(1);
    expect(await testDb.inventoryMovement.count({ where: { variantId: variant.id, type: "SALE" } })).toBe(1);
    expect(await testDb.orderStatusHistory.count({ where: { orderId, to: "PAID" } })).toBe(1);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 4, reserved: 0 });
  });

  it("a second, different success event for an already paid payment changes nothing", async () => {
    const { payment, variant } = await onlineOrder();
    await handleCallback("mock", callback(ev(payment.id, payment.amountAmd)));
    const again = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd)));
    expect(again.outcome).toBe("DUPLICATE");
    expect(await testDb.inventoryMovement.count({ where: { variantId: variant.id, type: "SALE" } })).toBe(1);
  });

  it("bad signature → REJECTED_SIGNATURE, order unchanged, event stored under a random id", async () => {
    const { orderId, payment, variant } = await onlineOrder();
    const body = ev(payment.id, payment.amountAmd);
    const res = await handleCallback("mock", callback(body, { signature: "0".repeat(64) }));
    expect(res.outcome).toBe("REJECTED_SIGNATURE");
    expect(res.response.status).toBe(400);

    const o = await order(orderId);
    expect(o).toMatchObject({ status: "AWAITING_PAYMENT", paymentStatus: "PENDING", stockState: "RESERVED" });
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });
    const events = await testDb.paymentEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ signatureValid: false, outcome: "REJECTED_SIGNATURE" });
    expect(events[0]!.eventId).toMatch(/^forged:/);

    // A forged event cannot burn the real event id: the genuine one still applies.
    expect((await handleCallback("mock", callback(body))).outcome).toBe("APPLIED_SUCCESS");
  });

  it("missing signature is rejected too", async () => {
    const { orderId, payment } = await onlineOrder();
    const res = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd), { signature: "" }));
    expect(res.outcome).toBe("REJECTED_SIGNATURE");
    expect((await order(orderId)).status).toBe("AWAITING_PAYMENT");
  });

  it("amount mismatch → REJECTED_AMOUNT, order unchanged", async () => {
    const { orderId, payment, variant } = await onlineOrder();
    const res = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd - 1)));
    expect(res.outcome).toBe("REJECTED_AMOUNT");
    expect((await order(orderId)).status).toBe("AWAITING_PAYMENT");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });
    expect(await testDb.auditLog.count({ where: { action: "payment.callback.amount_mismatch" } })).toBe(1);
  });

  it("unknown payment id and malformed body are rejected", async () => {
    await onlineOrder();
    expect((await handleCallback("mock", callback(ev("nope", 100)))).outcome).toBe("REJECTED_UNKNOWN_PAYMENT");
    const bad = new Request("http://x/api/payments/callback/mock", { method: "POST", body: "{not json" });
    expect((await handleCallback("mock", bad)).outcome).toBe("REJECTED_INVALID");
    expect((await handleCallback("nonexistent", callback(ev("x", 1)))).outcome).toBe("REJECTED_INVALID");
  });

  it("failure callback → PAYMENT_FAILED and stock released", async () => {
    const { orderId, payment, variant } = await onlineOrder({ quantity: 2 });
    const res = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd, "FAILED")));
    expect(res.outcome).toBe("APPLIED_FAILURE");
    expect(await order(orderId)).toMatchObject({ status: "PAYMENT_FAILED", paymentStatus: "FAILED", stockState: "RELEASED" });
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("FAILED");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
  });

  it("failure after success never un-pays", async () => {
    const { orderId, payment, variant } = await onlineOrder();
    await handleCallback("mock", callback(ev(payment.id, payment.amountAmd)));
    const res = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd, "FAILED")));
    expect(res.outcome).toBe("IGNORED_STALE");
    expect((await order(orderId)).status).toBe("PAID");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 4, reserved: 0 });
  });

  it("late success after failure → PAID with stock re-taken", async () => {
    const { orderId, payment, variant } = await onlineOrder({ quantity: 2 });
    await handleCallback("mock", callback(ev(payment.id, payment.amountAmd, "FAILED")));
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });

    const res = await handleCallback("mock", callback(ev(payment.id, payment.amountAmd)));
    expect(res.outcome).toBe("APPLIED_SUCCESS");
    expect(await order(orderId)).toMatchObject({ status: "PAID", paymentStatus: "SUCCEEDED", stockState: "COMMITTED" });
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 3, reserved: 0 });
    const sales = await testDb.inventoryMovement.findMany({ where: { variantId: variant.id, type: "SALE" } });
    expect(sales.map((s) => [s.onHandDelta, s.reservedDelta])).toEqual([[-2, 0]]);
  });

  it("late success when the stock is gone → PAID_STOCK_UNAVAILABLE, order PAID, history note", async () => {
    const { orderId, payment, variant } = await onlineOrder({ stock: 1, quantity: 1 });
    await handleCallback("mock", callback(ev(payment.id, payment.amountAmd, "FAILED")));
    // Someone else bought the last unit meanwhile.
    await testDb.variant.update({ where: { id: variant.id }, data: { stockOnHand: 0 } });

    const body = ev(payment.id, payment.amountAmd);
    const res = await handleCallback("mock", callback(body));
    expect(res.outcome).toBe("PAID_STOCK_UNAVAILABLE");
    expect(res.response.status).toBe(200);

    const o = await testDb.order.findUniqueOrThrow({ where: { id: orderId }, include: { history: { orderBy: { createdAt: "asc" } } } });
    expect(o.status).toBe("PAID");
    expect(o.paymentStatus).toBe("SUCCEEDED");
    const last = o.history.at(-1)!;
    expect(last).toMatchObject({ from: "PAYMENT_FAILED", to: "PAID" });
    expect(last.note).toMatch(/STOCK UNAVAILABLE/);
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SUCCEEDED");
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 0, reserved: 0 });
    expect(await testDb.paymentEvent.count({ where: { eventId: body.eventId, outcome: "PAID_STOCK_UNAVAILABLE" } })).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: "payment.late_without_stock", entityId: orderId } })).toBe(1);

    // A redelivery of the same event does not create a second PAID entry.
    const again = await handleCallback("mock", callback(body));
    expect(again.outcome).toBe("DUPLICATE");
    expect(await testDb.orderStatusHistory.count({ where: { orderId, to: "PAID" } })).toBe(1);
  });
});

describe("expireReservations", () => {
  it("AWAITING_PAYMENT past its reservation → PAYMENT_FAILED, stock released", async () => {
    const { orderId, variant } = await onlineOrder({ quantity: 2 });
    const fresh = await onlineOrder({ quantity: 1 });
    await testDb.order.update({ where: { id: orderId }, data: { reservationExpiresAt: new Date(Date.now() - 60_000) } });

    const r = await expireReservations(new Date());
    expect(r).toEqual({ failed: 1, cancelled: 0 });
    expect(await order(orderId)).toMatchObject({ status: "PAYMENT_FAILED", paymentStatus: "FAILED", stockState: "RELEASED" });
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
    // the unexpired order is untouched
    expect((await order(fresh.orderId)).status).toBe("AWAITING_PAYMENT");
    expect(await variantStock(fresh.variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });

    // running again is a no-op
    expect(await expireReservations(new Date())).toEqual({ failed: 0, cancelled: 0 });
  });

  it("PAYMENT_FAILED older than 24h is cancelled", async () => {
    const { orderId } = await onlineOrder();
    await testDb.order.update({ where: { id: orderId }, data: { reservationExpiresAt: new Date(Date.now() - 60_000) } });
    await expireReservations(new Date());
    const r = await expireReservations(new Date(Date.now() + 25 * 3600_000));
    expect(r.cancelled).toBe(1);
    expect((await order(orderId)).status).toBe("CANCELLED");
  });
});

describe("payment after the order was closed", () => {
  it("success callback on an admin-cancelled order is recorded and flagged for refund, never lost", async () => {
    const { adminTransition } = await import("@/lib/domain/orders");
    const { orderId, payment } = await onlineOrder();
    await adminTransition(orderId, "CANCELLED", "admin@test");
    const body = ev(payment.id, payment.amountAmd);
    const first = await handleCallback("mock", callback(body));
    expect(first.outcome).toBe("PAID_ORDER_CLOSED");
    expect(first.response.status).toBe(200);
    const o = await order(orderId);
    expect(o).toMatchObject({ status: "CANCELLED", paymentStatus: "SUCCEEDED" });
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SUCCEEDED");
    const notes = await testDb.orderNote.findMany({ where: { orderId } });
    expect(notes.some((n) => n.body.startsWith("REFUND REQUIRED"))).toBe(true);
    expect(await testDb.auditLog.count({ where: { action: "payment.paid_on_closed_order", entityId: orderId } })).toBe(1);
    // Redelivery of the same event does not duplicate anything.
    await handleCallback("mock", callback(body));
    expect(await testDb.orderNote.count({ where: { orderId } })).toBe(1);
    expect(await testDb.paymentEvent.count({ where: { eventId: body.eventId } })).toBe(1);
  });
});
