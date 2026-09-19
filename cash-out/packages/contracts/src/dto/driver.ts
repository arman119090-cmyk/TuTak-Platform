import { z } from 'zod';
import { localeSchema, moneySchema, phoneSchema } from './common';

export const driverVerificationStatusSchema = z.enum([
  /** Signed up, but we have not matched them to a Yandex contractor profile yet. */
  'UNLINKED',
  /** A candidate profile was found and is awaiting confirmation. */
  'PENDING',
  /** Matched and allowed to withdraw. */
  'VERIFIED',
  /** Matched, but withdrawals are blocked (risk, park decision, or compliance). */
  'BLOCKED',
]);
export type DriverVerificationStatus = z.infer<typeof driverVerificationStatusSchema>;

export const driverProfileSchema = z.object({
  id: z.string().uuid(),
  phone: phoneSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  locale: localeSchema,
  verificationStatus: driverVerificationStatusSchema,
  parkId: z.string().nullable(),
  parkName: z.string().nullable(),
  yandexContractorProfileId: z.string().nullable(),
  currency: z.string().nullable(),
});
export type DriverProfileDto = z.infer<typeof driverProfileSchema>;

export const balanceSchema = z.object({
  /** What Yandex reports for the driver's park account, as of `asOf`. */
  available: moneySchema,
  /** Already committed to withdrawals that have not finished. */
  reservedByPendingWithdrawals: moneySchema,
  /** `available` minus what is reserved: the most the driver may request now. */
  withdrawable: moneySchema,
  asOf: z.string().datetime(),
  /** False when the figure came from cache because Yandex was unreachable. */
  fresh: z.boolean(),
  /** Present when `fresh` is false: how old the cached figure is. */
  staleSeconds: z.number().int().nonnegative().optional(),
});
export type BalanceDto = z.infer<typeof balanceSchema>;

export const linkDriverSchema = z.object({
  /** The park the driver says they work for. */
  parkId: z.string().min(1).max(64),
  /**
   * Last four digits of the driver licence, used as a second factor when
   * matching a phone number to a Yandex contractor profile.
   */
  licenceLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});
export type LinkDriverDto = z.infer<typeof linkDriverSchema>;
