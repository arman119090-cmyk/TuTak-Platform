"use server";

import { db } from "@/lib/db";
import { isLocale } from "@/i18n/config";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { currentCustomer } from "@/lib/security/session";
import { reviewSchema } from "@/lib/validation/checkout";
import { visibleProductWhere } from "@/lib/catalog";

export type ReviewState = { ok: boolean; errors?: Record<string, string>; message?: "thanks" | "rateLimited" | "error" };

/** Reviews are stored as PENDING and only shown after moderation. Stored as plain text. */
export async function submitReviewAction(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  // Honeypot: bots fill every field.
  if (form.get("website")) return { ok: true, message: "thanks" };
  const locale = String(form.get("locale") ?? "hy");
  const parsed = reviewSchema.safeParse({
    productId: form.get("productId"),
    authorName: form.get("authorName"),
    rating: form.get("rating"),
    body: form.get("body"),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { ok: false, errors };
  }
  const limit = await rateLimit("review", await clientIp());
  if (!limit.ok) return { ok: false, message: "rateLimited" };
  const product = await db.product.findFirst({ where: { AND: [visibleProductWhere(), { id: parsed.data.productId }] }, select: { id: true } });
  if (!product) return { ok: false, message: "error" };
  const customer = await currentCustomer();
  const verifiedPurchase = customer
    ? (await db.orderItem.count({
        where: { order: { customerId: customer.id, status: "DELIVERED" }, variant: { productId: product.id } },
      })) > 0
    : false;
  await db.review.create({
    data: {
      productId: product.id,
      customerId: customer?.id,
      authorName: parsed.data.authorName,
      rating: parsed.data.rating,
      body: parsed.data.body,
      locale: isLocale(locale) ? locale : "hy",
      verifiedPurchase,
    },
  });
  return { ok: true, message: "thanks" };
}
