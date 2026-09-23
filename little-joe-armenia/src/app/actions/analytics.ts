"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { shopper } from "@/lib/security/session";
import { findOrderForViewer } from "@/lib/domain/checkout";

// Atomic "send purchase once" claim. Called by the order page only when the
// visitor has consented to analytics, so an order viewed without consent
// is not marked as tracked and the event is not lost.
const PURCHASE_STATUSES = new Set(["PENDING", "PAID", "CONFIRMED", "PACKING", "SHIPPED", "DELIVERED"]);

export async function claimPurchaseEventAction(number: string, token: string): Promise<boolean> {
  const n = z.string().max(40).safeParse(number);
  const t = z.string().max(100).safeParse(token);
  if (!n.success || !t.success) return false;
  const order = await findOrderForViewer(n.data, t.data || undefined, await shopper());
  if (!order || !PURCHASE_STATUSES.has(order.status)) return false;
  const claimed = await db.order.updateMany({ where: { id: order.id, purchaseTrackedAt: null }, data: { purchaseTrackedAt: new Date() } });
  return claimed.count === 1;
}
