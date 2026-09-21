import { z } from 'zod';
import { LOCALES } from './i18n';

/**
 * Every request body that reaches the database is parsed here first. Route
 * handlers never trust a field they have not run through one of these schemas.
 */

const ARMENIAN_PHONE = /^(\+374|0)\d{8}$/;

export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()\-]/g, ''))
  .refine((value) => ARMENIAN_PHONE.test(value), { message: 'invalid_phone' });

export const localeSchema = z.enum(LOCALES);

export const emailSchema = z.string().trim().toLowerCase().email({ message: 'invalid_email' });

export const cartItemSchema = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(20),
  options: z.record(z.string().max(32), z.string().max(64)).optional(),
  doorConfig: z.record(z.string().max(32), z.string().max(64)).optional(),
});

export const deliverySchema = z.object({
  method: z.enum(['DELIVERY', 'PICKUP']),
  regionKey: z.string().max(40).nullish(),
  floor: z.number().int().min(0).max(60).nullish(),
  hasLift: z.boolean().optional(),
});

export const servicesSchema = z.object({
  lift: z.boolean().optional(),
  assembly: z.boolean().optional(),
  doorInstall: z.boolean().optional(),
});

export const quoteRequestSchema = z.object({
  items: z.array(cartItemSchema).max(40),
  promoCode: z.string().trim().max(32).nullish(),
  delivery: deliverySchema.optional(),
  services: servicesSchema.optional(),
  locale: localeSchema.optional(),
});

export const checkoutSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(40),
  promoCode: z.string().trim().max(32).nullish(),
  locale: localeSchema.default('ru'),
  contacts: z.object({
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().max(60).optional().default(''),
    phone: phoneSchema,
    email: emailSchema,
  }),
  delivery: z.object({
    method: z.enum(['DELIVERY', 'PICKUP']),
    regionKey: z.string().max(40).nullish(),
    city: z.string().trim().max(80).nullish(),
    street: z.string().trim().max(120).nullish(),
    building: z.string().trim().max(20).nullish(),
    apartment: z.string().trim().max(20).nullish(),
    entrance: z.string().trim().max(20).nullish(),
    floor: z.number().int().min(0).max(60).nullish(),
    hasLift: z.boolean().default(true),
    pickupPoint: z.string().max(60).nullish(),
    slot: z.string().max(40).nullish(),
    comment: z.string().trim().max(500).nullish(),
  }),
  services: servicesSchema.default({}),
  payment: z.object({
    method: z.enum(['CARD', 'CASH', 'CASH_ON_DELIVERY']),
    /** DEMO only: lets the demo walk both the happy and the declined path. */
    demoOutcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(100),
    passwordRepeat: z.string().min(8).max(100),
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().max(60).optional().default(''),
    phone: phoneSchema.optional(),
    locale: localeSchema.default('ru'),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    message: 'password_mismatch',
    path: ['passwordRepeat'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(100),
});

export const otpRequestSchema = z.object({ phone: phoneSchema });

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/),
});

export const profileSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().max(60).optional().default(''),
  phone: phoneSchema.optional().nullable(),
  locale: localeSchema,
});

export const addressSchema = z.object({
  label: z.string().trim().min(2).max(60),
  region: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(80),
  street: z.string().trim().min(2).max(120),
  building: z.string().trim().min(1).max(20),
  apartment: z.string().trim().max(20).optional().default(''),
  entrance: z.string().trim().max(20).optional().default(''),
  floor: z.number().int().min(0).max(60).optional().nullable(),
  hasLift: z.boolean().default(true),
  comment: z.string().trim().max(300).optional().default(''),
  isDefault: z.boolean().default(false),
});

