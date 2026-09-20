import { z } from 'zod';
import { localeSchema, moneySchema, phoneSchema } from './common';

export const driverVerificationStatusSchema = z.enum([
  /** Signed up, but no park roster row has been attached to this account yet. */
  'UNLINKED',
  /** A membership exists but is awaiting review. */
  'PENDING',
  /** Has an active, eligible park membership and may withdraw. */
  'VERIFIED',
  /** Withdrawals are blocked for this driver (risk, park decision, or compliance). */
  'BLOCKED',
]);
export type DriverVerificationStatus = z.infer<typeof driverVerificationStatusSchema>;

export const parkStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export type ParkStatus = z.infer<typeof parkStatusSchema>;

export const membershipStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const membershipEligibilitySchema = z.enum(['ELIGIBLE', 'INELIGIBLE', 'PENDING_REVIEW']);
export type MembershipEligibility = z.infer<typeof membershipEligibilitySchema>;

/** A park as the driver sees it. */
export const parkSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  status: parkStatusSchema,
  currency: z.string(),
});
export type ParkSummaryDto = z.infer<typeof parkSummarySchema>;

/** One row of the driver's roster memberships. */
export const membershipSchema = z.object({
  id: z.string().uuid(),
  park: parkSummarySchema,
  /** The contractor profile id inside the park — the "Driver ID". */
  externalProfileId: z.string(),
  status: membershipStatusSchema,
  eligibility: membershipEligibilitySchema,
  /** True when the driver may activate this park right now. */
  available: z.boolean(),
  isActive: z.boolean(),
});
export type MembershipDto = z.infer<typeof membershipSchema>;

/**
 * How the server resolved the phone number against the roster:
 *  - NONE: no membership at all — the driver is not in any park;
 *  - ACTIVE: an active park is selected (chosen, or the only one);
 *  - CHOOSE: several eligible parks and none selected yet.
 */
export const parkResolutionSchema = z.enum(['NONE', 'ACTIVE', 'CHOOSE']);
export type ParkResolution = z.infer<typeof parkResolutionSchema>;

export const driverProfileSchema = z.object({
  id: z.string().uuid(),
  phone: phoneSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  locale: localeSchema,
  verificationStatus: driverVerificationStatusSchema,
  resolution: parkResolutionSchema,
  activePark: parkSummarySchema.nullable(),
  /** The Driver ID in the active park. */
  driverId: z.string().nullable(),
  membershipCount: z.number().int().nonnegative(),
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
  /** The park the figures belong to. */
  park: parkSummarySchema,
  asOf: z.string().datetime(),
  /** False when the figure came from cache because Yandex was unreachable. */
  fresh: z.boolean(),
  /** Present when `fresh` is false: how old the cached figure is. */
  staleSeconds: z.number().int().nonnegative().optional(),
});
export type BalanceDto = z.infer<typeof balanceSchema>;

export const activateParkSchema = z.object({
  parkId: z.string().uuid(),
});
export type ActivateParkDto = z.infer<typeof activateParkSchema>;
