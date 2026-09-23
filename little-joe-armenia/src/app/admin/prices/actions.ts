"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adjust } from "@/lib/domain/inventory";
import { adminAction, parse } from "@/lib/admin/action";
import { fail, ok, optInt, s, type ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

// Bulk price / stock for a whole product line. The brand book has no prices,
// so the catalogue starts with demo prices; this sets the real price for all
// products of a line at once and clears the DEMO flag. Stock goes through the
// inventory ledger like any other adjustment.

export async function setLinePrice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(
      z.object({
        collectionId: z.string().min(1).max(40),
        priceAmd: optInt(1, 10_000_000),
        stock: optInt(0, 100_000),
      }),
      { collectionId: s(fd, "collectionId"), priceAmd: s(fd, "priceAmd"), stock: s(fd, "stock") },
    );
    if (error) return error;
    if (data.priceAmd === null && data.stock === null) return fail("Укажите цену и/или остаток");
    const variants = await db.variant.findMany({
      where: { isActive: true, product: { collectionId: data.collectionId, status: { not: "ARCHIVED" } } },
      select: { id: true, stockOnHand: true, reserved: true },
    });
    if (!variants.length) return fail("В этой линейке нет активных товаров");
    let skipped = 0;
    await db.$transaction(
      async (tx) => {
        if (data.priceAmd !== null) {
          await tx.variant.updateMany({ where: { id: { in: variants.map((v) => v.id) } }, data: { priceAmd: data.priceAmd, priceIsDemo: false } });
        }
        if (data.stock !== null) {
          for (const v of variants) {
            // Never below what customers have already reserved.
            const target = Math.max(data.stock, v.reserved);
            if (target !== data.stock) skipped++;
            const delta = target - v.stockOnHand;
            if (delta !== 0) await adjust(tx, v.id, delta, "MANUAL_ADJUSTMENT", `admin:${admin.email}`, "Массовая установка остатка по линейке");
          }
        }
        await audit({ actor: admin.email, action: "collection.bulk_price", entity: "Collection", entityId: data.collectionId, data: { ...data, variants: variants.length } }, tx);
      },
      { timeout: 60_000 },
    );
    revalidateStore();
    const parts = [data.priceAmd !== null ? `цена ${data.priceAmd.toLocaleString("ru-RU")} ֏` : null, data.stock !== null ? `остаток ${data.stock} шт.` : null].filter(Boolean);
    return ok(`Готово: ${parts.join(", ")} — для ${variants.length} товаров${skipped ? ` (у ${skipped} остаток не ниже резерва)` : ""}`);
  });
}
