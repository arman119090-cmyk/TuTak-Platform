import { z } from "zod";
import { REGION_CODES, normalizeArmenianPhone } from "@/lib/armenia";

// Shared by the checkout form (client validation, localised messages via
// error codes) and the server action (authoritative validation).
// Error messages are message keys under `validation.*`.

const text = (max: number) => z.string().trim().max(max, "tooLong");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .optional()
    .transform((v) => (v ? v : undefined));

export const PAYMENT_CODES = ["CASH_ON_DELIVERY", "IDRAM", "TELCELL", "BANK_CARD"] as const;

export const checkoutSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  name: text(80).min(2, "nameInvalid"),
  phone: z
    .string()
    .trim()
    .max(30, "tooLong")
    .refine((v) => normalizeArmenianPhone(v) !== null, "phoneInvalid")
    .transform((v) => normalizeArmenianPhone(v)!),
  email: z
    .string()
    .trim()
    .max(120, "tooLong")
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => v === undefined || z.email().safeParse(v).success, "emailInvalid"),
  region: z.enum(REGION_CODES, { message: "regionInvalid" }),
  city: text(80).min(1, "required"),
  street: text(120).min(1, "required"),
  building: text(20).min(1, "required"),
  apartment: optionalText(20),
  entrance: optionalText(10),
  floor: optionalText(10),
  comment: optionalText(500),
  deliveryMethod: z.string().min(1, "deliveryInvalid").max(40),
  payment: z.enum(PAYMENT_CODES, { message: "paymentInvalid" }),
  saveAddress: z.boolean().optional(),
});

export type CheckoutInput = z.input<typeof checkoutSchema>;
export type CheckoutData = z.output<typeof checkoutSchema>;

export const reviewSchema = z.object({
  productId: z.string().min(1).max(40),
  authorName: z.string().trim().min(2, "nameInvalid").max(60, "tooLong"),
  rating: z.coerce.number().int().min(1, "ratingInvalid").max(5, "ratingInvalid"),
  body: z.string().trim().min(10, "reviewTooShort").max(2000, "tooLong"),
});
