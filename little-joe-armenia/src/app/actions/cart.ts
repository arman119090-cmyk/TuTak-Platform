"use server";

import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { ensureGuestId, shopper } from "@/lib/security/session";
import {
  addItem,
  cartCount,
  removeItem,
  setPromo,
  setQuantity,
  toggleSaved,
  viewCart,
  loadPromotion,
  MAX_QTY,
  type CartView,
  type Owner,
} from "@/lib/domain/cart";
import { evaluatePromotion, type PromoRejection } from "@/lib/domain/pricing";
import { freeDeliveryThreshold } from "@/lib/domain/delivery";
import { visibleProductWhere } from "@/lib/catalog";

// Server Actions for cart and favourites. Next.js checks the Origin of every
// Server Action request against the host (CSRF), and each action validates
// its arguments with Zod — client input is never trusted.

const id = z.string().min(1).max(40);
const qty = z.number().int().min(0).max(MAX_QTY);
const localeSchema = z.string().refine(isLocale);

async function ownerForWrite(): Promise<Owner> {
  const o = await shopper();
  if (o.customerId) return o;
  return { customerId: null, guestId: await ensureGuestId() };
}

async function limited(): Promise<boolean> {
  const r = await rateLimit("cart", await clientIp());
  return !r.ok;
}

export type CartSnapshot = CartView & { freeDeliveryFromAmd: number | null };

export async function getCartAction(locale: string): Promise<CartSnapshot> {
  const l = localeSchema.parse(locale) as Locale;
  const owner = await shopper();
  const [cart, freeFrom] = await Promise.all([viewCart(owner, l), freeDeliveryThreshold()]);
  // The free-delivery hint uses the cheapest active threshold.
  const remaining = freeFrom === null ? null : Math.max(0, freeFrom - (cart.totals.subtotalAmd - cart.totals.discountAmd));
  return { ...cart, totals: { ...cart.totals, freeDeliveryRemainingAmd: remaining }, freeDeliveryFromAmd: freeFrom };
}

export type MutationResult = { ok: boolean; count: number; error?: string; quantity?: number; limited?: boolean };

export async function addToCartAction(variantId: string, quantity: number): Promise<MutationResult> {
  const v = id.safeParse(variantId);
  const q = qty.min(1).safeParse(quantity);
  if (!v.success || !q.success) return { ok: false, count: 0, error: "INVALID" };
  if (await limited()) return { ok: false, count: 0, error: "RATE_LIMITED" };
  const owner = await ownerForWrite();
  const r = await addItem(owner, v.data, q.data);
  const count = await cartCount(owner);
  return r.ok ? { ok: true, count, quantity: r.quantity, limited: r.limited } : { ok: false, count, error: r.error };
}

export async function setQuantityAction(itemId: string, quantity: number): Promise<MutationResult> {
  const i = id.safeParse(itemId);
  const q = qty.safeParse(quantity);
  if (!i.success || !q.success) return { ok: false, count: 0, error: "INVALID" };
  if (await limited()) return { ok: false, count: 0, error: "RATE_LIMITED" };
  const owner = await shopper();
  const r = await setQuantity(owner, i.data, q.data);
  return { ok: r.ok, count: await cartCount(owner), quantity: r.ok ? r.quantity : undefined };
}

export async function removeItemAction(itemId: string): Promise<MutationResult> {
  const i = id.safeParse(itemId);
  if (!i.success) return { ok: false, count: 0, error: "INVALID" };
  const owner = await shopper();
  const r = await removeItem(owner, i.data);
  return { ok: r.ok, count: await cartCount(owner) };
}

export async function saveForLaterAction(itemId: string, saved: boolean): Promise<MutationResult> {
  const i = id.safeParse(itemId);
  if (!i.success || typeof saved !== "boolean") return { ok: false, count: 0, error: "INVALID" };
  const owner = await shopper();
  const r = await toggleSaved(owner, i.data, saved);
  return { ok: r.ok, count: await cartCount(owner) };
}

export type PromoResult = { ok: true } | { ok: false; reason: PromoRejection | "RATE_LIMITED" | "INVALID"; minSubtotalAmd?: number };

export async function applyPromoAction(code: string): Promise<PromoResult> {
  const c = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/).safeParse(code);
  if (!c.success) return { ok: false, reason: "NOT_FOUND" };
  const limit = await rateLimit("promo", await clientIp());
  if (!limit.ok) return { ok: false, reason: "RATE_LIMITED" };
  const owner = await ownerForWrite();
  const cart = await viewCart(owner, "en");
  const promo = await loadPromotion(c.data);
  const collections = new Map(
    (
      await db.product.findMany({
        where: { AND: [visibleProductWhere(), { id: { in: cart.lines.map((l) => l.productId) } }] },
        select: { id: true, collectionId: true },
      })
    ).map((p) => [p.id, p.collectionId]),
  );
  const evaluation = evaluatePromotion(
    promo,
    cart.lines
      .filter((l) => l.purchasable)
      .map((l) => ({ variantId: l.variantId, productId: l.productId, collectionId: collections.get(l.productId) ?? "", unitAmd: l.unitAmd, quantity: l.quantity })),
    new Date(),
  );
  if (!evaluation.ok) return { ok: false, reason: evaluation.reason, minSubtotalAmd: evaluation.minSubtotalAmd };
  await setPromo(owner, c.data);
  return { ok: true };
}

export async function removePromoAction(): Promise<{ ok: boolean }> {
  const owner = await shopper();
  if (!owner.customerId && !owner.guestId) return { ok: true };
  await setPromo(owner, null);
  return { ok: true };
}

// ── Favourites ──

export async function toggleFavoriteAction(productId: string): Promise<{ ok: boolean; favorite: boolean }> {
  const p = id.safeParse(productId);
  if (!p.success) return { ok: false, favorite: false };
  if (await limited()) return { ok: false, favorite: false };
  const owner = await ownerForWrite();
  const product = await db.product.findFirst({ where: { AND: [visibleProductWhere(), { id: p.data }] }, select: { id: true } });
  if (!product) return { ok: false, favorite: false };
  const where = owner.customerId
    ? { customerId_productId: { customerId: owner.customerId, productId: p.data } }
    : { guestId_productId: { guestId: owner.guestId!, productId: p.data } };
  const existing = await db.favorite.findUnique({ where });
  if (existing) {
    await db.favorite.delete({ where: { id: existing.id } });
    return { ok: true, favorite: false };
  }
  await db.favorite.create({
    data: owner.customerId ? { customerId: owner.customerId, productId: p.data } : { guestId: owner.guestId!, productId: p.data },
  });
  return { ok: true, favorite: true };
}
