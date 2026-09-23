import "server-only";
import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { expireReservations } from "@/lib/domain/orders";

/** Statuses that count as revenue (money received or COD order confirmed). */
export const REVENUE_STATUSES: OrderStatus[] = ["PAID", "CONFIRMED", "PACKING", "SHIPPED", "DELIVERED"];

/** Lazy reservation sweep (Render free tier has no cron). Never breaks the page. */
export async function sweepReservations() {
  try {
    await expireReservations();
  } catch (e) {
    console.error("[admin] expireReservations failed", e);
  }
}

export type LowStockRow = {
  variantId: string;
  sku: string;
  productId: string;
  slug: string;
  stockOnHand: number;
  reserved: number;
  lowStockAt: number;
};

export async function lowStock(limit = 20): Promise<LowStockRow[]> {
  return db.$queryRaw<LowStockRow[]>`
    SELECT v."id" AS "variantId", v."sku", p."id" AS "productId", p."slug",
           v."stockOnHand", v."reserved", v."lowStockAt"
    FROM "Variant" v JOIN "Product" p ON p."id" = v."productId"
    WHERE v."isActive" = true AND p."status" <> 'ARCHIVED'
      AND v."stockOnHand" - v."reserved" <= v."lowStockAt"
    ORDER BY (v."stockOnHand" - v."reserved") ASC, v."sku" ASC
    LIMIT ${limit}`;
}

/** Russian (fallback hy/en) product names by id. */
export async function productNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.productTranslation.findMany({
    where: { productId: { in: ids } },
    select: { productId: true, locale: true, name: true },
  });
  const out = new Map<string, string>();
  for (const pref of ["en", "hy", "ru"] as const) {
    for (const r of rows) if (r.locale === pref && r.name.trim()) out.set(r.productId, r.name);
  }
  return out;
}

/** Start of the rolling window `days` back from now. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600_000);
}
