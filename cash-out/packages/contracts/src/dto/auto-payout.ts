import { z } from 'zod';
import { moneySchema } from './common';

export const autoPayoutCadenceSchema = z.enum(['ON_THRESHOLD', 'DAILY', 'WEEKLY']);
export type AutoPayoutCadence = z.infer<typeof autoPayoutCadenceSchema>;

/**
 * Enabling or changing the rule. The server owns the bounds (from the park's
 * limit policy) and the schedule; the app only sends what the driver chose,
 * plus the PIN/biometric authorization that is their consent.
 */
export const upsertAutoPayoutSchema = z
  .object({
    cadence: autoPayoutCadenceSchema,
    threshold: moneySchema,
    /** Omit for "everything available". */
    maxPayout: moneySchema.optional(),
    /** Local hour 0–23 for DAILY/WEEKLY. */
    runHour: z.number().int().min(0).max(23).optional(),
    /** 0 = Sunday … 6 = Saturday, for WEEKLY. */
    runWeekday: z.number().int().min(0).max(6).optional(),
    authorizationToken: z.string().min(16).max(256),
  })
  .refine((value) => value.cadence === 'ON_THRESHOLD' || value.runHour !== undefined, {
    message: 'runHour is required for a daily or weekly schedule',
  })
  .refine((value) => value.cadence !== 'WEEKLY' || value.runWeekday !== undefined, {
    message: 'runWeekday is required for a weekly schedule',
  });
export type UpsertAutoPayoutDto = z.infer<typeof upsertAutoPayoutSchema>;

export const autoPayoutRuleSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
  paused: z.boolean(),
  pausedReason: z.string().nullable(),
  cadence: autoPayoutCadenceSchema,
  threshold: moneySchema,
  maxPayout: moneySchema.nullable(),
  runHour: z.number().int().nullable(),
  runWeekday: z.number().int().nullable(),
  timezone: z.string(),
  park: z.object({ id: z.string().uuid(), name: z.string() }),
  destination: z.object({
    id: z.string().uuid(),
    maskedIdentifier: z.string(),
    displayName: z.string().nullable(),
    status: z.string(),
  }),
  nextCheckAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  lastWithdrawalId: z.string().uuid().nullable(),
  lastFailureCode: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  authorizationMethod: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type AutoPayoutRuleDto = z.infer<typeof autoPayoutRuleSchema>;

/** What the server allows; the app renders its form from this, never from constants. */
export const autoPayoutConstraintsSchema = z.object({
  minThreshold: moneySchema,
  maxPayout: moneySchema,
  cadences: z.array(autoPayoutCadenceSchema),
  checkIntervalSeconds: z.number().int().positive(),
  timezone: z.string(),
});
export type AutoPayoutConstraintsDto = z.infer<typeof autoPayoutConstraintsSchema>;

export const autoPayoutStateSchema = z.object({
  rule: autoPayoutRuleSchema.nullable(),
  constraints: autoPayoutConstraintsSchema,
});
export type AutoPayoutStateDto = z.infer<typeof autoPayoutStateSchema>;
