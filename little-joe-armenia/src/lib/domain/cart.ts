import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import { NEUTRAL_ACCENT, pickT, toMedia, visibleProductWhere, type MediaDTO } from "@/lib/catalog";
import { available } from "@/lib/domain/inventory";
import {
  computeTotals,
  evaluatePromotion,
  normalizePromoCode,
  type DeliveryRule,
  type PricingLine,
  type PromoEvaluation,
  type PromotionRule,
  type Totals,
} from "@/lib/domain/pricing";

export type Owner = { customerId: string | null; guestId: string | null };

export const MAX_QTY = 20;

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: {
          product: {
            include: {
              translations: true,
              collection: { include: { translations: true } },
              media: { orderBy: { sortOrder: "asc" }, take: 1 },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

function ownerWhere(o: Owner): Prisma.CartWhereUniqueInput | null {
  if (o.customerId) return { customerId: o.customerId };
  if (o.guestId) return { guestId: o.guestId };
  return null;
}

export async function findCart(o: Owner): Promise<CartRow | null> {
  const where = ownerWhere(o);
  if (!where) return null;
  return db.cart.findUnique({ where, include: cartInclude });
}

export async function getOrCreateCartId(o: Owner): Promise<string> {
  const where = ownerWhere(o);
  if (!where) throw new Error("No cart owner");
  const cart = await db.cart.upsert({
    where,
    create: o.customerId ? { customerId: o.customerId } : { guestId: o.guestId! },
    update: {},
    select: { id: true },
  });
  return cart.id;
}

export type CartLineDTO = {
  id: string;
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  collectionName: string;
  sku: string;
  unitAmd: number;
  priceIsDemo: boolean;
  quantity: number;
  lineAmd: number;
  available: number;
  // false when the product/variant was archived or lost its price
  purchasable: boolean;
  savedForLater: boolean;
  accent: string;
  image: MediaDTO | null;
};

export type CartView = {
  id: string | null;
  lines: CartLineDTO[];
  saved: CartLineDTO[];
  count: number;
  promoCode: string | null;
  promo: PromoEvaluation | null;
  totals: Totals;
  hasProblems: boolean;
};

const EMPTY_TOTALS: Totals = { subtotalAmd: 0, discountAmd: 0, deliveryAmd: 0, totalAmd: 0, freeDeliveryRemainingAmd: null };

export async function loadPromotion(code: string): Promise<PromotionRule | null> {
  const p = await db.promotion.findUnique({
    where: { code: normalizePromoCode(code) },
    include: { products: true, collections: true },
  });
  if (!p) return null;
  return {
    id: p.id,
    code: p.code,
    type: p.type,
    value: p.value,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    minSubtotalAmd: p.minSubtotalAmd,
    usageLimit: p.usageLimit,
    usedCount: p.usedCount,
    isActive: p.isActive,
    productIds: p.products.map((x) => x.productId),
    collectionIds: p.collections.map((x) => x.collectionId),
  };
}

export function toPricingLines(lines: CartLineDTO[], collectionOf: Map<string, string>): PricingLine[] {
  return lines
    .filter((l) => l.purchasable)
    .map((l) => ({
      variantId: l.variantId,
      productId: l.productId,
      collectionId: collectionOf.get(l.productId) ?? "",
      unitAmd: l.unitAmd,
      quantity: l.quantity,
    }));
}

/** Builds the priced view of a cart. `delivery` null = not chosen yet. */
export async function viewCart(o: Owner, locale: Locale, delivery: DeliveryRule | null = null): Promise<CartView> {
  const cart = await findCart(o);
  if (!cart) {
    return { id: null, lines: [], saved: [], count: 0, promoCode: null, promo: null, totals: EMPTY_TOTALS, hasProblems: false };
  }
  const visible = visibleProductWhere();
  const visibleIds = new Set(
    (
      await db.product.findMany({
        where: { AND: [visible, { id: { in: cart.items.map((i) => i.variant.productId) } }] },
        select: { id: true },
      })
    ).map((p) => p.id),
  );
  const collectionOf = new Map<string, string>();
  const all: CartLineDTO[] = cart.items.map((i) => {
    const p = i.variant.product;
    collectionOf.set(p.id, p.collectionId);
    const t = pickT(p.translations, locale);
    const ct = pickT(p.collection.translations, locale);
    const avail = available(i.variant);
    const price = i.variant.priceAmd;
    const purchasable = visibleIds.has(p.id) && i.variant.isActive && price !== null && avail >= i.quantity;
    const name = t?.name ?? p.slug;
    return {
      id: i.id,
      variantId: i.variantId,
      productId: p.id,
      slug: p.slug,
      name,
      collectionName: ct?.name ?? p.collection.slug,
      sku: i.variant.sku,
      unitAmd: price ?? 0,
      priceIsDemo: i.variant.priceIsDemo,
      quantity: i.quantity,
      lineAmd: (price ?? 0) * i.quantity,
      available: avail,
      purchasable,
      savedForLater: i.savedForLater,
      accent: p.accentColor ?? p.collection.accentColor ?? NEUTRAL_ACCENT,
      image: p.media[0] ? toMedia(p.media[0], locale, name) : null,
    };
  });
  const lines = all.filter((l) => !l.savedForLater);
  const saved = all.filter((l) => l.savedForLater);
  const pricing = toPricingLines(lines, collectionOf);

  let promo: PromoEvaluation | null = null;
  if (cart.promoCode) {
    promo = evaluatePromotion(await loadPromotion(cart.promoCode), pricing, new Date());
  }
  const totals = computeTotals({ lines: pricing, discountAmd: promo?.ok ? promo.discountAmd : 0, delivery });
  return {
    id: cart.id,
    lines,
    saved,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    promoCode: cart.promoCode,
    promo,
    totals,
    hasProblems: lines.some((l) => !l.purchasable),
  };
}

export async function cartCount(o: Owner): Promise<number> {
  const where = ownerWhere(o);
  if (!where) return 0;
  const agg = await db.cartItem.aggregate({
    where: { cart: where, savedForLater: false },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

// ── Mutations ──

export async function addItem(o: Owner, variantId: string, qty: number) {
  const variant = await db.variant.findFirst({
    where: { id: variantId, isActive: true, priceAmd: { not: null }, product: visibleProductWhere() },
  });
  if (!variant) return { ok: false as const, error: "UNAVAILABLE" as const };
  const cartId = await getOrCreateCartId(o);
  const existing = await db.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
  const wanted = Math.min(MAX_QTY, (existing && !existing.savedForLater ? existing.quantity : 0) + qty);
  const avail = available(variant);
  if (avail <= 0) return { ok: false as const, error: "SOLD_OUT" as const };
  const quantity = Math.min(wanted, avail);
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId, variantId } },
    create: { cartId, variantId, quantity },
    update: { quantity, savedForLater: false },
  });
  return { ok: true as const, quantity, limited: quantity < wanted };
}

async function ownedItem(o: Owner, itemId: string) {
  const where = ownerWhere(o);
  if (!where) return null;
  return db.cartItem.findFirst({ where: { id: itemId, cart: where }, include: { variant: true } });
}

export async function setQuantity(o: Owner, itemId: string, qty: number) {
  const item = await ownedItem(o, itemId);
  if (!item) return { ok: false as const };
  if (qty <= 0) {
    await db.cartItem.delete({ where: { id: item.id } });
    return { ok: true as const, quantity: 0 };
  }
  const quantity = Math.max(1, Math.min(MAX_QTY, qty, Math.max(1, available(item.variant))));
  await db.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return { ok: true as const, quantity };
}

export async function removeItem(o: Owner, itemId: string) {
  const item = await ownedItem(o, itemId);
  if (!item) return { ok: false as const };
  await db.cartItem.delete({ where: { id: item.id } });
  return { ok: true as const, variantId: item.variantId, quantity: item.quantity };
}

export async function toggleSaved(o: Owner, itemId: string, saved: boolean) {
  const item = await ownedItem(o, itemId);
  if (!item) return { ok: false as const };
  await db.cartItem.update({ where: { id: item.id }, data: { savedForLater: saved } });
  return { ok: true as const };
}

export async function setPromo(o: Owner, code: string | null) {
  const cartId = await getOrCreateCartId(o);
  await db.cart.update({ where: { id: cartId }, data: { promoCode: code ? normalizePromoCode(code) : null } });
}

/** On sign-in: move the guest cart into the customer cart (quantities add up). */
export async function mergeGuestIntoCustomer(guestId: string, customerId: string) {
  const guestCart = await db.cart.findUnique({ where: { guestId }, include: { items: true } });
  if (!guestCart || guestCart.items.length === 0) return;
  const target = await getOrCreateCartId({ customerId, guestId: null });
  await db.$transaction(async (tx) => {
    for (const item of guestCart.items) {
      const existing = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: target, variantId: item.variantId } } });
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: target, variantId: item.variantId } },
        create: { cartId: target, variantId: item.variantId, quantity: item.quantity, savedForLater: item.savedForLater },
        update: { quantity: Math.min(MAX_QTY, (existing?.quantity ?? 0) + item.quantity) },
      });
    }
    if (guestCart.promoCode) await tx.cart.update({ where: { id: target }, data: { promoCode: guestCart.promoCode } });
    await tx.cart.delete({ where: { id: guestCart.id } });
    // Favourites follow the shopper too.
    const favs = await tx.favorite.findMany({ where: { guestId } });
    for (const f of favs) {
      await tx.favorite.upsert({
        where: { customerId_productId: { customerId, productId: f.productId } },
        create: { customerId, productId: f.productId },
        update: {},
      });
    }
    await tx.favorite.deleteMany({ where: { guestId } });
  });
}
