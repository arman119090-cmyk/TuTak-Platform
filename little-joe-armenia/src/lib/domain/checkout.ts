import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Locale } from "@/i18n/config";
import { hashToken, hmacHex, randomToken, safeEqual } from "@/lib/security/crypto";
import { findCart, loadPromotion, type Owner } from "@/lib/domain/cart";
import { InsufficientStockError, reserve } from "@/lib/domain/inventory";
import { computeTotals, evaluatePromotion, type PricingLine } from "@/lib/domain/pricing";
import { visibleProductWhere, pickT } from "@/lib/catalog";
import { adapterFor } from "@/lib/payments/registry";
import type { CheckoutData } from "@/lib/validation/checkout";
import { deliveryName, deliveryOptions } from "@/lib/domain/delivery";

/**
 * Guest access token for the order page. Derived from the client's
 * idempotency key (known only to that browser) so a retried submit after a
 * lost response gets the same link back. Only its hash is stored.
 */
export function orderAccessToken(idempotencyKey: string): string {
  return hmacHex(`${env().SESSION_SECRET}:order-access`, idempotencyKey).slice(0, 40);
}

export type PlaceOrderResult =
  | { ok: true; orderId: string; number: string; accessToken: string; online: boolean; existing: boolean }
  | {
      ok: false;
      error:
        | "EMPTY_CART"
        | "CART_PROBLEM"
        | "OUT_OF_STOCK"
        | "DELIVERY_INVALID"
        | "PAYMENT_UNAVAILABLE"
        | "PROMO_INVALID";
    };

function orderNumber(): string {
  // LJ-YYMMDD-XXXX (Crockford base32 without ambiguous chars).
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = randomToken(8);
  let suffix = "";
  for (let i = 0; i < 5; i++) suffix += alphabet[bytes.charCodeAt(i) % alphabet.length];
  return `LJ-${ymd}-${suffix}`;
}

/**
 * Places an order from the shopper's cart. Everything is re-read and
 * re-priced from the database — nothing the browser sends is trusted except
 * the form fields validated by checkoutSchema.
 *
 * One transaction: create order + items, reserve stock row by row (atomic
 * conditional UPDATE, variant ids sorted to avoid deadlocks), consume the
 * promo usage (conditional UPDATE), remove purchased lines from the cart.
 * Any failure rolls everything back.
 *
 * Idempotent on `idempotencyKey`: a double click or a retried request after
 * a network error returns the order created by the first attempt.
 */
