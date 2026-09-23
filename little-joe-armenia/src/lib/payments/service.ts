import "server-only";
import { Prisma, type PaymentProviderCode } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import type { Locale } from "@/i18n/config";
import { LatePaymentStockError, TransitionError, transitionOrder } from "@/lib/domain/orders";
import { adapterById, adapterFor } from "@/lib/payments/registry";
import { randomToken } from "@/lib/security/crypto";
import { PaymentNotAvailableError, type PaymentStart } from "@/lib/payments/types";
import { orderAccessToken } from "@/lib/domain/checkout";
import { paths } from "@/lib/paths";

// Provider-agnostic payment pipeline.
//
// Rules enforced here:
// 1. Only a verified provider callback changes payment/order state. The
//    browser return page just reads state.
// 2. Every callback is stored in PaymentEvent. (adapter, eventId) is unique,
//    so a duplicate delivery hits the constraint and is acknowledged without
//    re-running side effects — even when two deliveries arrive concurrently.
// 3. Callbacks with a bad signature are stored under a random id (so a
//    forged event can never "burn" a real provider event id) and rejected.
// 4. The amount in the callback must equal the stored payment amount.

export async function startPayment(orderId: string, locale: Locale): Promise<PaymentStart> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const adapter = adapterFor(order.paymentProvider);
  if (!adapter) throw new PaymentNotAvailableError(order.paymentProvider);
  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      provider: order.paymentProvider,
      adapter: adapter.id,
      amountAmd: order.totalAmd,
    },
  });
  const base = env().APP_URL;
  return adapter.start({
    paymentId: payment.id,
    orderNumber: order.number,
    amountAmd: order.totalAmd,
    locale,
    returnUrl: new URL(paths.order(locale, order.number, orderAccessToken(order.idempotencyKey)), base).toString(),
    callbackUrl: new URL(`/api/payments/callback/${adapter.id}`, base).toString(),
  });
}

export type CallbackOutcome =
  | "APPLIED_SUCCESS"
  | "APPLIED_FAILURE"
  | "DUPLICATE"
  | "IGNORED_STALE"
  | "PRECHECK_OK"
  | "PRECHECK_REJECTED"
  | "REJECTED_SIGNATURE"
  | "REJECTED_AMOUNT"
  | "REJECTED_UNKNOWN_PAYMENT"
  | "REJECTED_INVALID"
  | "PAID_STOCK_UNAVAILABLE"
  | "PAID_ORDER_CLOSED";

export async function handleCallback(adapterId: string, request: Request): Promise<{ response: Response; outcome: CallbackOutcome }> {
  const adapter = adapterById(adapterId);
  if (!adapter) return { response: new Response("Unknown provider", { status: 404 }), outcome: "REJECTED_INVALID" };

  const body = await request.text();
  if (body.length > 64 * 1024) {
    return { response: new Response("Payload too large", { status: 413 }), outcome: "REJECTED_INVALID" };
  }
  const parsed = await adapter.parseCallback({
    body,
    contentType: request.headers.get("content-type") ?? "",
    headers: request.headers,
  });
  const payload = { body, contentType: request.headers.get("content-type") ?? "" };

  if (parsed.kind === "invalid") {
    await db.paymentEvent.create({
      data: { adapter: adapter.id, eventId: `invalid:${randomToken(12)}`, signatureValid: false, outcome: "REJECTED_INVALID", payload },
    });
    return { response: adapter.ack(false), outcome: "REJECTED_INVALID" };
  }

  const payment = await db.payment.findUnique({ where: { id: parsed.paymentId }, include: { order: true } });

  if (parsed.kind === "precheck") {
    const ok =
      parsed.signatureValid &&
      payment !== null &&
      payment.adapter === adapter.id &&
      payment.amountAmd === parsed.amountAmd &&
      (payment.order.status === "AWAITING_PAYMENT");
    return { response: adapter.ack(ok), outcome: ok ? "PRECHECK_OK" : "PRECHECK_REJECTED" };
  }

  if (!parsed.signatureValid) {
    await db.paymentEvent.create({
      data: {
        adapter: adapter.id,
        eventId: `forged:${randomToken(12)}`,
        paymentId: payment?.id,
        signatureValid: false,
        outcome: "REJECTED_SIGNATURE",
        payload,
      },
    });
    await audit({ actor: `provider:${adapter.id}`, action: "payment.callback.bad_signature", entity: "Payment", entityId: parsed.paymentId });
    return { response: adapter.ack(false), outcome: "REJECTED_SIGNATURE" };
  }

  if (!payment || payment.adapter !== adapter.id) {
    await db.paymentEvent.create({
      data: { adapter: adapter.id, eventId: `unknown:${randomToken(12)}`, signatureValid: true, outcome: "REJECTED_UNKNOWN_PAYMENT", payload },
    });
    return { response: adapter.ack(false), outcome: "REJECTED_UNKNOWN_PAYMENT" };
  }

  if (parsed.amountAmd !== payment.amountAmd) {
    await db.paymentEvent.create({
      data: { adapter: adapter.id, eventId: `amount:${randomToken(12)}`, paymentId: payment.id, signatureValid: true, outcome: "REJECTED_AMOUNT", payload },
    });
    await audit({
      actor: `provider:${adapter.id}`,
      action: "payment.callback.amount_mismatch",
      entity: "Payment",
      entityId: payment.id,
      data: { expected: payment.amountAmd, got: parsed.amountAmd },
    });
    return { response: adapter.ack(false), outcome: "REJECTED_AMOUNT" };
  }

  try {
    const outcome = await db.$transaction(async (tx) => {
      // Idempotency gate: the unique (adapter, eventId) insert is the first
      // write. A concurrent duplicate blocks on it and then fails with P2002.
      const event = await tx.paymentEvent.create({
        data: {
          adapter: adapter.id,
          eventId: parsed.eventId,
          paymentId: payment.id,
          signatureValid: true,
          outcome: "PROCESSING",
          payload,
        },
      });

      const lockedPayment = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
      const paymentStatus = lockedPayment[0]?.status;

      let result: CallbackOutcome;
      if (parsed.outcome === "SUCCEEDED") {
        if (paymentStatus === "SUCCEEDED") {
          result = "DUPLICATE";
        } else {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", providerRef: parsed.providerRef } });
          await transitionOrder(tx, payment.orderId, "PAID", { kind: "payment", name: adapter.id }, {
            paymentStatus: "SUCCEEDED",
            note: `Verified ${adapter.id} callback ${parsed.eventId}`,
          });
          result = "APPLIED_SUCCESS";
        }
      } else {
        if (paymentStatus === "SUCCEEDED") {
          // A failure notice after success never un-pays an order.
          result = "IGNORED_STALE";
        } else {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", providerRef: parsed.providerRef } });
          const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, select: { status: true } });
          if (order.status === "AWAITING_PAYMENT") {
            await transitionOrder(tx, payment.orderId, "PAYMENT_FAILED", { kind: "payment", name: adapter.id }, {
              paymentStatus: "FAILED",
              note: `Declined by ${adapter.id} (${parsed.eventId})`,
            });
            result = "APPLIED_FAILURE";
          } else {
            result = "IGNORED_STALE";
          }
        }
      }
      await tx.paymentEvent.update({ where: { id: event.id }, data: { outcome: result } });
      return result;
    });
    return { response: adapter.ack(true), outcome };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Already processed: acknowledge so the provider stops retrying.
      return { response: adapter.ack(true), outcome: "DUPLICATE" };
    }
    if (e instanceof LatePaymentStockError) {
      await markPaidWithoutStock(payment.id, payment.orderId, adapter.id, parsed.eventId, parsed.providerRef, payload);
      return { response: adapter.ack(true), outcome: "PAID_STOCK_UNAVAILABLE" };
    }
    if (e instanceof TransitionError) {
      if (parsed.outcome === "SUCCEEDED") {
        // Money arrived for an order that can no longer become PAID (e.g.
        // cancelled by an admin). Never lose it: record the payment as
        // taken, flag the order for a refund, audit it.
        await markPaidOnClosedOrder(payment.id, payment.orderId, adapter.id, parsed.eventId, parsed.providerRef, payload, e.from);
        return { response: adapter.ack(true), outcome: "PAID_ORDER_CLOSED" };
      }
      await db.paymentEvent
        .create({
          data: { adapter: adapter.id, eventId: parsed.eventId, paymentId: payment.id, signatureValid: true, outcome: `IGNORED_${e.from}`, payload },
        })
        .catch(() => undefined);
      return { response: adapter.ack(true), outcome: "IGNORED_STALE" };
    }
    throw e;
  }
}

