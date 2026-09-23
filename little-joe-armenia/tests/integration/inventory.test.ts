import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../support/db";
import { createVariant, variantStock } from "../support/fixtures";
import {
  adjust,
  commitReserved,
  InsufficientStockError,
  release,
  reserve,
  restock,
  sellFromAvailable,
} from "@/lib/domain/inventory";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await testDb.$disconnect();
});

describe("inventory ledger", () => {
  it("reserve / release / commit update columns and append matching ledger rows", async () => {
    const { variant } = await createVariant({ stock: 10 });

    await testDb.$transaction((tx) => reserve(tx, variant.id, 3, "order-1"));
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 10, reserved: 3 });

    await testDb.$transaction((tx) => release(tx, variant.id, 1, "order-1", "test:release"));
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 10, reserved: 2 });

    await testDb.$transaction((tx) => commitReserved(tx, variant.id, 2, "order-1", "test:commit"));
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 8, reserved: 0 });

    await testDb.$transaction((tx) => restock(tx, variant.id, 2, "order-1", "test:restock"));
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 10, reserved: 0 });

    await testDb.$transaction((tx) => sellFromAvailable(tx, variant.id, 4, "order-2", "test:sell"));
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 6, reserved: 0 });

    const rows = await testDb.inventoryMovement.findMany({
      where: { variantId: variant.id },
      orderBy: { createdAt: "asc" },
      select: { type: true, onHandDelta: true, reservedDelta: true, onHandAfter: true, reservedAfter: true, orderId: true, actor: true },
    });
    expect(rows).toEqual([
      { type: "RESERVE", onHandDelta: 0, reservedDelta: 3, onHandAfter: 10, reservedAfter: 3, orderId: "order-1", actor: "checkout" },
      { type: "RELEASE", onHandDelta: 0, reservedDelta: -1, onHandAfter: 10, reservedAfter: 2, orderId: "order-1", actor: "test:release" },
      { type: "SALE", onHandDelta: -2, reservedDelta: -2, onHandAfter: 8, reservedAfter: 0, orderId: "order-1", actor: "test:commit" },
      { type: "CANCEL_RETURN", onHandDelta: 2, reservedDelta: 0, onHandAfter: 10, reservedAfter: 0, orderId: "order-1", actor: "test:restock" },
      { type: "SALE", onHandDelta: -4, reservedDelta: 0, onHandAfter: 6, reservedAfter: 0, orderId: "order-2", actor: "test:sell" },
    ]);
    // ledger reconciles with the columns
    const sum = rows.reduce((s, r) => s + r.onHandDelta, 0);
    expect(10 + sum).toBe(6);
  });

  it("reserve beyond available throws InsufficientStockError and writes nothing", async () => {
    const { variant } = await createVariant({ stock: 2 });
    await testDb.$transaction((tx) => reserve(tx, variant.id, 2, "o1"));
    await expect(testDb.$transaction((tx) => reserve(tx, variant.id, 1, "o2"))).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 2, reserved: 2 });
    expect(await testDb.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(1);
  });

  it("reserve on an inactive variant throws InsufficientStockError", async () => {
    const { variant } = await createVariant({ stock: 5 });
    await testDb.variant.update({ where: { id: variant.id }, data: { isActive: false } });
    await expect(testDb.$transaction((tx) => reserve(tx, variant.id, 1, "o1"))).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("release / commit larger than the reservation throws", async () => {
    const { variant } = await createVariant({ stock: 5 });
    await testDb.$transaction((tx) => reserve(tx, variant.id, 1, "o1"));
    await expect(testDb.$transaction((tx) => release(tx, variant.id, 2, "o1", "t"))).rejects.toThrow(/ledger out of sync/);
    await expect(testDb.$transaction((tx) => commitReserved(tx, variant.id, 2, "o1", "t"))).rejects.toThrow(/ledger out of sync/);
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });
  });

  it("DB CHECK constraints reject negative stock, negative reserved and reserved > stock", async () => {
    const { variant } = await createVariant({ stock: 3 });
    await expect(testDb.$executeRaw`UPDATE "Variant" SET "stockOnHand" = -1 WHERE "id" = ${variant.id}`).rejects.toThrow(
      /variant_stock_non_negative|variant_reserved_le_stock|check constraint/i,
    );
    await expect(testDb.$executeRaw`UPDATE "Variant" SET "reserved" = -1 WHERE "id" = ${variant.id}`).rejects.toThrow(
      /variant_reserved_non_negative|check constraint/i,
    );
    await expect(testDb.$executeRaw`UPDATE "Variant" SET "reserved" = 4 WHERE "id" = ${variant.id}`).rejects.toThrow(
      /variant_reserved_le_stock|check constraint/i,
    );
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 3, reserved: 0 });
  });

  it("adjust cannot take stock below what is reserved", async () => {
    const { variant } = await createVariant({ stock: 5 });
    await testDb.$transaction((tx) => reserve(tx, variant.id, 3, "o1"));

    await expect(testDb.$transaction((tx) => adjust(tx, variant.id, -3, "MANUAL_ADJUSTMENT", "admin@x"))).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
    expect(await variantStock(variant.id)).toEqual({ stockOnHand: 5, reserved: 3 });

    const row = await testDb.$transaction((tx) => adjust(tx, variant.id, -2, "MANUAL_ADJUSTMENT", "admin@x", "count"));
    expect(row).toEqual({ stockOnHand: 3, reserved: 3 });

    const up = await testDb.$transaction((tx) => adjust(tx, variant.id, 7, "PURCHASE", "admin@x"));
    expect(up).toEqual({ stockOnHand: 10, reserved: 3 });

    const last = await testDb.inventoryMovement.findMany({ where: { variantId: variant.id, type: { in: ["MANUAL_ADJUSTMENT", "PURCHASE"] } }, orderBy: { createdAt: "asc" } });
    expect(last.map((m) => [m.type, m.onHandDelta, m.onHandAfter, m.note])).toEqual([
      ["MANUAL_ADJUSTMENT", -2, 3, "count"],
      ["PURCHASE", 7, 10, null],
    ]);
  });

  it("adjust validates its delta", async () => {
    const { variant } = await createVariant({ stock: 5 });
    await expect(testDb.$transaction((tx) => adjust(tx, variant.id, 0, "MANUAL_ADJUSTMENT", "a"))).rejects.toThrow(/non-zero/);
    await expect(testDb.$transaction((tx) => adjust(tx, variant.id, 1.5, "MANUAL_ADJUSTMENT", "a"))).rejects.toThrow(/non-zero/);
    await expect(testDb.$transaction((tx) => adjust(tx, variant.id, -1, "PURCHASE", "a"))).rejects.toThrow(/positive/);
  });
});
