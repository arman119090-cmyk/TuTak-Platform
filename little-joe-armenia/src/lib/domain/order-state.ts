// Order lifecycle. The transition table is the single source of truth for
// both the admin UI (which buttons to show) and the server (which writes to
// accept). Payment-driven transitions (PAID, PAYMENT_FAILED) are only made
// by the payment service after provider verification, never by an admin
// button or a browser redirect.

export const ORDER_STATUSES = [
  "PENDING",
  "AWAITING_PAYMENT",
  "PAID",
  "PAYMENT_FAILED",
  "CONFIRMED",
  "PACKING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type TransitionActor = "system" | "payment" | "admin";

type Rule = { to: OrderStatus; by: TransitionActor[] };

const RULES: Record<OrderStatus, Rule[]> = {
  // COD orders start here.
  PENDING: [
    { to: "CONFIRMED", by: ["admin"] },
    { to: "CANCELLED", by: ["admin", "system"] },
  ],
  // Online payment orders start here.
  AWAITING_PAYMENT: [
    { to: "PAID", by: ["payment"] },
    { to: "PAYMENT_FAILED", by: ["payment", "system"] },
    { to: "CANCELLED", by: ["admin", "system"] },
  ],
  PAID: [
    { to: "CONFIRMED", by: ["admin", "system"] },
    { to: "REFUNDED", by: ["admin"] },
  ],
  PAYMENT_FAILED: [
    // A late successful callback still wins: money was taken.
    { to: "PAID", by: ["payment"] },
    // Customer retries payment: stock is reserved again.
    { to: "AWAITING_PAYMENT", by: ["system"] },
    { to: "CANCELLED", by: ["admin", "system"] },
  ],
  CONFIRMED: [
    { to: "PACKING", by: ["admin"] },
    { to: "CANCELLED", by: ["admin"] },
  ],
  PACKING: [
    { to: "SHIPPED", by: ["admin"] },
    { to: "CANCELLED", by: ["admin"] },
  ],
  SHIPPED: [{ to: "DELIVERED", by: ["admin"] }],
  DELIVERED: [{ to: "REFUNDED", by: ["admin"] }],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor): boolean {
  return RULES[from].some((r) => r.to === to && r.by.includes(actor));
}

export function nextStatuses(from: OrderStatus, actor: TransitionActor): OrderStatus[] {
  return RULES[from].filter((r) => r.by.includes(actor)).map((r) => r.to);
}

export function isTerminal(status: OrderStatus): boolean {
  return RULES[status].length === 0;
}

/**
 * Stock effect of entering a status.
 *  - RESERVE: take a fresh reservation (payment retry).
 *  - COMMIT: reserved units become sold (stockOnHand and reserved both drop).
 *  - RELEASE: reservation returned to available stock.
 *  - RESTOCK: units already sold come back (cancel after commit).
 *  - NONE.
 */
export type StockEffect = "RESERVE" | "COMMIT" | "RELEASE" | "RESTOCK" | "NONE";

export function stockEffect(
  to: OrderStatus,
  stockState: "RESERVED" | "COMMITTED" | "RELEASED",
): StockEffect {
  if (stockState === "RESERVED") {
    if (to === "CONFIRMED" || to === "PAID") return "COMMIT";
    if (to === "CANCELLED" || to === "PAYMENT_FAILED") return "RELEASE";
    return "NONE";
  }
  if (stockState === "RELEASED") {
    // A late PAID after a failure/expiry must re-take stock (see payments).
    if (to === "PAID") return "COMMIT";
    if (to === "AWAITING_PAYMENT") return "RESERVE";
    return "NONE";
  }
  // COMMITTED
  if (to === "CANCELLED") return "RESTOCK";
  // Refunds do not restock automatically: returned goods are inspected and
  // restocked through a RETURN_TO_STOCK adjustment.
  return "NONE";
}
