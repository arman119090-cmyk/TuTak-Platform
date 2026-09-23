import { randomUUID } from "node:crypto";
import { testDb } from "./db";
import { checkoutSchema, type CheckoutData, type CheckoutInput } from "@/lib/validation/checkout";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Collection + ACTIVE non-demo Product + one Variant. */
export async function createVariant(opts: { priceAmd?: number; stock?: number; collectionId?: string } = {}) {
  const collection =
    opts.collectionId !== undefined
      ? await testDb.collection.findUniqueOrThrow({ where: { id: opts.collectionId } })
      : await testDb.collection.create({ data: { slug: `col-${uniq()}` } });
  const product = await testDb.product.create({
    data: { slug: `prod-${uniq()}`, status: "ACTIVE", isDemo: false, collectionId: collection.id },
  });
  const variant = await testDb.variant.create({
    data: {
      productId: product.id,
      sku: `SKU-${uniq()}`,
      priceAmd: opts.priceAmd ?? 2500,
      stockOnHand: opts.stock ?? 10,
    },
  });
  return { collection, product, variant };
}

/** Active delivery method for every region + COD and IDRAM enabled. */
export async function createShopSettings(delivery: { priceAmd?: number; freeFromAmd?: number | null } = {}) {
  await testDb.deliveryMethod.create({
    data: {
      code: "courier",
      priceAmd: delivery.priceAmd ?? 1000,
      freeFromAmd: delivery.freeFromAmd ?? null,
      regions: [],
      nameHy: "Առաքիչ",
      nameRu: "Курьер",
      nameIt: "Corriere",
      nameEn: "Courier",
    },
  });
  await testDb.paymentMethodSetting.createMany({
    data: [
      { provider: "CASH_ON_DELIVERY", isEnabled: true, sortOrder: 0 },
      { provider: "IDRAM", isEnabled: true, sortOrder: 1 },
    ],
  });
}

/** A guest with a cart holding the given lines. Returns the Owner for placeOrder. */
export async function createGuestCart(lines: { variantId: string; quantity: number }[], promoCode?: string) {
  const guest = await testDb.guest.create({ data: { tokenHash: `hash-${randomUUID()}` } });
  await testDb.cart.create({
    data: {
      guestId: guest.id,
      promoCode: promoCode ?? null,
      items: { create: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) },
    },
  });
  return { customerId: null, guestId: guest.id };
}

export function checkoutData(over: Partial<CheckoutInput> = {}): CheckoutData {
  return checkoutSchema.parse({
    idempotencyKey: `key_${randomUUID().replace(/-/g, "")}`,
    name: "Ani Petrosyan",
    phone: "091234567",
    email: "ani@example.am",
    region: "ER",
    city: "Yerevan",
    street: "Abovyan",
    building: "1",
    deliveryMethod: "courier",
    payment: "CASH_ON_DELIVERY",
    ...over,
  } satisfies CheckoutInput);
}

export async function variantStock(id: string) {
  return testDb.variant.findUniqueOrThrow({ where: { id }, select: { stockOnHand: true, reserved: true } });
}
