import "server-only";
import type { OrderStatus as DbOrderStatus, PaymentStatus } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import {
  canTransition,
  stockEffect,
  type OrderStatus,
  type TransitionActor,
} from "@/lib/domain/order-state";
import {
  commitReserved,
  InsufficientStockError,
  release,
  reserve,
  restock,
  sellFromAvailable,
} from "@/lib/domain/inventory";

export class TransitionError extends Error {
  constructor(public readonly from: OrderStatus, public readonly to: OrderStatus) {
    super(`Transition ${from} → ${to} is not allowed`);
    this.name = "TransitionError";
  }
}

type StockState = "RESERVED" | "COMMITTED" | "RELEASED";

export type Actor = { kind: TransitionActor; name: string };

/**
 * Moves an order to a new status and applies the stock side effect in the
 * same transaction. The order row is locked (SELECT … FOR UPDATE) first, so
 * a webhook and an admin click on the same order are serialised and the
 * second one sees the first one's result.
 */
export async function transitionOrder(
  tx: Tx,
  orderId: string,
  to: OrderStatus,
  actor: Actor,
  opts: { note?: string; paymentStatus?: PaymentStatus } = {},
) {
  const locked = await tx.$queryRaw<{ status: DbOrderStatus; stockState: string }[]>`
    SELECT "status", "stockState" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  const current = locked[0];
  if (!current) throw new Error(`Order ${orderId} not found`);
  const from = current.status as OrderStatus;
  if (!canTransition(from, to, actor.kind)) throw new TransitionError(from, to);

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { variantId: true, quantity: true },
    // Consistent lock order across concurrent transactions avoids deadlocks.
    orderBy: { variantId: "asc" },
  });

  let stockState = current.stockState as StockState;
  const effect = stockEffect(to, stockState);
  const who = `${actor.kind}:${actor.name}`;

  switch (effect) {
    case "RESERVE":
      for (const i of items) await reserve(tx, i.variantId, i.quantity, orderId, who);
      stockState = "RESERVED";
      break;
    case "COMMIT":
      if (stockState === "RESERVED") {
        for (const i of items) await commitReserved(tx, i.variantId, i.quantity, orderId, who);
        stockState = "COMMITTED";
      } else {
        // Late payment after the reservation was released: take stock again
        // if it is still there. If it is not, the order is still PAID (the
        // money was taken) and is flagged for manual resolution.
        try {
          for (const i of items) await sellFromAvailable(tx, i.variantId, i.quantity, orderId, who);
          stockState = "COMMITTED";
        } catch (e) {
          if (!(e instanceof InsufficientStockError)) throw e;
          throw new LatePaymentStockError(orderId);
        }
      }
      break;
    case "RELEASE":
      for (const i of items) await release(tx, i.variantId, i.quantity, orderId, who);
      stockState = "RELEASED";
      break;
    case "RESTOCK":
      for (const i of items) await restock(tx, i.variantId, i.quantity, orderId, who);
      stockState = "RELEASED";
      break;
    case "NONE":
      break;
  }

  let paymentStatus = opts.paymentStatus;
  if (to === "REFUNDED") paymentStatus = "REFUNDED";

  const updated = await tx.order.update({
    where: { id: orderId },
    data: {
      status: to,
      stockState,
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(to === "AWAITING_PAYMENT"
        ? { reservationExpiresAt: new Date(Date.now() + env().RESERVATION_TTL_MINUTES * 60_000) }
        : {}),
      history: { create: { from, to, actor: who, note: opts.note } },
    },
  });

  // A cancelled order gives its promo usage back.
  if (to === "CANCELLED") {
    const redemption = await tx.promotionRedemption.findUnique({ where: { orderId } });
    if (redemption) {
      await tx.promotionRedemption.delete({ where: { orderId } });
      await tx.$executeRaw`UPDATE "Promotion" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${redemption.promotionId}`;
    }
  }
  return updated;
}

export class LatePaymentStockError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} was paid after its reservation lapsed and stock is no longer available`);
    this.name = "LatePaymentStockError";
  }
}

/** Admin-initiated transition with audit. */
export async function adminTransition(orderId: string, to: OrderStatus, adminEmail: string, note?: string) {
  return db.$transaction(async (tx) => {
    const updated = await transitionOrder(tx, orderId, to, { kind: "admin", name: adminEmail }, { note });
    // COD payment stays PENDING until the courier collects cash on delivery.
    if (to === "DELIVERED" && updated.paymentProvider === "CASH_ON_DELIVERY") {
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "SUCCEEDED" } });
    }
    await audit(
      { actor: adminEmail, action: "order.transition", entity: "Order", entityId: orderId, data: { to, note: note ?? null } },
      tx,
    );
    return updated;
  });
}

/**
 * Sweeps unpaid orders whose reservation expired: AWAITING_PAYMENT →
 * PAYMENT_FAILED (stock released). Orders left in PAYMENT_FAILED for a day
 * are cancelled so promo usage is returned. Runs lazily on checkout and
 * admin requests and from /api/cron/expire (Render free has no cron).
 */
export async function expireReservations(now = new Date()) {
  const expired = await db.order.findMany({
    where: { status: "AWAITING_PAYMENT", reservationExpiresAt: { lt: now } },
    select: { id: true },
    take: 50,
  });
  let failed = 0;
  for (const o of expired) {
    try {
      await db.$transaction((tx) =>
        transitionOrder(tx, o.id, "PAYMENT_FAILED", { kind: "system", name: "reservation-expiry" }, {
          note: "Payment not received before the reservation expired",
          paymentStatus: "FAILED",
        }),
      );
      failed++;
    } catch (e) {
      // Another worker (or a webhook) got there first — that is fine.
      if (!(e instanceof TransitionError)) throw e;
    }
  }
  const stale = await db.order.findMany({
    where: { status: "PAYMENT_FAILED", updatedAt: { lt: new Date(now.getTime() - 24 * 3600_000) } },
    select: { id: true },
    take: 50,
  });
  let cancelled = 0;
  for (const o of stale) {
    try {
      await db.$transaction((tx) =>
        transitionOrder(tx, o.id, "CANCELLED", { kind: "system", name: "stale-payment" }, {
          note: "Cancelled automatically: unpaid for 24 hours",
        }),
      );
      cancelled++;
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e;
    }
  }
  return { failed, cancelled };
}
