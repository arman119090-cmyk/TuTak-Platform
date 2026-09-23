import "server-only";
import { db } from "@/lib/db";
import { shopper } from "@/lib/security/session";

/** Product ids the current shopper has favourited. */
export async function favoriteIds(): Promise<Set<string>> {
  const o = await shopper();
  if (!o.customerId && !o.guestId) return new Set();
  const rows = await db.favorite.findMany({
    where: o.customerId ? { customerId: o.customerId } : { guestId: o.guestId! },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}
