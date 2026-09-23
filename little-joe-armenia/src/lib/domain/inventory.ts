import "server-only";
import type { Tx } from "@/lib/db";

// Inventory writes. Concurrency model (see docs/ARCHITECTURE.md §Inventory):
//
// Every change is ONE conditional UPDATE on the Variant row, e.g.
//   UPDATE "Variant" SET reserved = reserved + $q
//   WHERE id = $id AND "stockOnHand" - reserved >= $q
//   RETURNING "stockOnHand", reserved
// Postgres takes a row lock for the UPDATE, so two checkouts racing for the
// last unit serialise on that row: the second one re-evaluates the WHERE
// clause against the committed row and matches zero rows. No SELECT … then
// UPDATE window exists. CHECK constraints (stock >= 0, reserved >= 0,
// reserved <= stock) back this up at the database level.
//
// Every successful write appends an InventoryMovement row in the same
// transaction, so the ledger always reconciles with the Variant columns.

export class InsufficientStockError extends Error {
  constructor(public readonly variantId: string, public readonly requested: number) {
    super(`Insufficient stock for variant ${variantId} (requested ${requested})`);
    this.name = "InsufficientStockError";
  }
}

type Row = { stockOnHand: number; reserved: number };

async function ledger(
  tx: Tx,
  variantId: string,
  type:
    | "PURCHASE"
    | "SALE"
    | "RESERVE"
    | "RELEASE"
    | "CANCEL_RETURN"
    | "MANUAL_ADJUSTMENT"
    | "REFUND"
    | "RETURN_TO_STOCK",
  onHandDelta: number,
  reservedDelta: number,
  after: Row,
  actor: string,
  orderId?: string,
  note?: string,
) {
  await tx.inventoryMovement.create({
    data: {
      variantId,
      type,
      onHandDelta,
      reservedDelta,
      onHandAfter: after.stockOnHand,
      reservedAfter: after.reserved,
      orderId,
      actor,
      note,
    },
  });
}

/** Reserve units for an order. Throws InsufficientStockError when not available. */
export async function reserve(tx: Tx, variantId: string, qty: number, orderId: string, actor = "checkout") {
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "Variant" SET "reserved" = "reserved" + ${qty}, "updatedAt" = now()
    WHERE "id" = ${variantId} AND "isActive" = true AND "stockOnHand" - "reserved" >= ${qty}
    RETURNING "stockOnHand", "reserved"`;
  const row = rows[0];
  if (!row) throw new InsufficientStockError(variantId, qty);
  await ledger(tx, variantId, "RESERVE", 0, qty, row, actor, orderId);
}

/** Return a reservation to available stock. */
export async function release(tx: Tx, variantId: string, qty: number, orderId: string, actor: string) {
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "Variant" SET "reserved" = "reserved" - ${qty}, "updatedAt" = now()
    WHERE "id" = ${variantId} AND "reserved" >= ${qty}
    RETURNING "stockOnHand", "reserved"`;
  const row = rows[0];
  if (!row) throw new Error(`Reservation for ${variantId} is smaller than ${qty}; ledger out of sync`);
  await ledger(tx, variantId, "RELEASE", 0, -qty, row, actor, orderId);
}

/** Convert a reservation into a sale. */
export async function commitReserved(tx: Tx, variantId: string, qty: number, orderId: string, actor: string) {
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "Variant" SET "reserved" = "reserved" - ${qty}, "stockOnHand" = "stockOnHand" - ${qty}, "updatedAt" = now()
    WHERE "id" = ${variantId} AND "reserved" >= ${qty} AND "stockOnHand" >= ${qty}
    RETURNING "stockOnHand", "reserved"`;
  const row = rows[0];
  if (!row) throw new Error(`Reservation for ${variantId} is smaller than ${qty}; ledger out of sync`);
  await ledger(tx, variantId, "SALE", -qty, -qty, row, actor, orderId);
}

/** Sell directly from available stock (late payment after a released reservation). */
export async function sellFromAvailable(tx: Tx, variantId: string, qty: number, orderId: string, actor: string) {
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "Variant" SET "stockOnHand" = "stockOnHand" - ${qty}, "updatedAt" = now()
    WHERE "id" = ${variantId} AND "stockOnHand" - "reserved" >= ${qty}
    RETURNING "stockOnHand", "reserved"`;
  const row = rows[0];
  if (!row) throw new InsufficientStockError(variantId, qty);
  await ledger(tx, variantId, "SALE", -qty, 0, row, actor, orderId);
}

/** Put sold units back (order cancelled after the sale was committed). */
export async function restock(tx: Tx, variantId: string, qty: number, orderId: string, actor: string) {
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "Variant" SET "stockOnHand" = "stockOnHand" + ${qty}, "updatedAt" = now()
    WHERE "id" = ${variantId}
    RETURNING "stockOnHand", "reserved"`;
  const row = rows[0];
  if (!row) throw new Error(`Variant ${variantId} not found`);
  await ledger(tx, variantId, "CANCEL_RETURN", qty, 0, row, actor, orderId);
}

export type AdjustmentType = "PURCHASE" | "MANUAL_ADJUSTMENT" | "RETURN_TO_STOCK" | "REFUND";

/**
 * Admin stock adjustment by a signed delta. A negative delta can never take
 * stock below what is currently reserved (and therefore never below zero).
 */
export async function adjust(
  tx: Tx,
  variantId: string,
  delta: number,
  type: AdjustmentType,
  actor: string,
  note?: string,
) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("Delta must be a non-zero integer");
  if (type === "PURCHASE" && delta < 0) throw new Error("PURCHASE must be positive");
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE "Variant" SET "stockOnHand" = "stockOnHand" + ${delta}, "updatedAt" = now()
    WHERE "id" = ${variantId} AND "stockOnHand" + ${delta} >= "reserved"
    RETURNING "stockOnHand", "reserved"`;
  const row = rows[0];
  if (!row) throw new InsufficientStockError(variantId, -delta);
  await ledger(tx, variantId, type, delta, 0, row, actor, undefined, note);
  return row;
}

export function available(v: { stockOnHand: number; reserved: number; isActive?: boolean }): number {
  if (v.isActive === false) return 0;
  return Math.max(0, v.stockOnHand - v.reserved);
}
