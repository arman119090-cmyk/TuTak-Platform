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

/**
 * Normalises what a person typed into E.164, or returns null.
 *
 * Armenian numbers are the common case: "094 12 34 56", "094123456",
 * "+374 94 123456" and "374941234 56" all mean +37494123456. Anything that
 * already starts with "+" is kept as typed once the separators are gone.
 */
export function normalisePhone(raw: string, defaultCountryCode = '374'): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  let candidate: string;
  if (digits.startsWith('+')) {
    candidate = digits;
  } else if (digits.startsWith('00')) {
    candidate = `+${digits.slice(2)}`;
  } else if (digits.startsWith('0') && digits.length === 9) {
    candidate = `+${defaultCountryCode}${digits.slice(1)}`;
  } else if (
    digits.startsWith(defaultCountryCode) &&
    digits.length === defaultCountryCode.length + 8
  ) {
    candidate = `+${digits}`;
  } else if (/^\d{8}$/.test(digits)) {
    candidate = `+${defaultCountryCode}${digits}`;
  } else {
    candidate = `+${digits}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}
