import { z } from 'zod';

/** E.164, which is what both the OTP gateway and Yandex profiles use. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, e.g. +37411223344');

export const currencySchema = z.enum(['AMD', 'RUB', 'USD', 'EUR', 'GEL', 'KZT']);

/**
 * Money on the wire is always `{ minor: "12345", currency: "AMD" }`.
 *
 * A JSON number cannot represent every amount we handle without loss, and a
 * bare decimal string invites a client to parse it as a float. Minor units as a
 * string is the only representation that survives every client we do not
 * control.
 */
export const moneySchema = z.object({
  minor: z.string().regex(/^-?\d+$/, 'minor must be an integer string'),
  currency: currencySchema,
});

export type MoneyDto = z.infer<typeof moneySchema>;

export const localeSchema = z.enum(['hy', 'ru', 'en']);
export type Locale = z.infer<typeof localeSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const idSchema = z.string().uuid();

/**
 * The client-supplied idempotency key for any state-changing money operation.
 * The mobile app generates one per user intent, not per HTTP attempt, so that a
 * retry after a timeout is recognised as the same intent.
 */
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key must be URL-safe');