export const requestSchema = z.object({
  type: z.enum([
    'KITCHEN',
    'MEASUREMENT',
    'DOOR',
    'CALLBACK',
    'CUSTOM_SIZE',
    'PRICE_REQUEST',
    'CONSULTATION',
  ]),
  name: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal('')),
  comment: z.string().trim().max(1000).optional().default(''),
  productId: z.string().max(64).optional().nullable(),
  locale: localeSchema.default('ru'),
  payload: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

export const newsletterSchema = z.object({ email: emailSchema, locale: localeSchema.default('ru') });

export const reviewSchema = z.object({
  productId: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional().default(''),
  body: z.string().trim().min(10).max(2000),
  locale: localeSchema.default('ru'),
});

// ------------------------------------------------------------------ admin ---

export const adminProductSchema = z.object({
  sku: z.string().trim().min(3).max(40),
  slug: z.string().trim().min(3).max(120),
  categoryId: z.string().min(1),
  brandId: z.string().min(1),
  collectionId: z.string().nullish(),
  priceMinor: z.number().int().min(0).max(1_000_000_000),
  oldPriceMinor: z.number().int().min(0).max(1_000_000_000).nullish(),
  stockStatus: z.enum(['IN_STOCK', 'ON_ORDER', 'OUT_OF_STOCK']),
  stockQty: z.number().int().min(0).max(100_000),
  productionDays: z.number().int().min(0).max(365),
  widthMm: z.number().int().min(0).max(100_000).nullish(),
  heightMm: z.number().int().min(0).max(100_000).nullish(),
  depthMm: z.number().int().min(0).max(100_000).nullish(),
  weightGram: z.number().int().min(0).max(10_000_000).nullish(),
  country: z.string().trim().min(2).max(2),
  warrantyMonths: z.number().int().min(0).max(240),
  styleKey: z.string().trim().min(2).max(40),
  purposeKey: z.string().trim().min(2).max(40),
  roomKey: z.string().trim().min(2).max(40),
  colorKeys: z.array(z.string().max(40)).max(12),
  materialKeys: z.array(z.string().max(40)).max(12),
  specs: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
  isNew: z.boolean().default(false),
  isHit: z.boolean().default(false),
  isPremium: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  smallSpace: z.boolean().default(false),
  isActive: z.boolean().default(true),
  translations: z
    .array(
      z.object({
        locale: localeSchema,
        name: z.string().trim().min(3).max(200),
        shortDescription: z.string().trim().max(400).default(''),
        description: z.string().trim().max(4000).default(''),
      }),
    )
    .min(1),
  images: z.array(z.object({ url: z.string().min(1).max(500), alt: z.string().max(200).default('') })).default([]),
  options: z
    .array(
      z.object({
        kind: z.enum(['COLOR', 'MATERIAL', 'SIZE']),
        valueKey: z.string().min(1).max(64),
        label: z.string().max(80).nullish(),
        priceDeltaMinor: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(0),
        isDefault: z.boolean().default(false),
      }),
    )
    .default([]),
});

export const adminOrderStatusSchema = z.object({
  status: z.enum([
    'NEW',
    'CONFIRMED',
    'PAID',
    'IN_PRODUCTION',
    'READY',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
  ]),
  comment: z.string().trim().max(500).optional().default(''),
});

export const adminPromoSchema = z.object({
  code: z.string().trim().min(3).max(32).toUpperCase(),
  discountType: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().min(1).max(1_000_000_000),
  minSubtotalMinor: z.number().int().min(0).nullish(),
  maxDiscountMinor: z.number().int().min(0).nullish(),
  freeDelivery: z.boolean().default(false),
  usageLimit: z.number().int().min(1).nullish(),
  isActive: z.boolean().default(true),
  description: z.string().trim().max(200).default(''),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
});

export const adminRequestUpdateSchema = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED']),
  adminNote: z.string().trim().max(1000).optional().default(''),
});

/** Bulk import: a JSON array, or CSV converted to rows by the import route. */
export const importRowSchema = z.object({
  sku: z.string().trim().min(3).max(40),
  categorySlug: z.string().trim().min(2).max(80),
  brandSlug: z.string().trim().min(2).max(80),
  priceMinor: z.coerce.number().int().min(0),
  oldPriceMinor: z.coerce.number().int().min(0).optional(),
  stockQty: z.coerce.number().int().min(0).default(0),
  nameRu: z.string().trim().min(3).max(200),
  nameHy: z.string().trim().max(200).optional(),
  nameEn: z.string().trim().max(200).optional(),
  descriptionRu: z.string().trim().max(4000).optional(),
  colorKeys: z.string().max(200).optional(),
  materialKeys: z.string().max(200).optional(),
  styleKey: z.string().max(40).optional(),
  widthMm: z.coerce.number().int().min(0).optional(),
  heightMm: z.coerce.number().int().min(0).optional(),
  depthMm: z.coerce.number().int().min(0).optional(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

/** Flattens a ZodError into `{ field: message }` for form rendering. */
export const fieldErrors = (error: z.ZodError): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!(path in result)) result[path] = issue.message;
  }
  return result;
};
