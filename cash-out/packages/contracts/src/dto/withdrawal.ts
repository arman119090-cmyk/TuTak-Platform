import { z } from 'zod';
import { idempotencyKeySchema, moneySchema } from './common';

export const withdrawalStateSchema = z.enum([
  'CREATED',
  'RISK_CHECK',
  'RISK_REVIEW',
  'REJECTED',
  'RESERVING',
  'RESERVE_UNCERTAIN',
  'RESERVE_PENDING',
  'RESERVED',
  'PAYOUT_SUBMITTING',
  'PAYOUT_UNCERTAIN',
  'PAYOUT_SUBMITTED',
  'PAYOUT_CONFIRMED',
  'COMPLETED',
  'PAYOUT_FAILED',
  'PAYOUT_RETURNED',
  'COMPENSATING',
  'REVERSED',
  'FAILED',
  'MANUAL_REVIEW',
]);

export const driverVisibleStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'UNDER_REVIEW',
]);

/**
 * Ask the server what a given withdrawal would cost. Quotes are signed and
 * short-lived; the driver confirms the exact quote they were shown, and the
 * server refuses to execute a quote it did not issue.
 */
export const createQuoteSchema = z
  .object({
    payoutMethodId: z.string().uuid(),
    /** Mutually exclusive with `all`. */
    amount: moneySchema.optional(),
    /** "Withdraw everything" — the server picks the largest amount that works. */
    all: z.boolean().default(false),
  })
  .refine((value) => (value.all ? value.amount === undefined : value.amount !== undefined), {
    message: 'Provide either an amount or all=true, not both',
  });
export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;

export const quoteSchema = z.object({
  quoteId: z.string().uuid(),
  /** Deducted from the Yandex balance. */
  gross: moneySchema,
  platformFee: moneySchema,
  providerFee: moneySchema,
  totalFee: moneySchema,
  /** What reaches the driver's card or account. */
  net: moneySchema,
  payoutMethodId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  /** The balance the quote was computed against, so the client can detect drift. */
  balanceAtQuote: moneySchema,
  /** HMAC over the quote's fields; the confirm call must present it unchanged. */
  signature: z.string(),
});
export type QuoteDto = z.infer<typeof quoteSchema>;

export const confirmWithdrawalSchema = z.object({
  quoteId: z.string().uuid(),
  signature: z.string(),
  idempotencyKey: idempotencyKeySchema,
});
export type ConfirmWithdrawalDto = z.infer<typeof confirmWithdrawalSchema>;

export const withdrawalSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: driverVisibleStatusSchema,
  /** Full internal state — returned to admins, omitted for drivers. */
  state: withdrawalStateSchema.optional(),
  gross: moneySchema,
  platformFee: moneySchema,
  providerFee: moneySchema,
  totalFee: moneySchema,
  net: moneySchema,
  payoutMethod: z.object({
    id: z.string().uuid(),
    maskedIdentifier: z.string(),
    displayName: z.string().nullable(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  /** Machine-readable reason when the withdrawal did not succeed. */
  failureCode: z.string().nullable(),
  /** Best estimate of when the money lands, for the processing screen. */
  estimatedArrival: z.string().datetime().nullable(),
});
export type WithdrawalDto = z.infer<typeof withdrawalSchema>;

export const withdrawalListSchema = z.object({
  items: z.array(withdrawalSchema),
  nextCursor: z.string().nullable(),
});
export type WithdrawalListDto = z.infer<typeof withdrawalListSchema>;

export const withdrawalTimelineEntrySchema = z.object({
  state: withdrawalStateSchema,
  at: z.string().datetime(),
  note: z.string().nullable(),
});
export type WithdrawalTimelineEntryDto = z.infer<typeof withdrawalTimelineEntrySchema>;