export async function placeOrder(owner: Owner, data: CheckoutData, locale: Locale): Promise<PlaceOrderResult> {
  const accessToken = orderAccessToken(data.idempotencyKey);
  const existing = await db.order.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
  if (existing) {
    return { ok: true, orderId: existing.id, number: existing.number, accessToken, online: existing.paymentProvider !== "CASH_ON_DELIVERY", existing: true };
  }

  const cart = await findCart(owner);
  const items = cart?.items.filter((i) => !i.savedForLater) ?? [];
  if (!cart || items.length === 0) return { ok: false, error: "EMPTY_CART" };

  const visibleIds = new Set(
    (
      await db.product.findMany({
        where: { AND: [visibleProductWhere(), { id: { in: items.map((i) => i.variant.productId) } }] },
        select: { id: true },
      })
    ).map((p) => p.id),
  );
  if (items.some((i) => !visibleIds.has(i.variant.productId) || !i.variant.isActive || i.variant.priceAmd === null)) {
    return { ok: false, error: "CART_PROBLEM" };
  }

  // Delivery method must be active and serve the chosen region.
  const options = await deliveryOptions(data.region);
  const method = options.find((m) => m.code === data.deliveryMethod);
  if (!method) return { ok: false, error: "DELIVERY_INVALID" };

  // Payment method must be enabled and technically available.
  const setting = await db.paymentMethodSetting.findUnique({ where: { provider: data.payment } });
  const online = data.payment !== "CASH_ON_DELIVERY";
  if (!setting?.isEnabled || (online && !adapterFor(data.payment))) return { ok: false, error: "PAYMENT_UNAVAILABLE" };

  const lines: PricingLine[] = items.map((i) => ({
    variantId: i.variantId,
    productId: i.variant.productId,
    collectionId: i.variant.product.collectionId,
    unitAmd: i.variant.priceAmd!,
    quantity: i.quantity,
  }));

  let promotionId: string | null = null;
  let discountAmd = 0;
  if (cart.promoCode) {
    const promo = await loadPromotion(cart.promoCode);
    const evaluation = evaluatePromotion(promo, lines, new Date());
    if (!evaluation.ok || !promo) return { ok: false, error: "PROMO_INVALID" };
    promotionId = promo.id;
    discountAmd = evaluation.discountAmd;
  }
  const totals = computeTotals({ lines, discountAmd, delivery: method });

  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));

  try {
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: orderNumber(),
          accessTokenHash: hashToken(accessToken),
          idempotencyKey: data.idempotencyKey,
          status: online ? "AWAITING_PAYMENT" : "PENDING",
          paymentProvider: data.payment,
          paymentStatus: "PENDING",
          stockState: "RESERVED",
          reservationExpiresAt: online ? new Date(Date.now() + env().RESERVATION_TTL_MINUTES * 60_000) : null,
          customerId: owner.customerId,
          locale,
          customerName: data.name,
          customerPhone: data.phone,
          customerEmail: data.email,
          region: data.region,
          city: data.city,
          street: data.street,
          building: data.building,
          apartment: data.apartment,
          entrance: data.entrance,
          floor: data.floor,
          comment: data.comment,
          deliveryMethodCode: method.code,
          deliveryMethodName: deliveryName(method, locale),
          subtotalAmd: totals.subtotalAmd,
          discountAmd: totals.discountAmd,
          deliveryAmd: totals.deliveryAmd,
          totalAmd: totals.totalAmd,
          promoCode: promotionId ? cart.promoCode : null,
          promotionId,
          items: {
            create: sorted.map((i) => ({
              variantId: i.variantId,
              productSlug: i.variant.product.slug,
              name: pickT(i.variant.product.translations, locale)?.name ?? i.variant.product.slug,
              sku: i.variant.sku,
              unitAmd: i.variant.priceAmd!,
              quantity: i.quantity,
              lineAmd: i.variant.priceAmd! * i.quantity,
            })),
          },
          history: { create: { to: online ? "AWAITING_PAYMENT" : "PENDING", actor: "checkout" } },
        },
      });

      for (const i of sorted) await reserve(tx, i.variantId, i.quantity, created.id);

      if (promotionId) {
        const used = await tx.$executeRaw`
          UPDATE "Promotion" SET "usedCount" = "usedCount" + 1
          WHERE "id" = ${promotionId} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
        if (used !== 1) throw new PromoExhaustedError();
        await tx.promotionRedemption.create({ data: { promotionId, orderId: created.id } });
      }

      await tx.cartItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
      await tx.cart.update({ where: { id: cart.id }, data: { promoCode: null } });

      if (data.saveAddress && owner.customerId) {
        await tx.address.create({
          data: {
            customerId: owner.customerId,
            region: data.region,
            city: data.city,
            street: data.street,
            building: data.building,
            apartment: data.apartment,
            entrance: data.entrance,
            floor: data.floor,
            comment: data.comment,
          },
        });
      }
      return created;
    });
    return { ok: true, orderId: order.id, number: order.number, accessToken, online, existing: false };
  } catch (e) {
    if (e instanceof InsufficientStockError) return { ok: false, error: "OUT_OF_STOCK" };
    if (e instanceof PromoExhaustedError) return { ok: false, error: "PROMO_INVALID" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Concurrent duplicate submit with the same idempotency key.
      const again = await db.order.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (again) return { ok: true, orderId: again.id, number: again.number, accessToken, online, existing: true };
    }
    throw e;
  }
}

class PromoExhaustedError extends Error {}

/** Order lookup for the confirmation page: by access token or by owner. */
export async function findOrderForViewer(number: string, token: string | undefined, owner: Owner) {
  const order = await db.order.findUnique({
    where: { number },
    include: { items: true, history: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) return null;
  const tokenOk = token !== undefined && token.length < 100 && safeEqual(hashToken(token), order.accessTokenHash);
  const ownerOk = owner.customerId !== null && order.customerId === owner.customerId;
  return tokenOk || ownerOk ? order : null;
}