/**
 * Money was taken after the reservation lapsed and the goods are gone. The
 * order must still show as PAID (we owe the customer goods or a refund);
 * it is flagged in history and the audit log for manual handling.
 */
async function markPaidWithoutStock(
  paymentId: string,
  orderId: string,
  adapterId: string,
  eventId: string,
  providerRef: string | null,
  payload: Prisma.InputJsonValue,
) {
  await db.$transaction(async (tx) => {
    await tx.paymentEvent.create({
      data: { adapter: adapterId, eventId, paymentId, signatureValid: true, outcome: "PAID_STOCK_UNAVAILABLE", payload },
    });
    await tx.payment.update({ where: { id: paymentId }, data: { status: "SUCCEEDED", providerRef } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        paymentStatus: "SUCCEEDED",
        history: {
          create: {
            from: order.status,
            to: "PAID",
            actor: `payment:${adapterId}`,
            note: "STOCK UNAVAILABLE: paid after reservation expired — resolve manually (restock or refund)",
          },
        },
      },
    });
    await audit({ actor: `provider:${adapterId}`, action: "payment.late_without_stock", entity: "Order", entityId: orderId }, tx);
  });
}

async function markPaidOnClosedOrder(
  paymentId: string,
  orderId: string,
  adapterId: string,
  eventId: string,
  providerRef: string | null,
  payload: Prisma.InputJsonValue,
  orderStatus: string,
) {
  try {
    await db.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: { adapter: adapterId, eventId, paymentId, signatureValid: true, outcome: "PAID_ORDER_CLOSED", payload },
      });
      await tx.payment.update({ where: { id: paymentId }, data: { status: "SUCCEEDED", providerRef } });
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "SUCCEEDED" } });
      await tx.orderNote.create({
        data: {
          orderId,
          author: `payment:${adapterId}`,
          body: `REFUND REQUIRED: a verified payment (${eventId}) arrived while the order was ${orderStatus}.`,
        },
      });
      await audit(
        { actor: `provider:${adapterId}`, action: "payment.paid_on_closed_order", entity: "Order", entityId: orderId, data: { eventId, orderStatus } },
        tx,
      );
    });
  } catch (e) {
    // Duplicate delivery of the same event: already recorded.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
}

/** Used by the order page: may the shopper retry an online payment? */
export function canRetryPayment(order: { status: string; paymentProvider: PaymentProviderCode }) {
  return order.status === "PAYMENT_FAILED" && order.paymentProvider !== "CASH_ON_DELIVERY";
}
